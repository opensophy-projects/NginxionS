#!/usr/bin/env bash
# One test of the stack of CI (the matrix "stack" of ci.yml), by name: each runs on a stack of its own, in parallel
# with the others, on the images of the build (NGINXIONS_REGISTRY, NGINXIONS_VERSION).
#
#   smoke-waf        closed-network test with the smoke group waf (WAF of open-appsec, learning)
#   smoke-crowdsec   closed-network test with the groups crowdsec and migration
#   smoke-core       closed-network test with the other groups and the interface in a browser
#   waf-score        GoTestWAF against a protected host (scripts/test-waf-score.sh)
#   upgrade          update from the published develop (scripts/test-upgrade.sh)
#   chaos            failures of the parts of the stack (scripts/test-chaos.sh)
#   dast             ZAP, Nuclei, testssl.sh, gixy (scripts/test-dast.sh)
#
#   NGINXIONS_REGISTRY=local NGINXIONS_VERSION=dev scripts/ci-stack.sh smoke-waf
set -euo pipefail

cd "$(dirname "$0")/.."
suite="${1:?the test: smoke-waf, smoke-crowdsec, smoke-core, waf-score, upgrade, chaos, dast}"
# volumes and networks named after the test
export COMPOSE_PROJECT_NAME="nginxions-$suite"

case "$suite" in
  smoke-waf) SMOKE_GROUPS="waf" UI_E2E=0 exec scripts/test-airgap.sh ;;
  smoke-crowdsec) SMOKE_GROUPS="crowdsec migration" UI_E2E=0 exec scripts/test-airgap.sh ;;
  smoke-core) SMOKE_GROUPS="services hosts rbac events pki" UI_E2E=1 exec scripts/test-airgap.sh ;;
  waf-score) OUT="${OUT:-reports/waf}" exec scripts/test-waf-score.sh ;;
  upgrade) exec scripts/test-upgrade.sh ;;
  chaos) exec scripts/test-chaos.sh ;;
  dast) OUT="${OUT:-reports/dast}" exec scripts/test-dast.sh ;;
  *) echo "unknown test: $suite" >&2; exit 2 ;;
esac
