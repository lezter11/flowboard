# Flowboard ordered tasks

## Active: sample prompts and production promotion — 2026-11-05

The user reports hosted UAT connection success and authorizes production. Sample prompt help is now deployed to **UAT application40e51e1**: CI22steps/API1,926/hosted24, scoped review9.065, helper review8.79 and final anonymous UAT17/17 pass. Required title/board/column and optional priority/date/description are explained; MCP assignment remains a manual follow-up. **Next: resolve the fresh production backup quota**, with explicit permission pending to delete only `uat-backup-2026-10-28`. Then reviewed migrations20–27, immutable production Worker/Pages upload, verification, monitoring and owner acceptance. No production write/promotion has occurred. [Exact release checkpoint](docs/reviews/PROD-MCP-20261105/SUMMARY.md). Docker is off; user may close the laptop while permission is pending.

## Earlier: hosted browser-sign-in connector — 2026-11-04

Hosted connector HMCP00–08 is complete for **UAT application dce1a67**: fresh independent8.955/current local handoffs, exact native CI and guarded backup/migration27/Worker+Pages upload. Final anonymous17/17 and actual referrer-policy browser proof pass. HMCP09 retains real owner Google/Claude and signed-in acceptance: [five-step setup](docs/HOSTED_MCP_QUICKSTART.md), [live release evidence](docs/reviews/HOSTED-MCP-20261104/release-dce1a67/SUMMARY.md). Docker is stopped and laptop closure is safe. Company client credentials/card updates remain next scope. Production excluded; earlier states below are historical.

Earlier deployment baseline2026-11-04: UAT deployed exactd1c81f4; independent anonymous smoke15/15passed. Local98Backend/74requiredUI/98integration approvals current. UAT-01–05 complete; HOST-01–03 remain pending actual signed-in/provider/Claude tests. See [checkpoint](docs/reviews/FULL-REVALIDATION-20261104/CHECKPOINT.md) and [testing guide](docs/UAT_TESTING.md). Older rollout/pending statements below are historical.

Latest user decision (2026-11-04, demo preparation): **physically organize folders and repair CI in parallel, then deploy UAT only after the existing gates pass.** Follow [flowBoardTasks.md](flowBoardTasks.md). Historical worktrees now live under main `archive/worktrees`; numbered current-doc links live in `project-docs`. Exact candidate `d1c81f42fe306c352c9cb10f04883e251ead58bd` is published to GitHub `uat`; full Linux CI and all98 independent Backend/current local UI/integration revalidations now pass. Production is excluded.

Current release state: source `bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a` contains the seven-file portability/cutoff repair, but the latest reported Linux run 41685962254 failed maximum-length XLSX validation (422 `PARSE_BUDGET_EXCEEDED`, expected 201). Root cause is not established. Historical c1 local98Backend/74requiredUI/98integration and all14-command results remain [exact-source historical evidence](docs/reviews/FULL-REVALIDATION-20261103/LOCAL-RELEASE-GATE.json), not current approval. The generated checklist correctly reopens all98 for review. The narrow decoder repair now has focused builder/independent passing evidence; finish complete Linux gates and independent current-target reviews/rebindings before UAT. Verified encrypted backup exists outside Git; refresh before migration. No UAT migration, storage-policy edit or Worker/Pages deployment from this release has occurred. Production is excluded.

Current authorized release task (2026-11-03): revalidate all98 product features with real source-bound evidence, repair mandatory gaps, obtain fresh independent review and freeze the candidate, then publish directly to UAT and finish hosted tests. Follow [the execution plan](docs/reviews/FULL-REVALIDATION-20261103/PLAN.md). Do not manually close generated checklist entries. Hosted acceptance remains UAT pending until executed; older completion/score statements below are historical. Production is excluded.

Latest instruction (resumed 2026-11-03): continue from [the checkpoint](docs/reviews/FULL-REVALIDATION-20261103/CHECKPOINT-20261103.md), finish pending checks and independent reviews, deploy the approved candidate directly to UAT, then deliver MCP testing steps. Final closure/deployment gates remain pending until executed. [Destination and machine-identity requirements](docs/decisions/2026-11-03-integration-destination-and-machine-identity.md) capture the user's company client-credentials requirement and future MCP update capability; neither is claimed implemented.

## MCP repair — 2026-11-03

Task `MCP-HARDENING` repairs the eight findings from the independent review of `62ce05f`. Frozen acceptance: [criteria](docs/reviews/MCP-REPAIR-20261103/criteria.json). The exact source manifest, independent verdict and command results govern closure; this entry is not a backend/UI feature approval.

- Implement the token route boundary, metadata-only discovery, scoped pagination, stable create retries, canonical Owner issuance, correct search, reproducible MCP binary/CI and safe activity provenance.
- Run the full local suites and mounted-handler response-loss/concurrency probes against disposable PostgreSQL; preserve actual exit codes.
- Obtain a fresh independent review of the complete frozen source. Apply BACKEND_REVIEW_GATE; do not self-score.
- Promote only the reviewed candidate directly to UAT under the latest explicit user instruction, then perform signed-in acceptance. There is no dev stage for this release. Production remains separate. Company installation/external-issue API implementation follows this repair.

Current result and remaining actions: [repair summary](docs/reviews/MCP-REPAIR-20261103/summary.md).

## Resumed Stage 2 acceptance — 2026-10-26

Gemini's interrupted BRD-01–07, CRD-01–11, COM-01–06 and DEL-01–08 audits were independently resumed using three fresh Luna reviewers with primary-agent supervision. **All three groups failed acceptance; all 32 handoffs are blocked.** See [current reports, exact targets and next bounded repair](docs/reviews/STAGE2-RESUME-20261026/README.md). Existing source and prior reviews are preserved; passing existing tests is not feature approval.

Repair round 1 is complete as a code slice but not as feature acceptance. Three fresh audits rechecked the same 161-file target and still failed: BRD 7.400, CRD 7.345, COM/DEL 6.655. See [repair round 1 and re-audit](docs/reviews/STAGE2-REPAIR-20261026/README.md). Current-grant replay, minimal receipts and same-key card create were verified; archive/lifecycle guards, canonical movement/cursors, copied-content cleanup and real purge remain open. All 32 handoffs stay blocked until complete feature acceptance passes.

Repair round 2 added archived-context write guards, operation-equivalent comment-delete replay permissions, current comment lifecycle checks before replay, and stable comment pagination. Full check passed (typecheck, Worker dry-run, API 235/235, contracts 41/41), but the fresh group audits still failed: BRD 7.810, CRD 7.135, COM/DEL 6.775. Board/card cursor binding, card rank and placement rules, overdue search, trash/replay concurrency, purge/cleanup, private content retention, bounded trash and restore placement remain open. See [round 2 evidence](docs/reviews/STAGE2-REPAIR-20261026/README.md). All 32 handoffs remain blocked. The backend gate's three-failed-round limit has been reached; preserve the reports and request a concrete Architect/user decision before another automatic review cycle.

## Audit hold — 2026-10-26

The backend at `a7153456294b166f2c0c1684d6b257a6f35caa76` fails independent acceptance. Preserve older implementation claims as history; they do not authorize new UI integration or deployment. Follow BACKEND_REVIEW_GATE.md and docs/reviews/README.md. Historical handoffs need independent review before reapproval.

- [ ] R1: Remove unconditional email-only session issuance from the normal application; choose and verify real identity. Test actual mounted routes and claimed runtimes.
- [x] R2: Prevent pending invitations from restoring deliberately removed access; test self-invites, existing members and fresh authorized reinvites.
- [ ] R3: Serialize actual protected writes with actor-grant revocation and target-role changes; test concurrent PostgreSQL requests through mounted handlers.
- [x] R4: Inject one coherent DB dependency into Node/Worker product routes, health checks and shutdown; test authenticated Worker product routes.
- [x] R5: Reconcile mandatory idempotency, invitation response schemas, logout status, receipt expiry/token copies and bounded lists with the shared API contract. Preserve requirements unless Architect records a deliberate change.
- [ ] R6: Strengthen PostgreSQL ancestry/owner constraints and migration failure/concurrency evidence; distinguish dormant table design from implemented features.
- [ ] R7: Re-review affected features with immutable manifests, passing evidence and independent records; then resume Backend → UI → integration one feature at a time.

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
   - [x] PRJ-02, PRJ-03, PRJ-05 — Backend: Project list/nav (keyset cursor), settings (OCC), people directory (synthesized owner). Audited at 10.0/10.0.
   - [x] INV-01 — Backend: Project invitation (Owner/PM invitation permissions, SHA-256 token hashing, outbox event). Audited at 10.0/10.0.
   - [ ] INV-02 — Project invitation delivery (outbox delivery worker).
   - [x] INV-03 — Backend: Accept matching invitation (FOR UPDATE row lock, matching email check, active membership creation). Audited at 10.0/10.0.
   - [x] INV-04, INV-05 — Backend: Resend/revoke invitations (token rotation, outbox event, FOR UPDATE), pending invitations list. Audited at 10.0/10.0 and 9.7/10.0.
   - [x] INV-06 — Backend: Change member roles (Owner appoints/removes managers, PM modifies member/viewer, self/peer protection, OCC with expectedVersion). Audited at 10.0/10.0.
   - [x] INV-07 — Backend: Remove project access (immediate revocation sets status 'removed', subsequent calls return 404 NOT_FOUND). Audited at 10.0/10.0.
   - [x] INV-08 — Backend: Leave a project (voluntary exit, status 'removed', owner protection). Audited at 10.0/10.0.
   - [x] RBAC-02 to RBAC-05 — Backend: Ancestry enforcement (uniform 404), FOR SHARE lock protocol, picker privacy (assignee/mentionee scoping), inheritance disclosure. Audited at 10.0/10.0.
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
