#!/usr/bin/env bash
# Install the production Compose deployment on a Linux x86_64 server.
set -euo pipefail
umask 077

scripts_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/install-lib.sh
. "$scripts_dir/install-lib.sh"

install_dir=/opt/nginxions
yes=false
version=
with_updater=false
while (($#)); do
  case "$1" in
    -h|--help) echo "Usage: $0 [--dir /opt/nginxions] [--version V1.0.0] [--with-updater] [--yes]"; exit 0 ;;
    --dir) (($# >= 2)) || fail "--dir requires a path."; install_dir=$2; shift ;;
    --version) (($# >= 2)) || fail "--version requires a stable release tag."; version=$2; shift
      stable_release_tag "$version" || fail "Use a stable release tag such as V1.0.0." ;;
    --with-updater) with_updater=true ;;
    --yes) yes=true ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done

[[ "$(uname -s)" = Linux && "$(uname -m)" = x86_64 ]] || fail "This installer supports Linux x86_64."
lock_install_dir
if $with_updater; then
  [[ $EUID = 0 && "$install_dir" = /opt/nginxions && -d /run/systemd/system ]] \
    || fail "The host updater requires a root installation at /opt/nginxions on systemd."
  command -v curl >/dev/null || fail "Install curl before enabling the host updater."
  if [[ ! -f "$install_dir/.host-updater" ]]; then
    for unit in nginxions-update.service nginxions-update.timer; do
      [[ ! -e "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] \
        || fail "The systemd unit $unit already exists."
    done
  fi
fi
[[ -z "$version" || ! -e "$install_dir" ]] || fail "--version is for a new installation. See the release notes to upgrade an existing deployment."
if [[ ! -e "$install_dir" ]]; then
  source_deploy=$scripts_dir/../deploy
  stage=$(mktemp -d -- "$(dirname -- "$install_dir")/.nginxions-install.XXXXXXXX")
  trap '[[ ! -d "$stage" ]] || rm -r -- "$stage"' EXIT
  mkdir -- "$stage/deploy"
  cp -R -- "$source_deploy"/{.env,compose.yaml,init,seccomp,clamav} "$stage/deploy/"
  if [[ -n "$version" ]]; then
    set_deployment_env "$stage/deploy/.env" NGINXIONS_VERSION "$version"
    unset NGINXIONS_VERSION
  fi
  install -m 0700 -- "$scripts_dir/uninstall.sh" "$stage/uninstall.sh"
  install -m 0600 -- "$scripts_dir/install-lib.sh" "$stage/install-lib.sh"
  printf '1\n' > "$stage/.nginxions-install"
  touch "$stage/.images"
  mv -T -- "$stage" "$install_dir"
  trap - EXIT
fi
if $with_updater; then
  grep -q 'NGINXIONS_HOST_UPDATER:' "$install_dir/deploy/compose.yaml" \
    || fail "Update the deployment files before installing the host updater."
  set_deployment_env "$install_dir/deploy/.env" NGINXIONS_HOST_UPDATER true
  unset NGINXIONS_HOST_UPDATER
fi
# Docker bind-mounts these files into containers that run under different UIDs
# and without CAP_DAC_OVERRIDE. The host installation directory stays private.
chmod 0755 -- "$install_dir"/deploy/{init/nginxions-init.sh,init/postgres-init.sh,clamav/nginxions-clamav.sh}

install_engine() {
  (( EUID == 0 )) || fail "Run as root to install Docker packages."
  allow_package_install "Docker Engine and Compose are required. Install missing Docker packages now?"
  if [[ $(dpkg-query -W -f='${db:Status-Status}' containerd.io 2>/dev/null || true) != installed ]]; then
    touch "$install_dir/.installed-containerd"
  fi
  install_docker_packages "${apt_docker_packages[@]}"
  systemctl enable --now docker.service
}

allow_package_install() {
  if ! "$yes" && ! confirm "$1"; then
    fail "Install Docker first or rerun the installer with --yes to authorize package installation."
  fi
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
  allow_package_install "Docker Compose is missing. Install the Compose plugin now?"
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
  "${compose[@]}" ps -a || true
  "${compose[@]}" logs --no-color --tail 30 nginxions-init || true
  fail "The stack did not become ready. Inspect the container logs and rerun the installer."
fi
if $with_updater; then
  install -m 0700 -- "$scripts_dir/update.sh" "$install_dir/update.sh"
  install -m 0700 -- "$scripts_dir/uninstall.sh" "$install_dir/uninstall.sh"
  install -m 0600 -- "$scripts_dir/install-lib.sh" "$install_dir/install-lib.sh"
  touch "$install_dir/.host-updater"
  for unit in nginxions-update.service nginxions-update.timer; do
    install -m 0644 -- "$scripts_dir/../deploy/update/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now nginxions-update.timer
fi
printf 'NginxionS installed in %s\n' "$install_dir"
printf 'Panel on this server: https://127.0.0.1:81 (default address)\n'
