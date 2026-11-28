#!/usr/bin/env python3
"""Builds a deduplicated registry of attack payloads from cloned repositories.

Reads cloned repos (PayloadsAllTheThings-master, IntruderPayloads-master,
InternalAllTheThings-main, mgm-web-attack-payloads, ...) from a directory,
extracts one payload per line from *.txt files, normalizes them, deduplicates
by SHA-256, excludes payloads that are in mgm false-positives (label 0 set),
and emits samples.jsonl entries with label=1 (attack).

Every payload is sent in two forms, like the WAF Comparison Project:
  GET  ?p=<urlencoded payload>
  POST p=<urlencoded payload>  (application/x-www-form-urlencoded)

Usage:
    python3 model/payload_registry.py --root data --mgm data/mgm-web-attack-payloads \
        --out payloads.jsonl

The output is consumed by model/datasets.py via --payloads.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.parse
from pathlib import Path

# lines starting with these are comments / metadata, not payloads
COMMENT_MARKERS = ("#", "//", "--", "/*")
# BurpSuite .bb markers and similar noise lines
NOISE_PREFIXES = ("ACTIVE", "PASSIVE")

SKIP_NAMES = {"readme.txt", "license.txt", "changelog.txt", "contributing.txt"}
# Directories known to contain wordlists/passwords/shells - NOT web attack payloads
SKIP_DIRS = {"images", "docs", "screenshots", "assets", "wordlists", "passwords", "shells", "webshells",
             "exploits", "exploitdb", "cves", "cve", "downloads", "samples", "examples",
             "bypass", "bypasses", "wp-content", "wp-plugins", "joomla", "drupal",
             "magnet", "torrent", "irc", "ftp", "protocols", "api-docs"}
# File patterns that are likely wordlists, not attack payloads
# Every entry is a regular expression consumed by re.search below; glob-style
# entries are expressed as anchored regexes so "*" never appears at position 0.
NOISE_FILENAME_PATTERNS = (
    r".*passwords.*",
    r".*shells.*",
    r".*wordlist.*",
    r".*list\.txt$",
    r".*dotxt\.txt$",
    r".*requirements\.txt$",
    r".*gemspec",
    r".*manifest\.json$",
    r".*composer\.json$",
    r".*package\.json$",
    r".*nginx\.conf$",
    r".*httpd\.conf$",
    r".*apache\.conf$",
    r".*web\.xml$",
    r".*pyproject\.toml$",
    r".*setup\.py$",
    r"\.cfg$",
    r"\.ini$",
    r"\.yaml$",
    r"\.yml$",
    r"\.toml$",
    r"^dockerfile",
    r"^docker-compose",
    r"\.sql$",
    r"^backup",
    r"^dump",
    r"^archive",
    r"^readme",
    r"^license",
    r"^changelog",
)

# payloads shorter than this are noise (single punctuation etc.) and would
# cause false positives on legitimate traffic
MIN_PAYLOAD_LEN = 3
# a payload must contain at least one letter or digit to be considered an attack
HAS_ALNUM_RE = re.compile(r"[A-Za-z0-9]")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0"


def normalize(line: str) -> str:
    """Normalize a raw line to a comparable payload string."""
    line = line.strip()
    if not line:
        return ""
    # strip trailing inline comments
    for marker in COMMENT_MARKERS:
        idx = line.find(marker)
        if idx != -1:
            line = line[:idx]
    line = line.strip().strip('"').strip("'").strip()
    return line


def is_comment_or_noise(raw: str) -> bool:
    stripped = raw.lstrip()
    if not stripped:
        return True
    for marker in COMMENT_MARKERS:
        if stripped.startswith(marker):
            return True
    upper = stripped.upper()
    for prefix in NOISE_PREFIXES:
        if upper.startswith(prefix):
            return True
    return False


def payload_hash(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def iter_text_files(root: Path):
    """Yield (repo_name, path) for *.txt files under cloned repos, skipping noise."""
    for repo_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        # Skip known noise directories (wordlists, passwords, exploits, etc.)
        if repo_dir.name.lower() in SKIP_DIRS:
            continue
        for path in sorted(repo_dir.rglob("*.txt")):
            name = path.name.lower()
            if name in SKIP_NAMES:
                continue
            # Skip files with noise patterns in name (wordlists, etc.)
            skip_file = False
            for pattern in NOISE_FILENAME_PATTERNS:
                if re.search(pattern, name, re.IGNORECASE):
                    skip_file = True
                    break
            if skip_file:
                continue
            parts = path.relative_to(repo_dir).parts
            if any(p.lower() in SKIP_DIRS for p in parts):
                continue
            yield repo_dir.name, path


def mgm_false_positives(mgm_root: Path) -> set:
    """Set of normalized payloads from mgm false-positives.txt — excluded from label 1."""
    out = set()
    if not mgm_root or not mgm_root.exists():
        return out
    for fp in sorted(mgm_root.rglob("false-positives.txt")):
        try:
            lines = fp.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            p = normalize(line)
            if p:
                out.add(p)
    return out


def two_forms(payload: str):
    """GET and POST form of a payload, like datasets.payload_requests."""
    quoted = urllib.parse.quote(payload).replace("%25", "%")
    return [
        ("GET", f"/?p={quoted}", {"User-Agent": UA}, ""),
        ("POST", "/",
         {"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
         f"p={quoted}"),
    ]


def build(root: Path, mgm_root: Path | None = None):
    """Yield unique label-1 samples (GET + POST form) from all repos.

    Deduplication is by SHA-256 of the normalized payload text. Payloads that
    appear in mgm false-positives are excluded (they are label 0 already).
    """
    seen = set()
    exclude = mgm_false_positives(mgm_root) if mgm_root else set()

    for repo_name, path in iter_text_files(root):
        category = path.parent.name or path.stem
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for raw in lines:
            if is_comment_or_noise(raw):
                continue
            p = normalize(raw)
            if not p:
                continue
            if len(p) < MIN_PAYLOAD_LEN:
                continue
            if not HAS_ALNUM_RE.search(p):
                continue  # pure punctuation / noise, not an attack payload
            if p in exclude:
                continue  # already covered as mgm false-positive (label 0)
            h = payload_hash(p)
            if h in seen:
                continue
            seen.add(h)
            group = f"payload:{repo_name}:{category}:{h[:16]}"
            for method, url, headers, data in two_forms(p):
                yield {
                    "label": 1,
                    "source": f"payloads:{repo_name}",
                    "category": category,
                    "group": group,
                    "method": method,
                    "url": url,
                    "headers": headers,
                    "data": data,
                }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True,
                    help="directory with cloned payload repos")
    ap.add_argument("--mgm",
                    help="path to mgm-web-attack-payloads (its false-positives are excluded)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    root = Path(args.root)
    mgm = Path(args.mgm) if args.mgm else None
    n = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for sample in build(root, mgm):
            out.write(json.dumps(sample, ensure_ascii=False) + "\n")
            n += 1
    print(f"total {n} unique payloads", file=sys.stderr)


if __name__ == "__main__":
    main()
