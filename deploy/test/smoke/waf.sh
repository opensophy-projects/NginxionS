# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «waf» (deploy/test/smoke.sh runs it in a subshell of its own): WAF of open-appsec: modes, the GUI switch, block page, events, agent settings, policy objects, IPS, File Security, responses, rate limits, learning.

step "WAF: protecting a proxy host generates its rule in local_policy.yaml"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
  -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
for i in $(seq 1 10); do
  $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q 'name: npm-managed-specific-rule-proxyhost-1\\n *host: test.local\\n' && break
  [ "$i" = 10 ] && fail "no rule for test.local in the policy: $($CURL "$ADMIN/api/nginxions/waf/policy")"
  sleep 1
done
$CURL "$ADMIN/api/nginxions/waf/policy" | grep -q 'mode: prevent-learn' || fail "the rule is not in prevent-learn"

for i in $(seq 1 45); do
  $CURL "$ADMIN/api/nginxions/waf" 2>/dev/null | grep -q '"reachable": *true' && break
  [ "$i" = 45 ] && fail "the WAF group requires a reachable open-appsec agent"
  sleep 2
done
if $CURL "$ADMIN/api/nginxions/waf" | grep -q '"reachable": *true'; then
  step "WAF: open-appsec is on after a clean install (the nginx attachment is loaded by default)"
  $CURL "$ADMIN/api/nginxions/waf" | grep -q '"active": *true' \
    || fail "attachment is not active by default: $($CURL "$ADMIN/api/nginxions/waf")"

  # the switch of the GUI: off, then on again; each restarts nginxions with or without the attachment
  waf_switch() {
    step "WAF: switch open-appsec $2 in the GUI (nginxions restarts)"
    $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf" -d "{\"enabled\": $1, \"apply\": true}" \
      | grep -q '"restarting": *true' || fail "WAF switch did not restart nginxions"
    # nginxions-control answers first, then restarts nginxions (the agent in openappsec keeps running)
    sleep 7
    wait_api
    for i in $(seq 1 30); do
      $CURL "$ADMIN/api/nginxions/waf" | grep -q "\"active\": *$1" && break
      [ "$i" = 30 ] && fail "attachment is not active=$1: $($CURL "$ADMIN/api/nginxions/waf")"
      sleep 2
    done
  }
  waf_switch false off
  waf_switch true on

  step "WAF: the open-appsec agent applies its policy without internet (local-only mode)"
  for i in $(seq 1 90); do
    $CURL "$ADMIN/api/nginxions/waf" | grep -q '"lastPolicyUpdate": *"' && break
    [ "$i" = 90 ] && fail "agent did not apply a policy: $($CURL "$ADMIN/api/nginxions/waf")"
    sleep 2
  done

  status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$HTTP$1"; }
  SQLI="/?id=1%27%20OR%20%271%27=%271"
  XSS="/?q=%3Cscript%3Ealert(document.cookie)%3C/script%3E"

  step "WAF: prevent-learn blocks SQLi and XSS with 403, normal requests pass"
  for i in $(seq 1 60); do
    [ "$(status "$SQLI")" = 403 ] && break
    [ "$i" = 60 ] && fail "SQLi was not blocked (last status $(status "$SQLI"))"
    sleep 2
  done
  # a request handled while the agent restarts a service (after a new policy) can pass: retried
  for i in $(seq 1 30); do
    [ "$(status "$XSS")" = 403 ] && break
    [ "$i" = 30 ] && fail "XSS was not blocked"
    sleep 2
  done
  [ "$(status "/?q=hello")" = 200 ] || fail "a normal request was blocked"

  step "WAF: the request headers of a browser pass (a stylesheet of Chrome: Sec-Fetch-Dest: style)"
  # the agent's model takes "style" for XSS: without the browser headers among its clean headers (its waap.data) every stylesheet of Chrome was refused
  browser=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' -H 'Accept: text/css,*/*;q=0.1' \
    -H 'Sec-Fetch-Dest: style' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-origin' -H 'Priority: u=0' \
    -H 'Sec-Ch-Ua-Mobile: ?0' -H 'Sec-Ch-Ua-Platform: "Linux"' "$HTTP/assets/index.css")
  [ "$browser" = 403 ] && fail "a stylesheet request of a browser was blocked"
  # retried like the checks above: a request handled while the agent restarts a service passes (fail-open)
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' \
      -H 'Sec-Fetch-Dest: <script>alert(document.cookie)</script>' "$HTTP/")" = 403 ] && break
    [ "$i" = 30 ] && fail "an attack in Sec-Fetch-Dest was not blocked"
    sleep 2
  done

  step "WAF: a non-standard HTTP method is blocked (recommended practice: nonValidHttpMethods, read by the agent)"
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X ARBITRARY -H 'Host: test.local' "$HTTP/")" = 403 ] && break
    [ "$i" = 30 ] && fail "the method ARBITRARY was not blocked"
    sleep 2
  done

  step "Block page: a refused request gets the page of NginxionS, not the one of the agent"
  for i in $(seq 1 30); do
    page=$(curl -s --max-time 10 -H 'Host: test.local' "$HTTP$SQLI")
    echo "$page" | grep -q 'NginxionS: block page' && break
    [ "$i" = 30 ] && fail "no block page of NginxionS: $(echo "$page" | head -c 300)"
    sleep 2
  done
  echo "$page" | grep -q 'Application Security has detected' && fail "the page of the agent is shown"
  echo "$page" | grep -q '{{ip}}' && fail "the details of the request are not filled in"

  # events of the agent's security log, newest first. The attack is repeated while waiting: the agent
  # restarts its services a few seconds after a start or a new policy, and the event of a request
  # handled just before such a restart can be lost.
  event() {
    for i in $(seq 1 30); do
      status "$SQLI" > /dev/null || true
      $CURL "$ADMIN/api/nginxions/events?important=true&host=test.local" | grep -q "\"action\": *\"$1\"" && return 0
      sleep 2
    done
    fail "no $1 event for test.local in WAF -> Events: $($CURL "$ADMIN/api/nginxions/events?kind=all&limit=5")"
  }

  step "WAF -> Events: the blocked attack is an important event (Prevent)"
  event Prevent

  # Agent settings from the GUI: saving restarts the agent, its entrypoint applies them.
  # $1: JSON body, $2: what is checked
  started() { $CURL "$ADMIN/api/nginxions/services/$1" 2>/dev/null | grep -o '"startedAt": *"[^"]*"'; }
  # after a restart of the agent: nginxions restarted since $1, the agent applied its settings and answers, and the
  # same start of nginxions twice in a row 2 s apart. A restart of the agent restarts nginxions (it lives in the network
  # of openappsec), and nginxions-control may restart it once more: the first new start alone was taken for the end,
  # the next request then met nginx without its backend (502). $2: what is waited for
  back_after_restart() {
    seen=""
    for i in $(seq 1 90); do
      now=$(started nginxions || true)
      if [ -n "$now" ] && [ "$now" != "$1" ] \
        && $CURL "$ADMIN/api/nginxions/waf/agent" 2>/dev/null | grep -q '"restartRequired": *false' \
        && $CURL "$ADMIN/api/nginxions/waf" 2>/dev/null | grep -q '"reachable": *true'; then
        [ "$now" = "$seen" ] && return 0
        seen=$now
      else
        seen=""
      fi
      sleep 2
    done
    fail "the agent and nginxions did not come back after $2"
  }
  agent_settings() {
    step "WAF -> Agent: $2"
    nginxions_before=$(started nginxions)
    $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/agent" -d "$1" \
      | grep -q '"restarting": *true' || fail "saving agent settings did not restart the agent"
    # the agent restarts, then nginxions: the API is away for a while (connections are reset)
    for i in $(seq 1 60); do
      agent=$($CURL "$ADMIN/api/nginxions/waf/agent" 2>/dev/null || true)
      echo "$agent" | grep -q '"restartRequired": *false' && break
      [ "$i" = 60 ] && fail "the agent did not apply its settings: $agent"
      sleep 2
    done
    # nginxions-control restarts nginxions once the new agent is up, which can be after the agent already
    # answers: wait for it, or the next request of the test meets nginx without its backend (502)
    for i in $(seq 1 60); do
      now=$(started nginxions || true)
      [ -n "$now" ] && [ "$now" != "$nginxions_before" ] && break
      [ "$i" = 60 ] && fail "nginxions was not restarted after the agent: $now"
      sleep 2
    done
    for i in $(seq 1 60); do
      $CURL "$ADMIN/api/nginxions/waf" 2>/dev/null | grep -q '"reachable": *true' && break
      [ "$i" = 60 ] && fail "the agent did not come back after the restart: $($CURL "$ADMIN/api/nginxions/waf")"
      sleep 2
    done
    for i in $(seq 1 60); do
      [ "$(status "$SQLI")" = 403 ] && break
      [ "$i" = 60 ] && fail "SQLi is not blocked after the agent's restart"
      sleep 2
    done
    since=$(date -u +%Y-%m-%dT%H:%M:%S)
    for i in $(seq 1 30); do
      # nginxions restarts after the agent, possibly only now: a refused connection (curl 7) is retried, not fatal
      status "$XSS" > /dev/null || true
      # an event newer than the restart (times are ISO, compared as text)
      $CURL "$ADMIN/api/nginxions/events?important=true&host=test.local&limit=1" \
        | grep -o '"time": *"[^"]*"' | cut -d'"' -f4 | awk -v s="$since" '$0 >= s {f=1} END {exit !f}' && return 0
      sleep 2
    done
    fail "attacks after the agent's restart are not in WAF -> Events: $($CURL "$ADMIN/api/nginxions/events?kind=all&limit=3")"
  }

  agent_settings '{"fail_open": {"enabled": true, "timeout_ms": 100}}' \
    "fail-open timeout from the GUI is applied at the agent's restart, attacks are still blocked and logged"
  agent_settings '{"fail_open": {"enabled": true, "timeout_ms": 50}}' \
    "a second change is applied the same way"

  # applying agent settings restarts the agent process in openappsec, then nginxions: without the restart of nginxions
  # the nginx attachment kept its IPC with the old agent and every request waited for it (about 1-2 s)
  step "WAF -> Agent: after the agent's restart requests are not held up"
  slow=0
  for i in $(seq 1 10); do
    t=$(curl -s -o /dev/null -w '%{time_total}' --max-time 10 -H 'Host: test.local' "$HTTP/")
    awk -v t="$t" 'BEGIN {exit !(t > 0.5)}' && slow=$((slow + 1))
  done
  [ "$slow" -le 1 ] || fail "$slow of 10 requests took more than 0.5 s after the agent's restart"
  t=$($CURL -o /dev/null -w '%{time_total}' "$ADMIN/api/")
  awk -v t="$t" 'BEGIN {exit !(t > 0.5)}' && fail "the interface took $t s: it must not wait for the agent"

  # issue 149: the steps above retry until 403, which hid that the first request after a restart of the agent met
  # nginx workers not registered with it yet: fail-open let that attack through, fail-close closed a normal request
  # with no answer. Here the agent restarts with no traffic at all, then one request of each kind is sent, once.
  first_after_restart() {
    step "WAF -> Agent: fail-open $1, the first requests after the agent's restart: the attack 403, a normal one 200"
    nginxions_before=$(started nginxions)
    $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/agent" \
      -d "{\"fail_open\": {\"enabled\": $1, \"timeout_ms\": 50}}" | grep -q '"restarting": *true' \
      || fail "saving agent settings did not restart the agent"
    back_after_restart "$nginxions_before" "the restart"
    # as in the issue: a pause with no traffic after the policy is applied
    sleep 10
    first=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H 'Host: test.local' "$HTTP/first-$1$XSS")
    normal=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' --max-time 15 -H 'Host: test.local' "$HTTP/?q=hello")
    [ "$first" = 403 ] || fail "the first attack after the agent's restart got $first (fail-open $1)"
    # issue 90: the first single request gave no event (it was not inspected): the agent logs this very request
    for i in $(seq 1 30); do
      $CURL "$ADMIN/api/nginxions/events?important=true&host=test.local&q=first-$1" \
        | grep -q '"action": *"Prevent"' && break
      [ "$i" = 30 ] && fail "no Prevent event for the first attack after the agent's restart (fail-open $1)"
      sleep 2
    done
    case "$normal" in
      "200 "*) ;;
      *) fail "a normal request after the agent's restart got \"$normal\" (status, bytes; fail-open $1)" ;;
    esac
  }
  # called at the end of the group for both modes; leave fail-open for the remaining smoke groups and browser tests

  step "WAF -> Agent: the metrics of the agent (its prometheus service) are read"
  metrics=""
  for i in $(seq 1 30); do
    metrics=$($CURL "$ADMIN/api/nginxions/waf/agent/metrics" | tr -d ' \n')
    echo "$metrics" | grep -q '"reachable":true' && break
    [ "$i" = 30 ] && fail "the metrics service of the agent does not answer: $(echo "$metrics" | head -c 300)"
    sleep 4
  done
  echo "    metrics of the agent: $(echo "$metrics" | grep -o '"name":"[^"]*"' | wc -l)"

  wait_status() {
    for i in $(seq 1 60); do
      [ "$(status "$1")" = "$2" ] && return 0
      sleep 2
    done
    fail "$3 (last status $(status "$1"))"
  }
  # the same, three times in a row: while the agent reloads its policy, fail-open lets a blocked request through once
  wait_status_stable() {
    for i in $(seq 1 60); do
      [ "$(status "$1")" = "$2" ] && [ "$(status "$1")" = "$2" ] && [ "$(status "$1")" = "$2" ] && return 0
      sleep 2
    done
    fail "$3 (last status $(status "$1"))"
  }

  step "WAF -> Policy (expert): an exception for the tester's IP lets the attack through"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/policy/custom" -d "{
    \"content\": \"exceptions:\\n  - name: smoke-trusted\\n    action: accept\\n    condition:\\n      - key: sourceIp\\n        value: $client_ip\\npolicies:\\n  default:\\n    exceptions:\\n      - smoke-trusted\\n\",
    \"comment\": \"smoke\"}" > /dev/null
  $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q 'name: smoke-trusted' || fail "the exception is not in the policy"
  wait_status_stable "$SQLI" 200 "SQLi from the trusted IP is still blocked"

  step "WAF -> Policy (expert): without the fragment (a new empty version) the attack is blocked again"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/policy/custom" \
    -d '{"content": "", "comment": "smoke: empty"}' > /dev/null
  for i in $(seq 1 60); do
    [ "$(status "$SQLI")" = 403 ] && break
    [ "$i" = 60 ] && fail "SQLi is not blocked after the exception was removed"
    sleep 2
  done
  $CURL "$ADMIN/api/nginxions/waf/policy/custom" | grep -q '"comment": *"smoke: empty"' || fail "versions are not listed"

  # WAF -> Policy (phase 5): objects of the policy through the API of the GUI
  json() { tr -d ' \n'; }
  object_id() {
    $CURL "$ADMIN/api/nginxions/waf/policy/objects" | json \
      | grep -o "\"id\":[0-9]*,[^{}]*\"kind\":\"$1\",\"name\":\"$2\"" | head -1 | sed 's/"id":\([0-9]*\).*/\1/'
  }
  new_id() { json | grep -o '^{"id":[0-9]*' | grep -o '[0-9]*$'; }
  last_version() { $CURL "$ADMIN/api/nginxions/waf/policy/versions" | json | grep -o '^\[{"id":[0-9]*' | grep -o '[0-9]*$'; }
  post_json() { $CURL -X "$1" -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/policy$2" -d "$3"; }
  step "WAF -> Policy: an exception object in the default policy lets the attack through, a rollback blocks it again"
  recommended=$(object_id threat_prevention nginxions-recommended)
  trigger=$(object_id log_trigger nginxions-log)
  response=$(object_id custom_response nginxions-403)
  [ -n "$recommended" ] && [ -n "$trigger" ] && [ -n "$response" ] || fail "built-in objects are missing"
  exception=$(post_json POST /objects "{\"kind\": \"exception\", \"name\": \"smoke-office\",
    \"spec\": {\"action\": \"accept\", \"condition\": [{\"key\": \"sourceIp\", \"value\": \"192.0.2.1\"},
    {\"key\": \"sourceIp\", \"value\": \"$client_ip\"}]}}" | new_id)
  [ -n "$exception" ] || fail "the exception was not created"
  before=$(last_version)
  default_policy="{\"mode\": \"inactive\", \"threatPreventionPractices\": [$recommended], \"triggers\": [$trigger],
    \"customResponse\": $response"
  post_json POST /preview "{\"policy\": $default_policy, \"exceptions\": [$exception]}}" | json \
    | grep -q '"valid":true,"changed":true' || fail "the preview of the default policy is not valid"
  # the dry run on recent events: the attacks of the tester blocked so far would pass with the exception
  preview=$(post_json POST /preview "{\"policy\": $default_policy, \"exceptions\": [$exception]}, \"simulate\": \"24h\"}" | json)
  echo "$preview" | grep -q '"toPass":[1-9]' \
    || fail "the dry run does not let the blocked attacks of the tester through: $(echo "$preview" | grep -o '"simulation":{[^]]*' | head -c 400)"
  post_json PUT /default "$default_policy, \"exceptions\": [$exception]}" > /dev/null
  $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q -- "value: $client_ip" || fail "the exception is not in local_policy.yaml"
  wait_status_stable "$SQLI" 200 "SQLi from an IP of the exception is still blocked"
  [ "$($CURL -o /dev/null -w "%{http_code}" -X DELETE "$ADMIN/api/nginxions/waf/policy/objects/$exception" 2>/dev/null || true)" = 400 ] \
    || fail "an object in use was deleted"
  post_json POST "/versions/$before/rollback" "" > /dev/null
  wait_status "$SQLI" 403 "SQLi is not blocked after the rollback"

  step "WAF -> Policy: local_policy.yaml is v1beta2; a rate limit of the host limits requests"
  limit=$(post_json POST /objects '{"kind": "access_control", "name": "smoke-limit",
    "spec": {"rateLimit": {"overrideMode": "prevent", "rules": [{"uri": "/smoke-rate", "limit": 3, "unit": "minute"}]}}}' \
    | new_id)
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" -d "{\"enabled\": true,
    \"mode\": \"prevent-learn\", \"minimum_confidence\": \"high\", \"objects\": {\"accessControlPractices\": [$limit]}}" > /dev/null
  $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q '"format": *"v1beta2"' \
    || fail "the policy is not v1beta2: $($CURL "$ADMIN/api/nginxions/waf/policy" | head -c 400)"
  # the path holds no word the model reads as an attack ("limit" is an SQL keyword): a 403 here is the rate limit's
  limited=""
  for i in $(seq 1 60); do
    for _ in 1 2 3 4 5 6; do
      [ "$(status /smoke-rate)" = 403 ] && limited=1
    done
    [ -n "$limited" ] && break
    [ "$i" = 60 ] && fail "requests over the rate limit are not blocked (statuses: $(for _ in 1 2 3 4 5 6; do printf '%s ' "$(status /smoke-rate)"; done))"
    sleep 2
  done
  [ "$(status /)" = 200 ] || fail "a path without a rate limit is blocked"
  # a rate limit lets the path through again once its minute is over (no request in between: each one blocked
  # renews the block); a refusal of the path itself would not
  sleep 65
  [ "$(status /smoke-rate)" = 200 ] || fail "the path stays blocked after the minute of the rate limit"
  wait_status "$SQLI" 403 "SQLi is not blocked with the rate limit of the host"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high", "objects": null}' > /dev/null

  host_objects() {
    $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" -d "{\"enabled\": true,
      \"mode\": \"prevent-learn\", \"minimum_confidence\": \"high\", \"objects\": $1}" > /dev/null
  }
  step "WAF -> Policy: every exception of a rule applies, not only the first"
  # the agent took the first exception of a rule only: the second one, for the tester's IP, had no effect
  other=$(post_json POST /objects '{"kind": "exception", "name": "smoke-other",
    "spec": {"action": "accept", "condition": [{"key": "sourceIp", "value": "192.0.2.7"}]}}' | new_id)
  mine=$(post_json POST /objects "{\"kind\": \"exception\", \"name\": \"smoke-mine\",
    \"spec\": {\"action\": \"accept\", \"condition\": [{\"key\": \"sourceIp\", \"value\": \"$client_ip\"}]}}" | new_id)
  [ -n "$other" ] && [ -n "$mine" ] || fail "the exceptions were not created"
  host_objects "{\"accessControlPractices\": [$limit], \"exceptions\": [$other, $mine]}"
  wait_status_stable "$SQLI" 200 "the second exception of a rule does not let the attack through"
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not blocked once the exceptions are gone"

  step "WAF -> Policy: x-nginxions conditions of an exception: not-in and a header name"
  # every source but 192.0.2.7: the tester's attack passes
  not_in=$(post_json POST /objects '{"kind": "exception", "name": "smoke-not-in",
    "spec": {"action": "accept", "condition": [{"key": "sourceIp", "op": "not-in", "value": "192.0.2.7"}]}}' | new_id)
  # a request with the header is dropped, even a normal one
  by_header=$(post_json POST /objects '{"kind": "exception", "name": "smoke-header",
    "spec": {"action": "drop", "condition": [{"key": "headerName", "value": "x-smoke-drop"}]}}' | new_id)
  [ -n "$not_in" ] && [ -n "$by_header" ] || fail "the exceptions of x-nginxions were not created"
  host_objects "{\"exceptions\": [$not_in]}"
  wait_status_stable "$SQLI" 200 "an exception for every source but another one does not let the attack through"
  host_objects "{\"exceptions\": [$by_header]}"
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' -H 'X-Smoke-Drop: 1' "$HTTP/")" = 403 ] \
      && break
    [ "$i" = 60 ] && fail "a request with the header of a drop exception is not dropped"
    sleep 2
  done
  [ "$(status /)" = 200 ] || fail "a request without the header of a drop exception is dropped"
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not blocked once the exceptions of x-nginxions are gone"

  step "WAF -> Policy: the IPS of a practice blocks a known vulnerability (signatures of NginxionS, CrowdSec virtual patching)"
  PHPUNIT=/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php
  wait_status_stable "$PHPUNIT" 200 "the path of PHPUnit is blocked without the IPS"
  ips=$(post_json POST /objects '{"kind": "threat_prevention", "name": "smoke-ips",
    "spec": {"practiceMode": "inherited", "webAttacks": {"overrideMode": "inherited", "minimumConfidence": "high"},
    "intrusionPrevention": {"overrideMode": "prevent", "minSeverityLevel": "medium", "minCveYear": 2010,
    "highConfidenceEventAction": "prevent", "mediumConfidenceEventAction": "prevent", "lowConfidenceEventAction": "detect"}}}' \
    | new_id)
  [ -n "$ips" ] || fail "the practice with the IPS was not created"
  host_objects "{\"threatPreventionPractices\": [$ips]}"
  wait_status "$PHPUNIT" 403 "the IPS does not block CVE-2017-9841"
  [ "$(status /)" = 200 ] || fail "the IPS blocks a normal request"
  for i in $(seq 1 30); do
    $CURL "$ADMIN/api/nginxions/events?kind=all&host=test.local&q=CVE-2017-9841&limit=1" | grep -q '"incident_type": *"IPS"' \
      && break
    [ "$i" = 30 ] && fail "no event of the IPS in WAF -> Events: $($CURL "$ADMIN/api/nginxions/events?kind=all&limit=3" | head -c 600)"
    sleep 2
  done
  # the year of a signature counts: CVE-2017 is older than 2018
  post_json PUT "/objects/$ips" '{"kind": "threat_prevention", "name": "smoke-ips", "spec": {"practiceMode": "inherited",
    "webAttacks": {"overrideMode": "inherited", "minimumConfidence": "high"},
    "intrusionPrevention": {"overrideMode": "prevent", "minCveYear": 2018}}}' > /dev/null
  wait_status_stable "$PHPUNIT" 200 "a signature of a CVE older than minCveYear still blocks"
  host_objects null
  wait_status_stable "$PHPUNIT" 200 "the path of PHPUnit is blocked once the IPS is off"
  wait_status "$SQLI" 403 "SQLi is not blocked once the practice with the IPS is gone"

  step "WAF -> Policy: File Security of a practice: an upload with a virus is refused (ClamAV), a clean one passes"
  # the EICAR test file of antivirus vendors; the ML model of the WAF only logs here (webAttacks detect), so a 403 is
  # the one of File Security
  EICAR='X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
  # a named file (Content-Disposition); unnamed ones follow unnamedFilesAction of the practice
  upload() {
    printf '%s' "$1" | curl -s -o /dev/null -w '%{http_code}' --max-time 30 -H 'Host: test.local' \
      -H 'Content-Type: application/octet-stream' -H 'Content-Disposition: attachment; filename="smoke.bin"' \
      --data-binary @- "$HTTP/smoke-upload"
  }
  upload_unnamed() {
    printf '%s' "$1" | curl -s -o /dev/null -w '%{http_code}' --max-time 30 -H 'Host: test.local' \
      -H 'Content-Type: application/octet-stream' --data-binary @- "$HTTP/smoke-upload"
  }
  files_spec() {
    printf '{"kind": "threat_prevention", "name": "smoke-files", "spec": {"practiceMode": "inherited",
      "webAttacks": {"overrideMode": "detect", "minimumConfidence": "high"}, "fileSecurity": {"overrideMode": "%s"}}}' "$1"
  }
  files=$(post_json POST /objects "$(files_spec prevent)" | new_id)
  [ -n "$files" ] || fail "the practice with File Security was not created"
  host_objects "{\"threatPreventionPractices\": [$files]}"
  # clamd starts with the first practice that needs it and loads its signatures: up to a few minutes
  for i in $(seq 1 120); do
    [ "$(upload "$EICAR")" = 403 ] && break
    [ "$i" = 120 ] && fail "an upload with the EICAR test file is not refused: $($CURL "$ADMIN/api/nginxions/waf/files")"
    sleep 3
  done
  $CURL "$ADMIN/api/nginxions/waf/files" | grep -q '"clamd": *"ClamAV ' || fail "clamd does not answer NginxionS"
  [ "$(upload 'a clean file of the smoke test')" = 200 ] || fail "a clean upload is refused"
  # unnamedFilesAction inherited: prevent, as the practice
  [ "$(upload_unnamed 'a clean file with no name')" = 403 ] || fail "a file with no name is not refused"
  for i in $(seq 1 30); do
    $CURL "$ADMIN/api/nginxions/events?kind=all&host=test.local&q=EICAR&limit=1" \
      | grep -q '"incident_type": *"File Security"' && break
    [ "$i" = 30 ] && fail "the refused upload is not in the events: $($CURL "$ADMIN/api/nginxions/events?kind=all&limit=3" | head -c 600)"
    sleep 2
  done
  step "WAF -> Policy: File Security in detect lets the upload through; off, clamd stops"
  post_json PUT "/objects/$files" "$(files_spec detect)" > /dev/null
  for i in $(seq 1 60); do
    [ "$(upload "$EICAR")" = 200 ] && break
    [ "$i" = 60 ] && fail "File Security in detect still refuses the upload"
    sleep 2
  done
  host_objects null
  for i in $(seq 1 30); do
    $CURL "$ADMIN/api/nginxions/waf/files" | grep -q '"enabled": *false' && break
    [ "$i" = 30 ] && fail "clamd is still on with no practice that needs it"
    sleep 2
  done
  wait_status "$SQLI" 403 "SQLi is not blocked once the practice with File Security is gone"

  step "WAF -> Policy: a custom response «response code only» answers with its own code"
  code406=$(post_json POST /objects '{"kind": "custom_response", "name": "smoke-406",
    "spec": {"mode": "response-code-only", "httpResponseCode": 406}}' | new_id)
  [ -n "$code406" ] || fail "the custom response was not created"
  host_objects "{\"customResponse\": $code406}"
  wait_status "$SQLI" 406 "the attack is not answered with the code of the custom response"
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not answered with 403 again"

  step "WAF -> Policy: a custom response «block page» shows its own title and text, nothing of a vendor"
  page406=$(post_json POST /objects '{"kind": "custom_response", "name": "smoke-page",
    "spec": {"mode": "block-page", "httpResponseCode": 406, "messageTitle": "Smoke title",
    "messageBody": "Smoke text of the page"}}' | new_id)
  [ -n "$page406" ] || fail "the custom response with a page was not created"
  host_objects "{\"customResponse\": $page406}"
  # the handlers of the agent take a new policy one after another: a request may still meet the previous response
  # (403) for a while, so the page and its code are waited for together, from one request, three times in a row
  hits=0
  for i in $(seq 1 60); do
    body=$(curl -s --max-time 10 -w ' HTTPCODE=%{http_code}' -H 'Host: test.local' "$HTTP$SQLI")
    code=${body##* HTTPCODE=}
    body=${body% HTTPCODE=*}
    if [ "$code" = 406 ] && echo "$body" | grep -q "Smoke title"; then hits=$((hits + 1)); else hits=0; fi
    [ "$hits" = 3 ] && break
    [ "$i" = 60 ] && fail "the custom response is not a page with its code 406 (status $code): $(echo "$body" | head -c 300)"
    sleep 1
  done
  echo "$body" | grep -q "Smoke text of the page" || fail "the text of the custom response is not on the page"
  echo "$body" | grep -q "Incident Id" || fail "the incident ID is not on the page"
  echo "$body" | grep -qi "openappsec" && fail "the page names a vendor: $(echo "$body" | head -c 300)"
  [ "${#body}" -lt 4000 ] || fail "the page of the WAF is ${#body} bytes (the page of the vendor of the agent was 278 KB)"
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not answered with 403 again"

  step "WAF -> Policy: a rate limit rule has its own conditions and action, answered with the response of the rule"
  # one practice, three rules: the tester's IP is limited on /smoke-mine; another IP only on /smoke-other; detect on
  # /smoke-detect logs and lets through (the action and the conditions of a rule were not read by the agent)
  rules=$(post_json POST /objects "{\"kind\": \"access_control\", \"name\": \"smoke-rules\",
    \"spec\": {\"rateLimit\": {\"overrideMode\": \"prevent\", \"rules\": [
      {\"uri\": \"/smoke-mine\", \"limit\": 2, \"unit\": \"minute\",
       \"condition\": [{\"key\": \"sourceIp\", \"value\": \"$client_ip\"}]},
      {\"uri\": \"/smoke-other\", \"limit\": 2, \"unit\": \"minute\",
       \"condition\": [{\"key\": \"sourceIp\", \"value\": \"192.0.2.99\"}]},
      {\"uri\": \"/smoke-detect\", \"limit\": 2, \"unit\": \"minute\", \"action\": \"detect\"}]}}}" | new_id)
  [ -n "$rules" ] || fail "the practice with rate limit rules was not created"
  host_objects "{\"accessControlPractices\": [$rules], \"customResponse\": $code406}"
  limited=""
  for i in $(seq 1 60); do
    for _ in 1 2 3 4 5; do
      [ "$(status /smoke-mine)" = 406 ] && limited=1
    done
    [ -n "$limited" ] && break
    [ "$i" = 60 ] && fail "the rule for the tester's IP does not limit, or not with the response of the rule (406)"
    sleep 2
  done
  for _ in 1 2 3 4 5 6; do
    [ "$(status /smoke-other)" = 200 ] || fail "a rule for another IP limits the tester"
    [ "$(status /smoke-detect)" = 200 ] || fail "a rule with the action detect blocks"
  done
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not answered with 403 again"

  step "WAF -> Policy: a custom response «redirect» sends the attack to its URL with the ID of the event"
  redirect=$(post_json POST /objects '{"kind": "custom_response", "name": "smoke-redirect",
    "spec": {"mode": "redirect", "redirectUrl": "https://help.example.com/blocked?from=waf", "redirectAddXEventId": true}}' | new_id)
  [ -n "$redirect" ] || fail "the redirect response was not created"
  host_objects "{\"customResponse\": $redirect}"
  location=""
  for i in $(seq 1 60); do
    location=$(curl -s -o /dev/null -D - --max-time 10 -H 'Host: test.local' "$HTTP$SQLI" | tr -d '\r' \
      | sed -n 's/^[Ll]ocation: //p')
    case "$location" in https://help.example.com/blocked\?from=waf\&event-id=*) break ;; esac
    [ "$i" = 60 ] && fail "the attack is not redirected with the ID of the event (status $(status "$SQLI"), location '$location')"
    sleep 2
  done
  host_objects null
  wait_status "$SQLI" 403 "SQLi is not answered with 403 again"

  step "WAF -> Learning: a trial of blocking on a detecting host reports what it would block, then switches it"
  trial() { $CURL -X "$1" -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1/trial" ${2:+-d "$2"}; }
  [ "$($CURL -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' \
    "$ADMIN/api/nginxions/waf/hosts/1/trial" -d '{"hours": 1}' 2>/dev/null || true)" = 400 ] \
    || fail "a trial was started on a host that blocks already"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "detect-learn", "minimum_confidence": "high"}' > /dev/null
  wait_status_stable "$SQLI" 200 "SQLi is still blocked in detect mode"
  trial POST '{"hours": 1}' | json | grep -q '"state":"running"' || fail "the trial did not start"
  report=""
  for i in $(seq 1 30); do
    status "$SQLI" > /dev/null
    report=$(trial GET | json)
    echo "$report" | grep -q '"toBlock":[1-9]' && break
    [ "$i" = 30 ] && fail "the trial does not report the attacks blocking would block: $(echo "$report" | head -c 400)"
    sleep 4
  done
  $CURL "$ADMIN/api/nginxions/learning/hosts" | json | grep -q '"trial":{"id"' || fail "Learning does not show the trial"
  trial PUT '{"enable": true}' | json | grep -q '"outcome":"enabled"' || fail "the trial was not closed by switching"
  $CURL "$ADMIN/api/nginxions/waf/hosts/1" | json | grep -q '"mode":"prevent-learn"' \
    || fail "the host was not switched to blocking by the trial"
  wait_status "$SQLI" 403 "SQLi is not blocked after the trial switched the host"

  step "WAF -> Policy: the v1beta2 example of open-appsec is imported and applied by the agent"
  applied_at() { $CURL "$ADMIN/api/nginxions/waf" | json | grep -o '"lastPolicyUpdate":"[^"]*"'; }
  before=$(last_version)
  previous=$(applied_at)
  example=$(sed 's/\\/\\\\/g; s/"/\\"/g' /examples/v1beta2-example.yaml | awk '{printf "%s\\n", $0}')
  post_json POST "/import?dry_run=true" "{\"content\": \"$example\"}" | json | grep -q '"errors":\[\]' \
    || fail "the example is not imported: $(post_json POST "/import?dry_run=true" "{\"content\": \"$example\"}")"
  post_json POST /import "{\"content\": \"$example\"}" | json | grep -q '"applied":true' || fail "the import was not applied"
  for i in $(seq 1 60); do
    [ "$(applied_at)" != "$previous" ] && break
    [ "$i" = 60 ] && fail "the agent did not apply the imported policy"
    sleep 2
  done
  post_json POST "/versions/$before/rollback" "" > /dev/null
  wait_status "$SQLI" 403 "SQLi is not blocked after the rollback of the import"

  step "Learning: the blocked attack is a group of the queue of its host"
  key=""
  for i in $(seq 1 30); do
    key=$($CURL "$ADMIN/api/nginxions/learning/queue?period=24h&host=1&reason=blocked&suggestions=0" \
      | grep -o '"key": *"[0-9a-f]*"' | head -1 | grep -o '[0-9a-f]\{32\}' || true)
    [ -n "$key" ] && break
    [ "$i" = 30 ] && fail "no blocked group for test.local: $($CURL "$ADMIN/api/nginxions/learning/queue?period=24h")"
    status "$SQLI" > /dev/null || true
    sleep 2
  done

  step "Learning: what the agent learned on the host is read through nginxions-control"
  learned=$($CURL "$ADMIN/api/nginxions/learning/hosts/1/learned" | json)
  echo "$learned" | grep -q '"assets":\[' || fail "what the agent learned is not read: $(echo "$learned" | head -c 400)"
  echo "$learned" | grep -q 'nginxions-control' && fail "nginxions-control does not read what the agent learned: $(echo "$learned" | head -c 400)"

  step "Learning: labelled legitimate with an exception, the attack passes at once; undo blocks it again"
  label=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/learning/labels" -d "{\"key\": \"$key\", \"decision\": \"benign\",
    \"scopes\": [{\"type\": \"parameterName\", \"value\": \"id\"}], \"exception\": true, \"ttl_days\": 1}")
  label_id=$(echo "$label" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*$')
  # decisions.data of the assets of the host is written in the shared storage, where the agent reads it
  echo "$label" | grep -q '"syncError": *""' || fail "the label was not written for the agent: $label"
  echo "$label" | grep -q '"syncedOn": *"' || fail "the label was not written for the agent: $label"
  $CURL "$ADMIN/api/nginxions/learning/queue?period=24h&host=1&suggestions=0" | grep -q "\"$key\"" \
    && fail "the labelled group is still in the queue"
  # the exception reaches the policy a moment later (debounced generation); while the agent reloads after the
  # rollback above, fail-open (50 ms) lets the attack through on its own, so 200 alone proves nothing yet
  for i in $(seq 1 30); do
    $CURL "$ADMIN/api/nginxions/waf/policy" | grep -q "nginxions-learn-$label_id" && break
    [ "$i" = 30 ] && fail "no exception of the label in the policy"
    sleep 1
  done
  wait_status_stable "$SQLI" 200 "SQLi labelled legitimate is still blocked"
  $CURL -X DELETE "$ADMIN/api/nginxions/learning/labels/$label_id" | grep -q '"ok": *true' || fail "the label was not undone"
  wait_status "$SQLI" 403 "SQLi is not blocked after the label was undone"
  $CURL "$ADMIN/api/nginxions/learning/labels?active=0" | grep -q '"undoneOn": *"' || fail "the undone label is not in the history"

  step "Learning: a snapshot of what the agent learned is taken, downloaded, uploaded and restored (the agent restarts)"
  snapshot=$($CURL -X POST "$ADMIN/api/nginxions/learning/snapshots" | tr -d ' \n')
  snapshot_id=$(echo "$snapshot" | grep -o '"id":"[0-9TZ]*-[0-9a-f]*"' | head -1 | cut -d'"' -f4)
  [ -n "$snapshot_id" ] || fail "no snapshot was taken: $(echo "$snapshot" | head -c 400)"
  echo "$snapshot" | grep -q '"reason":"manual"' || fail "the snapshot is not a manual one: $(echo "$snapshot" | head -c 400)"
  $CURL -o /tmp/learning.json.gz "$ADMIN/api/nginxions/learning/snapshots/$snapshot_id/download"
  [ "$(od -An -tx1 -N2 /tmp/learning.json.gz | tr -d ' ')" = 1f8b ] || fail "the downloaded snapshot is not gzip"
  uploaded=$($CURL -X POST -H 'Content-Type: application/octet-stream' --data-binary @/tmp/learning.json.gz \
    "$ADMIN/api/nginxions/learning/snapshots/upload" | tr -d ' \n')
  uploaded_id=$(echo "$uploaded" | grep -o '"id":"[0-9TZ]*-[0-9a-f]*"' | head -1 | cut -d'"' -f4)
  echo "$uploaded" | grep -q '"reason":"import"' || fail "the snapshot was not uploaded: $(echo "$uploaded" | head -c 400)"
  # a file that is not a snapshot is refused
  [ "$(printf 'nope' | curl -s -k -o /dev/null -w '%{http_code}' -b "$JAR" -X POST --data-binary @- \
    -H 'Content-Type: application/octet-stream' "$ADMIN/api/nginxions/learning/snapshots/upload" || true)" = 400 ] \
    || fail "a file that is not a snapshot was accepted"
  nginxions_before=$(started nginxions)
  $CURL -X POST "$ADMIN/api/nginxions/learning/snapshots/$uploaded_id/restore" | grep -q '"restarting": *true' \
    || fail "the snapshot was not restored"
  # the agent restarts with the snapshot in place, then nginxions: the API is away for a while
  back_after_restart "$nginxions_before" "the restore of the snapshot"
  wait_status "$SQLI" 403 "SQLi is not blocked after the restore of a snapshot of learning"
  snapshots=$($CURL "$ADMIN/api/nginxions/learning/snapshots" | tr -d ' \n')
  echo "$snapshots" | grep -q '"reason":"before-restore"' || fail "the state before the restore was not kept: $(echo "$snapshots" | head -c 600)"
  echo "$snapshots" | grep -q '"restoredOn":"' || fail "the restored snapshot is not marked: $(echo "$snapshots" | head -c 600)"
  $CURL "$ADMIN/api/nginxions/learning/hosts/1/learned" | grep -q '"assets"' || fail "what the agent learned is not read after the restore"

  step "WAF: detect-learn lets attacks through"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "detect-learn", "minimum_confidence": "high"}' > /dev/null
  wait_status_stable "$SQLI" 200 "SQLi is still blocked in detect-learn"

  step "WAF -> Events: the detected attack is an important event (Detect)"
  event Detect

  # the first requests after a restart of the agent (issue 149), at the end of the group: the host blocks again. The
  # group ends in fail-open, the default shared by the subsequent smoke groups and the browser tests. The separate
  # agent fault test enables fail-close immediately before stopping the agent.
  step "WAF: the host blocks again (prevent-learn)"
  $CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/waf/hosts/1" \
    -d '{"enabled": true, "mode": "prevent-learn", "minimum_confidence": "high"}' > /dev/null
  wait_status_stable "$SQLI" 403 "SQLi is not blocked again in prevent-learn"
  first_after_restart false
  first_after_restart true
else
  fail "the open-appsec agent became unreachable before the WAF scenarios"
fi
