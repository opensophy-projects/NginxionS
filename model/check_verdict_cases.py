"""Check the evaluator's classifications against recorded status fixtures."""
import argparse
import re
from pathlib import Path

from evaluate import verdict_outcome

CASE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}")
STATUS = re.compile(r"0|[1-5][0-9]{2}")
OUTCOMES = {"tp", "tn", "fp", "fn", "unusable"}


def check_cases(path):
    rows = []
    seen = set()
    classes = set()
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        columns = line.split()
        if len(columns) != 6:
            raise ValueError(f"Line {number}: expected six fields")
        case_id, label, stock, candidate, expected_stock, expected_candidate = columns
        if not CASE_ID.fullmatch(case_id) or case_id in seen:
            raise ValueError(f"Line {number}: invalid or duplicate case ID")
        if label not in {"0", "1"} or not all(STATUS.fullmatch(status) for status in (stock, candidate)):
            raise ValueError(f"Line {number}: invalid label or HTTP status")
        expected = (expected_stock, expected_candidate)
        if any(outcome not in OUTCOMES for outcome in expected):
            raise ValueError(f"Line {number}: unknown expected outcome")
        seen.add(case_id)
        classes.add(label)

        actual = tuple(verdict_outcome(int(label), {"status": int(status), "blocked": status == "403"})
                       for status in (stock, candidate))
        rows.append((case_id, label, stock, candidate, expected, actual))

    if classes != {"0", "1"}:
        raise ValueError("At least one ordinary case and one attack case are required")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", type=Path)
    args = parser.parse_args()
    try:
        rows = check_cases(args.cases)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Verdict fixtures: {error}\n")

    print("## Проверка оценщика на заданных HTTP-статусах\n")
    print("| Сценарий | Метка | Поколение 2 | Кандидат | Проверка |")
    print("| --- | --- | --- | --- | --- |")
    failed = False
    for case_id, label, stock, candidate, expected, actual in rows:
        mismatch = expected != actual
        failed |= mismatch
        result = f"Ожидалось {expected[0]} / {expected[1]}" if mismatch else "OK"
        print(f"| {case_id} | {label} | {stock} → {actual[0]} | {candidate} → {actual[1]} | {result} |")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
