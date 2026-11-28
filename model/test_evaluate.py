import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from evaluate import main, usable_verdict
from waapmodel import Model


def write_rows(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (self.root / "dump-stock").mkdir()
        (self.root / "dump-new").mkdir()
        model = Model(stats={"intercept": 0.0, "log_nnz_coef": 0.0})
        (self.root / "candidate.data").write_text(json.dumps({"waap_scores": model.to_scores()}))
        (self.root / "loaded.data").write_bytes((self.root / "candidate.data").read_bytes())
        (self.root / "stock.data").write_text("baseline fixture")
        self.samples = [{"id": f"case-{i}", "label": i % 2, "split": "test", "source": "fixture",
                         "category": "case-group"} for i in range(4)]
        self.verdicts = [{"id": s["id"], "status": 403 if s["label"] else 200, "blocked": bool(s["label"])}
                         for s in self.samples]
        self.rows = [{"sample": s["id"], "keywords": [], "combinations": [], "score": model.score([], [])}
                     for s in self.samples]

    def evaluate(self, candidate=None, samples=None):
        write_rows(self.root / "samples.jsonl", self.samples if samples is None else samples)
        write_rows(self.root / "verdicts-stock.jsonl", self.verdicts)
        write_rows(self.root / "verdicts-new.jsonl", self.verdicts if candidate is None else candidate)
        write_rows(self.root / "dump-stock/rows.jsonl", self.rows)
        write_rows(self.root / "dump-new/rows.jsonl", self.rows + [
            {"sample": "probe", "keywords": [], "combinations": [], "score": 0},
        ])
        paths = {
            "--samples": "samples.jsonl",
            "--stock": "verdicts-stock.jsonl",
            "--candidate": "verdicts-new.jsonl",
            "--dump": "dump-new",
            "--stock-dump": "dump-stock",
            "--model": "candidate.data",
            "--stock-model": "stock.data",
            "--loaded-model": "loaded.data",
            "--out": "metrics.json",
        }
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as result:
            main([value for key, path in paths.items() for value in (key, str(self.root / path))])
        return result.exception.code, json.loads((self.root / "metrics.json").read_text())

    def test_accepts_held_out_pairs_and_ignores_probe_scores(self):
        code, report = self.evaluate()
        self.assertEqual(code, 0)
        self.assertEqual(report["paired_verdicts"], 4)
        self.assertEqual(report["parity"]["values"], 4)
        self.assertEqual(report["loaded_model_sha256"], report["model_sha256"])

    def test_errors_and_missing_answers_do_not_count_as_passed_requests(self):
        candidate = [{**self.verdicts[0], "status": 500}, *self.verdicts[2:]]
        code, report = self.evaluate(candidate)
        self.assertEqual(code, 1)
        self.assertEqual(report["paired_verdicts"], 2)
        self.assertEqual(report["candidate"]["no_answer"], 2)
        self.assertEqual(report["stock"]["legitimate"], 1)
        self.assertEqual(report["candidate"]["legitimate"], 1)
        self.assertFalse(next(check for check in report["checks"] if check["check"] == "answers")["ok"])

    def test_rejects_a_single_class_and_a_model_different_from_the_agent_file(self):
        (self.root / "loaded.data").write_text("different fixture")
        code, report = self.evaluate(samples=[sample for sample in self.samples if sample["label"] == 0])
        self.assertEqual(code, 1)
        failed = {check["check"] for check in report["checks"] if not check["ok"]}
        self.assertTrue({"balanced accuracy", "attacks blocked (TPR)", "model identity"} <= failed)

    def test_status_and_block_flag_must_agree(self):
        for verdict in (None, {"status": 302, "blocked": False}, {"status": 403, "blocked": False},
                        {"status": 200, "blocked": True}, {"status": 200, "blocked": 0}):
            with self.subTest(verdict=verdict):
                self.assertFalse(usable_verdict(verdict))
        self.assertTrue(usable_verdict({"status": 204, "blocked": False}))
        self.assertTrue(usable_verdict({"status": 403, "blocked": True}))
