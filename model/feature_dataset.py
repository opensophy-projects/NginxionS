"""Turn reviewed, pre-extracted WAAP observations into the trainer's offline inputs."""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from datasets import unit
from waapmodel import Model

IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")
SURFACES = {"path", "query", "header", "cookie", "json", "form", "multipart", "xml"}
FIELDS = {"id", "group", "source", "category", "surface", "label", "blocked", "values"}
VALUE_FIELDS = {"keywords", "combinations", "score"}


def write_rows(path, rows):
    with path.open("w", encoding="utf-8") as destination:
        for row in rows:
            destination.write(json.dumps(row, ensure_ascii=True) + "\n")


def prepare(input_dir, model_path, output):
    model = model_path.read_bytes()
    model_digest = hashlib.sha256(model).hexdigest()
    if (input_dir / "model.sha256").read_text(encoding="ascii").strip() != model_digest:
        raise ValueError("Observations were collected with a different starting model")
    known = Model.from_scores(json.loads(model)["waap_scores"]).entries
    samples, values, verdicts = [], [], []
    coverage, seen, identifiable = Counter(), {}, Counter()

    with (input_dir / "observations.jsonl").open(encoding="utf-8") as observations:
        for line_number, line in enumerate(observations, 1):
            try:
                row = json.loads(line)
                if not isinstance(row, dict) or row.keys() != FIELDS:
                    raise ValueError("Expected observation fields only")
                for field in ("id", "group", "source", "category"):
                    if not isinstance(row[field], str) or not IDENTIFIER.fullmatch(row[field]):
                        raise ValueError(f"Invalid {field}")
                if not isinstance(row["surface"], str) or row["surface"] not in SURFACES:
                    raise ValueError("Unknown HTTP surface")
                if type(row["label"]) is not int or row["label"] not in (0, 1) or type(row["blocked"]) is not bool:
                    raise ValueError("Invalid reviewed label or stock verdict")
                if not isinstance(row["values"], list):
                    raise ValueError("Expected a list of feature values")
                for value in row["values"]:
                    if not isinstance(value, dict) or value.keys() != VALUE_FIELDS:
                        raise ValueError("Expected feature fields only")
                    if type(value["score"]) not in (int, float) or not 0 <= value["score"] <= 10:
                        raise ValueError("Invalid stock score")
                    for field in ("keywords", "combinations"):
                        tokens = value[field]
                        if not isinstance(tokens, list) or not all(
                            isinstance(token, str) and token in known for token in tokens
                        ):
                            raise ValueError("Feature identifier does not exist in the starting model")
                sid = row["id"]
                identity = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).digest()
                if sid in seen:
                    if seen[sid] != identity:
                        raise ValueError("Conflicting observations for the same ID")
                    continue
                seen[sid] = identity

                split = "test" if unit("split", row["group"]) < 0.3 else "train"
                label, surface, category = row["label"], row["surface"], row["category"]
                samples.append({key: row[key] for key in ("id", "label", "group", "source", "category")} | {
                    "split": split,
                })
                values.extend({"sample": sid, **value} for value in row["values"])
                verdicts.append({"id": sid, "status": 403 if row["blocked"] else 200, "blocked": row["blocked"]})
                coverage[(split, label, surface, category)] += 1
                if any(v["keywords"] or v["combinations"] for v in row["values"]):
                    identifiable[(split, label)] += 1
            except (TypeError, ValueError) as error:
                raise ValueError(f"Invalid observation on line {line_number}: {error}") from error

    if any(not identifiable[(split, label)] for split in ("train", "test") for label in (0, 1)):
        raise ValueError("Both splits require identifiable observations from both classes")

    output.mkdir(parents=True, exist_ok=False)
    (output / "dump").mkdir()
    write_rows(output / "samples.jsonl", samples)
    write_rows(output / "dump/observations.jsonl", values)
    write_rows(output / "stock.jsonl", verdicts)
    report = [{
        "split": split, "label": label, "surface": surface, "category": category, "requests": count,
    } for (split, label, surface, category), count in sorted(coverage.items())]
    (output / "coverage.json").write_text(
        json.dumps({"model_sha256": model_digest, "coverage": report}, indent=2) + "\n", encoding="utf-8"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(args.input, args.base, args.out)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Feature dataset rejected: {error}\n")


if __name__ == "__main__":
    main()
