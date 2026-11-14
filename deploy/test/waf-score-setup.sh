#!/bin/sh
# Setup of scripts/test-waf-score.sh, run in the closed network: the first admin, the proxy host test.local in front of
# test-upstream, its WAF in prevent-learn with the recommended practice (minimum confidence high). Ready when an
# SQL injection is refused and a normal request passes.
set -eu
ADMIN="https://nginxions:81"
HTTP="http://nginxions"
EMAIL="admin@nginxions.test"
PASSWORD="nginxions-wafscore-$(date +%s)"
JAR=/tmp/cookies
CURL="curl -sS --fail-with-body --max-time 30 -k -b $JAR -c $JAR"
fail() { echo "FAIL: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$HTTP$1"; }

for i in $(seq 1 60); do
  $CURL "$ADMIN/api/" 2> /dev/null | grep -q '"status": *"OK"' && break
  [ "$i" = 60 ] && fail "the API did not come up"
  sleep 2
done
$CURL -H 'Content-Type: application/json' "$ADMIN/api/users" -d "{\"name\": \"Admin\", \"nickname\": \"admin\",
  \"email\": \"$EMAIL\", \"auth\": {\"type\": \"password\", \"secret\": \"$PASSWORD\"}}" > /dev/null
$CURL -H 'Content-Type: application/json' "$ADMIN/api/tokens" \
  -d "{\"identity\": \"$EMAIL\", \"secret\": \"$PASSWORD\"}" > /dev/null
$CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d '{"domain_names": ["test.local"],
  "forward_scheme": "http", "forward_host": "test-upstream", "forward_port": "80"}' > /dev/null
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
  -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
# the agent loads the policy; fail-open lets a request through while it reloads: three refusals in a row
ok=0
for i in $(seq 1 90); do
  if [ "$(status "/?id=1%27%20OR%20%271%27=%271")" = 403 ]; then ok=$((ok + 1)); else ok=0; fi
  [ "$ok" = 3 ] && break
  [ "$i" = 90 ] && fail "the WAF does not block an SQL injection on test.local"
  sleep 2
done
[ "$(status /)" = 200 ] || fail "a normal request to test.local is refused"
echo "OK: test.local is protected"
