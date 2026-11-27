#!/usr/bin/env bash
# Shared by the Linux installer and its installed uninstaller.
# shellcheck disable=SC2034,SC2154  # install.sh and uninstall.sh share these variables with this file

fail() { printf 'NginxionS: %s\n' "$*" >&2; exit 1; }

confirm() {
  local reply
  printf '%s [y/N] ' "$1" >&2
  read -r reply && [[ "$reply" =~ ^([Yy]|[Yy][Ee][Ss])$ ]]
}

lock_install_dir() {
  local parent mode
  [[ "$install_dir" = /* && "$install_dir" != / ]] || fail "--dir must be an absolute directory other than /."
  parent=$(realpath -e -- "$(dirname -- "$install_dir")") || fail "The installation directory's parent must exist."
  [[ $(realpath -m -- "$install_dir") = "$install_dir" && "$(dirname -- "$install_dir")" = "$parent" ]] \
    || fail "Use a canonical installation path without symlinks."
  mode=$(stat -c '%a' -- "$parent")
  (( (8#$mode & 0022) == 0 || (8#$mode & 01000) != 0 )) \
    || fail "The installation directory's parent must be protected against renames by other users."
  [[ $EUID != 0 || -O "$parent" ]] || fail "The installation directory's parent must belong to root."
  exec 9< "$parent"
  flock -x 9
  if [[ -e "$install_dir" ]]; then
    [[ -d "$install_dir" && -O "$install_dir" && $(stat -c '%a' -- "$install_dir") = 700 ]] \
      || fail "The installation directory must belong to this user and have mode 0700."
    [[ -f "$install_dir/.nginxions-install" && $(<"$install_dir/.nginxions-install") = 1 ]] \
      || fail "Directory was not created by the NginxionS installer: $install_dir"
  fi
  local label=com.docker.compose.project=nginxions
  project_filter=(--filter "label=$label")
  compose=(docker compose --project-name nginxions --env-file "$install_dir/deploy/.env" -f "$install_dir/deploy/compose.yaml")
}

docker_version_at_least() {
  local version=${1#v} major minor
  [[ "$version" =~ ^([0-9]+)\.([0-9]+)(\.|$) ]] || return 1
  major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]}
  (( 10#$major > $2 || (10#$major == $2 && 10#$minor >= $3) ))
}

require_local_docker() {
  local host
  host=${DOCKER_HOST:-}
  if [[ -z "$host" || -n "${DOCKER_CONTEXT:-}" ]]; then
    host=$(docker context inspect --format '{{.Endpoints.docker.Host}}') || fail "Cannot read the Docker context."
  fi
  case "$host" in
    unix:///var/run/docker.sock|unix:///run/docker.sock) ;;
    *) fail "Select the local Docker Engine on /var/run/docker.sock. Active endpoint: $host" ;;
  esac
}

docker_id() {
  local id
  id=$(docker info --format '{{.ID}}') && [[ -n "$id" ]] || fail "Cannot identify the local Docker Engine."
  printf '%s\n' "$id"
}

apt_docker_packages=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
docker_sources=/etc/apt/sources.list.d/nginxions-docker.sources
docker_key=/etc/apt/keyrings/nginxions-docker.asc
os_release=/etc/os-release

apt_has_candidates() {
  local package
  for package in "$@"; do
    LC_ALL=C apt-cache policy "$package" | awk '
      $1 == "Candidate:" && NF == 2 && $2 != "(none)" { found = 1 }
      END { exit !found }
    ' || return 1
  done
}

install_docker_packages() {
  local os suite stage key_dir
  # shellcheck source=/dev/null
  . "$os_release"
  os=${ID:-} suite=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
  [[ "$os" = debian || "$os" = ubuntu ]] && [[ "$suite" =~ ^[a-z][a-z0-9-]*$ ]] \
    || fail "Automatic Docker installation supports Debian and Ubuntu. Install Docker Engine and Compose on this distribution first."
  command -v systemctl >/dev/null || fail "Automatic Docker installation requires systemd."
  apt-get update
  # APT can know a package name through dependencies even if no repository provides a version.
  if ! apt_has_candidates "$@"; then
    if [[ ! -f "$install_dir/.docker-apt-source" ]]; then
      [[ ! -e "$docker_sources" && ! -L "$docker_sources" && ! -e "$docker_key" && ! -L "$docker_key" ]] \
        || fail "The NginxionS Docker APT source or key already exists."
      touch "$install_dir/.docker-apt-source"
    fi
    apt-get install -y --no-remove ca-certificates curl
    stage=$(mktemp -d)
    if curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
      --connect-timeout 10 --max-time 60 "https://download.docker.com/linux/$os/gpg" -o "$stage/docker.asc"; then
      key_dir=$(dirname -- "$docker_key")
      [[ -d "$key_dir" ]] || install -d -m 0755 -- "$key_dir"
      install -m 0644 -- "$stage/docker.asc" "$docker_key"
      printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: amd64\nSigned-By: %s\n' \
        "$os" "$suite" "$docker_key" > "$docker_sources"
      chmod 0644 -- "$docker_sources"
    else
      rm -r -- "$stage"
      fail "Could not download Docker's signing key."
    fi
    rm -r -- "$stage"
    apt-get update
  fi
  apt_has_candidates "$@" || fail "Docker packages are unavailable for $os $suite (amd64). Check the Docker APT source."
  apt-get install -y --no-remove "$@"
}

remove_docker_packages() {
  local containers images volumes networks proposal package removed
  local -a packages=()
  command -v apt-get >/dev/null && command -v dpkg-query >/dev/null \
    || fail "Automatic Docker removal requires APT packages."
  containers=$(docker ps -aq)
  images=$(docker image ls -aq)
  volumes=$(docker volume ls -q)
  networks=$(docker network ls -q --filter type=custom)
  [[ -z "$containers$images$volumes$networks" ]] \
    || fail "Docker still has containers, images, volumes or custom networks. Docker was kept."
  for package in "${apt_docker_packages[@]}" docker-ce-rootless-extras docker.io docker-compose-v2 docker-compose; do
    if [[ "$package" = containerd.io && ! -f "$install_dir/.installed-containerd" ]]; then continue; fi
    if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null) = installed ]]; then
      packages+=("$package")
    fi
  done
  (( ${#packages[@]} )) || fail "Docker is not installed as a supported APT package."
  proposal=$(LC_ALL=C apt-get -s --no-auto-remove purge "${packages[@]}")
  while read -r removed; do
    [[ -z "$removed" ]] && continue
    if ! printf '%s\n' "${packages[@]}" | grep -Fxq -- "${removed%%:*}"; then
      fail "Removing Docker would also remove $removed. Docker was kept."
    fi
  done < <(awk '$1 == "Purg" || $1 == "Remv" { print $2 }' <<< "$proposal")
  apt-get purge -y --no-auto-remove "${packages[@]}"
  if [[ -f "$install_dir/.docker-apt-source" ]]; then
    for file in "$docker_sources" "$docker_key"; do
      [[ ! -e "$file" ]] || rm -- "$file"
    done
  fi
}

record_image() {
  local image=$1 id=${2:-}
  awk -F '\t' -v ref="$image" '$1 != ref' "$install_dir/.images" > "$install_dir/.images.next"
  printf '%s\t%s\n' "$image" "$id" >> "$install_dir/.images.next"
  mv -- "$install_dir/.images.next" "$install_dir/.images"
}

# Release identifiers are bounded so comparisons stay within shell integer limits.
stable_release_tag() {
  [[ "$1" =~ ^[Vv](0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ ]]
}

set_deployment_env() {
  local file=$1 name=$2 value=$3 next
  next=$(mktemp -- "${file}.XXXXXXXX") || return 1
  if ! awk -v name="$name" -v value="$value" '
    index($0, name "=") != 1 { print }
    END { print name "=" value }
  ' "$file" > "$next" || ! mv -fT -- "$next" "$file"; then
    rm -- "$next"
    return 1
  fi
}

deployment_fingerprint() (
  cd -- "$1" || exit 1
  {
    sha256sum -- compose.yaml init/nginxions-init.sh init/postgres-init.sh seccomp/nginxions.json clamav/nginxions-clamav.sh &&
      grep -E '^(CROWDSEC_VERSION|POSTGRES_VERSION|CLAMAV_VERSION)=' .env | sort
  } | sha256sum | cut -d ' ' -f1
)
