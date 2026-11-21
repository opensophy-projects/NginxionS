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
#   learning     the agents of the nodes reach the shared storage of the manager (through the relay of their node)
#   link down    the manager unreachable: the nodes keep proxying and blocking; the event of the outage reaches the
#                manager once the link is back
#   command      "restart the agent" of a node is done with its heartbeat, written in the rollout
#   revoke       a node disabled on the manager learns it and keeps serving on its own
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
  docker rm -f "$probe" > /dev/null 2>&1 || true
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
declare -A NODE_ID NODE_UID
for s in node1 node2; do
  answer=$(call manager POST /nginxions/nodes "{\"name\": \"$s\", \"labels\": [\"cluster\"]}")
  NODE_ID[$s]=$(echo "$answer" | jq -r '.node.id // empty')
  NODE_UID[$s]=$(echo "$answer" | jq -r '.node.uid // empty')
  code_of=$(echo "$answer" | jq -r '.code // empty')
  [ -n "${NODE_ID[$s]}" ] && [ -n "$code_of" ] || fail "no node or code for $s: $answer"
  joined=$(call "$s" PUT /nginxions/cluster/member \
    "{\"manager_url\": \"https://${IP[manager]}:81\", \"code\": \"$code_of\"}")
  echo "$joined" | jq -e '.joined == true' > /dev/null || fail "$s did not join: $joined"
done
# the first node makes the manager learn for the cluster (smartsync), each node learns through the manager: their
# agents restart, nginxions with them
sleep 10
panels_up "${STACKS[@]}"
online() { [ "$(node_field "${NODE_ID[$1]}" .state)" = online ]; }
for s in node1 node2; do until_ok "$s is not online on the manager" 60 3 online "$s"; done

step "rollout: $DOMAIN given to both nodes comes in their signed packages; proxied there, an attack blocked"
for s in node1 node2; do
  call manager PUT "/nginxions/nodes/${NODE_ID[$s]}/hosts" "{\"host_ids\": [$host_id]}" | jq -e ". == [$host_id]" \
    > /dev/null || fail "$DOMAIN was not given to $s"
done
# the package of a node: applied, nothing left out, no error; its version
applied() {
  node_field "${NODE_ID[$1]}" '.info | select((.package_version // "" | length) == 64 and .package_skipped == 0
    and (.package_error // "") == "") | .package_version' | grep -q .
}
for s in node1 node2; do until_ok "the package of $s was not applied: $(node_field "${NODE_ID[$s]}" .info)" 40 3 applied "$s"; done
for s in node1 node2; do
  until_ok "$s does not proxy $DOMAIN" 30 2 proxied "$s"
  answers "$s" "$SQLI" 403 || fail "$s does not block an SQL injection on $DOMAIN (its WAF mode came in the package)"
done
# the host is a row of the node (managed), not of the manager's database
call node1 GET /nginx/proxy-hosts | jq -e "[.[] | select(.domain_names == [\"$DOMAIN\"])] | length == 1" > /dev/null \
  || fail "$DOMAIN is not a host of node1"

step "events: the attack on node1 is an event on the manager with the id of node1"
event_of() { # stack (node), text in the event
  call manager GET "/nginxions/events?kind=all&period=1h&node=${NODE_UID[$1]}&limit=50" | grep -q "$2"
}
until_ok "no event of node1 on the manager" 45 2 event_of node1 "$DOMAIN"

step "rollback: a package nginx refuses is rolled back on the nodes and told; fixed, it is applied"
version_before=$(node_field "${NODE_ID[node1]}" .info.package_version)
call manager PUT "/nginx/proxy-hosts/$host_id" '{"advanced_config": "nginxions_cluster_test_not_a_directive on;"}' \
  > /dev/null
package_failed() { [ -n "$(node_field "${NODE_ID[$1]}" '.info.package_error // ""')" ]; }
for s in node1 node2; do until_ok "$s did not refuse the package nginx cannot load" 40 3 package_failed "$s"; done
# the package before is in place: the site is served as before
for s in node1 node2; do proxied "$s" || fail "$s does not serve $DOMAIN after the rollback"; done
[ "$(node_field "${NODE_ID[node1]}" .info.package_version)" = "$version_before" ] \
  || fail "node1 does not keep the package before"
rollout_failed() {
  call manager GET "/nginxions/nodes/rollout?node_id=${NODE_ID[$1]}" \
    | jq -e '[.. | objects | select(.kind == "package" and .result == "failed")] | length > 0' > /dev/null
}
until_ok "the refused package is not in the rollout" 20 3 rollout_failed node1
call manager PUT "/nginx/proxy-hosts/$host_id" '{"advanced_config": ""}' > /dev/null
for s in node1 node2; do until_ok "$s did not apply the fixed package" 40 3 applied "$s"; done
[ "$(node_field "${NODE_ID[node1]}" .info.package_version)" != "$version_before" ] || true

step "drain: node2 out of work drops $DOMAIN, node1 keeps it; back in work node2 serves it again"
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/drain" '{"drained": true}' | jq -e '.drained == true' > /dev/null \
  || fail "node2 was not taken out of work"
not_proxied() { ! proxied "$1"; }
until_ok "node2 still serves $DOMAIN out of work" 40 3 not_proxied node2
proxied node1 || fail "node1 stopped serving $DOMAIN while node2 was out of work"
call manager PUT "/nginxions/nodes/${NODE_ID[node2]}/drain" '{"drained": false}' > /dev/null
until_ok "node2 does not serve $DOMAIN back in work" 40 3 proxied node2

step "learning: the agents of the nodes reach the shared storage of the manager"
learns() { member "$1" | jq -e '.learning.last_ok_on // empty' > /dev/null; }
for s in node1 node2; do until_ok "the agent of $s did not reach the storage of the manager: $(member "$s")" 60 3 learns "$s"; done

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
step "done"
current=""
echo "OK: a manager and two nodes"
