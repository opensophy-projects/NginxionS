"""Validate HTTP fixtures and check the evaluator against their example statuses."""
import argparse
import json
import re
from pathlib import Path

from datasets import norm, unit
from evaluate import verdict_outcome
from feature_dataset import SURFACES

CASE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}")
STATUS = re.compile(r"0|[1-5][0-9]{2}")
OUTCOMES = {"tp", "tn", "fp", "fn", "unusable"}
OUTCOME_LABELS = {
    "tp": "Заблокирован (TP)",
    "tn": "Пропущен (TN)",
    "fp": "Ложная блокировка (FP)",
    "fn": "Атака пропущена (FN)",
    "unusable": "Ответ непригоден",
}
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
REQUEST_CATEGORIES = {f"http-{surface}" for surface in SURFACES | {"binary"}}


def ordinary_request(columns, number):
    if len(columns) != 4:
        raise ValueError(f"Line {number}: expected request ID, category and a JSON object")
    _, case_id, category, text = columns
    try:
        request = json.loads(text)
    except ValueError as error:
        raise ValueError(f"Line {number}: invalid request JSON") from error
    if not isinstance(request, dict) or request.keys() - {"method", "url", "headers", "data"}:
        raise ValueError(f"Line {number}: invalid request fields")
    method, url = request.get("method"), request.get("url")
    if (not isinstance(method, str) or method not in METHODS or not isinstance(url, str)
            or not url.startswith("/") or url.startswith("//") or "#" in url
            or not url.isprintable() or any(c.isspace() for c in url)):
        raise ValueError(f"Line {number}: expected an HTTP method and a relative URL")
    if category not in REQUEST_CATEGORIES:
        raise ValueError(f"Line {number}: unknown request category")
    headers = request.get("headers", {})
    if not isinstance(headers, dict) or not all(isinstance(v, str) for v in headers.values()):
        raise ValueError(f"Line {number}: headers must be an object of strings")
    group = f"case:{category}"
    return {"id": case_id, "label": 0, "source": "cases", "category": category, "group": group,
            "split": "test" if unit("split", group) < 0.3 else "train", **norm(request)}


def check_cases(path):
    rows = []
    requests = []
    seen = set()
    classes = set()
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.split(maxsplit=1)[0] == "request":
            request = ordinary_request(line.split(maxsplit=3), number)
            case_id = request["id"]
            if not CASE_ID.fullmatch(case_id) or case_id in seen:
                raise ValueError(f"Line {number}: invalid or duplicate case ID")
            seen.add(case_id)
            requests.append(request)
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
    return rows, requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", type=Path)
    parser.add_argument("--requests-out", type=Path, help="write the ordinary HTTP request fixtures as JSONL")
    args = parser.parse_args()
    try:
        rows, requests = check_cases(args.cases)
        if args.requests_out:
            with args.requests_out.open("w", encoding="utf-8") as output:
                for request in requests:
                    output.write(json.dumps(request, ensure_ascii=False) + "\n")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Verdict fixtures: {error}\n")

    print("## Проверка оценщика на заданных HTTP-статусах\n")
    print("В этой таблице статусы взяты из файла с тестовыми примерами.\n")
    print("| Сценарий | Тип | Поколение 2 | Кандидат | Проверка |")
    print("| --- | --- | --- | --- | --- |")
    failed = False
    for case_id, label, stock, candidate, expected, actual in rows:
        mismatch = expected != actual
        failed |= mismatch
        result = "Ожидалось " + " / ".join(OUTCOME_LABELS[key] for key in expected) if mismatch else "OK"
        kind = "Обычный запрос" if label == "0" else "Атака"
        left, right = (OUTCOME_LABELS[key] for key in actual)
        print(f"| {case_id} | {kind} | {stock} → {left} | {candidate} → {right} | {result} |")
    if requests:
        print(f"\n## Подготовленные HTTP-запросы ({len(requests)})\n")
        print("В этом задании запросы проверяются и экспортируются без отправки на агент.\n")
        print("| ID | Метод | Путь | Категория |")
        print("| --- | --- | --- | --- |")
        for request in requests:
            url = request["url"].replace("|", "%7C").replace("`", "%60")
            print(f'| {request["id"]} | {request["method"]} | `{url}` | {request["category"]} |')
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
