# Independent review plan

Reviewer: /root/browser_portability_review; not an implementer; read-only target review. Applicable skill: code-review-and-quality, adapted to immutable review (no mutation of held source; any mutation experiment must use a disposable copy).

Acceptance is CRITERIA.md, existing REVIEW-PLAN.md and unchanged backend-review-v1. Review current all99 feature applicability and all149 inherited statements; do not copy historical category scores. No production/UAT/actions/push.

1. Inspect runner/helper/test/root script delta against e5c5687 and prove all24 cases/assertions/limits unchanged.
2. Freeze exact source manifest before accepted commands; verify before/after source guards and actual platform/runtime/browser/source identities. Require actual Linux default24, Darwin default24, malicious diagnostics and invalid-executable nonzero/zero-cases cleanup.
3. Enumerate original17 command strings and explicit functional input closure per inherited command, including lifecycle scripts/root lock/config/artifact provenance. Retain actual prior execution SHA/environment/log only when closure equality holds. Changed package script field is analyzed semantically, never blanket whole-file equality.
4. Old19th Linux envelope cannot be rebound. Fresh attestation compares parser/API/install/offline/pressure functional sources/lock/fixtures/caps/dependency bytes and keeps old original execution distinct.
5. Re-evaluate every per-ID source reference and criteria applicability. Produce new record, findings, fixed six scores, strict threshold and floors, explicit limitations. Missing mandatory evidence yields incomplete.
