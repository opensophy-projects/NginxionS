#!/bin/sh
# NginxionS: the entrypoint of the clamav container (deploy/compose.yaml). clamd scans the uploads of the hosts with
# File Security in a practice of the WAF policy (nginxions/backend/nginxions/waf/files.js). Its signatures take about
# 1 GB of memory, so it runs only while a rule needs it: NginxionS writes the flag "enabled" into the control volume
# (/nginxions, read only here) and restarts this container. Without the flag the container only waits.
# Signature files uploaded in WAF -> Agent (/nginxions/db) replace those of the image at the start; freshclam (online
# updates, needs the internet) runs only when allowed there (/nginxions/freshclam).
set -eu

CTL=/nginxions

if [ ! -f "$CTL/enabled" ]; then
  echo "NginxionS: no practice of the WAF policy has File Security on, clamd does not run"
  trap 'exit 0' TERM INT
  while :; do sleep 3600 & wait $!; done
fi

for f in "$CTL"/db/*.cvd "$CTL"/db/*.cld "$CTL"/db/*.cud; do
  [ -f "$f" ] || continue
  echo "NginxionS: signatures $(basename "$f") uploaded in NginxionS"
  cp -f "$f" /var/lib/clamav/
done

# clamd and freshclam are started here, not by /init of the image: the container runs as the user clamav with a
# read-only root filesystem and no capability (deploy/compose.yaml), and /init edits /etc/clamav and chowns as root.
# The settings of compose (CLAMD_CONF_*) go into copies of the configuration in /tmp (tmpfs).
conf=/tmp/clamd.conf
fresh=/tmp/freshclam.conf
cp /etc/clamav/clamd.conf "$conf"
env | grep '^CLAMD_CONF_' | while IFS='=' read -r key value; do
  name=${key#CLAMD_CONF_}
  sed -i "/^#\{0,1\}$name /d" "$conf"
  echo "$name $value" >> "$conf"
done
sed -e "s|^NotifyClamd .*|NotifyClamd $conf|" /etc/clamav/freshclam.conf > "$fresh"

if [ ! -f /var/lib/clamav/main.cvd ] && [ ! -f /var/lib/clamav/main.cld ]; then
  if [ -f "$CTL/freshclam" ]; then
    echo "NginxionS: no signatures yet, downloading them (freshclam)"
    sed -e '/^NotifyClamd /d' -e '$a TestDatabases no' "$fresh" > /tmp/freshclam-initial.conf
    freshclam --foreground --stdout --config-file=/tmp/freshclam-initial.conf
  else
    echo "NginxionS: no signatures of ClamAV: upload main.cvd in WAF -> Agent or allow online updates" >&2
    exit 1
  fi
fi

if [ -f "$CTL/freshclam" ]; then
  echo "NginxionS: online updates of the signatures are on (freshclam)"
  freshclam --checks="${FRESHCLAM_CHECKS:-1}" --daemon --foreground --stdout --config-file="$fresh" &
fi
rm -f /tmp/clamd.sock
echo "NginxionS: starting clamd"
exec clamd --foreground --config-file="$conf"
