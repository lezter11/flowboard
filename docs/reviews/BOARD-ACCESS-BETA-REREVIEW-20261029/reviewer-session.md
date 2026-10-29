# Reviewer Session Evidence: BOARD-ACCESS-BETA-REREVIEW-20261029

Reviewer: actorId `independent-reviewer-gemini`, model `gemini-2.5-pro`, sessionId `review-session-7e44e3cf-29d2-4f7d-858a-20261029`.
Implementer (not this reviewer): actorId `backend-chat`, sessionId `cc5e8cdb-backend-gapfix-20261028`, model `claude-sonnet-5-5`.

Declaration: This reviewer did not implement, edit, commit, or push the target under review. Edits are strictly limited to files within `docs/reviews/BOARD-ACCESS-BETA-REREVIEW-20261029/` (probe scripts, test logs, this session log, the Scope B report, summary, and the final review record) and an append-only entry in `docs/GEMINI_LOG.md`. No network services, live production credentials, hosted deployments, or databases other than the isolated synthetic PostgreSQL 17 on `127.0.0.1:55488` were accessed or modified. The main repository source code was evaluated read-only.

H12 Author Separation Note: The H12 infrastructure files (`.github/workflows/ci.yml`, `docs/MONITORING.md`, and the `localConnectionString` edit in `apps/api/wrangler.jsonc`) were authored in this parent conversation. Per Rule 0.2, they are declared as "reviewed by author, not independent" and treated as an explicit coverage gap.

---

## Target
- Review target commit: `6e15bd0` (on branch `chore/baseline-2026-10-28`).
- `git status` at review start: Clean working tree.
- Scope roots: `apps/api/src`, `apps/api/test`, `apps/api/package.json`, `apps/api/tsconfig.build.json`, `apps/api/wrangler.jsonc`, `apps/web/functions`, `database/migrations`, `packages/contracts/src`, `packages/contracts/test`, `packages/contracts/package.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `scripts/check_backend_review.py`, `scripts/generate_review_record.py`, `BACKEND_REVIEW_GATE.md`, `RULES.md`, `AGENTS.md`, and review artifacts in `docs/reviews/BOARD-ACCESS-BETA-REREVIEW-20261029/`.

---

## What I Read (Fresh Independent Context)
1. Governance & Rules: `BACKEND_REVIEW_GATE.md`, `RULES.md`, `AGENTS.md`, `docs/FEATURE_SPEC.md`, `docs/API.md`, `docs/IMPORT_SPEC.md`, `docs/decisions/2026-10-28-beta-risk-acceptance.md`, `docs/GEMINI_HANDOFF.md`, `docs/GEMINI_REVIEW_HANDOVER.md`.
2. Prior Review History: `docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/` (criteria, record, findings R3-01 to R3-14, probe logs).
3. Backend Adapters: `apps/api/src/adapters/{session,postgres,rbac,boards,cards,comments,imports,images,trash,activity,notifications,board-grants-foundation,idempotency,embedded-migrations}.ts`.
4. HTTP Routes & Middleware: `apps/api/src/http/{app,errors,admin-secret}.ts`, `apps/api/src/http/middleware/{auth,origin,timing,correlation,limits,error-handler}.ts`, `apps/api/src/http/routes/{google-auth,session,boards,board-grants,cards,comments,imports,images,trash,activity,notifications,system,projects,members,invitations,workspaces}.ts`.
5. Frontend Proxy & Security: `apps/web/functions/api/[[path]].ts`, `apps/web/functions/boards/[id].ts`, `apps/web/functions/projects/[id].ts`, `apps/web/src/components/invitation/accept-screen.tsx`, `apps/web/src/app/signin/page.tsx`, `apps/web/src/app/layout.tsx`.
6. Migrations & Contracts: `database/migrations/0001..0010`, `packages/contracts/src/*`.

---

## What I Ran & Verified (All Raw Logs Retained)

1. **Complete Test Suite (`reviewer-complete-suite.log`)**:
   - Command: `DATABASE_URL="postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55488/flowboard_harness" FLOWBOARD_ACCESS_TEST_DATABASE_URL="postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55488/flowboard_access_test" npm run check`
   - Exit code: `0`
   - Test Counts:
     - `@flowboard/contracts`: **41 passed, 0 skipped, 0 failed**
     - `@flowboard/api`: **409 passed, 0 skipped, 0 failed** (all 13 previously skipped suites executed and passed against disposable test database)
     - Total: **450 tests passed, 0 skipped, 0 failed**

2. **Forced Concurrency & Deadlock Probe (`probe-concurrency-and-deadlocks.log`)**:
   - Command: `probe-concurrency-and-deadlocks.ts`
   - Exit code: `0`
   - Exercised 10 forced interleaving rounds of `moveCard` versus `editComment` (PATCH) and 10 rounds of `moveCard` versus `deleteComment` (DELETE) with a helper connection holding the board row `FOR UPDATE`.
   - Measured `pg_stat_database.deadlocks` delta: **0** (down from 30 in R3). Proves lock order inversion is resolved.

3. **Replay-After-Revocation Probe (`probe-replay-and-revocation.log`)**:
   - Command: `probe-replay-and-revocation.ts`
   - Exit code: `0`
   - Verified that after an Owner revokes a member's board grant, cached idempotency replays for card creation and comment creation return `404 NOT_FOUND` and do NOT leak the saved response payload. Direct reads (`GET /boards/:id`, `GET /cards/:id/comments`, `GET /cards/:id/activity`) immediately return 404.

4. **Session Token Hashing & Profile Overwrite Probe (`probe-session-and-auth.log`)**:
   - Command: `probe-session-and-auth.ts`
   - Exit code: `0`
   - Verified that `sessions.id` stores only the SHA-256 hash. The client cookie receives the raw 64-char bearer token. Injecting the leaked database hash into a cookie returns `401 UNAUTHORIZED`.
   - Verified that subsequent Google OAuth sign-in preserves a user's customized `display_name` and updates `avatar_url` only when non-empty.

5. **Origin & Secret Gates Probe (`probe-origin-and-secrets.log`)**:
   - Command: `probe-origin-and-secrets.ts`
   - Exit code: `0`
   - Verified that cross-site Origin on cookie requests returns `403 FORBIDDEN`.
   - Verified that `/api/v1/system/status` returns `403 FORBIDDEN` without a 32+ character admin secret.
   - Verified that `GET /api/v1/boards/:id/access` returns `503 CONFIG_ERROR` when `CURSOR_SECRET` is unset.

---

## Known Limits & Unverified Areas
- **Hosted Third-Party Providers**: Real Google OAuth token endpoints, hosted Cloudflare Hyperdrive, and live production Neon branches were not invoked (prohibited by review rules). Synthetic mocks and local Postgres were used.
- **Dependency Advisory Lookup**: No live vulnerability network lookup was executed during offline analysis; local `npm audit` was evaluated.
- **H12 Files**: Noted as non-independent self-authored files and marked as a coverage gap.
