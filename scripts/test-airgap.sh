#!/usr/bin/env bash
# Closed-network test: brings up a fresh stack where no network can reach the internet,
# runs deploy/test/smoke.sh inside it and checks that no service tried to go online.
#
#   scripts/test-airgap.sh                 # full stack
#   SERVICES="nginxions crowdsec" scripts/test-airgap.sh   # subset (dependencies are added by compose)
#   SMOKE_GROUPS="waf crowdsec" scripts/test-airgap.sh       # some groups of smoke (deploy/test/smoke/), all by default
#   UI_E2E=0 scripts/test-airgap.sh                            # without the interface in a browser
#   GUI_E2E=1 scripts/test-airgap.sh                           # with the interface driven like a user (gui-e2e.mjs)
#
# A failed group of smoke does not stop the test: the checks after it still run, the test fails at its end. The
# steps of smoke with their times are in reports/smoke (scripts/smoke-report.mjs) and in the summary of the run.
#
# Images: NGINXIONS_REGISTRY / NGINXIONS_VERSION and the pinned versions in deploy/.env.
set -euo pipefail

cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nginxions-airgap}"
compose=(docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml)
read -r -a services <<< "${SERVICES:-nginxions openappsec crowdsec clamav}"
export SMOKE_GROUPS="${SMOKE_GROUPS:-all}"
smoke_has() { [ "$SMOKE_GROUPS" = all ] || [[ " ${SMOKE_GROUPS//,/ } " == *" $1 "* ]]; }

# every error and warning of the stack, compared with deploy/test/log-allowlist.tsv (scripts/audit-logs.mjs): the
# report is in reports/logs and in the summary of the run; LOG_AUDIT=gate fails the test on a new one
audit_logs() {
  out=reports/logs
  mkdir -p "$out"
  for svc in $("${compose[@]}" ps -a --services 2> /dev/null); do
    "${compose[@]}" logs --no-color --no-log-prefix "$svc" > "$out/$svc.log" 2>&1 || true
  done
  if [ -n "$("${compose[@]}" ps -q openappsec 2> /dev/null)" ]; then
    "${compose[@]}" exec -T openappsec sh -c 'cat /var/log/nano_agent/*.dbg* /var/log/nano_agent/*.err 2> /dev/null' \
      > "$out/agent-debug.log" 2>&1 || true
  fi
  if command -v node > /dev/null; then
    node scripts/audit-logs.mjs "$out" --out "$out" ${LOG_AUDIT:+$([ "$LOG_AUDIT" = gate ] && echo --gate)}
  else
    echo "log audit skipped: no node"
  fi
}

# what the backend ran during the test (NODE_V8_COVERAGE of deploy/test/compose.airgap.yaml): SIGUSR2 makes the backend
# write it (index.js), then it is copied to reports/coverage-stack/backend for scripts/coverage-report.mjs
collect_coverage() {
  [ -n "$("${compose[@]}" ps -q nginxions 2> /dev/null)" ] || return 0
  "${compose[@]}" exec -T nginxions sh -c 'for p in $(pgrep -f "[i]ndex.js"); do kill -USR2 "$p"; done' || return 0
  sleep 3
  mkdir -p reports/coverage-stack
  docker cp "$("${compose[@]}" ps -q nginxions):/tmp/coverage-backend" reports/coverage-stack/backend > /dev/null 2>&1 || true
  command -v node > /dev/null && node scripts/coverage-report.mjs --trim reports/coverage-stack/backend
  echo "coverage of the backend: $(find reports/coverage-stack/backend -name '*.json' 2> /dev/null | wc -l) files"
}

cleanup() {
  status=$?
  audit_logs || true
  if [ $status -ne 0 ]; then
    echo "--- logs (failure) ---"
    "${compose[@]}" logs --no-color --tail 80 || true
    if [ -n "$("${compose[@]}" ps -q openappsec 2> /dev/null)" ]; then
      echo "--- open-appsec agent: log files, settings, policy status (failure) ---"
      "${compose[@]}" exec -T openappsec sh -c 'ls -la /var/log/nano_agent; cat /etc/cp/conf/settings.json;
        cat /ext/appsec/nginxions-agent.env; tail -n 5 /var/log/nano_agent/cp-nano-http-transaction-handler.log*;
        tail -n 20 /var/log/nano_agent/*.err 2> /dev/null;
        echo "--- policy of the agent: web user responses, triggers of the rules ---";
        grep -ho "\"webUserResponse\": *\[[^]]*\]" /etc/cp/conf/*/*.policy 2> /dev/null | sort -u | head -c 3000; echo;
        grep -ho "\"triggers\": *\[[^]]*\]" /etc/cp/conf/*/*.policy 2> /dev/null | sort -u | head -c 3000; echo;
        echo "--- configuration the agent made of the policy: rate limits ---";
        grep -o "\"accessControlV2\".\{0,3000\}" /tmp/local_appsec.policy 2> /dev/null | head -c 3000; echo;
        echo "--- exceptions: local_policy.yaml, the configuration the agent made of it, the policy of the services ---";
        grep -h -A 40 "^exceptions:" /etc/cp/conf/local_policy.yaml 2> /dev/null | head -n 60;
        grep -o "\"exceptions\": *\[.\{0,2000\}" /tmp/local_appsec.policy 2> /dev/null | head -c 2000; echo;
        grep -ho "\"exception\": *\[.\{0,2000\}" /etc/cp/conf/*/*.policy 2> /dev/null | sort -u | head -c 3000; echo;
        echo "--- rules of local_policy.yaml (their exceptions) and the overrides the WAF of the agent applies ---";
        grep -h -A 60 "^policies:" /etc/cp/conf/local_policy.yaml 2> /dev/null | head -n 80;
        grep -ho "\"overrides\": *\[.\{0,3000\}" /etc/cp/conf/waap/*.policy /etc/cp/conf/*/*.policy 2> /dev/null \
          | sort -u | head -c 4000; echo;
        echo "--- orchestration: checks of updates, policies applied ---";
        grep -h "check update\|Check update\|NginxionS\|apply\|Failed\|econfiguration" /var/log/nano_agent/cp-nano-orchestration.dbg* \
          2> /dev/null | tail -n 40' || true
    fi
  fi
  collect_coverage || true
  [ "${KEEP:-}" = 1 ] || "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  exit $status
}
trap cleanup EXIT

"${compose[@]}" up -d --no-build "${services[@]}" test-upstream


wait_healthy() {
  for i in $(seq 1 90); do
    state=$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q nginxions)" 2>/dev/null || true)
    [ "$state" = healthy ] && return 0
    [ "$i" = 90 ] && { echo "nginxions is not healthy: $state"; return 1; }
    sleep 2
  done
}

echo "==> waiting for nginxions to become healthy"
wait_healthy
echo "==> smoke (groups: $SMOKE_GROUPS)"
smoke_status=0
"${compose[@]}" run --rm -T tester || smoke_status=$?
mkdir -p reports/smoke
for f in smoke-steps.tsv smoke-groups.tsv; do
  "${compose[@]}" run --rm -T --entrypoint cat tester "/state/$f" > "reports/smoke/$f" 2> /dev/null || true
done
command -v node > /dev/null && node scripts/smoke-report.mjs reports/smoke || true

# an update runs init again on the volumes of an existing install (issue 146: the copies of the secrets are read
# only and init has no capabilities, cp could not write them)
echo "==> init again on existing volumes (an update) succeeds"
"${compose[@]}" run --rm -T nginxions-init || { echo "FAIL: nginxions-init fails on an existing install"; exit 1; }

echo "==> restart nginxions"
"${compose[@]}" restart nginxions
wait_healthy
"${compose[@]}" run --rm -T tester after-restart

# the interface in a real browser with the session of smoke: every page renders, no error of JavaScript, no 5xx of the
# API, screenshots in reports/ui (deploy/test/ui-e2e.mjs, UI_E2E=1); the interface driven like a user, each action
# checked by its effect on the sites (deploy/test/gui-e2e.mjs, GUI_E2E=1, reports/gui). The container installs the
# package of Playwright on the default network, then is moved into the closed network of the stack.
if [ "${UI_E2E:-1}" = 1 ] || [ "${GUI_E2E:-0}" = 1 ]; then
  pw_image=$(grep -m1 '^PLAYWRIGHT_IMAGE=' .github/security/tools.env | cut -d= -f2-)
  pw_version=$(grep -m1 '^PLAYWRIGHT_VERSION=' .github/security/tools.env | cut -d= -f2-)
  pw="${COMPOSE_PROJECT_NAME}-ui"
  mkdir -p reports/ui reports/gui
  docker rm -f "$pw" > /dev/null 2>&1 || true
  docker run -d --name "$pw" --init -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    -v "$PWD/deploy/test/ui-e2e.mjs:/e2e/ui-e2e.mjs:ro" -v "$PWD/deploy/test/gui-e2e.mjs:/e2e/gui-e2e.mjs:ro" \
    -v "${COMPOSE_PROJECT_NAME}_test-state:/state:ro" \
    -v "$PWD/reports/ui:/out" -v "$PWD/reports/gui:/out-gui" -w /e2e "$pw_image" sleep 3600 > /dev/null
  docker exec "$pw" sh -c "npm init -y > /dev/null && npm install --no-save --no-audit --no-fund playwright@$pw_version > /dev/null"
  docker network connect "${COMPOSE_PROJECT_NAME}_edge" "$pw"
  docker network disconnect bridge "$pw"
  ui_status=0
  if [ "${UI_E2E:-1}" = 1 ]; then
    echo "==> the interface in a browser: every page"
    docker exec "$pw" node ui-e2e.mjs || ui_status=$?
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -s reports/ui/ui-e2e.md ]; then cat reports/ui/ui-e2e.md >> "$GITHUB_STEP_SUMMARY"; fi
  fi
  gui_status=0
  if [ "${GUI_E2E:-0}" = 1 ]; then
    echo "==> the interface driven like a user: each action checked by its effect"
    docker exec -e OUT=/out-gui "$pw" node gui-e2e.mjs || gui_status=$?
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -s reports/gui/gui-e2e.md ]; then cat reports/gui/gui-e2e.md >> "$GITHUB_STEP_SUMMARY"; fi
  fi
  docker rm -f "$pw" > /dev/null 2>&1 || true
  [ "$ui_status" = 0 ] || { echo "FAIL: a page of the interface is broken (reports/ui/ui-e2e.md)"; exit 1; }
  [ "$gui_status" = 0 ] || { echo "FAIL: an action in the interface had no effect (reports/gui/gui-e2e.md)"; exit 1; }
fi

# the isolation of the networks, as an attacker on the edge network (the internet side) would try it: the internal
# services (database, LAPI of CrowdSec, clamd) and nginxions-control (the Docker API, network "control") are not on
# it, and the local services of the openappsec container (agent 7777, shared storage 7811, tuning 7813) listen on
# 127.0.0.1 only
echo "==> networks: from the edge, internal services and the local ports of openappsec are out of reach"
"${compose[@]}" run --rm -T --entrypoint sh tester -c '
  bad=""
  for t in postgres:5432 crowdsec:8080 crowdsec:7422 clamav:3310 nginxions-control:7080 control:7080 nginxions:7777 nginxions:7080 nginxions:7811 nginxions:7813; do
    # the time of the TCP connection: 0 when none was made (no such name on this network, refused, dropped); a server
    # that waits for its client keeps curl until the timeout, so its exit code does not tell
    tc=$(curl -s -o /dev/null -w "%{time_connect}" --connect-timeout 3 --max-time 4 "telnet://$t" < /dev/null)
    case "$tc" in 0|0.0*|0,0*|"") ;; *) bad="$bad $t(connected in ${tc}s)" ;; esac
  done
  [ -z "$bad" ] || { echo "FAIL: reachable from the edge network:$bad"; exit 1; }
  echo "    none reachable"' || { echo "FAIL: the networks of the stack are not isolated"; exit 1; }

echo "==> all requested services are still running"
for s in "${services[@]}"; do
  id=$("${compose[@]}" ps -q "$s")
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Running}}' "$id")" = true ] || { echo "FAIL: $s is not running"; exit 1; }
done

if [[ " ${services[*]} " == *" crowdsec "* ]]; then
  echo "==> CrowdSec runs locally with the NginxionS bouncer pre-registered"
  "${compose[@]}" exec -T crowdsec cscli bouncers list -o raw | grep -q '^nginxions,' || { echo "FAIL: bouncer nginxions is not registered"; exit 1; }
  "${compose[@]}" exec -T crowdsec cscli bouncers list -o raw | grep -q '^appsec,' || { echo "FAIL: bouncer appsec is not registered"; exit 1; }
  echo "==> NginxionS manages CrowdSec: its machine is registered, the hub index comes from NginxionS"
  "${compose[@]}" exec -T crowdsec cscli machines list -o raw | grep -q '^nginxions-' || { echo "FAIL: the machine of NginxionS is not registered"; exit 1; }
  "${compose[@]}" exec -T crowdsec cscli hub update > /dev/null || { echo "FAIL: cscli hub update does not reach the hub of NginxionS"; exit 1; }
  # smoke banned the tester through the bouncer of NginxionS in nginx: it reads the decisions of the local LAPI
  if smoke_has crowdsec; then
    echo "==> the CrowdSec bouncer of NginxionS pulls decisions from the local LAPI"
    line=$("${compose[@]}" exec -T crowdsec cscli bouncers list -o raw | grep '^nginxions,' || true)
    # name,ip,valid,last_pull,...: last_pull is set after the first pull
    [ -n "$(echo "$line" | cut -d, -f4)" ] || { echo "FAIL: the bouncer of NginxionS never pulled CrowdSec decisions: $line"; exit 1; }
  fi
  # the IP reputation of the agent stays off (WAF -> Agent): it would hold every request for a lookup
fi

if [[ " ${services[*]} " == *" openappsec "* ]] && { smoke_has waf || smoke_has events || smoke_has crowdsec; }; then
  # smoke sent attacks: the agent sends its logs to the local tuning service, which creates its events database
  # with the first one. Without a Fog there is no access token: the agent refused to send them (fixed in openappsec/agent).
  echo "==> the agent's logs reach the local tuning service (its events database exists)"
  for i in $(seq 1 30); do
    db=$("${compose[@]}" exec -T postgres psql -U postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname = 'i2datatubeschemasecurityeventlogsv03'" 2> /dev/null || true)
    [ "$db" = 1 ] && break
    [ "$i" = 30 ] && { echo "FAIL: the tuning service got no logs of the agent (no events database)"; exit 1; }
    sleep 2
  done
  agent_log=$("${compose[@]}" exec -T openappsec sh -c 'cat /var/log/nano_agent/*.dbg* 2> /dev/null' || true)
  if echo "$agent_log" | grep -q 'Access token is missing'; then
    echo "FAIL: the agent asks for an access token of the Fog to reach a local service"
    exit 1
  fi
  # the agent of NginxionS has no cloud (openappsec/agent): no connection to a Fog is even tried
  if echo "$agent_log" | grep -E 'connected to the Fog|Failed to connect to the Fog|Setting a fog connection'; then
    echo "FAIL: the agent tried to reach a Fog"
    exit 1
  fi
fi

if [[ " ${services[*]} " == *" openappsec "* ]] && smoke_has crowdsec; then
  # smoke set the log trigger to syslog on localhost:5514 (UDP) and 127.0.0.1:5515 (TCP): the agent sends to the relay
  # of NginxionS (waf/syslog.js), which forwards to both. The listeners run in the network of the agent.
  echo "==> syslog of the agent reaches every server through the relay of NginxionS"
  "${compose[@]}" exec -T -d nginxions node -e '
    const fs = require("node:fs");
    require("node:dgram").createSocket("udp4").on("message", (m) => fs.appendFileSync("/tmp/syslog-udp", m + "\n"))
      .bind(5514, "127.0.0.1");
    require("node:net").createServer((c) => c.on("data", (d) => fs.appendFileSync("/tmp/syslog-tcp", d)))
      .listen(5515, "127.0.0.1");
    setTimeout(() => process.exit(0), 180000);'
  for i in $(seq 1 45); do
    "${compose[@]}" exec -T nginxions curl -s -o /dev/null --max-time 5 -H 'Host: test.local' \
      "http://127.0.0.1/?id=1%27%20OR%20%271%27=%271" || true
    got=$("${compose[@]}" exec -T nginxions sh -c 'test -s /tmp/syslog-udp && test -s /tmp/syslog-tcp && echo yes' || true)
    [ "$got" = yes ] && break
    [ "$i" = 45 ] && { echo "FAIL: syslog of the agent did not reach both servers through the relay"; \
      "${compose[@]}" exec -T nginxions sh -c 'ls -la /tmp/syslog-* 2>&1; head -c 300 /tmp/syslog-* 2>&1' || true; exit 1; }
    sleep 2
  done
  # TCP is framed by octet counting, as the agent does it: "<length> <message>"
  "${compose[@]}" exec -T nginxions sh -c 'head -c 200 /tmp/syslog-tcp' | grep -Eq '^[0-9]+ ' \
    || { echo "FAIL: syslog over TCP is not framed by octet counting"; exit 1; }
fi

nginx_timeouts() {
  "${compose[@]}" logs --no-color nginxions 2>&1 | grep -c "Reached timeout during attempt to signal nano service" || true
}

echo "==> sustained traffic through the WAF: the attachment reaches the agent (open-appsec issue 110)"
# open-appsec issue 110: "Reached timeout during attempt to signal nano service" at a few requests per second, each
# one a request let through unchecked (fail-open). 20 clients, 100 requests each.
before=$(nginx_timeouts)
"${compose[@]}" exec -T nginxions sh -c '
  for c in $(seq 1 20); do
    (for i in $(seq 1 100); do curl -s -o /dev/null --max-time 5 -H "Host: test.local" http://127.0.0.1/load-$c-$i || true; done) &
  done
  wait'
timeouts=$(( $(nginx_timeouts) - before ))
echo "nano service timeouts during 2000 requests: $timeouts"
# fail-open's timeout is short in the test (smoke sets 50 ms): a few under the load of CI are timing, a share is not
[ "$timeouts" -le 20 ] || { echo "FAIL: $timeouts of 2000 requests could not reach the agent (over 1%)"; exit 1; }

echo "==> nginx reloads under traffic: the old workers exit (open-appsec attachment, issue of stuck workers)"
# NginxionS reloads nginx at every change made in the GUI; a worker of the attachment that never left "shutting down"
# would pile up with every reload
"${compose[@]}" exec -T nginxions sh -c '
  (for i in $(seq 1 300); do curl -s -o /dev/null --max-time 2 http://127.0.0.1/ || true; done) &
  for i in 1 2 3; do nginx -s reload; sleep 3; done
  wait'
stuck=0
for i in $(seq 1 20); do
  stuck=$("${compose[@]}" exec -T nginxions sh -c 'ps -o args 2> /dev/null || ps' | grep -c "shutting down" || true)
  [ "$stuck" = 0 ] && break
  sleep 3
done
[ "$stuck" = 0 ] || { echo "FAIL: $stuck nginx workers are still shutting down a minute after the reloads"; exit 1; }

echo "==> nginx reloads while the agent does not answer: the old workers exit all the same (issue 105)"
# the worst case of issue 105: requests waiting for an agent that is stopped (SIGSTOP) when the workers are told to quit
"${compose[@]}" exec -T openappsec sh -c 'pkill -STOP -f cp-nano-http-transaction-handler'
"${compose[@]}" exec -T nginxions sh -c '
  (for i in $(seq 1 60); do curl -s -o /dev/null --max-time 3 http://127.0.0.1/ || true; done) &
  sleep 2; nginx -s reload; sleep 2; nginx -s reload
  wait'
stuck=0
for i in $(seq 1 20); do
  stuck=$("${compose[@]}" exec -T nginxions sh -c 'ps -o args 2> /dev/null || ps' | grep -c "shutting down" || true)
  [ "$stuck" = 0 ] && break
  sleep 3
done
"${compose[@]}" exec -T openappsec sh -c 'pkill -CONT -f cp-nano-http-transaction-handler'
[ "$stuck" = 0 ] || { echo "FAIL: $stuck nginx workers stay shutting down while the agent does not answer"; exit 1; }
echo "==> requests are answered again after the agent is resumed"
for i in $(seq 1 30); do
  code=$("${compose[@]}" exec -T nginxions curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/ || true)
  [ "$code" != 000 ] && [ -n "$code" ] && break
  [ "$i" = 30 ] && { echo "FAIL: nginx does not answer after the agent is resumed"; exit 1; }
  sleep 2
done

if smoke_has waf; then
  echo "==> fail-close: a request the agent does not answer gets the 403 page, not a closed connection (issue 149)"
  # smoke leaves the host blocking and fail-close on. The response filters of the attachment returned an error on the 403
  # page of the request they had refused themselves: nginx logged 403 and closed the connection with nothing sent
  # ("Empty reply from server"). The agent is stopped (SIGSTOP) longer than the timeouts of the attachment.
  # smoke switches fail-close on in its last step; a smoke failure before it leaves fail-open, where a request the agent
  # does not answer passes by design: that is the failure of smoke (reported below), not a second one here
  fail_open=$("${compose[@]}" exec -T openappsec sh -c 'cat /etc/cp/conf/settings.json' \
    | grep -o '"agent.failOpenState.nginxModule", *"value": *"[a-z]*"' | grep -o '[a-z]*"$' | tr -d '"')
  if [ "$fail_open" != false ]; then
    if [ "$smoke_status" != 0 ]; then
      echo "    skipped: smoke failed before it switched fail-close on (fail-open: ${fail_open:-unknown})"
    else
      echo "FAIL: smoke passed but left fail-open ${fail_open:-unknown}, not fail-close"
      exit 1
    fi
  else
  xss='http://127.0.0.1/fail-close?q=%3Cscript%3Ealert(document.cookie)%3C/script%3E'
  waf_get() { "${compose[@]}" exec -T nginxions curl -s -o /dev/null -w '%{http_code} %{size_download}' --max-time 10 -H 'Host: test.local' "$1" || true; }
  for i in $(seq 1 30); do
    case "$(waf_get "$xss")" in "403 "*) break ;; esac
    [ "$i" = 30 ] && { echo "FAIL: the attack is not blocked before the test"; exit 1; }
    sleep 2
  done
  # new workers (reload): not registered with the agent yet, the case of the first request after a restart of the agent
  "${compose[@]}" exec -T nginxions nginx -s reload
  sleep 3
  "${compose[@]}" exec -T openappsec sh -c 'pkill -STOP -f cp-nano-http-transaction-handler'
  normal=$(waf_get 'http://127.0.0.1/?q=hello')
  "${compose[@]}" exec -T openappsec sh -c 'pkill -CONT -f cp-nano-http-transaction-handler'
  case "$normal" in
    "403 0" | "000 "* | "" | " "*) echo "FAIL: fail-close answered \"$normal\" (status, bytes): no page was sent"; exit 1 ;;
    "403 "*) ;;
    *) echo "FAIL: fail-close let a request through while the agent did not answer: \"$normal\""; exit 1 ;;
  esac
  fi
fi

echo "==> no nginx worker crashed (signal, failed allocation)"
if "${compose[@]}" logs --no-color nginxions 2>&1 | grep -E "worker process [0-9]+ exited on signal|malloc\([0-9]+\) failed"; then
  echo "FAIL: an nginx worker crashed"
  exit 1
fi

echo "==> no phone-home attempts in logs"
# Messages that only appear when a component tries to reach a cloud service by default
if "${compose[@]}" logs --no-color "${services[@]}" 2>&1 \
  | grep -E "Fetching IP Ranges|Error downloading gravatar|Failed to fetch remote version|Registering ACME account|certbot.ini register|api\.crowdsec\.net|version\.crowdsec\.net|my\.openappsec\.io|cloud\.ngen\.checkpoint\.com"; then
  echo "FAIL: a component tried to reach a cloud service"
  exit 1
fi

if [ "$smoke_status" != 0 ]; then
  echo "FAIL: smoke groups failed (above and in reports/smoke/smoke.md); the checks after smoke passed"
  exit 1
fi
echo "OK: closed-network test passed"
