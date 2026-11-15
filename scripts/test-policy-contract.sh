#!/usr/bin/env bash
# The contract of the policy with the agent: the policies NginxionS writes (the built-in objects and templates, the
# examples of open-appsec, a policy with every kind of object and every engine on; nginxions/backend/nginxions/waf/
# objects/contract.js) are given one by one to the agent of the image nginxions-openappsec, alone (no nginx, no
# database), as the backend gives them (set-apply-policy). Each must be applied: the agent generates its
# configuration (/tmp/local_appsec.policy), it holds every rule and what compare.js checks, and the agent logs no
# refusal of the policy. A field the agent cannot read fails here in minutes, not in the smoke test of the full stack.
#
#   NGINXIONS_REGISTRY=docker.io/opensophy NGINXIONS_VERSION=develop scripts/test-policy-contract.sh
# Report: reports/policy-contract (contract.md, the files given and what the agent made of them).
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${NGINXIONS_REGISTRY:?the registry}/nginxions-openappsec:${NGINXIONS_VERSION:?the tag}"
out="${OUT:-reports/policy-contract}"
name="nginxions-contract-$$"
APPLY_TIMEOUT="${APPLY_TIMEOUT:-120}"
rm -rf "$out"
mkdir -p "$out"

cleanup() {
  status=$?
  docker logs "$name" > "$out/agent-stdout.log" 2>&1 || true
  docker exec "$name" sh -c 'cat /var/log/nano_agent/cp-nano-orchestration*.dbg 2>/dev/null' > "$out/orchestration.log" 2> /dev/null || true
  docker rm -f "$name" > /dev/null 2>&1 || true
  exit $status
}
trap cleanup EXIT

node scripts/policy-contract.mjs write "$out" > "$out/cases.txt"
mapfile -t cases < "$out/cases.txt"

# the first policy is there at the start, as in the stack (the backend writes it before the agent starts)
docker run -d --name "$name" --security-opt no-new-privileges:true --cap-drop ALL \
  -e autoPolicyLoad=false -e TZ=UTC "$IMAGE" --hybrid-mode > /dev/null
docker exec "$name" mkdir -p /ext/appsec
docker cp "$out/contract.rules" "$name:/ext/appsec/contract.rules"
docker exec -i "$name" sh -c 'cat > /ext/appsec/local_policy.yaml' < "$out/${cases[0]}.yaml"

echo "==> the agent starts"
for i in $(seq 1 90); do
  docker exec "$name" nc -z 127.0.0.1 7777 2> /dev/null && break
  [ "$i" = 90 ] && { echo "the agent does not listen on 7777"; exit 1; }
  sleep 2
done

# the lines of the agent that say a policy was refused (orchestration, local policy generator)
refusals() {
  docker exec "$name" sh -c 'cat /var/log/nano_agent/cp-nano-orchestration*.dbg 2>/dev/null' 2> /dev/null \
    | grep -E 'Failed to (load|parse|apply|set)|[Ii]nvalid policy|Could not (load|parse)|failed to (load|parse)' || true
}

first=1
for c in "${cases[@]}"; do
  echo "==> $c"
  before=$(refusals | wc -l)
  # the first one the agent applies at its start; the next ones as the backend gives them
  if [ "$first" = 0 ]; then
    docker exec "$name" rm -f /tmp/local_appsec.policy
    # through the link the agent makes from /etc/cp/conf to /ext/appsec, whichever exists
    docker exec -i "$name" sh -c 'cat > /etc/cp/conf/local_policy.yaml' < "$out/$c.yaml"
    docker exec "$name" curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      -d '{"policy_path": "/etc/cp/conf/local_policy.yaml"}' http://127.0.0.1:7777/set-apply-policy > /dev/null \
      || echo "    set-apply-policy did not answer"
  fi
  first=0
  for i in $(seq 1 "$APPLY_TIMEOUT"); do
    docker exec "$name" test -s /tmp/local_appsec.policy && break
    sleep 1
  done
  if docker exec "$name" test -s /tmp/local_appsec.policy; then
    # written in one go? read it once it stops changing
    sleep 2
    docker cp "$name:/tmp/local_appsec.policy" "$out/$c.applied.json"
    echo "    applied"
  else
    echo "    no configuration in ${APPLY_TIMEOUT} s"
  fi
  refusals | tail -n "+$((before + 1))" > "$out/$c.refused.txt"
  [ -s "$out/$c.refused.txt" ] || rm -f "$out/$c.refused.txt"
done

node scripts/policy-contract.mjs check "$out"
