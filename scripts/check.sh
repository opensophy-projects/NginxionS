#!/usr/bin/env bash
# The fast part of CI on this machine, before a push: what the job "Lint, types, tests" of ci.yml runs, and the
# checks of the workflows when their tools are installed. Each part says ok or FAIL; the script goes on after a
# failure and fails at its end, so one run shows everything.
#
#   scripts/check.sh                 everything (the Go services only with --go: they need Docker)
#   scripts/check.sh backend lua     some parts: backend frontend scripts lua tree shell compose workflows go
#   scripts/check.sh --changed       the parts the changes since origin (or the last commit) touch
#   scripts/check.sh --install-hook  a pre-push hook of git that runs scripts/check.sh --changed
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ALL=(backend frontend scripts lua tree shell compose workflows)
parts=()
go=0
changed=0
for a in "$@"; do
  case "$a" in
    --go) go=1 ;;
    --changed) changed=1 ;;
    --install-hook)
      hook="$(git rev-parse --git-path hooks)/pre-push"
      printf '#!/bin/sh\n# NginxionS: the fast checks of CI before a push (scripts/check.sh); git push --no-verify skips them\nexec scripts/check.sh --changed\n' > "$hook"
      chmod +x "$hook"
      echo "pre-push hook: $hook"
      exit 0
      ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) parts+=("$a") ;;
  esac
done
[ "${#parts[@]}" -gt 0 ] || parts=("${ALL[@]}")
[ "$go" = 1 ] && parts+=(go)

if [ "$changed" = 1 ]; then
  base=$(git merge-base HEAD '@{upstream}' 2> /dev/null || git rev-parse HEAD~1 2> /dev/null || echo "")
  files=$( { [ -n "$base" ] && git diff --name-only "$base"; git diff --name-only; git diff --name-only --cached; } | sort -u)
  want=()
  has() { echo "$files" | grep -Eq "$1"; }
  has '^nginxions/backend/' && want+=(backend)
  has '^nginxions/frontend/' && want+=(frontend)
  has '^scripts/.*\.m?js$|^nginxions/backend/nginxions/waf/objects/' && want+=(scripts)
  has '\.lua$' && want+=(lua)
  has '.' && want+=(tree)
  has '\.sh$' && want+=(shell)
  has '^deploy/.*\.ya?ml$|^deploy/\.env' && want+=(compose)
  has '^\.github/' && want+=(workflows)
  has '\.go$|go\.(mod|sum)$' && [ "$go" = 1 ] && want+=(go)
  parts=("${want[@]}")
  [ "${#parts[@]}" -gt 0 ] || { echo "nothing changed to check"; exit 0; }
fi

have() { command -v "$1" > /dev/null; }
failed=()
run() {
  local name=$1
  shift
  local start=$SECONDS
  echo "==> $name"
  if "$@"; then
    echo "    ok ($((SECONDS - start)) s)"
  else
    echo "    FAIL: $name"
    failed+=("$name")
  fi
}

backend() {
  (cd nginxions/backend && pnpm install --frozen-lockfile --silent && pnpm biome ci . --assist-enabled=false \
    && node --test 'nginxions/**/*.test.js')
}
frontend() {
  (cd nginxions/frontend && pnpm install --frozen-lockfile --silent && pnpm biome ci . --assist-enabled=false \
    && node check-locales.cjs && node ../../scripts/check-i18n.mjs \
    && pnpm formatjs compile-folder src/locale/src src/locale/lang && pnpm tsc --noEmit && pnpm vitest run)
}
scripts_() {
  [ -d nginxions/backend/node_modules ] || (cd nginxions/backend && pnpm install --frozen-lockfile --silent)
  node --test scripts/*.test.mjs && node scripts/policy-contract.mjs write "$(mktemp -d)" > /dev/null
}
lua() {
  if have luajit; then scripts/test-lua.sh; else echo "    (no luajit: skipped)"; fi
}
tree() { node scripts/check-tree.mjs; }
shell() {
  if have shellcheck; then
    shellcheck -x -S warning scripts/*.sh deploy/*/*.sh deploy/openappsec/*/*.sh nginxions/crowdsec-seed/*.sh \
      && shellcheck -S warning -s sh deploy/test/smoke/*.sh
  else
    echo "    (no shellcheck: skipped)"
  fi
}
compose() {
  if have docker; then
    docker compose -f deploy/compose.yaml config -q && docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml config -q \
      && docker compose -f deploy/compose.yaml -f deploy/test/compose.airgap.yaml config -q
  else
    echo "    (no docker: skipped)"
  fi
}
workflows() {
  local ok=0
  if have actionlint; then actionlint .github/workflows/*.yml || ok=1; else echo "    (no actionlint: skipped)"; fi
  if have zizmor; then zizmor --offline -q --min-severity medium .github/workflows/ || ok=1; else echo "    (no zizmor: skipped)"; fi
  return $ok
}
go_() { scripts/test-go.sh; }

for p in "${parts[@]}"; do
  case "$p" in
    backend) run backend backend ;;
    frontend) run frontend frontend ;;
    scripts) run "scripts of CI" scripts_ ;;
    lua) run "Lua (File Security)" lua ;;
    tree) run "file tree" tree ;;
    shell) run shellcheck shell ;;
    compose) run "compose files" compose ;;
    workflows) run "workflows (actionlint, zizmor)" workflows ;;
    go) run "Go services of the agent" go_ ;;
    *) echo "unknown part: $p"; failed+=("$p") ;;
  esac
done

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAIL: ${failed[*]}"
  exit 1
fi
echo "OK: ${parts[*]}"
