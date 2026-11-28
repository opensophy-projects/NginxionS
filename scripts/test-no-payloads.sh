#!/usr/bin/env bash
# Test training without --payloads to isolate the source of false positives
# Usage: cd /path/to/nginxions && WORK=test-no-payloads scripts/test-no-payloads.sh

set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${WORK:-test-no-payloads}"
PYTHON="${PYTHON:-python3}"

if [ ! -f "model/datasets.py" ]; then
  echo "ERROR: not in nginxions root"
  exit 1
fi

# Check if WCP data exists
if [ ! -f "data/wcp-legitimate.zip" ] || [ ! -f "data/wcp-malicious.zip" ] || [ ! -d "data/mgm-web-attack-payloads" ]; then
  echo "ERROR: WCP data not found. Expected:"
  echo "  data/wcp-legitimate.zip"
  echo "  data/wcp-malicious.zip"
  echo "  data/mgm-web-attack-payloads/"
  exit 1
fi

mkdir -p "$WORK"

echo "==> Building dataset WITHOUT --payloads (baseline: WCP + mgm false-positives only)"
"$PYTHON" model/datasets.py \
  --legit data/wcp-legitimate.zip \
  --legit-fraction 0.15 \
  --malicious data/wcp-malicious.zip \
  --mgm data/mgm-web-attack-payloads \
  --test-fraction 0.3 \
  --out "$WORK/samples-no-payloads.jsonl" 2>&1 | grep -E '(^wcp|^mgm|^total|^$)' || true

echo
echo "==> Counts:"
grep -E '"split": "train"' "$WORK/samples-no-payloads.jsonl" | wc -l | xargs echo "Train samples:"
grep -E '"split": "test"' "$WORK/samples-no-payloads.jsonl" | wc -l | xargs echo "Test samples:"
grep -E '"label": 1' "$WORK/samples-no-payloads.jsonl" | wc -l | xargs echo "Attacks (label=1):"
grep -E '"label": 0' "$WORK/samples-no-payloads.jsonl" | wc -l | xargs echo "Legitimate (label=0):"

echo
echo "✅ Dataset built to: $WORK/samples-no-payloads.jsonl"
echo "Next: Run training with this dataset:"
echo "  SAMPLES=$WORK/samples-no-payloads.jsonl scripts/train-model.sh"
echo
echo "Then compare metrics with the full training (with --payloads)."
