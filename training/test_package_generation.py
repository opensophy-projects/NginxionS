import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from package_generation import ARCHIVE, CHECKS, baseline, candidate, model_details, package, sha256, write_json


def model_bytes(version="Fixture model", license_text="Fixture license"):
    return json.dumps({
        "model_version": version,
        "license": license_text,
        "waap_signatures": {
            "words_regex_list": [],
            "pattern_regex_list": [],
            "specific_acuracy_keywords_regex_list": [],
        },
        "waap_scores": {
            "version": 1,
            "scorePools": [{"key": "base_scores", "value": {"keyword_data": [], "keyword_stats": {}}}],
        },
    }).encode()


class PackagingTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def assert_model_archive(self, directory, expected):
        packed = (directory / ARCHIVE).read_bytes()
        self.assertEqual((directory / "SHA256SUMS").read_text(), f"{sha256(packed)}  {ARCHIVE}\n")
        with tarfile.open(directory / ARCHIVE, "r:gz") as archive:
            (entry,) = archive.getmembers()
            self.assertEqual(entry.name, "waap.data")
            self.assertTrue(entry.isfile())
            self.assertEqual(archive.extractfile(entry).read(), expected)

    def test_generation_2_is_pinned_and_reproducible(self):
        data, label, license_text, manifest = baseline()
        self.assertEqual(manifest["generation"], 2)
        self.assertEqual((manifest["sha256"], manifest["size_bytes"]), (sha256(data), len(data)))
        self.assertEqual(label, manifest["model_version"])
        self.assertTrue(license_text)
        first, second = self.root / "first", self.root / "second"
        package(first, data, label, manifest)
        package(second, data, label, manifest)
        self.assertEqual((first / ARCHIVE).read_bytes(), (second / ARCHIVE).read_bytes())
        self.assert_model_archive(first, data)
        self.assert_model_archive(Path(__file__).resolve().parent / "generations/2", data)
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            package(first, data, label, manifest)

    def test_baseline_rejects_mismatched_checksum(self):
        *_, source = baseline()
        invalid = self.root / "source.json"
        write_json(invalid, {**source, "sha256": "0" * 64})
        with patch("package_generation.SOURCE", invalid):
            with self.assertRaisesRegex(ValueError, "checksum"):
                baseline()

    def existing_candidate(self):
        out = self.root / "out"
        out.mkdir()
        reference = model_bytes("Fixture baseline")
        data = model_bytes("Fixture candidate")
        card = {"model_version": "Fixture candidate", "sha256": sha256(data)}
        scores = {"attacks": 1, "legitimate": 1, "tpr": 1.0, "tnr": 1.0, "balanced_accuracy": 1.0}
        checked = {
            "passed": True,
            "model_sha256": sha256(data),
            "stock_model_sha256": sha256(reference),
            "loaded_model_sha256": sha256(data),
            "checks": [{"check": name, "ok": True} for name in sorted(CHECKS)],
            "card": card,
            "stock": scores,
            "candidate": scores,
        }
        (out / "waap.data").write_bytes(data)
        write_json(out / "model-card.json", card)
        write_json(self.root / "metrics.json", checked)
        return (reference, *model_details(reference), {"sha256": sha256(reference)}), checked

    def test_candidate_publishes_only_model_card_checks_and_checksum(self):
        reference, _ = self.existing_candidate()
        destination = self.root / "release"
        package(destination, *candidate(self.root, reference))
        self.assertEqual({p.name for p in destination.iterdir()},
                         {ARCHIVE, "SHA256SUMS", "model-card.json", "evaluation.json"})
        card = json.loads((destination / "model-card.json").read_text())
        self.assertEqual(card["generation"], 3)
        self.assertEqual(card["sha256"], sha256((self.root / "out/waap.data").read_bytes()))
        summary = json.loads((destination / "evaluation.json").read_text())
        self.assertEqual(summary["candidate"]["balanced_accuracy"], 1.0)
        self.assertEqual(summary["sha256"], card["sha256"])

    def test_candidate_rejects_foreign_incomplete_or_failed_reports(self):
        reference, checked = self.existing_candidate()
        for change, message in (
            ({"model_sha256": "0" * 64}, "same file"),
            ({"stock_model_sha256": "0" * 64}, "baseline must match generation 2"),
            ({"loaded_model_sha256": "0" * 64}, "differs from the file on the agent"),
            ({"passed": False}, "passing evaluation"),
            ({"checks": checked["checks"][:-1]}, "passing evaluation"),
            ({"checks": [checked["checks"][0]] * len(CHECKS)}, "passing evaluation"),
            ({"candidate": {"attacks": 0, "legitimate": 1}}, "both classes"),
            ({"stock": {**checked["stock"], "tpr": 1.5}}, "rates"),
        ):
            with self.subTest(change=change):
                write_json(self.root / "metrics.json", {**checked, **change})
                with self.assertRaisesRegex(ValueError, message):
                    candidate(self.root, reference)

    def test_candidate_rejects_changed_license_and_malformed_model(self):
        reference, _ = self.existing_candidate()
        model = self.root / "out/waap.data"
        model.write_bytes(model_bytes(license_text="Different license"))
        with self.assertRaisesRegex(ValueError, "original license"):
            candidate(self.root, reference)
        model.write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "WAAP signatures"):
            candidate(self.root, reference)


if __name__ == "__main__":
    unittest.main()
