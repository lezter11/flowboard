# Full 98-feature revalidation and UAT delivery

Started2026-11-03. Baseline917706ae0433df471c72736be4d548eb022236c4. User explicitly authorizes revalidation of all98tasks, repairs, parallel agents, evidence-backed checklist updates and direct UAT promotion only after closure. There is no dev stage; production is excluded.

Release-gate clarification from the user on2026-11-03: **local gates pass → deploy UAT → finish hosted checks**. All required local source/test/independent-review evidence must pass and be frozen before promotion. Host-dependent items are explicitly `UAT pending` until actual Google/Cloudflare/signed-in checks run; they are not falsely marked fully closed beforehand. This clarification resolves the otherwise circular requirement to finish hosted acceptance before deploying the candidate. Final feature closure still requires the applicable hosted evidence.

The previous0/98 figure measures current matching approvals, not missing source. This task must establish actual feature behavior, repair genuine defects and regenerate evidence rather than change checkboxes. MCP's prior8.98 review remains historical approval for its exact frozen target; shared-source changes require renewed coverage before promotion.

## Execution and ownership

1. Three parallel read-only surveys map identity/access/invitations, board/card/lifecycle/import backend and all UI/integration acceptance. Each feature ID gets source, tests, current behavior, missing acceptance and scope conflicts.
2. Architect reconciles stale definitions against the latest confirmed decisions while preserving IDs and history. Retired workspace creation/ownership transfer and project-wide board inheritance are not silently restored. Explicit choice for UI priority remains distinct from compatibility of existing API/import contracts until the appropriate acceptance is fixed.
3. Freeze bounded repair criteria before code changes. Assign disjoint source ownership; reproduce security/integrity candidates through mounted routes and real disposable PostgreSQL before calling them confirmed. Fixes include negative/concurrency/resource-retention tests as applicable. No live-user data or credentials in logs.
4. Finish implementation and local integration before freezing a comprehensive source target. Fresh reviewers who did not implement the evaluated code review grouped features with explicit per-ID criteria under BACKEND_REVIEW_GATE. Every feature still needs matching valid backend, required UI and integration evidence with prerequisite and hash bindings. No builder may approve their own work.
5. Regenerate FEATURE_CHECKLIST using its validator. "Closed and locked" means every required phase is genuinely evidenced for the exact immutable candidate, no unresolved mandatory blocker, all required checks pass, and source changes invalidate approval. It does not mean filesystem permissions alone prove correctness.
6. Push the accepted candidate directly to a UAT Git target, run its hosted checks and deploy only UAT Worker/Pages/Neon targets. No promotion occurs while the full closure gate is unmet. Capture previous deployed artifact/version before replacement, backup/migration state, exact source/artifact binding and bounded anonymous smoke results.
7. Deliver an implemented-feature inventory, repeatable UAT test cases for Owner/Manager/Member/Viewer and Claude MCP setup. Hosted identity, environment-dependent behavior and manual browser acceptance stay explicitly labeled; a local fixture never proves real Google login. If a mandatory gate requires owner interaction, record exact steps instead of manufacturing success.

## Initial source leads (not yet independently reproduced)

- Member PATCH reactivation may bypass seat-quota serialization and archived-context checks.
- XLSX preview/commit may drop descriptions, and abandoned import rows may retain private content beyond cleanup requirements.
- UI comment editing/deletion, complete pagination, before/after placement and full-board filter behavior need implementation/verification.
- Several feature definitions describe superseded permission/ownership flows and need evidence-based reconciliation before scoring.

Survey and subsequent task-specific evidence in this directory govern the repair queue. The existing release-preflight report and all failed reviews remain preserved. No feature is closed by this plan.
