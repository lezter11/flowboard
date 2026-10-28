# Independent backend acceptance review round 8 - PASS

Reviewer: /root/backend_gate_round8, orchestration-task:/root/backend_gate_round8. Fresh reviewer assignment; no target source/test edits. Inherited Codex/Gemini auditor agent; independent read-only reviewer. Builder identity follows prior round declaration (/root, parent-chat-current-turn:/root).

## 1. Actions

1. Independently executed the complete test suite against the authorized synthetic local PostgreSQL databases at loopback port 55479 using:
   `DATABASE_URL=postgres://flowboard_harness:synthetic_harness_only@127.0.0.1:55479/flowboard_harness FLOWBOARD_ACCESS_TEST_DATABASE_URL=postgres://flowboard_test:synthetic_test_only@127.0.0.1:55479/flowboard_access_test npm run check`
   - Exit code 0.
   - Typecheck (`tsc --noEmit`) succeeded without diagnostic errors.
   - Worker build and deploy dry-run (`tsc -p tsconfig.build.json && wrangler deploy --dry-run --outdir dist/worker`) succeeded without errors.
   - 366 API tests passed, 0 failed, 0 skipped.
   - 41 contract schema tests passed, 0 failed, 0 skipped.
   - Full test log captured in `docs/reviews/BOARD-ACCESS-REPAIR-20261028/reviewer-complete-suite-round-8.log`.

2. Independently executed adversarial probe suite `reviewer-probes-round-8.ts` in an isolated schema in `flowboard_access_test`:
   `node docs/reviews/BOARD-ACCESS-REPAIR-20261028/reviewer-probes-round-8.ts`
   - Exit code 0.
   - Captured in `docs/reviews/BOARD-ACCESS-REPAIR-20261028/reviewer-probes-round-8.log`.

## 2. Findings disposition

- **BAR7-01 HIGH: Project create/archive/reopen use cached Owner authority without holding workspace ownership lock until commit.**
  - *Disposition*: **Resolved**.
  - *Verification*: `apps/api/src/http/routes/projects.ts` was repaired. Project create acquires `SELECT owner_id FROM workspaces WHERE id = $1 FOR SHARE` inside the mutating transaction before checking/replaying receipts and before inserting the project. Project archive and reopen execute `lockProjectOwner(client, projectId, actor.id, ...)` which queries `SELECT w.owner_id, pm.role FROM projects p JOIN workspaces w ON w.id = p.workspace_id LEFT JOIN project_memberships pm ... FOR SHARE OF w`. If the actor is not the current workspace owner, it returns 404 (or 403 if they retain non-owner membership). Because `transferWorkspaceOwnership` acquires `FOR UPDATE` on `workspaces`, any concurrent ownership transfer is properly serialized. The former owner cannot create, archive, or reopen projects after ownership transfer. Verified in `apps/api/test/board-access.test.ts` (test 1389) and in `reviewer-probes-round-8.ts`.

- **BAR7-02 HIGH: Invitation creation uses cached project/Owner/Manager authority without a retained lock.**
  - *Disposition*: **Resolved**.
  - *Verification*: In `apps/api/src/http/routes/invitations.ts` and `apps/api/src/adapters/invitations.ts`, invitation creation acquires `acquireWriteGrantLock(client, projectId, actor.id, 'manager')` which queries with `FOR SHARE OF w` on the workspace table. Crucially, lines 54-56 enforce: `if (!grant.isOwner && body.role === 'manager') throw HttpError.forbidden('Only workspace owners can invite managers.', 'FORBIDDEN');`. Analogous authority checks and locks are enforced on resend and revoke: managers cannot resend or revoke invitations for manager roles, and all queries hold `FOR SHARE OF w`. Former owners receive 404; managers attempting to invite/resend/revoke manager invitations receive 403. Verified in test suite and `reviewer-probes-round-8.ts`.

- **BAR7-03 HIGH: Project membership and invitation retry receipts return before current authorization.**
  - *Disposition*: **Resolved**.
  - *Verification*: In `apps/api/src/http/routes/members.ts`, both PATCH and DELETE routes now invoke `authorizeMemberReplay(client, projectId, actor.id, userId, ...)` when an idempotency receipt match is found. `authorizeMemberReplay` executes `acquireWriteGrantLock(client, projectId, actorId, 'manager')` (holding `FOR SHARE OF w`) and verifies protected target rules (cannot modify self, workspace owner, or other managers unless owner, and cannot appoint manager unless owner). In `apps/api/src/http/routes/invitations.ts`, invitation creation replay requires `acquireWriteGrantLock` before receipt lookup, and invitation acceptance replay (lines 152-168) explicitly queries the project and workspace tables holding `FOR SHARE OF w` to verify that the actor remains active (`check.owner_id === actor.id || check.member_status === 'active'`); if revoked, it throws 404 NOT_FOUND. Revoked actors or former owners can no longer recover saved private receipt payloads. Verified in `reviewer-probes-round-8.ts`.

- **BAR7-04 HIGH: Invitation directory reads cached Owner/Manager authority, then fetches private email/role/inviter identities after ownership transfer.**
  - *Disposition*: **Resolved**.
  - *Verification*: In `apps/api/src/http/routes/invitations.ts`, `GET /projects/:projectId/invitations` now runs within a database transaction that executes `acquireWriteGrantLock(client, projectId, actor.id, 'manager')` before calling `listInvitations`. In `apps/api/src/adapters/invitations.ts`, `listInvitations` queries workspace ownership with `FOR SHARE OF w`. A former owner who transferred workspace ownership receives 404 NOT_FOUND and cannot inspect pending invitations or directory email addresses. Verified in test suite and `reviewer-probes-round-8.ts`.

- **BAR6-01, BAR6-02, BAR6-03**:
  - *Disposition*: **Resolved** (re-verified passing in suite and independent probes).

## 3. Scope and counterevidence

- A complete source review of all routes under `apps/api/src/http/routes` (`projects.ts`, `members.ts`, `invitations.ts`, `boards.ts`, `cards.ts`, `comments.ts`, `images.ts`, `imports.ts`, `trash.ts`, `notifications.ts`, `activity.ts`, `workspaces.ts`, `session.ts`) was conducted.
- Authorization and concurrency helpers under `apps/api/src/adapters` (`rbac.ts`, `idempotency.ts`, `board-grants-foundation.ts`, `invitations.ts`, `members.ts`, `projects.ts`, `boards.ts`, `cards.ts`, `trash.ts`) were verified.
- Schemas under `packages/contracts/src` were validated against all mounted inputs and responses.
- Database migrations 0001 through 0008 were verified on isolated PostgreSQL.
- Both Node and Cloudflare Worker runtime entry points and scheduled lease processor (`processOutboxLease`) were checked.
- Counterevidence checked: We specifically confirmed that `FOR SHARE` locks on parent tables (`workspaces`, `projects`) prevent concurrent privilege escalations during pending mutations, and that replay fences re-authorize current permissions so idempotency receipts cannot be weaponized as an exfiltration backdoor.

## 4. Why and options (plain-English system design)

When a web application uses an "idempotency key" to ensure an operation isn't accidentally performed twice (e.g., charging a card or adding a user twice when a network connection drops), it stores a "receipt" of the first successful response. If the client retries with the same key, the server can simply return the saved receipt instead of repeating the work.

However, a serious security flaw arises if the server blindly replays that saved receipt without first verifying that the user **still has permission right now**. Suppose an administrator was fired or an owner transferred their workspace to someone else. If they retry an old request with a saved idempotency key, a naive server might hand back the saved success receipt—leaking private member IDs, project configuration, or invitation tokens—even though the user is no longer allowed in that workspace!

In Flowboard, we solve this by placing an **authorization and lock gate before receipt replay**. Before returning any saved receipt, the server starts a transaction, acquires a row-level shared lock (`FOR SHARE OF w`) on the workspace, and checks that the user is currently an active owner or manager with authority over that specific resource. If their access was revoked, the replay immediately fails closed with a private `404 Not Found`.

- **Benefit**: Zero information leakage through replay caches; strict fail-closed security.
- **Drawback**: Replay requires a database query to re-verify permissions rather than a purely static cache lookup.
- **Alternative considered**: Storing an expiration timestamp on receipts or clearing receipts upon membership revocation. This alternative was rejected because clearing receipts across distributed records is prone to race conditions, whereas transactional row locking on the authority parent is provably atomic.

## 5. Evidence and limits

- All tests were run against disposable synthetic databases on loopback port 55479.
- No live production databases or credentials were used.
- Exit code 0 across 366 API tests, 41 contract tests, typecheck, and worker deploy dry-run.
- Independent adversarial probe script `reviewer-probes-round-8.ts` passed 100%.

## 6. Scoring rubric

| Category | Weight | Minimum | Score | Rationale |
|---|---:|---:|---:|---|
| Security and authority boundaries | 30 | 9.0 | **9.3** | Real session identity verified; workspace and project owner boundaries strictly enforced with transactional `FOR SHARE OF w` locks; manager invitation creation, resending, and revocation restricted to workspace owners; receipt replay gates prevent data recovery after authority loss; non-enumerating 404 responses for all unauthorized actors. |
| Functional and API correctness | 25 | 8.5 | **9.2** | Full per-board access cutover implemented across Node and Worker runtimes; project lifecycle operations (create, archive, reopen, settings) correctly serialized with workspace ownership; invitation workflows adhere to exact contract schemas; 41 contract suites and 366 API tests pass cleanly. |
| Data integrity and concurrency | 15 | 8.5 | **9.4** | PostgreSQL row-level locks (`FOR SHARE OF w`, `FOR UPDATE`, `FOR SHARE`) guarantee atomic authorization; receipt save/replay is strictly transactional; outbox events and state changes are unified in single transactions; OCC versions prevent lost updates. |
| Test quality and independent evidence | 15 | 8.5 | **9.5** | 366 API tests and 41 contract tests run without skips; dedicated BAR7 regression test suite passes on isolated PostgreSQL; independent adversarial probes (`reviewer-probes-round-8.ts`) verify all 5 repair areas. |
| Maintainability and portability | 10 | 7.5 | **9.0** | Clean modular monolith; shared authorization and locking helpers (`acquireWriteGrantLock`, `lockProjectOwner`, `checkOrReplayReceipt`); strict TypeScript type coverage; robust error propagation via HttpError. |
| Operations, performance and failure recovery | 5 | 7.0 | **8.5** | Both Node HTTP and Cloudflare Worker runtimes supported; pool connections and schemas safely scoped and cleaned up; outbox processor fails closed without leaking notifications when schema is missing; worker dry-run deploy passes. |

**Weighted Score**:
(30 × 9.3 + 25 × 9.2 + 15 × 9.4 + 15 × 9.5 + 10 × 9.0 + 5 × 8.5) / 100
= (279.0 + 230.0 + 141.0 + 142.5 + 90.0 + 42.5) / 100
= **9.25 / 10.0**

All category minimums are met.
Weighted score 9.25 is strictly greater than 8.5.
Zero hard blockers. Zero coverage gaps.
Verdict: **PASS**.

## 7. Next / your input

Task 1/2 and Step 3 acceptance criteria are satisfied. The independent review record has been validated using `scripts/check_backend_review.py`. The backend handoff is ready to proceed to UI integration. No further reviewer action needed.
