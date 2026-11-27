#!/bin/sh
# Smoke scenarios run inside the closed network against a fresh stack (scripts/test-airgap.sh).
#
# The base part (the first administrator, the proxy host test.local) runs first; then the groups of deploy/test/smoke/
# (mounted on /smoke.d), each in a subshell of its own: a failed group does not stop the next ones, every failure
# of the run is seen at once. SMOKE_GROUPS chooses them (a list, "all" by default); a group needs no other: what it
# needs (the analyst, the WAF on test.local) it makes with ensure_* below, so groups run on separate stacks in
# parallel (CI). Every step is logged with its time in /state/smoke-steps.tsv (group, step, start, result) and every
# group in /state/smoke-groups.tsv, for the report of the run and the history of flaky steps.
set -eu

ADMIN="https://nginxions:81"
HTTP="http://nginxions"
EMAIL="admin@nginxions.test"
PASSWORD="nginxions-airgap-$(date +%s)"
# cookie jar on a volume shared between tester runs (session must survive an nginxions restart)
JAR=/state/cookies
CURL="curl -sS --fail-with-body --max-time 30 -k -b $JAR -c $JAR"
GROUPS_DIR="${GROUPS_DIR:-/smoke.d}"
ALL_GROUPS="services waf hosts rbac events pki certs crowdsec migration"
STEPS=/state/smoke-steps.tsv
GROUP=base

# the step that ends where the next starts, or where its group ends: a failure is logged before the exit
step() {
  echo "==> $*"
  printf '%s\t%s\t%s\tok\n' "$GROUP" "$(echo "$*" | tr '\t' ' ')" "$(date +%s)" >> "$STEPS" 2> /dev/null || true
}
fail() {
  echo "FAIL: $*" >&2
  printf '%s\t%s\t%s\tFAIL\n' "$GROUP" "FAIL: $(echo "$*" | tr '\t\n' '  ' | cut -c1-300)" "$(date +%s)" >> "$STEPS" 2> /dev/null || true
  exit 1
}

wait_api() {
  for i in $(seq 1 60); do
    $CURL "$ADMIN/api/" 2>/dev/null | grep -q '"status": *"OK"' && return 0
    sleep 2
  done
  fail "admin API did not become ready"
}

if [ "${1:-}" = after-restart ]; then
  step "session is still valid after nginxions restart (persistent COOKIE_SECRET)"
  wait_api
  $CURL "$ADMIN/api/users/me" | grep -q '"email": *"admin@nginxions.test"' || fail "session lost after restart"
  echo "OK: after-restart scenarios passed"
  exit 0
fi

if [ "${1:-}" = fail-close ]; then
  step "WAF -> Agent: enable fail-close for the agent fault test"
  wait_api
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/agent" \
    -d '{"fail_open": {"enabled": false, "timeout_ms": 50}}' | grep -q '"restarting": *true' \
    || fail "saving agent settings did not restart the agent"
  sleep 7
  for i in $(seq 1 90); do
    if $CURL "$ADMIN/api/nginxions/waf/agent" 2> /dev/null | grep -q '"restartRequired": *false' \
      && $CURL "$ADMIN/api/nginxions/waf" 2> /dev/null | grep -q '"reachable": *true'; then
      exit 0
    fi
    sleep 2
  done
  fail "the agent did not come back in fail-close"
fi

# ---------------------------------------------------------------- helpers of every group

want() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1"; }
expect() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1"; }
json() { tr -d ' \n'; }
api_json() { $CURL -H 'Content-Type: application/json' "$@"; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$HTTP$1"; }
SQLI="/?id=1%27%20OR%20%271%27=%271"
wait_status() {
  for i in $(seq 1 60); do
    [ "$(status "$1")" = "$2" ] && return 0
    sleep 2
  done
  fail "$3 (last status $(status "$1"))"
}
new_id() { json | grep -o '^{"id":[0-9]*' | grep -o '[0-9]*$'; }
post_json() { $CURL -X "$1" -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/policy$2" -d "$3"; }
host_objects() {
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" -d "{\"enabled\": true,
    \"mode\": \"prevent-learn\", \"minimum_confidence\": \"high\", \"objects\": $1}" > /dev/null
}

# the Security Analyst (rbac, events, pki): made once, its id kept for the next groups of this run
AJAR=/tmp/analyst-cookies
as_analyst() { curl -sS -k -b $AJAR -o /dev/null -w '%{http_code}' "$@"; }
ensure_analyst() {
  roles=$($CURL "$ADMIN/api/nginxions/rbac/roles" | tr -d ' \n')
  analyst_role=$(echo "$roles" | grep -o '"id":[0-9]*,"name":"[^"]*","description":"[^"]*","builtin":"security_analyst"' \
    | grep -o '^"id":[0-9]*' | grep -o '[0-9]*')
  [ -n "$analyst_role" ] || fail "no Security Analyst role: $roles"
  analyst_id=$(cat /tmp/analyst-id 2> /dev/null || true)
  if [ -z "$analyst_id" ]; then
    analyst_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/users" \
      -d '{"name": "Analyst", "nickname": "analyst", "email": "analyst@nginxions.test", "roles": [], "is_disabled": false}' \
      | tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
    [ -n "$analyst_id" ] || fail "the analyst was not created"
    echo "$analyst_id" > /tmp/analyst-id
    $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/users/$analyst_id/auth" \
      -d "{\"type\": \"password\", \"secret\": \"$PASSWORD-analyst\"}" > /dev/null
  fi
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/rbac/users/$analyst_id" \
    -d "{\"roles\": [$analyst_role]}" > /dev/null
  curl -sS -k -c $AJAR -H 'Content-Type: application/json' "$ADMIN/api/tokens" \
    -d "{\"identity\": \"analyst@nginxions.test\", \"secret\": \"$PASSWORD-analyst\"}" > /dev/null
}

# test.local protected in prevent-learn and the agent blocking (events, crowdsec): what the group waf sets up first
ensure_waf_on() {
  $CURL "$ADMIN/api/nginxions/waf" | grep -q '"reachable": *true' || return 0
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
  for i in $(seq 1 90); do
    $CURL "$ADMIN/api/nginxions/waf" | grep -q '"lastPolicyUpdate": *"' && break
    [ "$i" = 90 ] && fail "agent did not apply a policy: $($CURL "$ADMIN/api/nginxions/waf")"
    sleep 2
  done
  wait_status "$SQLI" 403 "SQLi is not blocked on test.local in prevent-learn"
}

# ---------------------------------------------------------------- base: what every group starts from

: > "$STEPS" 2> /dev/null || true
: > /state/smoke-groups.tsv 2> /dev/null || true
base_start=$(date +%s)

step "admin API is up"
wait_api

step "initial setup: create the first admin"
$CURL -H 'Content-Type: application/json' "$ADMIN/api/users" -d "{
  \"name\": \"Admin\", \"nickname\": \"admin\", \"email\": \"$EMAIL\",
  \"auth\": {\"type\": \"password\", \"secret\": \"$PASSWORD\"}
}" > /dev/null

step "log in"
$CURL -H 'Content-Type: application/json' "$ADMIN/api/tokens" \
  -d "{\"identity\": \"$EMAIL\", \"secret\": \"$PASSWORD\"}" > /dev/null

step "duplicate email is rejected and does not crash the backend"
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' "$ADMIN/api/users" \
  -d "{\"name\": \"Dup\", \"nickname\": \"dup\", \"email\": \"$EMAIL\"}")
[ "$code" = 400 ] || fail "duplicate email: expected 400, got $code"
sleep 2
$CURL "$ADMIN/api/" | grep -q '"status": *"OK"' || fail "backend is down after duplicate email"

step "disabling a 404 host that does not exist answers 404 and does not crash the backend"
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -X POST "$ADMIN/api/nginx/dead-hosts/999999/disable")
[ "$code" = 404 ] || fail "disable of a missing 404 host: expected 404, got $code"
sleep 2
$CURL "$ADMIN/api/" | grep -q '"status": *"OK"' || fail "backend is down after disabling a missing 404 host"

step "a ?expand= that is not a relation answers 400, not an internal error (found by ZAP)"
for expand in 'http%3A%2F%2Fwww.google.com%2F' 'nothing' '%5Bowner'; do
  code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' "$ADMIN/api/nginx/access-lists?expand=$expand")
  [ "$code" = 400 ] || fail "access lists with ?expand=$expand: expected 400, got $code"
done
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' "$ADMIN/api/nginx/access-lists?expand=owner,items")
[ "$code" = 200 ] || fail "access lists with ?expand=owner,items: expected 200, got $code"

step "create a proxy host test.local -> test-upstream"
$CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d '{
  "domain_names": ["test.local"], "forward_scheme": "http",
  "forward_host": "test-upstream", "forward_port": "80"
}' > /dev/null

step "request goes through the proxy"
for i in $(seq 1 15); do
  body=$(curl -sS --max-time 10 -H 'Host: test.local' "$HTTP/" || true)
  echo "$body" | grep -q '^Hostname:' && break
  [ "$i" = 15 ] && fail "proxy host did not answer: $body"
  sleep 2
done

step "upstream sees the real client IP"
client_ip=$(hostname -i | awk '{print $1}')
echo "$body" | grep -qiE "^X-(Real-Ip|Forwarded-For): .*$client_ip" || fail "client IP $client_ip not forwarded: $body"

step "update check stays off"
$CURL "$ADMIN/api/version/check" | grep -q '"latest": *"unknown"' || fail "update check is not disabled"
$CURL "$ADMIN/api/nginxions/system/release" | json | grep -q '"canAutoUpdate":false,"autoUpdate":false' \
  || fail "automatic updates must stay off on a direct Compose deployment"
expect "$(curl -ksS --max-time 5 -o /dev/null -w '%{http_code}' -X POST \
  "$ADMIN/api/nginxions/system/release/check")" 403 "an anonymous version check"
expect "$(curl -ksS --max-time 5 -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT \
  -H 'Content-Type: application/json' -d '{"enabled":true}' "$ADMIN/api/nginxions/system/release")" 400 \
  "enabling automatic updates without the host updater"

printf 'base\tok\t%s\n' "$(($(date +%s) - base_start))" >> /state/smoke-groups.tsv 2> /dev/null || true

# ---------------------------------------------------------------- the groups

selected=" ${SMOKE_GROUPS:-all} "
[ "$selected" = " all " ] && selected=" $ALL_GROUPS "
selected=$(echo "$selected" | tr ',' ' ')
failed=""
ran=""
for g in $ALL_GROUPS; do
  case " $selected " in *" $g "*) ;; *) continue ;; esac
  echo
  echo "======== group $g"
  start=$(date +%s)
  set +e
  (
    set -e
    GROUP=$g
    # shellcheck source=/dev/null
    . "$GROUPS_DIR/$g.sh"
  )
  rc=$?
  set -e
  took=$(($(date +%s) - start))
  if [ "$rc" = 0 ]; then result=ok; else result=FAIL; failed="$failed $g"; fi
  ran="$ran $g"
  printf '%s\t%s\t%s\n' "$g" "$result" "$took" >> /state/smoke-groups.tsv 2> /dev/null || true
  echo "======== group $g: $result in ${took} s"
done
for g in $selected; do
  case " $ALL_GROUPS " in *" $g "*) ;; *) fail "unknown smoke group $g (groups: $ALL_GROUPS)" ;; esac
done

echo
echo "groups:$ran"
if [ -n "$failed" ]; then
  echo "FAIL: smoke groups failed:$failed" >&2
  exit 1
fi
echo "OK: closed-network smoke passed"
