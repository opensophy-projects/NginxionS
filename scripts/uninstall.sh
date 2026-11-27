#!/usr/bin/env bash
# Remove one installation created by install.sh and optionally remove Docker packages.
set -euo pipefail

scripts_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/install-lib.sh
. "$scripts_dir/install-lib.sh"

install_dir=/opt/nginxions
if [[ -f "$scripts_dir/.nginxions-install" ]]; then
  install_dir=$scripts_dir
fi
yes=false
while (($#)); do
  case "$1" in
    -h|--help) echo "Usage: $0 [--dir /opt/nginxions] [--yes]"; exit 0 ;;
    --dir) (($# >= 2)) || fail "--dir requires a path."; install_dir=$2; shift ;;
    --yes) yes=true ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done

lock_install_dir
if [[ ! -e "$install_dir" ]]; then
  echo "No NginxionS installation in $install_dir"
  exit 0
fi
if ! "$yes" && ! confirm "Permanently remove NginxionS from $install_dir, including the database, certificates, keys and logs?"; then
  echo "Uninstall cancelled."
  exit 0
fi

if [[ -f "$install_dir/.docker-id" ]]; then
  require_local_docker
  [[ $(docker_id) = "$(<"$install_dir/.docker-id")" ]] || fail "This installation belongs to another Docker Engine."
  "${compose[@]}" down --volumes --remove-orphans

  # Compose can leave volumes or networks that no longer appear in its current file.
  volumes=$(docker volume ls -q "${project_filter[@]}")
  networks=$(docker network ls -q "${project_filter[@]}")
  for volume in $volumes; do docker volume rm -- "$volume"; done
  for network in $networks; do docker network rm -- "$network"; done

  while IFS=$'\t' read -r image installed_id; do
    [[ -n "$image" ]] || continue
    if current_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null); then
      if [[ -n "$installed_id" && "$current_id" != "$installed_id" ]]; then
        printf 'Keeping image replaced since installation: %s\n' "$image"
        continue
      fi
      users=$(docker ps -aq --filter "ancestor=$image")
      if [[ -n "$users" ]]; then
        printf 'Keeping image in use by another container: %s\n' "$image"
      else
        docker image rm -- "$image"
      fi
    fi
  done < "$install_dir/.images"
  [[ $(docker_id) = "$(<"$install_dir/.docker-id")" ]] || fail "The Docker Engine changed during removal."
fi

docker_status=0
if command -v docker >/dev/null && confirm "Remove Docker Engine and Compose packages too?"; then
  # Keep the installation receipt until the separate Docker operation has finished.
  set +e
  (
    set -e
    (( EUID == 0 )) || fail "Run as root to remove Docker packages."
    require_local_docker
    remove_docker_packages
  )
  docker_status=$?
  set -e
fi
rm -r --one-file-system -- "$install_dir"
printf 'NginxionS removed from %s\n' "$install_dir"
exit "$docker_status"
