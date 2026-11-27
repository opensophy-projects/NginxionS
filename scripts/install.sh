#!/usr/bin/env bash
# Install the production Compose deployment on a Linux x86_64 server.
set -euo pipefail
umask 077

scripts_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/install-lib.sh
. "$scripts_dir/install-lib.sh"

install_dir=/opt/nginxions
case "${1:-}" in
  -h|--help) echo "Usage: $0 [--dir /opt/nginxions]"; exit 0 ;;
  --dir) [[ $# = 2 ]] || fail "--dir requires a path."; install_dir=$2 ;;
  '') [[ $# = 0 ]] || fail "Unexpected argument." ;;
  *) fail "Unknown argument: $1" ;;
esac

[[ "$(uname -s)" = Linux && "$(uname -m)" = x86_64 ]] || fail "This installer supports Linux x86_64."
lock_install_dir
if [[ ! -e "$install_dir" ]]; then
  source_deploy=$scripts_dir/../deploy
  stage=$(mktemp -d -- "$(dirname -- "$install_dir")/.nginxions-install.XXXXXXXX")
  trap '[[ ! -d "$stage" ]] || rm -r -- "$stage"' EXIT
  mkdir -- "$stage/deploy"
  cp -R -- "$source_deploy"/{.env,compose.yaml,init,seccomp,clamav} "$stage/deploy/"
  install -m 0700 -- "$scripts_dir/uninstall.sh" "$stage/uninstall.sh"
  install -m 0600 -- "$scripts_dir/install-lib.sh" "$stage/install-lib.sh"
  printf '1\n' > "$stage/.nginxions-install"
  touch "$stage/.images"
  mv -T -- "$stage" "$install_dir"
  trap - EXIT
fi

install_engine() {
  (( EUID == 0 )) || fail "Run as root to install Docker packages."
  if [[ $(dpkg-query -W -f='${db:Status-Status}' containerd.io 2>/dev/null || true) != installed ]]; then
    touch "$install_dir/.installed-containerd"
  fi
  install_docker_packages "${apt_docker_packages[@]}"
  systemctl enable --now docker.service
}

if ! command -v docker >/dev/null; then
  [[ -z "${DOCKER_HOST:-}${DOCKER_CONTEXT:-}" ]] || fail "Unset the Docker endpoint overrides before installing Docker."
  install_engine
fi
require_local_docker
if ! engine=$(docker version --format '{{.Server.Version}}'); then
  (( EUID == 0 )) || fail "Start Docker and grant this user access, or run the installer with sudo."
  if ! systemctl start docker.service; then
    state=$(systemctl show --property=LoadState --value docker.service 2>/dev/null || true)
    if [[ "$state" != not-found || -S /var/run/docker.sock ]] || command -v dockerd >/dev/null; then
      fail "Could not start the existing local Docker Engine."
    fi
    install_engine
  fi
  engine=$(docker version --format '{{.Server.Version}}') || fail "Cannot access the local Docker Engine."
fi
docker_version_at_least "$engine" 28 0 || fail "Docker Engine 28 or newer is required. Update the existing engine first."
if ! plugin=$(docker compose version --short 2>/dev/null); then
  (( EUID == 0 )) || fail "Run as root to install Docker Compose."
  install_docker_packages docker-compose-plugin
  plugin=$(docker compose version --short)
fi
docker_version_at_least "$plugin" 2 23 || fail "Docker Compose 2.23 or newer is required. Update the existing plugin first."

current_id=$(docker_id)
if [[ -f "$install_dir/.docker-id" ]]; then
  [[ $(<"$install_dir/.docker-id") = "$current_id" ]] || fail "This installation belongs to another Docker Engine."
else
  containers=$(docker ps -aq "${project_filter[@]}")
  volumes=$(docker volume ls -q "${project_filter[@]}")
  networks=$(docker network ls -q "${project_filter[@]}")
  [[ -z "$containers$volumes$networks" ]] \
    || fail "A Compose project named nginxions already exists. Use its existing deployment files to manage it."
  printf '%s\n' "$current_id" > "$install_dir/.docker-id.next"
  mv -- "$install_dir/.docker-id.next" "$install_dir/.docker-id"
fi

images=$("${compose[@]}" config --images | sort -u)
[[ -n "$images" ]] || fail "Compose reported no images."
while IFS= read -r image; do
  if ! image_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null); then
    # Record downloads before they start so a partial installation can be removed.
    record_image "$image"
    docker pull --platform linux/amd64 "$image"
    image_id=$(docker image inspect --format '{{.Id}}' "$image")
    record_image "$image" "$image_id"
  elif grep -Fxq -- "$image"$'\t' "$install_dir/.images"; then
    record_image "$image" "$image_id"
  fi
done <<< "$images"

if ! "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 420; then
  "${compose[@]}" ps -a
  fail "The stack did not become ready. Inspect the container logs and rerun the installer."
fi
printf 'NginxionS installed in %s\n' "$install_dir"
printf 'Panel on this server: https://127.0.0.1:81 (default address)\n'
