#!/bin/sh
# The test of an update (scripts/test-upgrade.sh), run in the closed network:
#   seed    on the release before: the first admin, a proxy host under the WAF in prevent-learn, an exception object
#           of the policy, a root CA of the PKI, a ban of CrowdSec; its credentials and ids go to /state
#   verify  on the new release, on the same volumes: the same admin logs in, each of these is still there and works
set -eu
ADMIN="https://nginxions:81"
HTTP="http://nginxions"
JAR=/tmp/cookies
CURL="curl -sS --fail-with-body --max-time 30 -k -b $JAR -c $JAR"
SQLI="/?id=1%27%20OR%20%271%27=%271"
fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo "==> $*"; }
api() { $CURL -H 'Content-Type: application/json' "$@"; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$HTTP$1"; }
wait_api() {
  for i in $(seq 1 90); do
    $CURL "$ADMIN/api/" 2> /dev/null | grep -q '"status": *"OK"' && return 0
    [ "$i" = 90 ] && fail "the API did not come up"
    sleep 2
  done
}
# three answers in a row: fail-open lets a request through while the agent reloads
wait_status() {
  ok=0
  for i in $(seq 1 90); do
    if [ "$(status "$1")" = "$2" ]; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" = 3 ] && return 0
    sleep 2
  done
  fail "$3 (last status $(status "$1"))"
}

wait_api
case "${1:-}" in
seed)
  EMAIL="admin@nginxions.test"
  PASSWORD="nginxions-upgrade-$(date +%s)"
  printf '%s\n%s\n' "$EMAIL" "$PASSWORD" > /state/admin
  step "seed: admin, proxy host test.local under the WAF"
  api "$ADMIN/api/users" -d "{\"name\": \"Admin\", \"nickname\": \"admin\", \"email\": \"$EMAIL\",
    \"auth\": {\"type\": \"password\", \"secret\": \"$PASSWORD\"}}" > /dev/null
  api "$ADMIN/api/tokens" -d "{\"identity\": \"$EMAIL\", \"secret\": \"$PASSWORD\"}" > /dev/null
  api "$ADMIN/api/nginx/proxy-hosts" -d '{"domain_names": ["test.local"], "forward_scheme": "http",
    "forward_host": "test-upstream", "forward_port": "80"}' > /dev/null
  api -X PUT "$ADMIN/api/nginxions/waf/hosts/1" -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
  wait_status "$SQLI" 403 "the WAF does not block SQLi before the update"
  step "seed: an exception object, a root CA, a ban"
  api "$ADMIN/api/nginxions/waf/policy/objects" -d '{"kind": "exception", "name": "upgrade-exception",
    "spec": {"action": "accept", "condition": [{"key": "sourceIp", "value": "192.0.2.10"}]}}' > /dev/null
  api "$ADMIN/api/nginxions/pki/cas" -d '{"kind": "root", "name": "Upgrade Root",
    "subject": {"common_name": "Upgrade Root", "organization": "NginxionS"}}' > /dev/null
  api "$ADMIN/api/nginxions/crowdsec/decisions" -d '{"values": ["192.0.2.66"], "duration": "4h", "reason": "upgrade"}' > /dev/null
  echo "OK: seeded"
  ;;
verify)
  EMAIL=$(sed -n 1p /state/admin)
  PASSWORD=$(sed -n 2p /state/admin)
  step "verify: the admin of the release before logs in"
  api "$ADMIN/api/tokens" -d "{\"identity\": \"$EMAIL\", \"secret\": \"$PASSWORD\"}" > /dev/null || fail "the admin cannot log in"
  step "verify: the proxy host answers, its WAF blocks SQLi"
  for i in $(seq 1 30); do
    curl -sS --max-time 10 -H 'Host: test.local' "$HTTP/" 2> /dev/null | grep -q '^Hostname:' && break
    [ "$i" = 30 ] && fail "the proxy host does not answer after the update"
    sleep 2
  done
  wait_status "$SQLI" 403 "the WAF does not block SQLi after the update"
  $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q 'host: test.local' || fail "the rule of test.local is gone from the policy"
  step "verify: the exception object, the root CA and the ban are there"
  $CURL "$ADMIN/api/nginxions/waf/policy/objects?kind=exception" | grep -q '"upgrade-exception"' || fail "the exception object is gone"
  # the CAs of the PKI are listed by GET /pki (/pki/cas only creates)
  $CURL "$ADMIN/api/nginxions/pki" | grep -q '"Upgrade Root"' || fail "the root CA is gone"
  $CURL "$ADMIN/api/nginxions/crowdsec/decisions?q=192.0.2.66" | grep -q '192.0.2.66' || fail "the ban is gone"
  echo "OK: everything of the release before works after the update"
  ;;
*) fail "usage: upgrade-check.sh seed|verify" ;;
esac
