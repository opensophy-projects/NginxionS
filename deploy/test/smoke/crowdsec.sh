# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «crowdsec» (deploy/test/smoke.sh runs it in a subshell of its own): CrowdSec: settings, profiles, bans, AppSec, engines of the policy in AppSec, syslog relay, blocklists, sharing, hub, GeoIP.


page() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$HTTP$1"; }
wait_page() { # path, code, message
  for i in $(seq 1 15); do
    [ "$(page "$1")" = "$2" ] && return 0
    sleep 2
  done
  fail "$3: expected $2, got $(page "$1")"
}
# settings of CrowdSec: AppSec on/off, the filter of the only profile
cs_settings() {
  $CURL --max-time 300 -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/crowdsec/settings" -d "{
  \"bouncer\": {\"enabled\": true, \"admin\": false, \"mode\": \"live\", \"fallback\": \"ban\", \"update_frequency\": 10,
    \"exclude_locations\": [], \"captcha\": {\"provider\": \"\", \"site_key\": \"\", \"secret_key\": \"\"}},
  \"sources\": {\"nginx\": true, \"openappsec\": true},
  \"appsec\": {\"enabled\": $1, \"failure_action\": \"passthrough\", \"configs\": [\"crowdsecurity/appsec-default\"]},
  \"profiles\": [{\"name\": \"ip\", \"enabled\": true, \"scope\": \"Ip\", \"scenarios\": [], \"filter\": \"$2\",
    \"type\": \"ban\", \"duration\": \"4h\", \"escalate\": false}],
  \"allowlist\": {\"ips\": [], \"expressions\": [], \"private\": false},
  \"openappsec_ban\": {\"enabled\": true, \"events\": 3, \"minutes\": 10}, \"log_level\": \"info\", \"online_hub\": false}"
}

step "CrowdSec: the local API answers, NginxionS is a machine of its own"
for i in $(seq 1 30); do
  $CURL "$ADMIN/api/nginxions/crowdsec" | tr -d ' \n' | grep -q '"lapi":{"healthy":true' && break
  [ "$i" = 30 ] && fail "the local API of CrowdSec does not answer: $($CURL "$ADMIN/api/nginxions/crowdsec")"
  sleep 2
done
$CURL "$ADMIN/api/nginxions/crowdsec/registry" | grep -q '"name": *"nginxions-' || fail "NginxionS is not a machine of CrowdSec"

# the closed network has private addresses only: they are not allowlisted here
step "CrowdSec: settings from the GUI are applied (bouncer and AppSec on)"
cs_settings true "" | tr -d ' \n' | grep -q '"\(restarted\|reloaded\)":true' || fail "the settings were not applied"

# profiles, acquisition, allowlists and scenarios are reread on SIGHUP: no restart of the container
step "CrowdSec: a change of a profile is applied by a reload, not a restart"
cs_started() { $CURL "$ADMIN/api/nginxions/services/crowdsec" | grep -o '"startedAt": *"[^"]*"'; }
before=$(cs_started)
cs_settings true "Alert.GetScope() == 'Ip'" | tr -d ' \n' | grep -q '"reloaded":true' \
  || fail "the profile change was not applied by a reload"
[ "$(cs_started)" = "$before" ] || fail "CrowdSec was restarted for a profile change"

step "CrowdSec: a broken profile is refused at the start of CrowdSec, the previous files come back"
answer=$(cs_settings true "Alert.Broken(((" 2>&1 || true)
echo "$answer" | grep -q 'previous ones are restored' || fail "a broken profile was not rolled back: $answer"
$CURL "$ADMIN/api/nginxions/crowdsec" | tr -d ' \n' | grep -q '"lapi":{"healthy":true' \
  || fail "CrowdSec is not healthy after the rollback"
# the filter of the previous step comes back, not the broken one
$CURL "$ADMIN/api/nginxions/crowdsec/settings" | grep -q 'Alert.Broken' && fail "the broken profile was kept"
$CURL "$ADMIN/api/nginxions/crowdsec/settings" | grep -q "Alert.GetScope() == 'Ip'" || fail "the previous profile did not come back"

step "CrowdSec: a ban by hand blocks the tester on its hosts, not in the interface of NginxionS"
api_json "$ADMIN/api/nginxions/crowdsec/decisions" -d "{\"values\": [\"$client_ip\"], \"duration\": \"10m\", \"reason\": \"smoke\"}" \
  | grep -q '"count": *1' || fail "the ban was not added"
wait_page / 403 "test.local for a banned address"
$CURL "$ADMIN/api/nginxions/crowdsec/decisions?q=$client_ip" | grep -q '"scenario": *"nginxions/manual"' \
  || fail "the ban is not among the decisions"

step "CrowdSec: a host left out by the bouncer lets the banned address in"
api_json -X PUT "$ADMIN/api/nginxions/crowdsec/hosts/proxy_host/1" -d '{"bouncer": false}' > /dev/null
wait_page / 200 "test.local left out by the bouncer"
api_json -X PUT "$ADMIN/api/nginxions/crowdsec/hosts/proxy_host/1" -d '{"bouncer": true}' > /dev/null
wait_page / 403 "test.local checked by the bouncer again"

step "CrowdSec: unban lets the tester in"
api_json "$ADMIN/api/nginxions/crowdsec/decisions/delete" -d "{\"values\": [\"$client_ip\"]}" | grep -q '"deleted": *[1-9]' \
  || fail "the ban was not removed"
wait_page / 200 "test.local after the unban"

step "CrowdSec: AppSec blocks a probe of /.env, its alert becomes a security event"
wait_page /.env 403 "a probe of /.env with AppSec"
# the probe is sent again while waiting: AppSec of CrowdSec starts again with the settings above, and until it
# answers the bouncer lets the probe on to open-appsec, whose 403 makes no CrowdSec alert
for i in $(seq 1 45); do
  page /.env > /dev/null
  $CURL "$ADMIN/api/nginxions/events?kind=crowdsec&limit=5" | grep -q '"kind": *"crowdsec"' && break
  [ "$i" = 45 ] && fail "no CrowdSec alert in the events: $($CURL "$ADMIN/api/nginxions/events?kind=crowdsec&limit=5")"
  sleep 2
done
# the agents are one list, each row names its agent
$CURL "$ADMIN/api/nginxions/events?agent=crowdsec&limit=5" | grep -q '"kind": *"crowdsec"' \
  || fail "the CrowdSec alert is not in the events of the agents"
api_json "$ADMIN/api/nginxions/crowdsec/decisions/delete" -d "{\"values\": [\"$client_ip\"]}" > /dev/null || true

if $CURL "$ADMIN/api/nginxions/waf" | grep -q '"reachable": *true'; then
  ensure_waf_on
  # antiBot and schemaValidation of a practice run in AppSec of CrowdSec (waf/engines.js): an appsec-config of the
  # policy, applied with a reload of CrowdSec
  browser_page() { curl -s --max-time 10 -H 'Host: test.local' -H 'Accept: text/html,application/xhtml+xml' "$HTTP$1"; }
  step "WAF -> Policy: Anti-Bot of a practice: a browser gets the challenge, a request without it is refused"
  bot_spec() {
    printf '{"kind": "threat_prevention", "name": "smoke-bot", "spec": {"practiceMode": "inherited",
      "webAttacks": {"overrideMode": "inherited", "minimumConfidence": "high"}, "antiBot": {"overrideMode": "%s",
      "injectedUris": [{"uri": "/smoke-page"}], "validatedUris": [{"uri": "/smoke-login"}]}}}' "$1"
  }
  bot=$(post_json POST /objects "$(bot_spec prevent)" | new_id)
  [ -n "$bot" ] || fail "the practice with Anti-Bot was not created"
  host_objects "{\"threatPreventionPractices\": [$bot]}"
  for i in $(seq 1 60); do
    body=$(browser_page /smoke-page)
    # the challenge page, not the upstream (whoami answers "Hostname: ...")
    echo "$body" | grep -qi '<script' && ! echo "$body" | grep -q 'Hostname:' && break
    [ "$i" = 60 ] && fail "a browser gets no challenge on an injected page: $(echo "$body" | head -c 300)"
    sleep 2
  done
  wait_page /smoke-login 403 "a request without the challenge cookie to a validated path"
  browser_page /smoke-other | grep -q 'Hostname:' || fail "a page outside the paths of Anti-Bot is challenged"
  [ "$(page /smoke-other)" = 200 ] || fail "a request outside the paths of Anti-Bot is refused"

  step "WAF -> Policy: Anti-Bot in detect: no challenge, a request without it passes and is logged"
  post_json PUT "/objects/$bot" "$(bot_spec detect)" > /dev/null
  for i in $(seq 1 60); do
    [ "$(page /smoke-login)" = 200 ] && browser_page /smoke-page | grep -q 'Hostname:' && break
    [ "$i" = 60 ] && fail "Anti-Bot in detect still refuses or challenges (status $(page /smoke-login))"
    sleep 2
  done
  for i in $(seq 1 45); do
    page /smoke-login > /dev/null
    $CURL "$ADMIN/api/nginxions/events?kind=crowdsec&q=anti-bot&limit=1" | grep -q '"kind": *"crowdsec"' && break
    [ "$i" = 45 ] && fail "a request without the challenge cookie in detect is not in the events"
    sleep 2
  done
  host_objects null

  step "WAF -> Policy: Schema Validation of a practice: requests that do not match the OpenAPI file are refused"
  cat > /tmp/smoke-api.yaml <<'EOF'
openapi: 3.0.3
info: {title: smoke, version: "1"}
paths:
  /smoke-api/items:
    get:
      parameters:
        - {name: id, in: query, required: true, schema: {type: integer}}
      responses: {"200": {description: ok}}
EOF
  $CURL -X PUT -H "Content-Type: application/octet-stream" --data-binary @/tmp/smoke-api.yaml "$ADMIN/api/nginxions/waf/policy/schemas/smoke-api.yaml" \
    | grep -q '"paths": *1' || fail "the OpenAPI file was not uploaded"
  echo 'not: [an api' | $CURL -o /dev/null -w '%{http_code}' -X PUT -H "Content-Type: application/octet-stream" --data-binary @- \
    "$ADMIN/api/nginxions/waf/policy/schemas/broken.yaml" | grep -q 400 || fail "a file that is not OpenAPI was taken"
  api=$(post_json POST /objects '{"kind": "threat_prevention", "name": "smoke-schema", "spec": {"practiceMode": "inherited",
    "webAttacks": {"overrideMode": "inherited", "minimumConfidence": "high"}, "schemaValidation": {"overrideMode": "prevent",
    "enforcementLevel": "fullSchema", "files": ["smoke-api.yaml"]}}}' | new_id)
  [ -n "$api" ] || fail "the practice with Schema Validation was not created"
  host_objects "{\"threatPreventionPractices\": [$api]}"
  wait_page '/smoke-api/items?id=abc' 403 "a request against the OpenAPI file (id is not an integer)"
  wait_page '/smoke-api/items?id=7' 200 "a request that matches the OpenAPI file"
  [ "$(page /smoke-api/other)" = 403 ] || fail "a route that is not in the OpenAPI file passes with fullSchema"
  [ "$($CURL -o /dev/null -w '%{http_code}' -X DELETE "$ADMIN/api/nginxions/waf/policy/schemas/smoke-api.yaml")" = 400 ] \
    || fail "an OpenAPI file in use was deleted"
  host_objects null
  wait_page '/smoke-api/items?id=abc' 200 "the OpenAPI file still refuses once the practice is gone"
  api_json "$ADMIN/api/nginxions/crowdsec/decisions/delete" -d "{\"values\": [\"$client_ip\"]}" > /dev/null || true

  step "CrowdSec: three requests blocked by open-appsec ban the address"
  # the WAF steps above leave test.local in detect-learn: the scenario counts blocked requests only
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
  wait_status "$SQLI" 403 "SQLi is not blocked in prevent-learn again"
  for i in $(seq 1 30); do
    page "$SQLI" > /dev/null
    $CURL "$ADMIN/api/nginxions/crowdsec/decisions?q=$client_ip" | grep -q 'nginxions/openappsec-prevent' && break
    [ "$i" = 30 ] && fail "blocked requests of open-appsec did not ban: $($CURL "$ADMIN/api/nginxions/crowdsec/alerts?limit=5")"
    sleep 2
  done
  wait_page / 403 "test.local for an address banned for its attacks"
  api_json "$ADMIN/api/nginxions/crowdsec/decisions/delete" -d "{\"values\": [\"$client_ip\"]}" > /dev/null
  wait_page / 200 "test.local after the unban"

  step "WAF -> Policy: syslog to several servers and by name goes through the relay of NginxionS"
  # localhost (a name, UDP) and 127.0.0.1 over TCP: the agent sends to one IPv4 server itself, so these go to the relay
  # of the backend on 127.0.0.1:79xx (waf/syslog.js); scripts/test-airgap.sh listens on both and checks the messages
  syslog=$(post_json POST /objects '{"kind": "log_trigger", "name": "smoke-syslog", "spec": {"logDestination": {
    "logToAgent": true, "syslogService": [{"address": "localhost", "port": 5514, "proto": "udp"},
    {"address": "127.0.0.1", "port": 5515, "proto": "tcp"}]}}}' | new_id)
  [ -n "$syslog" ] || fail "the log trigger with syslog was not created"
  # stays on test.local to the end: scripts/test-airgap.sh sends an attack and reads what the servers got
  host_objects "{\"triggers\": [$syslog]}"
  for i in $(seq 1 30); do
    $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q 'port: 7900' && break
    [ "$i" = 30 ] && fail "the policy of the agent does not send syslog to the relay: $($CURL "$ADMIN/api/nginxions/waf/policy" | grep -A4 syslog)"
    sleep 2
  done
fi

step "CrowdSec: a blocklist file becomes decisions, the allowlist and bad lines are left out"
printf '# smoke\n203.0.113.10\n203.0.113.0/28 range\nnot-an-ip\n2001:db8::10\n' > /tmp/list.txt
list=$($CURL -X POST -H 'Content-Type: text/plain' --data-binary @/tmp/list.txt \
  "$ADMIN/api/nginxions/crowdsec/blocklists?name=smoke&duration=1h")
echo "$list" | tr -d ' \n' | grep -q '"count":3' || fail "the blocklist did not make 3 decisions: $list"
$CURL "$ADMIN/api/nginxions/crowdsec/decisions?origin=lists" | grep -q '"value": *"203.0.113.0/28"' \
  || fail "the range of the blocklist is not banned"

step "CrowdSec: other nodes take the decisions of this one with its token only"
api_json "$ADMIN/api/nginxions/crowdsec/decisions" -d '{"values": ["192.0.2.77"], "duration": "1h"}' > /dev/null
token=$(api_json -X PUT "$ADMIN/api/nginxions/crowdsec/share" -d '{"enabled": true}' | tr -d ' \n' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$token" ] || fail "no token for other nodes"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' "$ADMIN/api/nginxions/crowdsec/public/decisions")" 403 "the export without a token"
export=$(curl -sS -k -H "Authorization: Bearer $token" "$ADMIN/api/nginxions/crowdsec/public/decisions")
echo "$export" | grep -q '^192.0.2.77$' || fail "the export has no decision by hand: $export"
echo "$export" | grep -q '203.0.113.10' && fail "the export has the decisions of a blocklist"
node=$(api_json "$ADMIN/api/nginxions/crowdsec/blocklists" -d "{\"name\": \"node\", \"source\": \"url\",
  \"url\": \"$ADMIN/api/nginxions/crowdsec/public/decisions\", \"token\": \"$token\", \"insecure\": true, \"refresh_minutes\": 60}")
echo "$node" | tr -d ' \n' | grep -q '"error":""' || fail "the decisions of another node were not taken: $node"

step "CrowdSec: a hub item installs from the offline snapshot and is removed again"
api_json --max-time 300 "$ADMIN/api/nginxions/crowdsec/hub" \
  -d '{"type": "collections", "name": "crowdsecurity/nextcloud", "action": "install"}' \
  | grep -q 'scenarios/crowdsecurity/nextcloud-bf' || fail "the collection did not install with its scenario"
$CURL "$ADMIN/api/nginxions/crowdsec/hub?type=collections&q=nextcloud&installed=true" | grep -q '"status": *"up-to-date"' \
  || fail "the installed collection is not up to date"
api_json --max-time 300 "$ADMIN/api/nginxions/crowdsec/hub" \
  -d '{"type": "collections", "name": "crowdsecurity/nextcloud", "action": "remove"}' \
  | grep -q 'collections/crowdsecurity/nextcloud' || fail "the collection was not removed"

step "CrowdSec: the machines and bouncers of the stack cannot be deleted, an unknown one is not found"
for target in machines/localhost bouncers/nginxions bouncers/appsec; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$ADMIN/api/nginxions/crowdsec/registry/$target")
  [ "$code" = 400 ] || fail "$target of the stack was not protected: HTTP $code"
done
code=$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE "$ADMIN/api/nginxions/crowdsec/registry/machines/nope")
[ "$code" = 404 ] || fail "deleting an unknown machine: HTTP $code"

step "GeoIP: the database of CrowdSec gives countries offline, a file that is no database is refused"
$CURL "$ADMIN/api/nginxions/system/geoip" | grep -q '"type": *"GeoLite2' || fail "no GeoIP database: $($CURL "$ADMIN/api/nginxions/system/geoip")"
code=$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/octet-stream' \
  --data-binary 'not a database' "$ADMIN/api/nginxions/system/geoip")
[ "$code" = 400 ] || fail "a broken GeoIP database was accepted: HTTP $code"

step "Hosts → Countries: nginx knows the countries; a host let in only for one country keeps answering private networks"
$CURL "$ADMIN/api/nginxions/geo" | grep -q '"available": *true' || fail "nginx has no GeoIP database: $($CURL "$ADMIN/api/nginxions/geo")"
geo_host=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/dead-hosts" -d '{
  "domain_names": ["geo.local"], "meta": {"nginxions_geo": {"mode": "allow", "countries": ["AQ"], "action": "403"}}
}')
geo_id=$(echo "$geo_host" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*')
[ -n "$geo_id" ] || fail "the 404 host was not created: $geo_host"
# the answer of the creation comes before nginx has the config: its state is read back
for i in $(seq 1 15); do
  geo_host=$($CURL "$ADMIN/api/nginx/dead-hosts/$geo_id")
  echo "$geo_host" | grep -q '"nginx_online": *true' && break
  echo "$geo_host" | grep -q '"nginx_online": *false' && fail "nginx refused the countries of a host: $geo_host"
  [ "$i" = 15 ] && fail "nginx did not apply the 404 host: $geo_host"
  sleep 1
done
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: geo.local' "$HTTP/")
  [ "$code" = 404 ] && break
  [ "$i" = 10 ] && fail "a client of a private network was refused by the countries of the host: HTTP $code"
  sleep 1
done
$CURL -X DELETE "$ADMIN/api/nginx/dead-hosts/$geo_id" > /dev/null
