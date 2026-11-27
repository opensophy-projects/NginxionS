#!/usr/bin/env bash
# Host-side updater for installer-managed Linux deployments. The panel can only opt in or out.
set -euo pipefail
umask 077

scripts_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/install-lib.sh
. "$scripts_dir/install-lib.sh"

install_dir=/opt/nginxions
case "$#" in
  0) ;;
  2) [[ "$1" = --dir ]] || fail "Usage: $0 [--dir /opt/nginxions]"; install_dir=$2 ;;
  *) fail "Usage: $0 [--dir /opt/nginxions]" ;;
esac
lock_install_dir
[[ -f "$install_dir/.docker-id" ]] || fail "No installer-managed Docker deployment found."
require_local_docker
[[ $(docker_id) = "$(<"$install_dir/.docker-id")" ]] || fail "This installation belongs to another Docker Engine."

dotenv=$install_dir/deploy/.env
current=$(sed -n 's/^NGINXIONS_VERSION=//p' "$dotenv")
registry=$(sed -n 's/^NGINXIONS_REGISTRY=//p' "$dotenv")
# Automatic updates are for stable releases from a single registry. Keep develop and local builds pinned.
stable_release_tag "$current" || exit 0
[[ "$registry" =~ ^docker\.io/[a-z0-9][a-z0-9_-]*$ ]] || fail "Invalid release registry."
container=$("${compose[@]}" ps -q nginxions)
[[ "$container" =~ ^[0-9a-f]{64}$ ]] || exit 0
enabled() { [[ $(docker exec "$container" cat /data/nginxions/auto-update 2>/dev/null) = true ]]; }
enabled || exit 0

manifest=$(curl --disable --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 30 --max-filesize 4096 \
  https://github.com/opensophy-projects/NginxionS/releases/latest/download/nginxions-release.env)
mapfile -t fields <<< "$manifest"
[[ ${#fields[@]} = 5 ]] || fail "Invalid release manifest."
next=${fields[0]#version=}
nginxions_digest=${fields[2]#nginxions=}
appsec_digest=${fields[3]#nginxions_openappsec=}
expected_deploy=${fields[4]#deployment=}
stable_release_tag "$next" && [[ "${fields[0]}" = "version=$next" && "$next" = V* ]] \
  && [[ "${fields[1]}" = "registry=$registry" && "${fields[2]}" = "nginxions=$nginxions_digest" \
  && "${fields[3]}" = "nginxions_openappsec=$appsec_digest" && "${fields[4]}" = "deployment=$expected_deploy" \
  && "$nginxions_digest" =~ ^sha256:[0-9a-f]{64}$ && "$appsec_digest" =~ ^sha256:[0-9a-f]{64}$ \
  && "$expected_deploy" =~ ^[0-9a-f]{64}$ ]] || fail "Invalid release version, registry or digest."

IFS=. read -r current_major current_minor current_patch <<< "${current:1}"
IFS=. read -r next_major next_minor next_patch <<< "${next:1}"
if (( next_major != current_major || next_minor < current_minor ||
  (next_minor == current_minor && next_patch <= current_patch) )); then exit 0; fi
if [[ $(deployment_fingerprint "$install_dir/deploy") != "$expected_deploy" ]]; then
  printf '%s\n' "$next requires an update of the deployment files. See the release notes."
  exit 0
fi
if [[ -f "$install_dir/.update-failed" && $(<"$install_dir/.update-failed") = "$next" ]]; then
  fail "$next was already attempted. See journalctl -u nginxions-update.service before retrying."
fi

resolved=$(NGINXIONS_VERSION="$next" "${compose[@]}" config --images)
for image in nginxions nginxions-openappsec; do
  grep -Fxq -- "$registry/$image:$next" <<< "$resolved" || fail "Compose does not use the expected project images."
  docker image inspect "$registry/$image:$current" > /dev/null || fail "The current local image is required for rollback."
done

pull_release_image() {
  local image=$1 src="$registry/$1@$2" target="$registry/$1:$next" id existing
  docker pull --platform linux/amd64 "$src"
  id=$(docker image inspect --format '{{.Id}}' "$src")
  if existing=$(docker image inspect --format '{{.Id}}' "$target" 2>/dev/null); then
    [[ "$existing" = "$id" ]] || fail "Existing release tag has a different image: $image:$next"
    return
  fi
  docker image tag "$src" "$target"
  record_image "$target" "$id"
}

pull_release_image nginxions "$nginxions_digest"
pull_release_image nginxions-openappsec "$appsec_digest"
# Honour an opt-out while downloads were in progress.
enabled || exit 0

printf '%s\n' "$next" > "$install_dir/.update-failed"
if NGINXIONS_VERSION="$next" "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 420 \
  && set_deployment_env "$dotenv" NGINXIONS_VERSION "$next"; then
  rm -- "$install_dir/.update-failed"
  printf 'NginxionS updated to %s.\n' "$next"
else
  NGINXIONS_VERSION="$current" "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 420 \
    || fail "$next did not start, and Compose could not restore $current."
  fail "Could not complete the upgrade to $next. Compose restored the previous images ($current)."
fi
