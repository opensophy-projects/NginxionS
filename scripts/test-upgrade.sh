#!/usr/bin/env bash
# The test of an update: the stack of the release before (FROM_VERSION, by default the published develop) gets data
# (deploy/test/upgrade-check.sh seed), then the images of this build replace it on the same volumes and everything
# must still be there and work (upgrade-check.sh verify), with no new error in the logs (scripts/audit-logs.mjs).
#
#   NGINXIONS_REGISTRY=docker.io/opensophy NGINXIONS_VERSION=<new tag> [FROM_REGISTRY=..] [FROM_VERSION=develop] \
#     scripts/test-upgrade.sh
set -euo pipefail

cd "$(dirname "$0")/.."
NEW_REGISTRY="${NGINXIONS_REGISTRY:?the registry of the new images}"
NEW_VERSION="${NGINXIONS_VERSION:?the tag of the new images}"
FROM_REGISTRY="${FROM_REGISTRY:-docker.io/opensophy}"
FROM_VERSION="${FROM_VERSION:-develop}"
CURL_VERSION=$(grep -m1 '^CURL_VERSION=' deploy/.env | cut -d= -f2)

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nginxions-upgrade}"
compose=(docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml)
seed_compose=("${compose[@]}")
net="${COMPOSE_PROJECT_NAME}_edge"
services=(nginxions openappsec crowdsec test-upstream)
state="${COMPOSE_PROJECT_NAME}-state"

cleanup() {
  status=$?
  out=reports/upgrade
  mkdir -p "$out"
  for svc in $("${compose[@]}" ps -a --services 2> /dev/null); do
    "${compose[@]}" logs --no-color --no-log-prefix "$svc" > "$out/$svc.log" 2>&1 || true
  done
  if [ $status -ne 0 ]; then
    echo "--- logs (failure) ---"
    "${compose[@]}" logs --no-color --tail 60 || true
  fi
  [ "${KEEP:-}" = 1 ] || { "${seed_compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true; docker volume rm "$state" > /dev/null 2>&1 || true; }
  exit $status
}
trap cleanup EXIT

wait_healthy() {
  for i in $(seq 1 120); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q nginxions)" 2> /dev/null || true)
    [ "$s" = healthy ] && return 0
    [ "$i" = 120 ] && { echo "nginxions is not healthy: $s"; return 1; }
    sleep 2
  done
}
check() {
  docker run --rm --user 0 --network "$net" -v "$PWD/deploy/test/upgrade-check.sh:/check.sh:ro" -v "$state:/state" \
    "docker.io/curlimages/curl:$CURL_VERSION" sh /check.sh "$1"
}

echo "==> the release before: $FROM_REGISTRY ($FROM_VERSION)"
if ! NGINXIONS_REGISTRY="$FROM_REGISTRY" NGINXIONS_VERSION="$FROM_VERSION" "${compose[@]}" pull -q nginxions openappsec; then
  echo "SKIP: the images of the release before cannot be pulled"
  exit 0
fi
# The seed needs the transport of the published images. The updated stack always uses the current Compose config.
previous_agent="$FROM_REGISTRY/nginxions-openappsec:$FROM_VERSION"
if docker run --rm --network none --entrypoint grep "$previous_agent" -q NGINXIONS_CONTROL_RPC_SOCKET /opt/nginxions-control/server.js; then
  :
else
  status=$?
  [ "$status" = 1 ] || exit "$status"
  seed_compose+=(-f deploy/test/compose.upgrade-legacy-control.yaml)
fi
docker volume create "$state" > /dev/null
NGINXIONS_REGISTRY="$FROM_REGISTRY" NGINXIONS_VERSION="$FROM_VERSION" "${seed_compose[@]}" up -d --no-build "${services[@]}"
wait_healthy
check seed

echo "==> the update: $NEW_REGISTRY ($NEW_VERSION) on the same volumes"
NGINXIONS_REGISTRY="$NEW_REGISTRY" NGINXIONS_VERSION="$NEW_VERSION" "${compose[@]}" up -d --no-build "${services[@]}"
wait_healthy
check verify
echo "OK: the update keeps the data and the work of the release before"
