# Flowboard ordered tasks

Updated 2026-10-26. Product scope v0.3 governs. [98-feature checklist](docs/FEATURE_CHECKLIST.md), [detailed flows](docs/FEATURE_SPEC.md), [import rules](docs/IMPORT_SPEC.md), [API](docs/API.md) and [handoff rules](docs/handoffs/README.md) are required reading.

## Planning completed

- [x] A-01 initial architecture/product/platform research and backend/UI chat creation.
- [x] A-02 six canonical root docs, source-linked research, all three references and teaching rules.
- [x] A-03 all 50 engineering concerns planned with honest delivery/evidence states.
- [x] A-04 latest feature research by three GPT-6 Luna agents; reconciled project-only access, Owner/Manager administration, images, card trash and XLSX import.
- [x] A-05 98 stable feature definitions with backend/UI/integration evidence gates.
- [x] A-06 actual downloadable seven-column Excel template with separate examples/instructions. Artifact checks are not importer verification.

## Current implementation handoff

- [x] FND-01 — Backend: build minimal local Node/Worker API harness plus real local PostgreSQL connection/transaction rollback test. Coordinate root workspace tooling; synthetic data only, no cloud resources or deployment. This is the first implementation task, not all 98 features at once.
- [x] FND-02 — Architect + Backend: shared validated API v0.3 schemas/OpenAPI/fixtures, including sibling-project privacy and Owner/Manager limits. Verified and audited at 9.8/10.0.
- [x] FND-03 — Backend: selected PostgreSQL migrations, project_memberships/invitations and new lifecycle/import/image/audit models. Verified with 7 integration tests in apps/api/test/migrations.test.ts; audited at 10.0/10.0.
- [x] FND-04 — Backend: safe errors, correlation/timing, bounded requests/deadlines and local test setup. Verified with 20 unit tests across 9 suites in apps/api/test/observability.test.ts; audited at 10.0/10.0.

For FND-01 only, Architect authorizes Backend to add the minimal root package/workspace/TypeScript/test configuration needed by apps/api, since no UI package exists yet. No other chat edits these implementation files during this task. Shared contracts remain coordinated in FND-02. If local PostgreSQL/Docker is unavailable, record the specific prerequisite and complete unaffected setup; do not substitute mocks and call database verification complete.

## Product sequence and UI gates

1. S1 Account, ownership, projects, invitations and RBAC. Owner and Manager have the authority confirmed in FEATURE_SPEC; manager is project-scoped.
   - [x] ACC-01 — Backend: Sign in and session (cookie extraction, DB session store, /session, /logout). Audited at 10.0/10.0.
   - [x] RBAC-01 — Backend: Owner manager member viewer matrix (inheritance, project memberships, sibling privacy 404). Audited at 10.0/10.0.
   - [x] ACC-04 — Backend: Create workspace and owner (single owner atomicity, idempotency replay duplicate protection). Audited at 10.0/10.0.
   - [x] PRJ-01 — Backend: Create multiple projects (owner-restricted creation, sibling project privacy, role-scoped lists). Audited at 10.0/10.0.
   - [ ] ACC-02, ACC-03, ACC-05, ACC-06 — Account lifecycle, profile, preferences, context switcher.
   - [ ] PRJ-02, PRJ-03, PRJ-05 — Project list/nav, settings, people directory.
   - [ ] INV-01 to INV-08 — Project invitations, email delivery, acceptance, role change, revoke/leave.
   - [ ] RBAC-02 to RBAC-05 — Ancestry enforcement, lock protocol, picker privacy, inheritance disclosure.
2. S2 Board/column/card CRUD, popup fields, Move/drag, query/filter/My tasks and basic UX.
3. S3 Comments/mentions, full card activity, owner/project feeds and durable inbox.
4. S4 Private image uploads/proxy/gallery and exact 24-hour trash/restore/purge.
5. S5 Template endpoint, XLSX validation/preview/confirmation, duplicate protection and result/error reporting.
6. S6 Archive/reopen, owner transfer, optional versioned Undo and full end-to-end/performance/recovery acceptance.

Backend selects one dependency-ready feature ID, implements/tests it and writes its role-owned evidence file. Regenerate the checklist; Architect reviews the handoff; UI then implements that feature against the verified contract. UI may plan visual flows beforehand but cannot mark mocks integrated. Work on different handed-off features can overlap. Root docs are source of truth when research alternatives differ.

## Access and release tasks

- [ ] Verify loaded Cloudflare account tools (user reports approval already complete; do not repeat consent unnecessarily).
- [ ] Verify GitHub push access and initialize/reconcile local Git/origin for lezter11/flowboard without overwriting remote history.
- [ ] Choose production OAuth audience/provider and invitation email adapter before real login/invites are enabled.
- [ ] Review first board/detail/Move/import/trash visual flows; choose approved tokens.
- [ ] Benchmark selected Worker and Node paths with the same PostgreSQL data/region; validate budget/limits and adapt if needed.
- [ ] Isolated dev → UAT → production promotion with migration/restore evidence. No paid benchmark or cloud provisioning is part of the local foundation handoff.

## Done means evidence

Record changed files, exact command/results, environment/dataset and limitations in a real evidence document. Backend handoff includes schema/setup, sample request/response/error, role checks and API version. Update only your own evidence directory; generated boxes are not hand-edited. Feature IDs and dependencies are in docs/features.tsv; the 50-item engineering checklist remains separate.
