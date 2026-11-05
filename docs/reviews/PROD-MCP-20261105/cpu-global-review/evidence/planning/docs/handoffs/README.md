# Backend to UI delivery contract

User-requested sequence: specify each feature → Backend implements and verifies it → UI receives that feature → integrated acceptance. Backend/UI can work on different ready features; UI does not guess an unfinished API. Visual flow planning can start earlier. Root RULES teaching format applies throughout.

Definitions are in [features.tsv](../features.tsv); [FEATURE_CHECKLIST.md](../FEATURE_CHECKLIST.md) is generated. Preserve stable IDs. Owner-specific evidence files avoid two chats editing the same shared checklist at once:

- Backend writes `docs/handoffs/backend/FEATURE-ID.json`.
- UI writes `docs/handoffs/ui/FEATURE-ID.json`.
- Architect/integration reviewer writes `docs/handoffs/integration/FEATURE-ID.json`.
- Run `python3 scripts/render_feature_checklist.py` after a status/evidence update. Do not hand-edit generated boxes. Only one chat regenerates at a time; source evidence is separately owned.

Example backend evidence structure (example only, do not create it until tests exist):

```json
{
  "status": "verified",
  "reviewPath": "docs/reviews/FEATURE-ID/manifest-round-N.json",
  "summary": "What works and which acceptance statements were tested",
  "api_contract": "docs/API.md section or generated OpenAPI path",
  "limitations": ["Unverified hosted behavior, if applicable"],
  "evidence": [{
    "path": "docs/evidence/FEATURE-ID-local.md",
    "command": "Exact test or verification command",
    "result": "Observed result",
    "environment": "Local PostgreSQL version / runtime / synthetic dataset"
  }]
}
```

Use not_started/in_progress/blocked/verified status as appropriate. A verified record must link actual code/test results, sample request/response and error cases, authorization scope, migration/setup steps and limitations in its evidence document. Backend also requires a passing independent review under [BACKEND_REVIEW_GATE.md](../../BACKEND_REVIEW_GATE.md), with schema and commands in [reviews/README.md](../reviews/README.md). The renderer validates current review hashes and phase ordering; Architect still judges scope, reviewer independence and actual evidence. Historical unreviewed records stay preserved but unapproved. A SQLite prototype or mocked database does not prove selected PostgreSQL concurrency behavior.

UI receives contract/fixtures, validation/error shapes, permission states, pagination, examples and backend setup instructions. It verifies real behavior or explicitly labels fixture-only work. Integration verification needs the actual Backend+UI flow and failure cases; it cannot be checked from a screenshot alone. Reopen evidence after a breaking change rather than keeping stale checkmarks.

See [TASKS.md](../../TASKS.md) for the current small task. Each completed unit is reported to Architect with the feature ID, evidence path and next ready features. Sending messages between chats follows direct user authorization; this document is not standing permission to message unrelated chats.
