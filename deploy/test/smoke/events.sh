# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «events» (deploy/test/smoke.sh runs it in a subshell of its own): events, analytics and the request log, notifications, system settings.

ensure_analyst
ensure_waf_on


step "events: stored events are filtered and exported"
$CURL "$ADMIN/api/nginxions/events?kind=all&limit=1" | grep -q '"total":' || fail "events are not listed"
$CURL "$ADMIN/api/nginxions/events/export?format=csv&kind=all" | head -1 | grep -q 'time,severity,action' \
  || fail "CSV export has no header"

step "events: the retention is set in the GUI (not by the analyst)"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/events/settings" \
  -d '{"days": 7, "aggregate_days": 90}' | grep -q '"days": *7' || fail "retention was not saved"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/events/settings" \
  -d '{"days": 1, "aggregate_days": 1}')" 403 "analyst changes the retention"

step "analytics: every request is in the request log (search, filters, export, pages, Events → All); a domain that is not a host is marked, CrowdSec counts as attacks"
curl -sS --max-time 10 -o /dev/null -H 'Host: not-a-host.local' "$HTTP/smoke-unknown" || true
curl -sS --max-time 10 -o /dev/null -H 'Host: test.local' "$HTTP/smoke-known" || true
for i in $(seq 1 20); do
  log=$($CURL "$ADMIN/api/nginxions/analytics/requests?unknown=1&path=/smoke-unknown&limit=5")
  echo "$log" | grep -q '"host": *"not-a-host.local"' && break
  [ "$i" = 20 ] && fail "the request to a domain that is not a host is not in the request log: $log"
  sleep 2
done
echo "$log" | grep -q '"known": *false' || fail "not-a-host.local is not marked as unknown: $log"
$CURL "$ADMIN/api/nginxions/analytics/requests?path=/smoke-known&limit=5" | grep -q '"known": *true' \
  || fail "the request to test.local is not in the request log as a known host"
# the log is read every 5 s and the ingest of the agent's log ran every 5 s too: it dropped the position of the
# request log, which was read again from its start (each request stored hundreds of times)
sleep 16
known=$($CURL "$ADMIN/api/nginxions/analytics/requests?path=/smoke-known&limit=1" | grep -o '"total": *[0-9]*' | grep -o '[0-9]*$')
[ "$known" = 1 ] || fail "one request is stored $known times in the request log"
# what an engineer checks by hand: as many rows as nginx served, no request lost or stored twice, and an attack of
# the agent is one event (a duplicate or a lost line of a log reader shows here)
run_id=$(date +%s)
for i in $(seq 1 20); do
  curl -sS --max-time 10 -o /dev/null -H 'Host: test.local' "$HTTP/smoke-count-$run_id?n=$i" || true
done
for i in $(seq 1 3); do
  expect "$(status "/smoke-attack-$run_id$SQLI&n=$i")" 403 "the WAF blocks the request for event $i"
done
for i in $(seq 1 30); do
  counted=$($CURL "$ADMIN/api/nginxions/analytics/requests?path=/smoke-count-$run_id&limit=1" \
    | grep -o '"total": *[0-9]*' | grep -o '[0-9]*$')
  [ "${counted:-0}" -ge 20 ] && break
  sleep 2
done
# two more rounds of the readers: a row stored twice shows up late
sleep 12
counted=$($CURL "$ADMIN/api/nginxions/analytics/requests?path=/smoke-count-$run_id&limit=1" \
  | grep -o '"total": *[0-9]*' | grep -o '[0-9]*$')
[ "$counted" = 20 ] || fail "20 requests served by nginx, $counted in the request log"
for i in $(seq 1 3); do
  for j in $(seq 1 30); do
    events=$($CURL "$ADMIN/api/nginxions/events?kind=security&host=test.local&q=smoke-attack-$run_id&limit=20")
    echo "$events" | grep -q "n=$i\"" && break
    [ "$j" = 30 ] && fail "the attack $i is not an event: $(echo "$events" | head -c 300)"
    sleep 2
  done
done
sleep 12
events=$($CURL "$ADMIN/api/nginxions/events?kind=security&host=test.local&q=smoke-attack-$run_id&limit=20")
for i in $(seq 1 3); do
  n=$(echo "$events" | grep -o "\"query\": *\"[^\"]*n=$i\"" | wc -l)
  [ "$n" = 1 ] || fail "the attack $i is $n events: $(echo "$events" | head -c 600)"
done
$CURL "$ADMIN/api/nginxions/analytics/requests?q=smoke-unknown&status=4xx,5xx,2xx,3xx&maxMs=60000&limit=5" \
  | grep -q '"not-a-host.local"' || fail "Events → Requests: search and filters miss the request"
$CURL "$ADMIN/api/nginxions/analytics/requests/export?format=csv&q=smoke-unknown" | grep -q 'not-a-host.local' \
  || fail "Events → Requests: the export misses the request"
$CURL "$ADMIN/api/nginxions/events?kind=all&q=smoke-unknown&limit=5" | grep -q '"kind": *"request"' \
  || fail "Events → All: the requests of the log are missing"
$CURL "$ADMIN/api/nginxions/analytics/requests?q=smoke-unknown&limit=1" | grep -q '"total":' \
  || fail "Events → Requests: no count for the pages"
for tab in requests visitors performance security cache origin; do
  $CURL "$ADMIN/api/nginxions/analytics/traffic?tab=$tab&period=1h" | grep -q '"kpi":' || fail "analytics tab $tab"
done
$CURL "$ADMIN/api/nginxions/analytics/traffic?tab=requests&period=1h&unknown=1" | grep -q '"not-a-host.local"' \
  || fail "the top hosts of Analytics miss the unknown domain"

step "notifications: a webhook channel delivers a test message"
hook=$($CURL -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/notifications/channels" \
  -d '{"name": "smoke", "type": "webhook", "config": {"url": "http://test-upstream/nginxions-hook", "secret": "k"}}')
hook_id=$(echo "$hook" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*$')
[ -n "$hook_id" ] || fail "webhook channel was not created: $hook"
echo "$hook" | grep -q '"secret"' && fail "the webhook secret is returned by the API"
$CURL -X POST "$ADMIN/api/nginxions/notifications/channels/$hook_id/test" | grep -q '"ok": *true' \
  || fail "test message through the webhook was not delivered"

step "notifications: an unreachable mail server is an error, not a hang"
mail=$($CURL -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/notifications/channels" \
  -d '{"name": "smoke mail", "type": "email", "config": {"host": "127.0.0.1", "port": 2, "security": "none", "from": "nginxions@example.test", "to": ["admin@example.test"]}}')
mail_id=$(echo "$mail" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*$')
$CURL --max-time 30 -X POST "$ADMIN/api/nginxions/notifications/channels/$mail_id/test" | grep -q '"ok": *false' \
  || fail "a mail server that does not answer was not reported"

step "notifications: a rule is created; the analyst cannot add channels"
$CURL -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/notifications/rules" \
  -d "{\"name\": \"smoke\", \"type\": \"cert_expiry\", \"params\": {\"days\": 30}, \"channel_ids\": [$hook_id]}" \
  | grep -q '"type": *"cert_expiry"' || fail "rule was not created"
expect "$(as_analyst "$ADMIN/api/nginxions/notifications")" 200 "analyst reads notifications"
expect "$(as_analyst -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/notifications/channels" \
  -d '{"name": "x", "type": "webhook", "config": {"url": "http://x"}}')" 403 "analyst adds a channel"

step "system settings: an env setting is saved for the next start, a bad value is refused"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/system/settings" \
  -d '{"values": [{"env": "NGINX_LOG_NOT_FOUND", "value": true}]}' | grep -q '"restartRequired": *true' \
  || fail "a saved env setting is not pending"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/system/settings" \
  -d '{"values": [{"env": "NGINX_LOG_NOT_FOUND", "value": false}]}' | grep -q '"restartRequired": *false' \
  || fail "the setting back to its running value is still pending"
code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
  "$ADMIN/api/nginxions/system/settings" -d '{"values": [{"env": "TZ", "value": "../../etc/passwd"}]}')
expect "$code" 400 "a bad time zone"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/system/settings" \
  -d '{"values": [{"env": "DISABLE_HTTP", "value": true}]}')" 403 "analyst changes system settings"
