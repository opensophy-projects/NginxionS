#!/usr/bin/env bash
# A long run of the stack under mixed traffic (the nightly workflow): what a short test does not show. For DURATION
# minutes (60 by default) clients send normal pages, an API, uploads and attacks to a proxy host under the WAF; every
# few minutes the memory of each container, the size of the database and of the logs, and the latency of a request
# are sampled. At the end:
#   memory    no container grows by more than SOAK_MEM_GROWTH % (default 20) from the middle to the last third: the
#             first third is the warm-up (the shared buffers of PostgreSQL fill as the tables grow, caches of nginx), a
#             leak keeps growing after it
#   answers   no 5xx; attacks blocked
#   latency   p95 of a normal request under SOAK_P95_MS (default 500)
#   logs      the audit of scripts/audit-logs.mjs (report)
# Report in reports/soak (soak.md, samples.tsv) and in the summary of the run.
#
#   NGINXIONS_REGISTRY=docker.io/opensophy NGINXIONS_VERSION=develop DURATION=60 scripts/test-soak.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DURATION="${DURATION:-60}"
SAMPLE_EVERY="${SAMPLE_EVERY:-120}"
MEM_GROWTH="${SOAK_MEM_GROWTH:-20}"
P95_MS="${SOAK_P95_MS:-500}"
CURL_VERSION=$(grep -m1 '^CURL_VERSION=' deploy/.env | cut -d= -f2)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nginxions-soak}"
compose=(docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml)
net="${COMPOSE_PROJECT_NAME}_edge"
state="${COMPOSE_PROJECT_NAME}-state"
load="${COMPOSE_PROJECT_NAME}-load"
out=reports/soak
mkdir -p "$out"

cleanup() {
  status=$?
  docker rm -f "$load" > /dev/null 2>&1 || true
  for svc in $("${compose[@]}" ps -a --services 2> /dev/null); do
    "${compose[@]}" logs --no-color --no-log-prefix "$svc" > "$out/$svc.log" 2>&1 || true
  done
  node scripts/audit-logs.mjs "$out" --out "$out" > /dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || { "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true; docker volume rm "$state" > /dev/null 2>&1 || true; }
  exit $status
}
trap cleanup EXIT

"${compose[@]}" up -d --no-build nginxions openappsec crowdsec test-upstream
for i in $(seq 1 120); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q nginxions)" 2> /dev/null || true)
  [ "$s" = healthy ] && break
  [ "$i" = 120 ] && { echo "nginxions is not healthy: $s"; exit 1; }
  sleep 2
done
docker volume create "$state" > /dev/null
docker run --rm --user 0 --network "$net" -e JAR=/state/cookies -v "$state:/state" \
  -v "$PWD/deploy/test/waf-score-setup.sh:/setup.sh:ro" "docker.io/curlimages/curl:$CURL_VERSION" sh /setup.sh

# the clients: 8 loops of normal pages and an API, one of uploads, one of attacks (about 40 requests a second);
# each answer is written as <kind> <code> <milliseconds>
docker run -d --user 0 --name "$load" --network "$net" -v "$state:/state" --entrypoint sh \
  "docker.io/curlimages/curl:$CURL_VERSION" -c '
    for c in 1 2 3 4 5 6 7 8; do
      ( while :; do
          for p in / /index.html /static/app.js "/api/items?page=$((RANDOM % 50))" /img/logo.png; do
            curl -s -o /dev/null -w "normal %{http_code} %{time_total}\n" --max-time 10 -H "Host: test.local" \
              -H "User-Agent: Mozilla/5.0 (soak $c)" "http://nginxions$p"
          done
        done >> /state/answers ) &
    done
    ( while :; do head -c 20000 /dev/urandom | curl -s -o /dev/null -w "upload %{http_code} %{time_total}\n" \
        --max-time 10 -H "Host: test.local" -H "Content-Type: application/octet-stream" --data-binary @- \
        http://nginxions/upload; sleep 1; done >> /state/answers ) &
    ( while :; do curl -s -o /dev/null -w "attack %{http_code} %{time_total}\n" --max-time 10 -H "Host: test.local" \
        "http://nginxions/?id=1%27%20OR%20%271%27=%271"; sleep 2; done >> /state/answers ) &
    wait' > /dev/null

samples="$out/samples.tsv"
printf 'minute\tcontainer\tmemory_mib\n' > "$samples"
db_sizes="$out/db.tsv"
printf 'minute\tdatabase_mib\tlogs_mib\n' > "$db_sizes"
mib() { awk -v v="$1" 'BEGIN { u = v; gsub(/[0-9.]/, "", u); n = v + 0; if (u ~ /GiB/) n *= 1024; else if (u ~ /KiB/) n /= 1024; else if (u ~ /B$/ && u !~ /iB/) n /= 1048576; printf "%.1f", n }'; }
end=$(( $(date +%s) + DURATION * 60 ))
while [ "$(date +%s)" -lt "$end" ]; do
  minute=$(( (DURATION * 60 - (end - $(date +%s))) / 60 ))
  while read -r name used; do
    printf '%s\t%s\t%s\n' "$minute" "$name" "$(mib "$used")" >> "$samples"
  done < <(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | awk '{print $1, $2}' | grep "^$COMPOSE_PROJECT_NAME\|^nginxions")
  db=$("${compose[@]}" exec -T postgres psql -U postgres -tAc "SELECT sum(pg_database_size(datname)) / 1048576 FROM pg_database" 2> /dev/null | tr -d ' ' || echo 0)
  logs=$("${compose[@]}" exec -T nginxions sh -c 'du -sm /data/nginx/logs | cut -f1' 2> /dev/null || echo 0)
  printf '%s\t%s\t%s\n' "$minute" "${db:-0}" "${logs:-0}" >> "$db_sizes"
  sleep "$SAMPLE_EVERY"
done
docker rm -f "$load" > /dev/null

docker run --rm --user 0 -v "$state:/state" --entrypoint cat "docker.io/curlimages/curl:$CURL_VERSION" /state/answers > "$out/answers.txt"
node --input-type=module - "$out" "$MEM_GROWTH" "$P95_MS" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [out, growthMax, p95Max] = process.argv.slice(2);
const answers = readFileSync(`${out}/answers.txt`, "utf8").trim().split("\n").map((l) => l.split(" "));
const count = (f) => answers.filter(f).length;
const normal = answers.filter((a) => a[0] === "normal").map((a) => Number(a[2]) * 1000).sort((a, b) => a - b);
const p95 = normal[Math.floor(normal.length * 0.95)] ?? 0;
const s5xx = count((a) => /^5/.test(a[1]));
const attacks = count((a) => a[0] === "attack");
const blocked = count((a) => a[0] === "attack" && a[1] === "403");
const rows = readFileSync(`${out}/samples.tsv`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
const byName = new Map();
for (const [m, name, mem] of rows) byName.set(name, [...(byName.get(name) ?? []), [Number(m), Number(mem)]]);
const failures = [];
const lines = ["## Long run (soak)", "", `requests: ${answers.length}, 5xx: ${s5xx}, attacks blocked: ${blocked}/${attacks}, p95 of a normal request: ${p95.toFixed(0)} ms`, "", "| container | memory first third (warm-up), MiB | middle third, MiB | last third, MiB | growth middle → last |", "|---|---|---|---|---|"];
for (const [name, points] of byName) {
	const third = Math.max(1, Math.floor(points.length / 3));
	const avg = (p) => p.reduce((s, [, v]) => s + v, 0) / p.length;
	const first = avg(points.slice(0, third));
	const middle = avg(points.slice(third, -third).length ? points.slice(third, -third) : points.slice(0, third));
	const last = avg(points.slice(-third));
	const growth = middle > 0 ? ((last - middle) / middle) * 100 : 0;
	lines.push(`| ${name} | ${first.toFixed(0)} | ${middle.toFixed(0)} | ${last.toFixed(0)} | ${growth.toFixed(0)} % |`);
	if (points.length >= 6 && growth > Number(growthMax)) failures.push(`${name}: memory +${growth.toFixed(0)} %`);
}
if (s5xx) failures.push(`${s5xx} answers 5xx`);
if (attacks && blocked / attacks < 0.95) failures.push(`attacks blocked ${blocked}/${attacks}`);
if (p95 > Number(p95Max)) failures.push(`p95 ${p95.toFixed(0)} ms > ${p95Max} ms`);
lines.push("", failures.length ? `**FAIL:** ${failures.join("; ")}` : "**OK**", "");
writeFileSync(`${out}/soak.md`, lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
console.log(lines.join("\n"));
process.exit(failures.length ? 1 : 0);
JS
