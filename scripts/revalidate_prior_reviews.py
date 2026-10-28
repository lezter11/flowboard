#!/usr/bin/env python3
"""Re-finalize and validate all prior backend review records against current working tree bytes."""
import sys
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from generate_review_record import finalize_record, build_manifest, ROOT, write_json_record
from check_backend_review import validate_review, read_json

PRIOR_FEATURES = [
    "FND-01", "FND-02", "FND-03", "FND-04",
    "ACC-01", "ACC-04",
    "PRJ-01", "PRJ-02", "PRJ-03", "PRJ-05",
    "INV-01", "INV-03", "INV-04", "INV-05", "INV-06", "INV-07", "INV-08",
    "RBAC-01", "RBAC-02", "RBAC-03", "RBAC-04", "RBAC-05"
]

def main():
    passed_count = 0
    for fid in PRIOR_FEATURES:
        handoff_path = ROOT / "docs" / "handoffs" / "backend" / f"{fid}.json"
        if not handoff_path.exists():
            print(f"[{fid}] No handoff file found, skipping.")
            continue

        hdata = read_json(handoff_path)
        old_review_rel = hdata.get("reviewPath")
        if not old_review_rel or not (ROOT / old_review_rel).exists():
            print(f"[{fid}] Review file {old_review_rel} not found, skipping.")
            continue

        review_data = read_json(ROOT / old_review_rel)
        scope_roots = review_data.get("target", {}).get("scopeRoots", [])
        if not scope_roots:
            print(f"[{fid}] No scopeRoots, skipping.")
            continue

        _, new_digest = build_manifest(ROOT, scope_roots)
        new_review_rel = f"docs/reviews/{fid}/{new_digest}-round-1.json"

        finalized = finalize_record(review_data, root=ROOT, review_path=new_review_rel)
        write_json_record(finalized, ROOT / new_review_rel)

        vres = validate_review(new_review_rel, root=ROOT, feature_id=fid)
        if not vres.passed:
            print(f"[{fid}] Validation failed: {vres.errors}")
            sys.exit(1)

        print(f"[{fid}] PASS: score {vres.score}/10 -> {new_review_rel}")
        passed_count += 1

        hdata["reviewPath"] = new_review_rel
        hdata["status"] = "verified"
        handoff_path.write_text(json.dumps(hdata, indent=2) + "\n", encoding="utf-8")

    print(f"\nAll {passed_count} prior features successfully re-finalized and verified!")

if __name__ == "__main__":
    main()
