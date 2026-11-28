#!/usr/bin/env python3
"""Sweep analysis: shows TPR at different TNR levels on held-out part.
Runs on already-trained model's dump - no need to retrain.
Usage: python3 model/sweep.py --samples samples.jsonl --dump model-work/dump-new
Prints TNR, TPR, false blocks count for various thresholds.
"""
import argparse
import glob
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from waapmodel import read_dump


def logit(s):
    p = min(max(s / 10, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--samples", required=True, help="samples.jsonl (must have split=test)")
    ap.add_argument("--dump", required=True, help="directory with *.jsonl feature dumps from new model run")
    args = ap.parse_args(argv)

    rows = read_dump(sorted(glob.glob(str(Path(args.dump) / "*.jsonl"))))

    pos, neg = [], []
    with open(args.samples, encoding="utf-8") as f:
        for line in f:
            s = json.loads(line)
            if s["split"] != "test":
                continue
            m = max((logit(r["score"]) for r in rows.get(s["id"], [])), default=-math.inf)
            (pos if s["label"] == 1 else neg).append(m)

    pos, neg = np.array(pos), np.array(neg)
    neg_sorted = np.sort(neg)[::-1]  # sort descending

    total_neg = len(neg)
    print(f"Test samples: {total_neg} legitimate, {len(pos)} attacks (visible to model)\n")
    print("TNR              TPR          ложных блокировок")
    print("----              ----          -----------------")

    # Print at the TNR levels mentioned in the diagnostic
    target_tnrs = [0.980, 0.985, 0.9859, 0.990, 0.992, 0.995]
    for tnr in target_tnrs:
        k = int(math.ceil(tnr * total_neg))  # number of legitimate to allow passing
        # Block if score > cut; cut is the k-th highest score among negatives
        cut = neg_sorted[k - 1] if k > 0 and k <= total_neg else -math.inf
        fp = int(np.sum(neg > cut))  # false positives = blocked legitimate
        tp_rate = np.mean(pos > cut)  # true positive rate
        print(f"{tnr:.4f}  {tp_rate:.4f}  {fp}")
    
    # Also print at current model's operating point
    # Find threshold that gives TNR closest to stock 98.59%
    print("\n--- Current model operating point ---")
    # Read the metrics from the last run's report if available
    print(f"Stock TNR: 98.59% (from diagnostics)")
    print(f"Current model can achieve various TPR/TNR tradeoffs via threshold sweep.")


if __name__ == "__main__":
    main()
