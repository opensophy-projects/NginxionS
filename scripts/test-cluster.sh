#!/usr/bin/env bash
# Several servers of NginxionS (docs/ROADMAP.md, phase 15, step 15.7; docs/adr/0012-nodes.md): a manager and two
# nodes, each a whole stack of its own on this machine (deploy/test/compose.cluster.yaml), in the closed network: the
# stacks reach each other over an internal network only, nothing reaches outside Docker. Everything is done through
# the API of the GUI, as an administrator would:
#   join         two nodes join the manager with one-time codes (CSR, PKI, token), online
#   rollout      a host with its WAF given to both nodes comes in their signed packages: proxied, an attack blocked
#   events       the security event of a node comes to the manager with the id of the node
#   rollback     a package nginx refuses on the nodes is rolled back there (the host still served), the error is in
#                the rollout; fixed on the manager, the nodes apply it
#   drain        a node taken out of work drops its hosts, back in work serves them again; the other one never stops
#   plan         hosts given to a label reach every node with it; a staged rollout reaches the canary first, the
#                other node with "Roll out to all nodes"; a node held on its package before drops the change
#   learning     the agents of the nodes reach the shared storage of the manager (through the relay of their node);
#                normal traffic of three sources through the three servers is put together by smartsync (windows of a
#                minute here: NGINXIONS_LEARNING_INTERVAL_MINUTES of compose.cluster.yaml)
#   bans         a ban on one node is held by the others, an unban there lifts it everywhere
#   link down    the manager unreachable: the nodes keep proxying and blocking; the event of the outage reaches the
#                manager once the link is back
#   command      "restart the agent" of a node is done with its heartbeat, written in the rollout
#   revoke       a node disabled on the manager learns it and keeps serving on its own
#   profile      a profile of the manager for new nodes: a node joining again takes it and blocks the first attack
#
#   NGINXIONS_REGISTRY=docker.io/opensophy NGINXIONS_VERSION=<tag> scripts/test-cluster.sh
#   KEEP=1 leaves the stacks running; OUT=reports/cluster the report and the logs
set -euo pipefail

cd "$(dirname "$0")/.."
CURL_VERSION=$(grep -m1 '^CURL_VERSION=' deploy/.env | cut -d= -f2)
OUT="${OUT:-reports/cluster}"
NET="${CLUSTER_NETWORK:-nginxions-cluster}"
SUBNET=172.30.250.0/24
PROBE_IP=172.30.250.5
# two more clients: three sources of traffic for the learning put together, one to ban
declare -A CLIENT=([b]=172.30.250.6 [c]=172.30.250.7)
STACKS=(manager node1 node2)
declare -A IP=([manager]=172.30.250.10 [node1]=172.30.250.11 [node2]=172.30.250.12)
probe="nginxions-cluster-probe"
state="nginxions-cluster-state"
SQLI="/?id=1%27%20OR%20%271%27=%271"
DOMAIN="shop.local"
mkdir -p "$OUT/logs"
export CLUSTER_NETWORK="$NET"

# the compose of one stack
stack() { # name, compose arguments...
  local s=$1
  shift
  CLUSTER_STACK="$s" CLUSTER_IP="${IP[$s]}" COMPOSE_PROJECT_NAME="nginxions-cluster-$s" \
    docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml -f deploy/test/compose.cluster.yaml "$@"
}

steps=()
current=""
started=$(date +%s)
step_started=$started
step() {
  [ -n "$current" ] && steps+=("| $current | ✅ | $(($(date +%s) - step_started)) |")
  current="$*"
  step_started=$(date +%s)
  echo "==> $*"
}
report() { # result of the last step
  [ -n "$current" ] && steps+=("| $current | $1 | $(($(date +%s) - step_started)) |")
  {
    echo "## Several servers: a manager and two nodes"
    echo
    echo "| step | result | s |"
    echo "|---|---|---|"
    printf '%s\n' "${steps[@]}"
    echo
    echo "$(($(date +%s) - started)) s in all."
  } > "$OUT/cluster.md"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/cluster.md" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then report "❌"; else report "✅"; fi
  for s in "${STACKS[@]}"; do stack "$s" logs --no-color > "$OUT/logs/$s.log" 2>&1 || true; done
  docker rm -f "$probe" "$probe-b" "$probe-c" > /dev/null 2>&1 || true
  [ -n "${traffic_pid:-}" ] && kill "$traffic_pid" 2> /dev/null
  if [ "${KEEP:-}" != 1 ]; then
    for s in "${STACKS[@]}"; do stack "$s" down -v --remove-orphans > /dev/null 2>&1 || true; done
    docker volume rm "$state" > /dev/null 2>&1 || true
    docker network rm "$NET" > /dev/null 2>&1 || true
  fi
  exit $status
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*"
  exit 1
}

# the API of the panel of a stack, with its session: stack, method, path under /api, [JSON body]
call() {
  local s=$1 m=$2 p=$3 d=${4:-}
  local args=(-sS --max-time 30 -k -b "/state/$s.jar" -c "/state/$s.jar" -X "$m" "https://${IP[$s]}:81/api$p")
  [ -n "$d" ] && args+=(-H 'Content-Type: application/json' -d "$d")
  docker exec "$probe" curl "${args[@]}" 2> /dev/null || true
}
# the code of an answer of a site through the nginx of a stack: stack, path
code() { docker exec "$probe" curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $DOMAIN" "http://${IP[$1]}$2" || true; }
# the site is proxied to its upstream (whoami answers "Hostname:")
proxied() { docker exec "$probe" curl -s --max-time 10 -H "Host: $DOMAIN" "http://${IP[$1]}/" 2> /dev/null | grep -q '^Hostname:'; }
up() { call "$1" GET / | grep -q '"status": *"OK"'; }
# a host proxied through the nginx of a stack: stack, host
serves() { docker exec "$probe" curl -s --max-time 10 -H "Host: $2" "http://${IP[$1]}/" 2> /dev/null | grep -q '^Hostname:'; }
not_serves() { ! serves "$@"; }
# the code of an answer to another client (b, c): client, stack, path
code_from() { docker exec "$probe-$1" curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $DOMAIN" "http://${IP[$2]}$3" || true; }
# repeats a check until it passes: what, tries, seconds between, the check...
until_ok() {
  local what=$1 tries=$2 every=$3 i
  shift 3
  for i in $(seq 1 "$tries"); do
    "$@" && return 0
    sleep "$every"
  done
  fail "$what"
}
# three answers in a row: stack, path, code
answers() {
  local ok=0 i
  for i in $(seq 1 90); do
    if [ "$(code "$1" "$2")" = "$3" ]; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" -ge 3 ] && return 0
    sleep 2
  done
  return 1
}
# the site answers only this during a time: stack, path, code, seconds
holds() {
  local i c
  for i in $(seq 1 "$4"); do
    c=$(code "$1" "$2")
    [ "$c" = "$3" ] || return 1
    sleep 1
  done
}
# the panel of a stack, after a restart (a change of the learning role restarts the agent and nginxions with it)
panels_up() { for s in "$@"; do until_ok "the panel of $s does not come back" 120 2 up "$s"; done; }
# a field of the node row on the manager: node id, jq filter on the row
node_field() { call manager GET /nginxions/nodes | jq -r --argjson id "$1" ".[] | select(.id == \$id) | $2" 2> /dev/null; }
member() { call "$1" GET /nginxions/cluster/member; }

step "three stacks: a manager and two nodes, in the closed network"
docker network create --internal --subnet "$SUBNET" "$NET" > /dev/null
for s in "${STACKS[@]}"; do
  stack "$s" up -d --no-build nginxions openappsec crowdsec test-upstream > "$OUT/logs/$s-up.log" 2>&1 &
done
wait
for s in "${STACKS[@]}"; do
  for i in $(seq 1 150); do
    h=$(docker inspect -f '{{.State.Health.Status}}' "$s-nginxions" 2> /dev/null || true)
    [ "$h" = healthy ] && break
    [ "$i" = 150 ] && fail "nginxions of $s is not healthy: $h ($(cat "$OUT/logs/$s-up.log"))"
    sleep 2
  done
done
docker volume create "$state" > /dev/null
docker run -d --user 0 --name "$probe" --network "$NET" --ip "$PROBE_IP" -v "$state:/state" --entrypoint sleep \
  "docker.io/curlimages/curl:$CURL_VERSION" 7200 > /dev/null
for c in b c; do
  docker run -d --user 0 --name "$probe-$c" --network "$NET" --ip "${CLIENT[$c]}" --entrypoint sleep \
    "docker.io/curlimages/curl:$CURL_VERSION" 7200 > /dev/null
done
panels_up "${STACKS[@]}"

step "the first administrator of each server"
for s in "${STACKS[@]}"; do
  email="admin@$s.test"
  password="cluster-$s-$(date +%s)"
  call "$s" POST /users "{\"name\": \"Admin\", \"nickname\": \"admin\", \"email\": \"$email\",
    \"auth\": {\"type\": \"password\", \"secret\": \"$password\"}}" > /dev/null
  call "$s" POST /tokens "{\"identity\": \"$email\", \"secret\": \"$password\"}" | grep -q '"expires"' \
    || fail "no login on $s"
done

step "the manager: $DOMAIN in front of its upstream, the WAF blocking"
host_id=$(call manager POST /nginx/proxy-hosts "{\"domain_names\": [\"$DOMAIN\"], \"forward_scheme\": \"http\",
  \"forward_host\": \"test-upstream\", \"forward_port\": \"80\"}" | jq -r '.id // empty')
[ -n "$host_id" ] || fail "the host $DOMAIN was not created on the manager"
call manager PUT "/nginxions/waf/hosts/$host_id" \
  '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
answers manager "$SQLI" 403 || fail "the manager does not block an SQL injection on $DOMAIN"

step "join: two nodes join the manager with one-time codes and are online"
manager_fingerprint=$(stack manager exec -T nginxions sh -c '
  openssl s_client -connect 127.0.0.1:81 -noservername </dev/null 2>/dev/null |
    openssl x509 -noout -sha256 -fingerprint
')
manager_fingerprint=${manager_fingerprint#*=}
declare -A NODE_ID NODE_UID
for s in node1 node2; do
  answer=$(call manager POST /nginxions/nodes "{\"name\": \"$s\", \"labels\": [\"cluster\"]}")
  NODE_ID[$s]=$(echo "$answer" | jq -r '.node.id // empty')
  NODE_UID[$s]=$(echo "$answer" | jq -r '.node.uid // empty')
  code_of=$(echo "$answer" | jq -r '.code // empty')
  [ -n "${NODE_ID[$s]}" ] && [ -n "$code_of" ] || fail "no node or code for $s: $answer"
  joined=$(call "$s" PUT /nginxions/cluster/member \
    "{\"manager_url\": \"https://${IP[manager]}:81\", \"code\": \"$code_of\", \"manager_fingerprint\": \"$manager_fingerprint\"}")
  echo "$joined" | jq -e '.joined == true' > /dev/null || fail "$s did not join: $joined"
done
# the first node makes the manager learn for the cluster (smartsync), each node learns through the manager: their
# agents restart, nginxions with them
sleep 10
panels_up "${STACKS[@]}"
online() { [ "$(node_field "${NODE_ID[$1]}" .state)" = online ]; }
for s in node1 node2; do until_ok "$s is not online on the manager" 60 3 online "$s"; done

# the package of a node: applied, nothing left out, no error; its version
applied_version() {
  node_field "${NODE_ID[$1]}" '.info | select((.package_version // "" | length) == 64 and .package_skipped == 0
    and (.package_error // "") == "") | .package_version'
}
applied() { [ -n "$(applied_version "$1")" ]; }
changed_package() {
  local version
  version=$(applied_version "$1")
  [ -n "$version" ] && [ "$version" != "$2" ]
}

step "rollout: $DOMAIN given to both nodes comes in their signed packages; proxied there, an attack blocked"
declare -A version_before
for s in node1 node2; do
  until_ok "$s did not report its initial package" 40 3 applied "$s"
  initial_version=$(applied_version "$s")
  call manager PUT "/nginxions/nodes/${NODE_ID[$s]}/hosts" "{\"host_ids\": [$host_id]}" | jq -e ". == [$host_id]" \
    > /dev/null || fail "$DOMAIN was not given to $s"
  until_ok "$s did not report applying the package with $DOMAIN" 40 3 changed_package "$s" "$initial_version"
  version_before[$s]=$(applied_version "$s")
done
for s in node1 node2; do
  until_ok "$s does not proxy $DOMAIN" 30 2 proxied "$s"
  answers "$s" "$SQLI" 403 || fail "$s does not block an SQL injection on $DOMAIN (its WAF mode came in the package)"
done
# the host is a row of the node (managed), not of the manager's database
call node1 GET /nginx/proxy-hosts | jq -e "[.[] | select(.domain_names == [\"$DOMAIN\"])] | length == 1" > /dev/null \
  || fail "$DOMAIN is not a host of node1"

step "events: the attack on node1 is an event on the manager with the id of node1"
event_of() { # stack (node), text in the event
  call manager GET "/nginxions/events?kind=security&period=1h&node=${NODE_UID[$1]}&host=$DOMAIN&limit=50" | grep -q "$2"
}
until_ok "no event of node1 on the manager" 45 2 event_of node1 "$DOMAIN"

step "rollback: a package nginx refuses is rolled back on the nodes and told; fixed, it is applied"
call manager PUT "/nginx/proxy-hosts/$host_id" '{"advanced_config": "nginxions_cluster_test_not_a_directive on;"}' \
  > /dev/null
package_failed() { [[ "$(node_field "${NODE_ID[$1]}" '.info.package_error // ""')" == "nginx refused "* ]]; }
for s in node1 node2; do
  until_ok "$s did not refuse the package nginx cannot load" 40 3 package_failed "$s"
  proxied "$s" || fail "$s does not serve $DOMAIN after the rollback"
  [ "$(node_field "${NODE_ID[$s]}" .info.package_version)" = "${version_before[$s]}" ] \
    || fail "$s does not keep the package before"
done
rollout_failed() {
  call manager GET "/nginxions/nodes/rollout?node_id=${NODE_ID[$1]}" \
    | jq -e '[.. | objects | select(.kind == "package" and .result == "failed")] | length > 0' > /dev/null
}
until_ok "the refused package is not in the rollout" 20 3 rollout_failed node1
call manager PUT "/nginx/proxy-hosts/$host_id" '{"advanced_config": ""}' > /dev/null
# the fixed host is the host before: the package applied is the one before again, without its error
restored_package() { [ "$(applied_version "$1")" = "${version_before[$1]}" ]; }
for s in node1 node2; do until_ok "$s did not report the restored package" 40 3 restored_package "$s"; done

step "drain: node2 out of work drops $DOMAIN, node1 keeps it; back in work node2 serves it again"
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/drain" '{"drained": true}' | jq -e '.drained == true' > /dev/null \
  || fail "node2 was not taken out of work"
not_proxied() { ! proxied "$1"; }
until_ok "node2 still serves $DOMAIN out of work" 40 3 not_proxied node2
proxied node1 || fail "node1 stopped serving $DOMAIN while node2 was out of work"
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/drain" '{"drained": false}' > /dev/null
until_ok "node2 does not serve $DOMAIN back in work" 40 3 proxied node2
until_ok "node2 did not report its package back in work" 40 3 restored_package node2

step "plan: hosts of a label, a staged rollout to the canary first, a node held on its package before"
lab_id=$(call manager POST /nginx/proxy-hosts '{"domain_names": ["lab.local"], "forward_scheme": "http",
  "forward_host": "test-upstream", "forward_port": "80"}' | jq -r '.id // empty')
[ -n "$lab_id" ] || fail "the host lab.local was not created on the manager"
call manager PUT /nginxions/nodes/staged '{"staged": true}' | jq -e '.staged == true' > /dev/null \
  || fail "the staged rollout was not switched on"
call manager PUT "/nginxions/nodes/${NODE_ID[node1]}/canary" '{"canary": true}' | jq -e '.canary == true' > /dev/null \
  || fail "node1 is not a canary"
held_version=$(node_field "${NODE_ID[node2]}" .info.package_version)
# both nodes have the label "cluster": lab.local goes to every node with it
call manager PUT /nginxions/nodes/label-hosts/cluster "{\"host_ids\": [$lab_id]}" | jq -e ". == [$lab_id]" > /dev/null \
  || fail "lab.local was not given to the label cluster"
until_ok "the canary node1 does not serve lab.local" 40 3 serves node1 lab.local
sleep 35
serves node2 lab.local && fail "node2 got the change before the staged rollout reached it"
[ "$(node_field "${NODE_ID[node2]}" .info.package_version)" = "$held_version" ] || fail "node2 left its package"
call manager POST /nginxions/nodes/staged/promote | jq -e '.promoted >= 1' > /dev/null || fail "the rollout was not promoted"
until_ok "node2 does not serve lab.local after the rollout to all nodes" 40 3 serves node2 lab.local
# back to the package before on node2 only: lab.local goes from it, node1 keeps it
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/packages" "{\"version\": \"$held_version\"}" \
  | jq -e '.pinned.by == "manual"' > /dev/null || fail "node2 was not held on its package before"
until_ok "node2 still serves lab.local held on its package before" 40 3 not_serves node2 lab.local
serves node1 lab.local || fail "node1 dropped lab.local when node2 was rolled back"
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/packages" '{"version": null}' > /dev/null
until_ok "node2 does not serve lab.local again" 40 3 serves node2 lab.local
call manager PUT /nginxions/nodes/staged '{"staged": false}' > /dev/null
call manager PUT "/nginxions/nodes/${NODE_ID[node1]}/canary" '{"canary": false}' > /dev/null

step "learning: the agents of the nodes reach the shared storage of the manager"
learns() { member "$1" | jq -e '.learning.last_ok_on // empty' > /dev/null; }
for s in node1 node2; do until_ok "the agent of $s did not reach the storage of the manager: $(member "$s")" 60 3 learns "$s"; done

step "learning together: traffic of three sources through the three servers is learned, the same through one node is not"
# Use a known parameter type (comma-delimited filters) with three sources in this isolated stack.
# Keep the default thresholds for keywords, number of windows and ratio.
call manager PUT /nginxions/cluster/learning \
  '{"min_sources": 3, "min_sources_types": 3, "min_intervals": 5, "ratio_threshold": 0.8}' \
  | jq -e '.minSourcesTypes == 3' > /dev/null || fail "the manager did not set the test threshold for types"

learning_request() { # client suffix, stack, parameter, sample suffix
  docker exec "$probe$1" curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: $DOMAIN" \
    "http://${IP[$2]}/search?$3=blue%2Cmedium%2Clinen%2C$4"
}
learning_round() {
  local sequence=$1 endpoint s client
  # Each source sends one parameter through its own server and the other through node1 alone.
  # The samples vary across clients and rounds so a cached clean value cannot stand in for fresh traffic.
  for endpoint in manager: node1:-b node2:-c; do
    s=${endpoint%:*}
    client=${endpoint#*:}
    [ "$(learning_request "$client" "$s" shared_filters "$sequence-$s")" = 200 ] || return 1
    [ "$(learning_request "$client" node1 isolated_filters "$sequence-$s")" = 200 ] || return 1
  done
}
learning_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
until_ok "the learning requests do not reach all three servers" 20 3 learning_round 0
(
  i=0
  while true; do
    i=$((i + 1))
    learning_round "$i" || true
    sleep 1
  done
) > /dev/null 2>&1 &
traffic_pid=$!
# the windows of the site from this server and both nodes, and a sync of smartsync since (files under remote/)
together() {
  call manager GET /nginxions/nodes/cluster-learning > "$OUT/learning-status.json"
  jq -e --arg d "$DOMAIN" --arg since "$learning_started" '[.assets[]
    | select(.asset == $d)
    | select(.local.lastOn >= $since and ([.nodes[] | select(.lastOn >= $since)] | length) == 2
      and .mergedOn >= $since)]
    | length > 0' "$OUT/learning-status.json" > /dev/null
}
until_ok "no learning of the three servers put together (see learning-status.json)" 90 10 together
# Read the types smartsync put together in the manager's shared storage.
norm() {
  docker exec manager-openappsec wget -qO- --header='X-Tenant-Id: local' \
    "http://127.0.0.1:7811/api/$DOMAIN/Type/Confidence/remote/confidence.data" 2> /dev/null | gzip -cdf
}
type_learned() {
  jq -e --arg key "url_param#$1" '
    any(.confidence_levels[]?; .key == $key and any(.value[]?; .key == "comma_delimiter" and .value > 0))
    or any(.confidence_set[]?; .key == $key and any(.value.first[]?; . == "comma_delimiter"))
  ' "$OUT/learning-confidence.json" > /dev/null
}
learned_together() {
  norm > "$OUT/learning-confidence.json" || return 1
  type_learned shared_filters
}
until_ok "the type from three sources through three servers was not learned (see learning-confidence.json)" 60 10 learned_together
type_learned isolated_filters && fail "the type from three sources through node1 alone was learned (poisoning from one node)"
kill "$traffic_pid" 2> /dev/null
traffic_pid=""

step "bans: a ban on node1 is held by the manager and node2; its unban there lifts it everywhere"
# Enable enforcement for the private ban-test clients. Keep the main probe on the CrowdSec allowlist
# so its WAF assertions cannot be satisfied by a CrowdSec ban triggered by earlier requests.
cs_settings=$(call manager GET /nginxions/crowdsec/settings |
  jq -ce --arg probe "$PROBE_IP" '.bouncer.enabled = true | .allowlist.private = false | .allowlist.ips += [$probe]')
call manager PUT /nginxions/crowdsec/settings "$cs_settings" | jq -e '.result.applied == true' > /dev/null \
  || fail "the manager did not apply the CrowdSec settings for the test"
bouncer_active() {
  call "$1" GET /nginxions/crowdsec/settings |
    jq -e --arg probe "$PROBE_IP" '
      .bouncer.enabled == true and .allowlist.private == false and
      (.allowlist.ips | index($probe) != null) and (.pending | length) == 0
    ' > /dev/null
}
for s in "${STACKS[@]}"; do until_ok "CrowdSec enforcement was not enabled on $s" 60 3 bouncer_active "$s"; done

answers_from_c() { [ "$(code_from c "$1" /)" = "$2" ]; }
answers_from_c node2 200 || fail "client c is refused by node2 before any ban"
call node1 POST /nginxions/crowdsec/decisions "{\"values\": [\"${CLIENT[c]}\"], \"duration\": \"1h\", \"reason\": \"cluster test\"}" \
  | jq -e '.count == 1' > /dev/null || fail "the ban on node1 was not made"
for s in node1 manager node2; do until_ok "$s does not refuse the client banned on node1" 60 3 answers_from_c "$s" 403; done
[ "$(code_from b node2 /)" = 200 ] || fail "node2 refuses a client nobody banned"
call node1 POST /nginxions/crowdsec/decisions/delete "{\"values\": [\"${CLIENT[c]}\"]}" \
  | jq -e '.deleted > 0' > /dev/null || fail "the ban on node1 was not removed"
for s in node1 manager node2; do until_ok "the unban on node1 did not reach $s" 60 3 answers_from_c "$s" 200; done

step "link down: without the manager the nodes keep proxying and blocking; the event of the outage arrives later"
docker network disconnect "$NET" manager-openappsec
for s in node1 node2; do
  holds "$s" / 200 10 || fail "$s does not serve $DOMAIN without its manager"
  answers "$s" "$SQLI" 403 || fail "$s does not block without its manager"
done
marker="outage-$(date +%s)"
code node2 "/$marker$SQLI" > /dev/null
# heartbeats fail meanwhile: the node keeps its events on disk
sleep 40
docker network connect --ip "${IP[manager]}" "$NET" manager-openappsec
until_ok "the event of node2 during the outage did not reach the manager" 60 3 event_of node2 "$marker"
for s in node1 node2; do until_ok "$s is not online again" 40 3 online "$s"; done

step "command: \"restart the agent\" of node1 is done with its heartbeat and written in the rollout"
call manager POST "/nginxions/nodes/${NODE_ID[node1]}/command" '{"action": "restart_agent"}' > /dev/null
command_done() {
  call manager GET "/nginxions/nodes/rollout?node_id=${NODE_ID[node1]}" \
    | jq -e '[.. | objects | select(.kind == "command" and .result == "applied")] | length > 0' > /dev/null
}
until_ok "node1 did not restart its agent" 40 3 command_done
panels_up node1
answers node1 "$SQLI" 403 || fail "node1 does not block after its agent restarted"

step "revoke: node2 disabled on the manager learns it and keeps serving on its own"
call manager POST "/nginxions/nodes/${NODE_ID[node2]}/revoke" | jq -e '.state == "revoked"' > /dev/null \
  || fail "node2 was not disabled"
disabled() { member node2 | jq -e '.disabled == true' > /dev/null; }
until_ok "node2 did not learn it was disabled" 40 3 disabled
# it no longer learns through the manager: its agent restarts
sleep 10
panels_up node2
until_ok "node2 does not serve $DOMAIN on its own" 40 3 proxied node2
answers node2 "$SQLI" 403 || fail "node2 does not block on its own"
proxied node1 || fail "node1 stopped serving $DOMAIN"

step "profile: the manager gives its learning profile to new nodes; node2 joins again, takes it, blocks the first attack"
# what the agent of the manager learned of the site (the traffic of the learning step), with its WAF
make_profile() {
  profile=$(call manager POST /nginxions/learning/profiles "{\"name\": \"shop\", \"host_ids\": [$host_id], \"with_policy\": true}")
  echo "$profile" | jq -e '.id' > /dev/null
}
until_ok "no learning profile of $DOMAIN on the manager" 30 10 make_profile
profile_id=$(echo "$profile" | jq -r .id)
profile_version=$(echo "$profile" | jq -r .version)
echo "$profile" | jq -e '.policy.sites == 1' > /dev/null || fail "the profile does not carry the WAF of the site: $profile"
call manager PUT "/nginxions/learning/profiles/$profile_id" '{"for_new_nodes": true}' | jq -e '.forNewNodes == true' \
  > /dev/null || fail "the profile is not for new nodes"
call node2 DELETE /nginxions/cluster/member | jq -e '.joined == false' > /dev/null || fail "node2 did not leave"
answer=$(call manager POST /nginxions/nodes '{"name": "node2-again", "labels": ["cluster"]}')
NODE_ID[node2]=$(echo "$answer" | jq -r '.node.id')
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/hosts" "{\"host_ids\": [$host_id]}" > /dev/null
call node2 PUT /nginxions/cluster/member \
  "{\"manager_url\": \"https://${IP[manager]}:81\", \"code\": \"$(echo "$answer" | jq -r .code)\", \"manager_fingerprint\": \"$manager_fingerprint\"}" \
  | jq -e '.joined == true' > /dev/null || fail "node2 did not join again"
sleep 10
panels_up node2
took_profile() { member node2 | jq -e --arg v "$profile_version" '.profile_version == $v and .profile_error == ""' > /dev/null; }
until_ok "node2 did not take the profile of the manager: $(member node2)" 40 5 took_profile
# the agent may restart with the profile: the panel and the site back, then the first attack is refused
sleep 10
panels_up node2
until_ok "node2 does not serve $DOMAIN after it joined again" 40 3 proxied node2
waf_ready() { call node2 GET /nginxions/waf | grep -q '"reachable": *true'; }
until_ok "the agent of node2 does not answer" 40 3 waf_ready
[ "$(code node2 "/first-$(date +%s)$SQLI")" = 403 ] || fail "node2 let the first attack through after it took the profile"
step "done"
current=""
echo "OK: a manager and two nodes"
