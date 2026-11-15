# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «rbac» (deploy/test/smoke.sh runs it in a subshell of its own): RBAC: roles, the analyst, scoped roles.

step "RBAC: built-in roles exist, a Security Analyst"
ensure_analyst

step "RBAC: the analyst sees hosts, WAF and events"
expect "$(as_analyst "$ADMIN/api/nginx/proxy-hosts")" 200 "analyst lists proxy hosts"
expect "$(as_analyst "$ADMIN/api/nginxions/events")" 200 "analyst reads WAF events"
expect "$(as_analyst "$ADMIN/api/nginxions/waf/policy")" 200 "analyst reads the WAF policy"

step "RBAC: the analyst changes the WAF mode, not the host"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
  -d '{"enabled": true, "mode": "detect-learn", "minimum_confidence": "high"}')" 200 "analyst sets the WAF mode"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts/1" \
  -d '{"forward_port": 81}')" 403 "analyst changes a proxy host"
expect "$(as_analyst -X DELETE "$ADMIN/api/nginx/proxy-hosts/1")" 403 "analyst deletes a proxy host"
expect "$(as_analyst -X POST "$ADMIN/api/nginxions/services/nginxions/restart")" 403 "analyst restarts a service"
expect "$(as_analyst "$ADMIN/api/users")" 403 "analyst lists users"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/rbac/users/$analyst_id" \
  -d '{"roles": [1]}')" 403 "analyst makes itself an administrator"

step "RBAC: the last administrator keeps the role"
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
  "$ADMIN/api/nginxions/rbac/users/1" -d '{"roles": []}')
expect "$code" 400 "removing the last administrator"

step "RBAC: a role of chosen hosts sees test.local, not another host of the administrator"
other_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d '{
  "domain_names": ["other.local"], "forward_scheme": "http", "forward_host": "test-upstream", "forward_port": "80"
}' | tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
scoped_role=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/rbac/roles" -d '{"name": "test.local team",
  "scope": "hosts", "hosts": [{"host_type": "proxy_host", "host_id": 1}], "permissions": ["proxy_hosts:view"]}' \
  | tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/rbac/users/$analyst_id" \
  -d "{\"roles\": [$scoped_role]}" > /dev/null
seen=$(curl -sS -k -b $AJAR "$ADMIN/api/nginx/proxy-hosts" | tr -d ' \n')
echo "$seen" | grep -q '"domain_names":\["test.local"\]' || fail "the role does not see its host: $seen"
echo "$seen" | grep -q 'other.local' && fail "the role sees a host it was not given: $seen"
expect "$(as_analyst "$ADMIN/api/nginx/proxy-hosts/$other_id")" 404 "the role opens a host it was not given"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/rbac/users/$analyst_id" \
  -d "{\"roles\": [$analyst_role]}" > /dev/null
$CURL -X DELETE "$ADMIN/api/nginx/proxy-hosts/$other_id" > /dev/null

step "Login: an account is locked after 5 wrong passwords, also for the right one (any address)"
lock_email="locked-$(date +%s)@nginxions.test"
for i in 1 2 3 4 5; do
  expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' "$ADMIN/api/tokens" \
    -d "{\"identity\": \"$lock_email\", \"secret\": \"wrong-$i\"}")" 400 "wrong password $i"
done
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' "$ADMIN/api/tokens" \
  -d "{\"identity\": \"$lock_email\", \"secret\": \"anything\"}")" 429 "the locked account"
