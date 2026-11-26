#!/usr/bin/env bash
# Package the current deployment and its Linux amd64 images for an offline Docker host.
# OFFLINE_BUNDLE_USE_LOCAL_IMAGES=1 uses the two preloaded NginxionS images and pulls upstream dependencies.
# Usage: [NGINXIONS_VERSION=develop] [NGINXIONS_REGISTRY=docker.io/opensophy] scripts/offline-bundle.sh bundle.tar
set -euo pipefail

output="${1:?usage: scripts/offline-bundle.sh bundle.tar}"
[ "$#" -eq 1 ] || exit 2
[[ "$output" = /* ]] || output="$PWD/$output"
[ ! -e "$output" ] || { echo "Bundle already exists: $output" >&2; exit 1; }
cd "$(dirname "$0")/.."

registry="${NGINXIONS_REGISTRY:-$(sed -n 's/^NGINXIONS_REGISTRY=//p' deploy/.env)}"
version="${NGINXIONS_VERSION:-$(sed -n 's/^NGINXIONS_VERSION=//p' deploy/.env)}"
[[ "$registry" =~ ^[a-z0-9][a-z0-9./:_-]*$ && "$version" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] \
  || { echo "Invalid image registry or tag" >&2; exit 2; }
unset NGINXIONS_REGISTRY NGINXIONS_VERSION CROWDSEC_VERSION POSTGRES_VERSION CLAMAV_VERSION

stage=$(mktemp -d)
archive=
cleanup() {
  rm -rf "$stage"
  [ -z "$archive" ] || rm -f "$archive"
}
trap cleanup EXIT
mkdir -p "$stage/deploy"
cp -R deploy/compose.yaml deploy/init deploy/seccomp deploy/clamav "$stage/deploy/"
cp docs/OFFLINE.md "$stage/README.md"
awk -v registry="$registry" -v version="$version" '
  /^NGINXIONS_REGISTRY=/ { print "NGINXIONS_REGISTRY=" registry; next }
  /^NGINXIONS_VERSION=/ { print "NGINXIONS_VERSION=" version; next }
  { print }
' deploy/.env > "$stage/deploy/.env"

compose=(docker compose --env-file "$stage/deploy/.env" -f "$stage/deploy/compose.yaml")
resolved=$("${compose[@]}" config --images | sort -u)
[ -n "$resolved" ] || { echo "No deployment images found" >&2; exit 1; }
mapfile -t images <<< "$resolved"
for image in "${images[@]}"; do
  case "${OFFLINE_BUNDLE_USE_LOCAL_IMAGES:-0}:$image" in
    "1:$registry/nginxions:$version"|"1:$registry/nginxions-openappsec:$version")
      docker image inspect "$image" > /dev/null \
        || { echo "CI image must be loaded before packing: $image" >&2; exit 1; }
      ;;
    *) docker pull --platform=linux/amd64 "$image" >&2 ;;
  esac
  platform=$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")
  [ "$platform" = linux/amd64 ] || { echo "Unexpected platform for $image: $platform" >&2; exit 1; }
done

docker image save "${images[@]}" | gzip -1 > "$stage/images.tar.gz"
(cd "$stage" && sha256sum images.tar.gz > SHA256SUMS)
archive=$(mktemp "${output}.tmp.XXXXXX")
tar -C "$stage" -cf "$archive" README.md SHA256SUMS images.tar.gz deploy
ln "$archive" "$output"
echo "Offline bundle: $output"
