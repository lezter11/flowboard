"""Unit tests for generate_review_record helper script."""
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_backend_review import CATEGORIES, validate_review
from generate_review_record import (
    build_manifest,
    compute_weighted_score,
    finalize_record,
    init_draft_from_criteria,
)


class GenerateReviewRecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

        # Setup synthetic project structure
        (self.root / "docs/reviews/ACC-01").mkdir(parents=True)
        (self.root / "scope").mkdir()
        (self.root / "scope/adapter.ts").write_text("export const session = true;\n")
        (self.root / "scope/session.test.log").write_text("5 tests passed\n")
        (self.root / "scope/reviewer.md").write_text("Independent reviewer statement\n")

        self.criteria_path = "docs/reviews/ACC-01/criteria.json"
        self.criteria = {
            "criteriaVersion": "backend-review-v1",
            "featureIds": ["ACC-01"],
            "mandatoryCriteria": [
                "Session extraction and verification",
                "Unauthenticated rejection",
            ],
            "requiredTests": {
                "unit": "npm run test:unit",
            },
            "scopeAndExclusions": "Synthetic test scope.",
        }
        (self.root / self.criteria_path).write_text(json.dumps(self.criteria, indent=2))

    def test_build_manifest(self):
        manifest, digest = build_manifest(self.root, ["scope", self.criteria_path])
        self.assertIn("scope/adapter.ts", manifest)
        self.assertIn("scope/session.test.log", manifest)
        self.assertIn("scope/reviewer.md", manifest)
        self.assertIn(self.criteria_path, manifest)
        self.assertEqual(len(digest), 64)

    def test_compute_weighted_score(self):
        categories = {
            name: {
                "weight": weight,
                "score": "9.5",
                "reason": "Passing evidence",
                "evidencePaths": ["scope/session.test.log"],
            }
            for name, (weight, _) in CATEGORIES.items()
        }
        score = compute_weighted_score(categories)
        self.assertEqual(score, Decimal("9.5"))

    def test_init_and_finalize_end_to_end(self):
        # 1. Initialize draft
        draft = init_draft_from_criteria(self.criteria_path, root=self.root)
        self.assertEqual(draft["featureIds"], ["ACC-01"])
        self.assertEqual(draft["criteriaPath"], self.criteria_path)
        self.assertEqual(len(draft["criteriaResults"]), 2)

        # 2. Configure reviewer evidence and scope roots
        draft["reviewer"]["independenceEvidence"] = "scope/reviewer.md"
        draft["tests"][0]["evidencePath"] = "scope/session.test.log"
        for cat in draft["categories"].values():
            cat["evidencePaths"] = ["scope/reviewer.md", "scope/session.test.log"]
            cat["score"] = "9.2"

        draft["target"]["scopeRoots"] = ["scope", self.criteria_path]

        review_rel_path = "docs/reviews/ACC-01/round-1.json"

        # 3. Finalize
        finalized = finalize_record(draft, root=self.root, review_path=review_rel_path)
        self.assertEqual(finalized["weightedScore"], "9.2")
        self.assertEqual(finalized["tests"][0]["targetDigest"], finalized["target"]["digest"])

        # 4. Write and validate with check_backend_review
        out_file = self.root / review_rel_path
        out_file.write_text(json.dumps(finalized, indent=2))

        result = validate_review(review_rel_path, root=self.root, feature_id="ACC-01")
        self.assertTrue(result.passed, f"Validation failed: {result.errors}")
        self.assertEqual(result.score, Decimal("9.2"))

    def test_cli_execution_with_validation(self):
        # Test CLI --init
        draft_path = "docs/reviews/ACC-01/draft.json"
        cmd_init = [
            sys.executable,
            str(Path(__file__).resolve().parent / "generate_review_record.py"),
            "--init",
            self.criteria_path,
            "-o",
            draft_path,
            "--root",
            str(self.root),
        ]
        res = subprocess.run(cmd_init, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue((self.root / draft_path).exists())

        # Update draft with valid evidence and scope
        draft_data = json.loads((self.root / draft_path).read_text())
        draft_data["reviewer"]["independenceEvidence"] = "scope/reviewer.md"
        draft_data["tests"][0]["evidencePath"] = "scope/session.test.log"
        for cat in draft_data["categories"].values():
            cat["evidencePaths"] = ["scope/reviewer.md", "scope/session.test.log"]
            cat["score"] = "9.5"
        draft_data["target"]["scopeRoots"] = ["scope", self.criteria_path]
        (self.root / draft_path).write_text(json.dumps(draft_data, indent=2))

        # Test CLI finalize with {digest} pattern and --validate
        cmd_finalize = [
            sys.executable,
            str(Path(__file__).resolve().parent / "generate_review_record.py"),
            draft_path,
            "-o",
            "docs/reviews/ACC-01/{digest}-round-1.json",
            "--validate",
            "--root",
            str(self.root),
        ]
        res = subprocess.run(cmd_finalize, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr + res.stdout)
        self.assertIn("PASS: 9.5/10", res.stdout)


if __name__ == "__main__":
    unittest.main()
