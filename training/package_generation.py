"""Package an existing WAF model for import. This tool runs no training or traffic."""
import argparse
import gzip
import hashlib
import io
import json
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "training/generations/2/source.json"
ARCHIVE = "open-appsec-advanced-model.tgz"
MAX_MODEL_BYTES = 128 * 1024 * 1024
CHECKS = {
    "inspection",
    "parity",
    "answers",
    "balanced accuracy",
    "legitimate passed (TNR)",
    "attacks blocked (TPR)",
}
SIGNATURE_LISTS = ("words_regex_list", "pattern_regex_list", "specific_acuracy_keywords_regex_list")


def metadata(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def score_pool(value):
    return (
        isinstance(value, dict)
        and isinstance(value.get("keyword_data"), list)
        and isinstance(value.get("keyword_stats"), dict)
    )


def model_details(data):
    if not 0 < len(data) <= MAX_MODEL_BYTES:
        raise ValueError("Invalid waap.data size")
    document = json.loads(data.decode("utf-8"))
    if not isinstance(document, dict):
        raise ValueError("waap.data must be a JSON object")
    signatures = document.get("waap_signatures")
    if not isinstance(signatures, dict) or not all(
        isinstance(signatures.get(name), list) for name in SIGNATURE_LISTS
    ):
        raise ValueError("waap.data lacks WAAP signatures")
    scores = document.get("waap_scores")
    if not isinstance(scores, dict):
        raise ValueError("waap.data lacks WAAP score pools")
    version = scores.get("version", 0)
    if type(version) is int and version == 1:
        pools = scores.get("scorePools")
        valid = (
            isinstance(pools, list)
            and all(isinstance(pool, dict) and isinstance(pool.get("key"), str)
                    and score_pool(pool.get("value")) for pool in pools)
            and any(pool["key"] == "base_scores" for pool in pools)
        )
    else:
        valid = type(version) is int and version == 0 and score_pool(scores)
    if not valid:
        raise ValueError("waap.data lacks WAAP score pools")
    label, license_text = document.get("model_version"), document.get("license")
    if not all(isinstance(item, str) and item.strip() for item in (label, license_text)):
        raise ValueError("waap.data must include a model version and license")
    return label, license_text


def baseline():
    source = metadata(SOURCE)
    commit, path = source["commit"], source["path"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"(?:[a-z_]+/)+waap\.data", path):
        raise ValueError("Invalid generation 2 source reference")
    result = subprocess.run(
        ["git", "cat-file", "blob", f"{commit}:{path}"], cwd=ROOT, capture_output=True, check=False
    )
    if result.returncode:
        raise ValueError(f"Generation 2 commit {commit} is missing. Fetch it before packaging.")
    data = result.stdout
    if len(data) != source["size_bytes"] or sha256(data) != source["sha256"]:
        raise ValueError("Generation 2 source checksum or size differs from its manifest")
    label, license_text = model_details(data)
    if label != source["model_version"]:
        raise ValueError("Generation 2 version differs from its manifest")
    return data, label, license_text, source


def candidate(work, reference):
    _, _, original_license, source = reference
    path = work / "out/waap.data"
    if path.stat().st_size > MAX_MODEL_BYTES:
        raise ValueError("Invalid candidate waap.data size")
    data = path.read_bytes()
    label, license_text = model_details(data)
    checksum = sha256(data)
    if license_text != original_license or checksum == source["sha256"]:
        raise ValueError("Candidate must be a distinct model with the original license")
    card = metadata(work / "out/model-card.json")
    metrics = metadata(work / "metrics.json")
    if not isinstance(card, dict) or not isinstance(metrics, dict):
        raise ValueError("Model card and evaluation must be JSON objects")
    if (card.get("sha256") != checksum or card.get("model_version") != label or metrics.get("card") != card
            or metrics.get("model_sha256") != checksum):
        raise ValueError("Candidate model, card and evaluation do not describe the same file")
    checks = metrics.get("checks")
    if (
        metrics.get("passed") is not True
        or not isinstance(checks, list)
        or len(checks) != len(CHECKS)
        or not all(isinstance(check, dict) and isinstance(check.get("check"), str)
                   and check.get("ok") is True for check in checks)
        or {check["check"] for check in checks} != CHECKS
    ):
        raise ValueError("Candidate has no complete passing evaluation")
    summary = {"passed": True, "checks": sorted(CHECKS), "sha256": checksum}
    fields = ("attacks", "legitimate", "tpr", "tnr", "balanced_accuracy")
    for key in ("stock", "candidate"):
        measured = metrics.get(key)
        if not isinstance(measured, dict) or not all(
            type(measured.get(field)) is int and measured[field] > 0 for field in ("attacks", "legitimate")
        ):
            raise ValueError("Evaluation must include both classes for the baseline and candidate")
        if not all(type(measured.get(field)) in (int, float) and 0 <= measured[field] <= 1
                   for field in fields[2:]):
            raise ValueError("Evaluation rates must be between zero and one")
        summary[key] = {field: measured[field] for field in fields}
    return data, label, {"generation": 3}, summary


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def package(output, data, label, card, evaluation=None):
    if output.exists() or output.is_symlink():
        raise ValueError(f"Output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        directory = Path(temporary) / "generation"
        directory.mkdir()
        with (directory / ARCHIVE).open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as packed:
                with tarfile.open(fileobj=packed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                    entry = tarfile.TarInfo("waap.data")
                    entry.size = len(data)
                    entry.mode = 0o644
                    archive.addfile(entry, io.BytesIO(data))
        checksum = sha256((directory / ARCHIVE).read_bytes())
        (directory / "SHA256SUMS").write_text(f"{checksum}  {ARCHIVE}\n", encoding="ascii")
        write_json(directory / "model-card.json", {**card, "model_version": label, "sha256": sha256(data)})
        if evaluation:
            write_json(directory / "evaluation.json", evaluation)
        directory.rename(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("generation", choices=("baseline", "candidate"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--work", type=Path, help="existing CI artifact extracted to a directory")
    args = parser.parse_args(argv)
    if (args.generation == "candidate") != (args.work is not None):
        parser.error("--work is required for candidate and unavailable for baseline")
    try:
        reference = baseline()
        if args.generation == "baseline":
            data, label, _, card = reference
            package(args.out, data, label, card)
        else:
            package(args.out, *candidate(args.work, reference))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Model packaging failed: {error}\n")


if __name__ == "__main__":
    main()
