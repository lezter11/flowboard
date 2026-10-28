# Independent acceptance review: CRD-01 through CRD-11

Date: 2026-10-26  
Verdict: **fail**  
Reviewer: `/root/resume_cards_audit`, GPT-6 Luna; new read-only collaboration task path. Provider session UUID was not exposed and has not been fabricated. See [reviewer-session.md](reviewer-session.md).  
Target: `/private/tmp/flowboard-stage2-resume-a37x7egs`, supplied 71-file SHA-256 manifest. The manifest check found 71 files and zero mismatches; original snapshot files were not edited.  
Criteria: frozen before commands in [criteria.json](criteria.json). Historical CRD scores and handoffs were not used as evidence.

## Actions and outcome

This review traced the actual mounted Node/Worker app, board and card routes, adapters, authentication and project grant locks, idempotency receipts, migrations, API schemas, and the CRD integration tests. It exercised the real mounted handlers against only the dedicated synthetic PostgreSQL fixture on `127.0.0.1:55437` after the parent confirmed it healthy.

A receipt is the server's saved answer to a retry. In Flowboard, a member can create a card, lose project access, and later retry the same request after a timeout. The server must check that the member still belongs to that project before returning the saved answer. The current route returns the private card before it performs that check, so the review fails on a confirmed authorization defect.

## Feature-by-feature result

| Feature | Result | Evidence and limit |
|---|---|---|
| CRD-01 Quick create | **Fail** | Group suite create/role/title/rank checks pass. Real route accepts an unknown body key, creates cards while the board or project is archived, and serves a saved create response after membership removal. Sources: `apps/api/src/http/routes/cards.ts:38-109`, `apps/api/src/adapters/cards.ts:240-374`; runtime evidence in `cards-probes.log` and `replay-repro.log`. |
| CRD-02 Compact summary | **Partial pass** | Summary tests pass. The actual mounted GET is `boardsRoutes` because `app.ts` mounts it before `cardsRoutes`; it returns card summaries through `listBoardCards` (`apps/api/src/http/app.ts:96-103`, `apps/api/src/http/routes/boards.ts:609-620`). Its summary/count behavior is source traced; the dedicated read is not a snapshot transaction and full snapshot/count coverage belongs to BRD-03. |
| CRD-03 Detail/deep link | **Partial pass** | API detail authorization and outsider 404 test pass. The backend route does not verify UI dialog, deep-link, focus, or loading recovery behavior. A stored create receipt exposes detail-like card data after revocation (Finding F-01). |
| CRD-04 Field edit | **Partial pass** | Limits and stale-version behavior pass in the group suite. A real simultaneous pair of PATCH requests returned one 200 and one 409, showing card-row locking/OCC works for this case. Mutation activity is absent (F-06); archived-context writes are not rejected (F-02). |
| CRD-05 Priority/date | **Pass for tested API cases** | Five priorities and real Gregorian date validation are represented in the shared contract and adapter; contract and PostgreSQL suite tests passed valid leap day and invalid calendar dates. Hosted timezone behavior was not tested. |
| CRD-06 Assignees | **Pass for tested API cases** | PostgreSQL suite passed eligible assignments, duplicate/max bounds and outsider/sibling/removed rejection. Detail reads use scoped person display logic. No hosted identity-provider or UI picker behavior was exercised. |
| CRD-07 Drag/reorder | **Fail** | Valid rank and version examples pass sequential tests. The adapter trusts neighbor IDs without verifying they are adjacent, and treats `(null,null)` as empty without checking destination emptiness (`apps/api/src/adapters/cards.ts:675-770`). A mounted move to a populated column with both neighbors null returned 200 and left three active cards at rank 1000 (`cards-probes.log`). No real concurrent move test exists in the frozen suite. |
| CRD-08 Click/tap/keyboard Move | **Backend incomplete** | Placement examples pass, but the actual mounted placement endpoint uses `boardsRoutes` (`apps/api/src/http/app.ts:96-103`, `apps/api/src/http/routes/boards.ts:586-607`, `apps/api/src/adapters/boards.ts:740-821`). It returns 200 for `movingCardId=not-a-card` because it never resolves or validates that card. Keyboard/tap interaction is UI evidence and was not claimed. |
| CRD-09 Filtered movement | **Partial pass** | The board snapshot source supports filters and canonical placement lookup, but placement does not validate the moving card and movement accepts nonadjacent neighbors. No browser evidence proves ambiguous filtered drag is disabled or the Move menu uses canonical placement. |
| CRD-10 Concurrent edits/moves | **Partial pass** | Group suite name says “Concurrent” but it sends stale requests sequentially (`apps/api/test/crd01-crd11.test.ts:849-890`). An independent `Promise.all` of real concurrent field edits yielded 200 and 409. This does not establish concurrent move/rank behavior; the populated-column rank defect is confirmed. |
| CRD-11 Save/retry/drafts | **Fail** | Sequential create replay and key-payload conflict pass. Concurrent same-key creates returned `[201,409]`, with no replay flag on the second response and one side effect. More seriously, a revoked actor received 201, `replayed:true`, and the saved private title (F-01). Save/Post/Upload separation and draft preservation require UI testing; no UI evidence was in scope. |

Unknown request fields are silently removed by default Zod object parsing: the mounted create route returned 201 for an extra `unexpectedPayloadField` and omitted it from its parsed effect. The authenticated caller can therefore believe a command was accepted when the server discarded a field. Product/API contracts should reject unknowns or explicitly declare forward-compatible stripping before handoff.

## Findings

### F-01 — Critical: revoked project member can replay a private card response

**Impact:** A member removed from Project A can still retrieve the saved body of a card they created or edited by replaying the same Idempotency-Key. A long description or assignee list can be disclosed. The session remains valid, and the route does not re-check project access before returning the cached body.

**Source:** `apps/api/src/http/routes/cards.ts:53-84` (create) and `:147-179` (update), with analogous ordering in the move route. Each route looks up enough ancestry to find the project receipt scope, calls `checkOrReplayReceipt`, and returns before invoking `createCard`, `updateCard`, or `moveCard`. Those adapters call `acquireWriteGrantLock` only on the non-replay branch (`apps/api/src/adapters/cards.ts:262-263`, `:466-467`, `:644-645`; lock checks removed grants in `apps/api/src/adapters/rbac.ts:292-339`).

**Reproduction:** `replay-repro.mjs` uses the mounted Hono handler and synthetic user/session. First create returned 201. The script changed that synthetic membership to `removed`, replayed the exact same key and body, and observed `replayStatus:201`, `replayed:true`, `replayBodyContainsPrivateTitle:true`. Its assertion expected 404, so the repro process exited 1. A `finally` block restored the grant's original active status. The log contains only statuses and a boolean, no cookie or private response body.

**Counterevidence:** Ordinary new writes do reach the `FOR SHARE` grant lock and reject a removed membership. This narrows the flaw to receipt replay; it does not mitigate that path. The existing suite proves sequential replay while access remains active but does not test revocation before replay.

**Severity/verdict:** Hard blocker under BACKEND_REVIEW_GATE §6: cross-project/private disclosure after access revocation.

### F-02 — High: archived project and board still accept card writes

**Impact:** An archived board/project is specified as read-only, yet a writer can create cards there. Source also has no archive-state guard in update or move adapters, so active cards remain writable after archive.

**Source:** `apps/api/src/adapters/cards.ts:240-263` selects `boards.archived` but does not inspect it; it never reads `projects.archived`. `updateCard` and `moveCard` select cards/board versions without checking archive state (`:444-467`, `:603-645`).

**Reproduction:** `cards-probes.mjs` set each synthetic archive flag true, sent the mounted create request, and observed 201 for both board and project. It restores the original flags and deletes temporary cards in `finally`.

**Counterevidence:** Board/project archive product work is a later feature slice, but the v1 specification already says archive is read-only, and CRD write acceptance explicitly targets active containers. This is an implementation gap, not hosted behavior evidence.

### F-03 — High: move can create rank collisions and does not validate adjacency

**Impact:** The API contract says two null neighbors represent an empty destination and that supplied neighbors must be adjacent. The adapter trusts the request. A malformed or stale client can place a card at rank 1000 inside a populated column or between non-neighbors. Equal ranks make displayed order fall back to IDs and can make later placement ambiguous.

**Source:** `apps/api/src/adapters/cards.ts:675-770` calculates ranks, but `(null,null)` directly maps to 1000 and both-neighbor handling checks only that each card belongs to the destination, not that they are adjacent. Migration `database/migrations/0001_initial.sql` has a non-unique `(column_id, position)` index, not a uniqueness guard.

**Reproduction:** The mounted move endpoint accepted a valid member request with `previousCardId:null,nextCardId:null` for a populated destination. It returned 200 and a PostgreSQL query observed three active cards at position 1000. The synthetic target DB already had earlier test cards; no product data was used.

**Counterevidence:** Normal placement responses compute canonical adjacent neighbors, and valid move examples pass. The server must still validate the client-supplied command because clients can send arbitrary IDs/order.

### F-04 — Medium: unknown request fields silently disappear

**Impact:** A stale or misspelled client field can be ignored while the server returns success, creating false confidence that the requested card value was saved. This also makes schema drift hard to detect.

**Source:** `packages/contracts/src/cards.ts:17-76` uses ordinary `z.object` schemas without strict unknown-key handling; `cards` routes parse the body then execute the parsed object (`apps/api/src/http/routes/cards.ts:48-50`).

**Reproduction:** Mounted create with `unexpectedPayloadField` returned 201; the unexpected key was absent from the returned card. `cards-probes.log` records only status and the discard boolean.

**Counterevidence:** Known fields still receive strict type/range/date validation, and contract tests pass for their cases. The extra field behavior itself is untested in the existing suite.

### F-05 — Medium: parallel same-key retry can receive a conflict instead of the receipt result

**Impact:** During a slow create request, a simultaneous retry with the same command can return 409 stale-board version instead of the original outcome. The client then cannot resolve a lost response through a reliable same-key retry without another GET. This case did not duplicate the card in the observed run.

**Source:** All card mutation routes check for a receipt before taking their card/board write locks (`apps/api/src/http/routes/cards.ts:63-86`, `:158-181`, `:227-249`). The group suite tests only after-the-fact sequential replay.

**Reproduction:** Two simultaneous mounted POSTs with the same actor, key, body and expected board version returned `[201,409]`; both replay flags were false; the database contained one card for that title. `cards-probes.log`.

**Counterevidence:** Receipt insertion's unique constraint and adapter locks prevented duplicate effects in this run. This is a retry-semantics gap, not evidence of duplicate card creation.

### F-06 — High: card mutations produce no activity rows

**Impact:** Create, field Save and move change card data without recording the corresponding activity event. Later card timelines cannot show who created, edited, or moved a card, and the action cannot be atomically coupled to its receipt/version update.

**Source:** `apps/api/src/adapters/cards.ts:318-374`, `:534-565`, and `:772-805` contain the card, assignee, version and receipt-adjacent mutation work but no `activity_log` insert. Search of the mounted card routes/adapters and boards adapter found no activity insert for these card operations.

**Reproduction:** Probe-created cards had zero `activity_log` rows after successful creation (`cards-probes.log`).

**Counterevidence:** Activity is separately tracked as AUD-01/AUD-02, whose full API surface is S3. The product specification still defines card creation/field/move facts as part of card activity, and the frozen review criteria explicitly require mutation+activity atomicity. This review does not claim the absent timeline feature has independent production proof.

### F-07 — Medium: mounted placement accepts a nonexistent moving card

**Impact:** The Move menu can receive a plausible placement response for a card ID that is missing, trashed, or belongs elsewhere. The UI may then build a mutation from invalid state, producing avoidable failures or unsafe assumptions.

**Source:** `boardsRoutes` is mounted before `cardsRoutes` (`apps/api/src/http/app.ts:96-103`). The actual matching placement handler is `apps/api/src/http/routes/boards.ts:586-607`, which calls `apps/api/src/adapters/boards.ts:740-821`. That adapter checks board/column and actor role, then filters active destination cards while excluding the supplied moving ID; it never fetches or validates the moving card.

**Reproduction:** The mounted route returned 200 for `movingCardId=not-a-card` (`cards-probes.log`).

**Counterevidence:** Board and column authorization are checked, and the group suite verifies canonical first/last/before/after values for real cards. The parallel `cardsRoutes` placement implementation is not the handler selected for this method/path.

## Fixed category scores

Scores reflect the whole frozen scope. Weights and minimums are unchanged from BACKEND_REVIEW_GATE.md. The total is unrounded.

| Category | Score | Weight | Weighted points | Minimum | Reason |
|---|---:|---:|---:|---:|---|
| Security and authority boundaries | 4.0 | 30% | 1.200 | 9.0 | Confirmed receipt replay discloses saved card data after membership removal; archived write guards also fail. Ordinary new-write grant lock is useful counterevidence. |
| Functional and API correctness | 6.5 | 25% | 1.625 | 8.5 | Normal create/detail/edit/date/assignment flows pass, but unknown fields are dropped, archived writes succeed, placement accepts missing moving IDs, and malformed neighbor commands can corrupt ranks. |
| Data integrity and concurrency | 5.5 | 15% | 0.825 | 8.5 | Parallel field OCC gives 200/409 and same-key create makes one effect, but same-key parallel retry conflicts, equal ranks are accepted, and card events are absent. No parallel move proof in the frozen suite. |
| Test quality and independent evidence | 5.5 | 15% | 0.825 | 8.5 | Typecheck, 41 contract tests, and 12 CRD group tests pass; new mounted adversarial probes found several untested failures. Full API suite/build were not run by this reviewer. |
| Maintainability and portability | 7.5 | 10% | 0.750 | 7.5 | Shared contracts and app code serve Node/Worker, but overlapping board/card route implementations make actual dispatch easy to misread. This review did not run a Worker production build. |
| Operations, performance and failure recovery | 7.0 | 5% | 0.350 | 7.0 | Source has bounded body/deadline/pool settings; no benchmark or hosted runtime test was authorized. Retry recovery has the gaps above. |
| **Unrounded total** |  | **100%** | **5.575 / 10** | **strictly >8.5** | **Fail.** Security, function, integrity, and evidence minima fail, and F-01 is a hard blocker. |

## Commands and evidence

All source/test commands below used the immutable snapshot; no install, network, cloud service, deployment or Git operation was run. All PostgreSQL access used only the dedicated 55437 fixture. Logs are raw and saved in this directory.

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | 0 | Passed. [`typecheck.log`](typecheck.log) |
| `npm run test --workspace @flowboard/contracts` | 0 | 41 passed, 0 failed/skipped. [`contracts-test.log`](contracts-test.log) |
| `node --test --test-concurrency=1 test/crd01-crd11.test.ts` (cwd `apps/api`) | 0 | 12 passed, 0 failed/skipped against PostgreSQL 17 synthetic fixture on 55437. [`cards-group-test.log`](cards-group-test.log) |
| Mounted revocation/replay repro | 1 (expected failing assertion) | Observed 201 replay with private title after grant removal; membership status restored in `finally`. [`replay-repro.log`](replay-repro.log), [`replay-repro.mjs`](replay-repro.mjs) |
| Mounted cards probes | 1 (expected failing assertions) | Confirmed unknown-field acceptance, archived writes, invalid moving-card placement, rank collision, parallel edit OCC, same-key parallel create conflict, and zero creation activity rows. [`cards-probes.log`](cards-probes.log), [`cards-probes.mjs`](cards-probes.mjs) |
| `npm run build --workspace @flowboard/api` | Not run | Its script invokes `wrangler deploy --dry-run`; parent instructions prohibited deployment commands. Worker build therefore remains an explicit coverage gap. |

The first unprivileged database test attempt was blocked by sandbox `EPERM` before the server accepted a connection. After the parent confirmed the disposable fixture healthy, the same group command ran with the required sandbox review and passed. No database URI or session cookie was written to the evidence logs.

## Coverage gaps

- UI dialog/deep-link, focus restoration, keyboard/tap Move, filtered drag disablement, draft retention, Save/Post/Upload separation and browser rollback were not verified. Backend evidence cannot stand in for those checks.
- No full Node HTTP or Worker `workerd` card-route run or Worker build was executed by this reviewer. The tested CRD route group used the real Hono mounted handler against PostgreSQL.
- No hosted OAuth, Cloudflare, Hyperdrive, production database, image/object storage, performance benchmark, or dependency advisory check was performed.
- The frozen CRD suite's “concurrent” cases are sequential stale-version requests. The independent concurrent field-edit probe is positive evidence for that one lock/OCC path only; move concurrency remains unproved.
- The review does not claim every UI or S3 timeline acceptance criterion implemented. It marks them unverified and reports missing card mutation audit events as a source-backed gap.

## Why this matters and next step

For example, if Priya is removed from the Website project, her old valid session must not allow her to retry a card Save and receive the saved card body from the receipt table. The server should re-check her active project grant inside the replay path, under the same revocation ordering rules used for a new write. Fixing the confirmed blockers requires a new source manifest, fresh isolated regression tests for the replay, archive, adjacency, unknown-field and activity cases, and another independent review. This report does not authorize a verified Backend handoff or checklist closure.
