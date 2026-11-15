# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «migration» (deploy/test/smoke.sh runs it in a subshell of its own): migration from NPM: a backup is read and analyzed.

step "Migration: a backup of NPM is read and analyzed; the import waits for a new NginxionS"
mig=$(curl -sS --max-time 120 -k -b $JAR -X POST -H 'Content-Type: application/octet-stream' \
  --data-binary @/fixtures/npm-backup.tgz "$ADMIN/api/nginxions/system/migration/upload")
echo "$mig" | grep -q '"kind": *"open-appsec-npm"' || fail "the backup was not recognised: $mig"
echo "$mig" | grep -q '"code": *"plain_passwords"' || fail "plain access list passwords not found: $mig"
echo "$mig" | grep -q '"table": *"proxy_host"' || fail "the import is not blocked by existing hosts: $mig"
code=$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{}' \
  "$ADMIN/api/nginxions/system/migration/apply")
[ "$code" = 400 ] || fail "the import into an NginxionS with hosts was not refused: HTTP $code"
$CURL -X DELETE "$ADMIN/api/nginxions/system/migration" | grep -q '"stage": *"idle"' || fail "the migration was not discarded"
