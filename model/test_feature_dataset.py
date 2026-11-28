import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import datasets
from check_verdict_cases import check_cases
from feature_dataset import SURFACES, prepare, write_rows


class HTTPFixtureTest(unittest.TestCase):
    def test_ordinary_http_fixtures_cover_all_surfaces_without_duplicates(self):
        _, cases = check_cases(Path(__file__).with_name("verdict-cases.txt"))
        self.assertEqual({case["category"] for case in cases}, {f"http-{s}" for s in SURFACES | {"binary"}})
        self.assertTrue(all(case["label"] == 0 and case["url"].startswith("/") for case in cases))
        requests = {json.dumps({key: case[key] for key in ("method", "url", "headers", "data")},
                               sort_keys=True) for case in cases}
        self.assertEqual(len(requests), len(cases))
        soak_pages = {case["url"] for case in cases if case["id"].startswith("soak-page-")}
        self.assertEqual(soak_pages, {f"/api/items?page={page}" for page in range(50)})


class FeatureDatasetTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.base = self.root / "stock.data"
        self.base.write_text(json.dumps({"waap_scores": {
            "keyword_data": [{"key": "fixture_signal", "value": {"type": 1}}],
            "keyword_stats": {},
        }}))
        (self.root / "model.sha256").write_text(hashlib.sha256(self.base.read_bytes()).hexdigest())
        groups = [f"group-{i}" for i in range(100)]
        train = next(g for g in groups if datasets.unit("split", g) >= 0.3)
        test = next(g for g in groups if datasets.unit("split", g) < 0.3)
        self.rows = [{
            "id": f"sample-{group}-{label}",
            "source": "fixture",
            "group": group,
            "category": "class-fixture",
            "surface": "json",
            "label": label,
            "blocked": bool(label),
            "values": [{"keywords": ["fixture_signal"], "combinations": [], "score": 2 + 5 * label}],
        } for group in (train, test) for label in (0, 1)]
        self.output = self.root / "prepared"

    def prepare(self, rows):
        write_rows(self.root / "observations.jsonl", rows)
        prepare(self.root, self.base, self.output)

    def test_keeps_groups_together_and_ignores_duplicate_ids(self):
        self.prepare(self.rows + [self.rows[0]])
        samples = [json.loads(line) for line in (self.output / "samples.jsonl").read_text().splitlines()]
        self.assertEqual(len(samples), 4)
        by_group = {}
        for sample in samples:
            by_group.setdefault(sample["group"], set()).add(sample["split"])
        self.assertCountEqual(list(by_group.values()), [{"train"}, {"test"}])
        report = json.loads((self.output / "coverage.json").read_text())
        self.assertEqual(sum(row["requests"] for row in report["coverage"]), 4)
        self.assertEqual({row["surface"] for row in report["coverage"]}, {"json"})

    def test_rejects_raw_fields_unknown_signals_and_conflicting_ids(self):
        for row, message in (
            ({**self.rows[0], "body": "ordinary text"}, "Expected observation fields"),
            ({**self.rows[0], "values": [{"keywords": ["unknown"], "combinations": [], "score": 2}]},
             "Feature identifier"),
            ({**self.rows[0], "surface": "query"}, "Conflicting observations"),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.prepare(self.rows + [row])
            self.assertFalse(self.output.exists())

    def test_rejects_wrong_model_and_missing_classes(self):
        with self.assertRaisesRegex(ValueError, "Both splits"):
            self.prepare([row for row in self.rows if row["label"] == 0])
        (self.root / "model.sha256").write_text("0" * 64)
        with self.assertRaisesRegex(ValueError, "different starting model"):
            self.prepare(self.rows)

    def test_prepared_observations_work_with_the_offline_trainer(self):
        try:
            import train
        except ImportError as exc:
            self.skipTest(str(exc))
        self.prepare(self.rows)
        with contextlib.redirect_stderr(io.StringIO()):
            train.main([
                "--samples", str(self.output / "samples.jsonl"), "--dump", str(self.output / "dump"),
                "--verdicts", str(self.output / "stock.jsonl"), "--base", str(self.base),
                "--out", str(self.root / "candidate"), "--name", "fixture",
            ])
        card = json.loads((self.root / "candidate/model-card.json").read_text())
        self.assertEqual(card["model_version"], "NginxionS fixture")
        self.assertEqual(card["offline"]["test"]["attacks"], 1)
        self.assertEqual(card["offline"]["test"]["legitimate"], 1)
