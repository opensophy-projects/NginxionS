#!/usr/bin/env python3
"""Compares the trained model with the stock one on the held-out part, by what the real agent decided, and
decides whether the model may be released (exit 1: it may not).

Release gate (all of them):
  - only paired, usable verdicts on the held-out set contribute to the comparison;
  - balanced accuracy (mean of attacks blocked and legitimate requests passed) not lower than the stock model's;
  - legitimate requests passed (TNR) not lower by more than --max-tnr-drop, attacks blocked (TPR) not lower by
    more than --max-tpr-drop;
  - inspection: every held-out request in which the agent found keywords with the stock model was also inspected
    with the new one (>= 99.5%; the signatures are the same). Otherwise part of the run went past the agent
    (fail-open while it started) and the verdicts are not the model's;
  - parity: the score the agent gave each value with the new model is the score model/waapmodel.py computes for
    it from the same keywords (>= 99.9% of the values within 0.001). Otherwise the agent does not read the model as
    the trainer meant it, and the numbers above prove nothing about the next model.

  python3 model/evaluate.py --samples samples.jsonl --stock verdicts-stock.jsonl --candidate verdicts-new.jsonl \
      --dump dump-new --stock-dump dump-stock --model out/waap.data --stock-model waap-stock.data \
      --loaded-model waap-loaded.data --summary report.md --out metrics.json
"""

import argparse
import glob
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from waapmodel import Model, read_dump  # noqa: E402


def usable_verdict(verdict):
    if not isinstance(verdict, dict):
        return False
    status = verdict.get("status")
    return (type(status) is int and (200 <= status < 300 or status == 403)
            and verdict.get("blocked") is (status == 403))


def metrics(samples, verdicts, ids):
    total = {"tp": 0, "fn": 0, "tn": 0, "fp": 0}
    by_category = {}
    for sid in ids:
        v = verdicts[sid]
        s = samples[sid]
        key = ("tp" if v["blocked"] else "fn") if s["label"] == 1 else ("fp" if v["blocked"] else "tn")
        total[key] += 1
        cat = by_category.setdefault(f'{s["source"]}/{s["category"]}' if s["source"] != "wcp-legit" else
                                     "wcp-legit", {"tp": 0, "fn": 0, "tn": 0, "fp": 0})
        cat[key] += 1
    return summarize(total), {k: summarize(v) for k, v in sorted(by_category.items())}


def summarize(c):
    attacks, legit = c["tp"] + c["fn"], c["tn"] + c["fp"]
    tpr = c["tp"] / attacks if attacks else None
    tnr = c["tn"] / legit if legit else None
    ba = (tpr + tnr) / 2 if tpr is not None and tnr is not None else None
    return {**c, "attacks": attacks, "legitimate": legit, "tpr": tpr, "tnr": tnr, "balanced_accuracy": ba}


def parity(model, rows):
    checked = matched = 0
    worst = []
    for sid, rs in rows.items():
        for r in rs:
            expected = model.score(r["keywords"], r["combinations"])
            checked += 1
            diff = abs(expected - r["score"])
            if diff <= 1e-3:
                matched += 1
            elif len(worst) < 5:
                worst.append({"sample": sid, "agent": r["score"], "model": round(expected, 6),
                              "keywords": r["keywords"][:10]})
    return {"values": checked, "matched": matched, "share": matched / checked if checked else None,
            "examples": worst}


def pct(x):
    return "—" if x is None else f"{x * 100:.2f}%"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--stock", required=True, help="verdicts of the stock model")
    ap.add_argument("--candidate", required=True, help="verdicts of the new model")
    ap.add_argument("--dump", required=True, help="feature dump of the new model's run")
    ap.add_argument("--stock-dump", required=True, help="feature dump of the stock model's run")
    ap.add_argument("--model", required=True, help="waap.data of the new model")
    ap.add_argument("--stock-model", type=Path, help="waap.data copied from the baseline agent")
    ap.add_argument("--loaded-model", type=Path, help="waap.data copied from the agent after loading the candidate")
    ap.add_argument("--card", help="model-card.json of the trainer, shown in the report")
    ap.add_argument("--max-tnr-drop", type=float, default=0.002)
    ap.add_argument("--max-tpr-drop", type=float, default=0.005)
    ap.add_argument("--summary", help="Markdown report (append)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    if (args.stock_model is None) != (args.loaded_model is None):
        ap.error("--stock-model and --loaded-model must be provided together")

    samples = {}
    with open(args.samples, encoding="utf-8") as f:
        for line in f:
            s = json.loads(line)
            samples[s["id"]] = {k: s[k] for k in ("label", "split", "source", "category")}
    test = [sid for sid, s in samples.items() if s["split"] == "test"]

    def verdicts(path):
        out = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                v = json.loads(line)
                out[v["id"]] = v
        return out

    stock_verdicts, candidate_verdicts = verdicts(args.stock), verdicts(args.candidate)
    stock_answered = {sid for sid in test if usable_verdict(stock_verdicts.get(sid))}
    candidate_answered = {sid for sid in test if usable_verdict(candidate_verdicts.get(sid))}
    shared = stock_answered & candidate_answered
    paired = [sid for sid in test if sid in shared]
    stock, stock_cat = metrics(samples, stock_verdicts, paired)
    new, new_cat = metrics(samples, candidate_verdicts, paired)
    stock["no_answer"] = len(test) - len(stock_answered)
    new["no_answer"] = len(test) - len(candidate_answered)
    unpaired = len(test) - len(paired)
    model_data = Path(args.model).read_bytes()
    model_digest = hashlib.sha256(model_data).hexdigest()
    stock_digest = hashlib.sha256(args.stock_model.read_bytes()).hexdigest() if args.stock_model else None
    loaded_digest = hashlib.sha256(args.loaded_model.read_bytes()).hexdigest() if args.loaded_model else None
    model = Model.from_scores(json.loads(model_data.decode("utf-8"))["waap_scores"])
    new_rows = {sid: rows for sid, rows in read_dump(sorted(glob.glob(str(Path(args.dump) / "*.jsonl")))).items()
                if sid in shared}
    par = parity(model, new_rows)
    stock_seen = stock_answered & read_dump(sorted(glob.glob(str(Path(args.stock_dump) / "*.jsonl")))).keys()
    inspected = len(stock_seen & set(new_rows)) / len(stock_seen) if stock_seen else None

    checks = []

    def check(name, ok, detail):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    check("inspection", inspected is not None and inspected >= 0.995,
          f'{pct(inspected)} of the held-out requests with keywords reached the agent with the new model')
    check("parity", par["share"] is not None and par["share"] >= 0.999,
          f'{par["matched"]}/{par["values"]} values scored by the agent as the trainer computes')
    check("answers", bool(test) and unpaired <= len(test) // 1000,
          f'{len(paired)}/{len(test)} paired verdicts; {stock["no_answer"]} baseline and '
          f'{new["no_answer"]} candidate verdicts missing or unusable')
    check("balanced accuracy", new["balanced_accuracy"] is not None
          and new["balanced_accuracy"] >= stock["balanced_accuracy"],
          f'{pct(new["balanced_accuracy"])} vs {pct(stock["balanced_accuracy"])}')
    check("legitimate passed (TNR)", new["tnr"] is not None and new["tnr"] >= stock["tnr"] - args.max_tnr_drop,
          f'{pct(new["tnr"])} vs {pct(stock["tnr"])} (drop allowed {args.max_tnr_drop * 100:.2f} pp)')
    check("attacks blocked (TPR)", new["tpr"] is not None and new["tpr"] >= stock["tpr"] - args.max_tpr_drop,
          f'{pct(new["tpr"])} vs {pct(stock["tpr"])} (drop allowed {args.max_tpr_drop * 100:.2f} pp)')
    check("model identity", loaded_digest == model_digest,
          "candidate matches the agent's waap.data" if loaded_digest == model_digest
          else "candidate checksum on the agent is missing or different")
    passed = all(c["ok"] for c in checks)
    card = json.loads(Path(args.card).read_text(encoding="utf-8")) if args.card else None

    result = {"passed": passed, "model_sha256": model_digest, "stock_model_sha256": stock_digest,
              "loaded_model_sha256": loaded_digest, "paired_verdicts": len(paired), "held_out": len(test),
              "checks": checks, "stock": stock, "candidate": new, "parity": par,
              "inspected": inspected,
              "by_category": {k: {"stock": stock_cat.get(k), "candidate": v} for k, v in new_cat.items()},
              "card": card}
    Path(args.out).write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lines = [f'## Модель WAF: {"✅ можно выпускать" if passed else "❌ не выпускается"}', ""]
    if card:
        lines += [f'`{card["model_version"]}`, sha256 `{card["sha256"][:16]}…`; порог — макс. оценка '
                  f'{card["threshold"]["max_score"]:.3f} (объясняет {pct(card["threshold"]["explains_stock_verdicts"])} '
                  f'решений модели образа)', ""]
    lines += ["| Проверка | Итог | |", "|---|---|---|"]
    lines += [f'| {c["check"]} | {"✅" if c["ok"] else "❌"} | {c["detail"]} |' for c in checks]
    lines += ["", "Отложенная часть (сайты и полезные нагрузки, которых модель не видела), решения настоящего агента:", "",
              "| | Модель образа | Новая модель |", "|---|---|---|"]
    for key, name in (("tpr", "атаки заблокированы (TPR)"), ("tnr", "легитимные пропущены (TNR)"),
                      ("balanced_accuracy", "сбалансированная точность"), ("fp", "ложные блокировки"),
                      ("fn", "пропущенные атаки")):
        a, b = stock[key], new[key]
        lines.append(f"| {name} | {pct(a) if key in ('tpr', 'tnr', 'balanced_accuracy') else a} | "
                     f"{pct(b) if key in ('tpr', 'tnr', 'balanced_accuracy') else b} |")
    lines += ["", "<details><summary>По категориям</summary>", "", "| Категория | Модель образа | Новая |", "|---|---|---|"]
    for category, measured in result["by_category"].items():
        for rate in ("tpr", "tnr"):
            if measured["candidate"][rate] is not None:
                lines.append(f'| {category} ({rate.upper()}) | {pct(measured["stock"][rate])} | '
                             f'{pct(measured["candidate"][rate])} |')
    lines += ["", "</details>", ""]
    if par["examples"]:
        lines += ["Расхождения оценки агента и тренера (первые):", "", "```json",
                  json.dumps(par["examples"], ensure_ascii=False, indent=1), "```", ""]
    text = "\n".join(lines)
    print(text)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
