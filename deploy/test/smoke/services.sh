# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «services» (deploy/test/smoke.sh runs it in a subshell of its own): System → Services: the stack, logs, restart of PostgreSQL, diagnostic archive.


step "System → Services: nginxions-control lists the stack: nginxions, openappsec, crowdsec, postgres and nothing more"
services=$($CURL "$ADMIN/api/nginxions/services")
for s in nginxions openappsec postgres; do
  echo "$services" | grep -q "\"service\": *\"$s\"" || fail "service $s is not listed: $services"
done
for s in nginxions-control socket-proxy appsec-agent appsec-shared-storage appsec-tuning-svc; do
  echo "$services" | grep -q "\"service\": *\"$s\"" && fail "service $s is still a container of its own"
done

step "System → Services: service logs are readable"
$CURL "$ADMIN/api/nginxions/services/nginxions/logs?tail=20" | grep -q '"line"' || fail "no nginxions logs"

step "System → Services: an unknown service is not found"
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -X POST "$ADMIN/api/nginxions/services/socket-proxy/restart")
[ "$code" = 404 ] || fail "restart of an unknown service: expected 404, got $code"

step "System → Services: restart postgres, the backend reconnects"
$CURL -X POST "$ADMIN/api/nginxions/services/postgres/restart" | grep -q '"restarted": *true' || fail "postgres restart failed"
for i in $(seq 1 30); do
  $CURL "$ADMIN/api/users/me" 2>/dev/null | grep -q "$EMAIL" && break
  [ "$i" = 30 ] && fail "backend did not reconnect to postgres"
  sleep 2
done
$CURL "$ADMIN/api/audit-log" | grep -q '"action": *"restarted"' || fail "restart is not in the audit log"

step "System → Services: regenerate nginx config, the proxy host still answers"
$CURL -X POST "$ADMIN/api/nginxions/nginx/regenerate" | grep -q '"regenerated": *true' || fail "regenerate failed"
curl -sS --max-time 10 -H 'Host: test.local' "$HTTP/" | grep -q '^Hostname:' || fail "proxy host is down after regenerate"

step "System → Services: diagnostic archive"
$CURL -o /tmp/diagnostics.zip "$ADMIN/api/nginxions/diagnostics"
[ "$(head -c 2 /tmp/diagnostics.zip)" = PK ] || fail "diagnostic archive is not a zip"
