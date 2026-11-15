#!/usr/bin/env bash
# Failures of the parts of the stack, one at a time: the sites keep working (fail-open) and everything comes back by
# itself, with no event lost. The stack of the closed network (nginxions, openappsec, crowdsec, postgres) with a proxy
# host under the WAF in prevent-learn (deploy/test/waf-score-setup.sh):
#   the agent killed       requests pass while it restarts, then an attack is blocked again
#   the backend killed     nginx keeps proxying, the API comes back
#   CrowdSec stopped       the sites work, the API of NginxionS answers, CrowdSec comes back
#   PostgreSQL stopped     the sites work; an attack during the outage is one event once the database is back
#
#   NGINXIONS_REGISTRY=docker.io/opensophy NGINXIONS_VERSION=<tag> scripts/test-chaos.sh
set -euo pipefail

cd "$(dirname "$0")/.."
CURL_VERSION=$(grep -m1 '^CURL_VERSION=' deploy/.env | cut -d= -f2)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nginxions-chaos}"
compose=(docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml)
net="${COMPOSE_PROJECT_NAME}_edge"
state="${COMPOSE_PROJECT_NAME}-state"
probe="${COMPOSE_PROJECT_NAME}-probe"
SQLI="/?id=1%27%20OR%20%271%27=%271"

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then
    echo "--- logs (failure) ---"
    "${compose[@]}" logs --no-color --tail 60 || true
  fi
  docker rm -f "$probe" > /dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || { "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true; docker volume rm "$state" > /dev/null 2>&1 || true; }
  exit $status
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; exit 1; }

# requests from a container of the closed network
code() { docker exec "$probe" curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "http://nginxions$1" || true; }
api() { docker exec "$probe" curl -sS --max-time 20 -k -b /state/cookies "https://nginxions:81$1" 2> /dev/null || true; }
# n answers in a row within a time
expect() { # path, code, seconds, message
  local ok=0 i
  for i in $(seq 1 "$3"); do
    if [ "$(code "$1")" = "$2" ]; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" -ge 3 ] && return 0
    sleep 1
  done
  fail "$4 (last answer $(code "$1"))"
}
# the site answers every request during a failure (nothing but 200)
serves() { # seconds, message
  local i c
  for i in $(seq 1 "$1"); do
    c=$(code /)
    [ "$c" = 200 ] || fail "$2: the site answered $c"
    sleep 1
  done
}

"${compose[@]}" up -d --no-build nginxions openappsec crowdsec test-upstream
for i in $(seq 1 120); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q nginxions)" 2> /dev/null || true)
  [ "$s" = healthy ] && break
  [ "$i" = 120 ] && fail "nginxions is not healthy: $s"
  sleep 2
done
docker volume create "$state" > /dev/null
docker run --rm --user 0 --network "$net" -e JAR=/state/cookies -v "$state:/state" \
  -v "$PWD/deploy/test/waf-score-setup.sh:/setup.sh:ro" "docker.io/curlimages/curl:$CURL_VERSION" sh /setup.sh
docker run -d --user 0 --name "$probe" --network "$net" -v "$state:/state" --entrypoint sleep \
  "docker.io/curlimages/curl:$CURL_VERSION" 3600 > /dev/null

echo "==> the agent killed: requests pass while it restarts, then the WAF blocks again"
"${compose[@]}" exec -T openappsec sh -c 'pkill -9 -f cp-nano-http-transaction-handler' || true
serves 10 "while the agent restarts"
expect "$SQLI" 403 180 "the WAF does not block again after the agent restarted"

echo "==> the backend killed: nginx keeps proxying, the API comes back"
"${compose[@]}" exec -T nginxions sh -c 'pkill -9 -f index.js' || true
serves 5 "while the backend restarts"
for i in $(seq 1 90); do
  api /api/ | grep -q '"status": *"OK"' && break
  [ "$i" = 90 ] && fail "the API did not come back after the backend was killed"
  sleep 2
done

echo "==> CrowdSec stopped: the sites work, NginxionS answers"
"${compose[@]}" stop crowdsec > /dev/null
serves 15 "with CrowdSec stopped"
api /api/ | grep -q '"status": *"OK"' || fail "the API does not answer with CrowdSec stopped"
"${compose[@]}" start crowdsec > /dev/null
for i in $(seq 1 90); do
  api /api/nginxions/crowdsec | tr -d ' \n' | grep -q '"lapi":{"healthy":true' && break
  [ "$i" = 90 ] && fail "CrowdSec did not come back: $(api /api/nginxions/crowdsec | head -c 300)"
  sleep 2
done

echo "==> PostgreSQL stopped: the sites work; an attack meanwhile is one event once it is back"
"${compose[@]}" stop postgres > /dev/null
serves 10 "with PostgreSQL stopped"
marker="chaos-$(date +%s)"
expect "/$marker$SQLI" 403 60 "the WAF does not block with PostgreSQL stopped"
"${compose[@]}" start postgres > /dev/null
for i in $(seq 1 90); do
  events=$(api "/api/nginxions/events?kind=security&q=$marker&limit=20")
  echo "$events" | grep -q "$marker" && break
  [ "$i" = 90 ] && fail "the attack during the outage of PostgreSQL is not an event: $(echo "$events" | head -c 300)"
  sleep 2
done
sleep 15
n=$(api "/api/nginxions/events?kind=security&q=$marker&limit=50" | grep -o "\"uri\": *\"/$marker/\"" | wc -l)
# expect sent the attack until three refusals in a row: as many events as refusals (403), each once
refused=$(api "/api/nginxions/analytics/requests?path=/$marker/&status=4xx&limit=1" | grep -o '"total": *[0-9]*' | grep -o '[0-9]*$')
[ "$n" -ge 1 ] && [ "$n" = "${refused:-$n}" ] || fail "attacks refused during the outage: $refused, events: $n"
expect "$SQLI" 403 60 "the WAF does not block after PostgreSQL is back"
echo "OK: the stack survives the failure of each of its parts"
