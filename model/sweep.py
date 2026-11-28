#!/usr/bin/env python3
"""Measure request-level operating points from held-out, precomputed scores."""
import argparse
import json
import math
from bisect import bisect_left
from pathlib import Path

from waapmodel import read_dump


def operating_point(scored, min_tnr, min_tpr=0.70, min_accuracy=0.90):
    """Keep tied scores together. A request without a score always passes."""
    pos = sorted(score for label, score in scored if label == 1)
    neg = sorted(score for label, score in scored if label == 0)
    if not pos or not neg:
        raise ValueError("Both request classes are required")
    finite = sorted({s for s in pos + neg if math.isfinite(s)}, reverse=True)
    if not finite:
        raise ValueError("No scored requests")
    best = None
    for cut in [math.nextafter(finite[0], math.inf), *finite]:
        tn = bisect_left(neg, cut)
        fn = bisect_left(pos, cut)
        tnr = tn / len(neg)
        if tnr < min_tnr:
            break
        tp, fp = len(pos) - fn, len(neg) - tn
        accuracy = (tn + tp) / (len(neg) + len(pos))
        tpr = tp / len(pos)
        meets = tpr >= min_tpr and accuracy >= min_accuracy
        rank = (meets, tp, -fp)
        if best is None or rank > best[0]:
            best = (rank, dict(cut=cut, tpr=tpr, tnr=tnr, accuracy=accuracy,
                               tp=tp, tn=tn, fp=fp, fn=fn, meets_targets=meets))
    return best[1]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", required=True, type=Path)
    parser.add_argument("--dump", required=True, type=Path)
    args = parser.parse_args(argv)
    rows = read_dump(sorted(args.dump.glob("*.jsonl")))
    scored = []
    with args.samples.open(encoding="utf-8") as samples:
        for line in samples:
            s = json.loads(line)
            if s["split"] == "test":
                score = max((r["score"] for r in rows.get(s["id"], [])), default=-math.inf)
                scored.append((s["label"], score))
    print("| Target TNR | Cut (>=) | Measured TNR | TPR | Accuracy | FP | FN |")
    print("|---|---|---|---|---|---|---|")
    for target in (0.980, 0.985, 0.9859, 0.990, 0.992, 0.995):
        p = operating_point(scored, target)
        print(f"| {target:.2%} | {p['cut']!r} | {p['tnr']:.2%} | {p['tpr']:.2%} | "
              f"{p['accuracy']:.2%} | {p['fp']} | {p['fn']} |")


if __name__ == "__main__":
    main()
