#!/usr/bin/env bash
# The score of the WAF: GoTestWAF (thousands of attacks of OWASP and API classes, and legitimate requests) against a
# proxy host in prevent-learn with the recommended practice, from the closed network. The stack has no CrowdSec: a
# ban of the scanner would block its legitimate requests too and spoil the score. Report in $OUT (reports/waf):
# gotestwaf.json and the summary of the run. Exits non-zero only when the stack or the scan fails.
#
#   NGINXIONS_REGISTRY=local NGINXIONS_VERSION=dev scripts/test-waf-score.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=../.github/security/tools.env
. .github/security/tools.env
# only the version of curl: deploy/.env also holds NGINXIONS_VERSION, which the caller sets
CURL_VERSION=$(grep -m1 '^CURL_VERSION=' deploy/.env | cut -d= -f2)

OUT="${OUT:-reports/waf}"
mkdir -p "$OUT"
out="$(cd "$OUT" && pwd)"
chmod 777 "$out"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nginxions-wafscore}"
compose=(docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml)
net="${COMPOSE_PROJECT_NAME}_edge"

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then
    echo "--- logs (failure) ---"
    "${compose[@]}" logs --no-color --tail 60 || true
  fi
  [ "${KEEP:-}" = 1 ] || "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  exit $status
}
trap cleanup EXIT

"${compose[@]}" up -d --no-build nginxions openappsec test-upstream
echo "==> waiting for nginxions to become healthy"
for i in $(seq 1 90); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q nginxions)" 2> /dev/null || true)
  [ "$state" = healthy ] && break
  [ "$i" = 90 ] && { echo "nginxions is not healthy: $state"; exit 1; }
  sleep 2
done

echo "==> set up: admin, proxy host test.local protected by the WAF"
docker run --rm --network "$net" -v "$PWD/deploy/test/waf-score-setup.sh:/setup.sh:ro" \
  "docker.io/curlimages/curl:$CURL_VERSION" sh /setup.sh

ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$("${compose[@]}" ps -q openappsec)")
echo "==> GoTestWAF ($GOTESTWAF_IMAGE)"
# --skipWAFBlockCheck: the check of a block runs before the scan and needs nothing else; 403 is the block page
docker run --rm --network "$net" --add-host "test.local:$ip" -v "$out:/out" "$GOTESTWAF_IMAGE" \
  --url http://test.local/ --blockStatusCodes 403 --skipWAFBlockCheck --noEmailReport --wafName NginxionS \
  --workers 8 --reportFormat json --reportPath /out --reportName gotestwaf 2>&1 | tee "$out/gotestwaf.log" | tail -n 60
[ -s "$out/gotestwaf.json" ] || { echo "FAIL: GoTestWAF left no report"; exit 1; }

node scripts/waf-score.mjs "$out/gotestwaf.json" "$out/gotestwaf.log" > "$out/waf-score.md" || true
cat "$out/waf-score.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$out/waf-score.md" >> "$GITHUB_STEP_SUMMARY"; fi
echo "OK: WAF score in $OUT"
