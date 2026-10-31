# Own projects backend: handover to Codex (31 October 2026)

Status: handover, not a verification record. Nothing here is independently reviewed under BACKEND_REVIEW_GATE.md. Local branch `chore/baseline-2026-10-28`, nothing pushed, nothing deployed, no database touched by this handover.

Read first: [own-projects-and-roles-cases-2026-10-31.md](own-projects-and-roles-cases-2026-10-31.md) (sections 3, 7, 8), [own-projects-decisions-2026-10-31.md](own-projects-decisions-2026-10-31.md), [own-projects-edge-cases-2026-10-31.md](own-projects-edge-cases-2026-10-31.md) (section 2 is the binding limit rules; section 3 is the findings table).

## 1. What is committed (this session, backend)

| Commit | Task | What it does | Verified |
|---|---|---|---|
| `685df94` | B-15 | Invitation email as the In progress card; dark mode; contrast in both themes | API 675/675 at the time |
| `9cc49a9` | B-16 | Migration 0018 (first, last, name_confirmed_at); Google suggestions; `needsName` on session; `PATCH /api/v1/session/name`; `409 NAME_REQUIRED` on accept | API 700/700 (access suite on); contracts 105/105 |
| `a66976f` | B-17 contract | `POST /api/v1/projects` input (strict, no workspaceId); `QUOTA_EXCEEDED` details; `RATE_LIMITED`; session `limits` and per-project `isOwned` (optional, additive) | contracts 108/108 |
| `e6fb32b` | B-17 helper | `ensurePersonalWorkspace` (user quota lock, deterministic primary, fixed name "Personal workspace"); Google callback uses it; limits parser `FB_LIMIT_*`; quota adapter | API 704/704 (access suite on) |

Commit `7c36c03` (S-22.1, UI name step) is another session's work. Do not revert it.

Contract shapes for the UI were already sent to the Architect (message after `a66976f`).

## 2. Uncommitted in the working tree (mine, typecheck 0, NOT yet tested)

These are partial B-18 edits. They compile (`npm run typecheck` exit 0 after the last edit) but no test run has covered them.

- `apps/api/src/adapters/own-projects.ts` (new): `assertOwnedProjectRoom` (owned cap, count includes archived = no), `consumeProjectCreateWindows`, `insertProjectRow` (shared insert), `projectKeyPrefix` (3 letters, same as before).
- `apps/api/src/adapters/rate-limit-postgres.ts`: `consumeActorWindows` (per actor id, throws 429 `RATE_LIMITED`); `consumeInvitationScopeLimits` now throws `RATE_LIMITED` (was `TOO_MANY_REQUESTS`).
- `apps/api/src/services/rate-limit.ts`: buckets `project-create` 5/60s, `project-create-hour` 30/3600s, `board-create` 10/60s, `board-create-hour` 60/3600s.
- `apps/api/src/http/middleware/rate-limit.ts` and tests `observability.test.ts`, `rate-limit.test.ts`, `b7-invite-scope-limits.test.ts`: 429 code aligned to `RATE_LIMITED`. Test titles still say TOO_MANY_REQUESTS in two places (cosmetic).
- `apps/api/src/http/routes/projects.ts`:
  - NEW `POST /api/v1/projects`: user quota lock, ensure workspace, actor-scoped replay, project-create windows, owned cap, insert, receipt. Idempotency required.
  - Old `POST /api/v1/workspaces/:id/projects`: user quota lock before the workspace row lock; same windows and cap; shared insert.
  - `POST /api/v1/projects/:id/reopen`: user quota lock first; the cap is checked only when the project is archived.
- `apps/api/src/http/routes/boards.ts`:
  - `POST /api/v1/projects/:id/boards`: project quota lock after BEGIN; replay; board-create windows; cap (`current` only for Owner); insert; creator grant for Manager.
  - `POST /api/v1/boards/:id/reopen`: project quota lock before row locks (project id from an unlocked read); `acquireWritableProjectContextLock` (refuses archived project, closes F-30 for reopen); cap for un-archive.
- `apps/api/src/adapters/board-grants-foundation.ts`: `grantCreatorBoardAccess` (B-19): inserts one grant for the new board, `granted_by` = creator, bumps `access_revision`, audit row `board_access_granted` with `safeChanges.source = 'creator'`.

Known gaps in these edits to check first:
- `boards.ts` imports `lockBoardAccess as lockBoardAccessForQuota`, which is unused. Remove it or the lint will complain.
- The board-create route resolves the role after the replay check. Confirm `checkOrReplayProjectWriteReceipt` (minRole manager) already returns 403 for Member/Viewer, and that the test proves it.
- The reopen route's cap check runs after the replay branch, so replays are never refused. Confirm with a test.

## 3. Not started

| Task | What is left | Notes |
|---|---|---|
| B-18 tests | Cap tests (4th owned, 6th board, archive then create, concurrent creates never exceed, replay at cap returns original, reopen refused at cap, grandfathered over-limit data) | See addendum section 5 of the edge doc |
| B-18 env docs | `docs/API.md` and `wrangler` comments for `FB_LIMIT_*` | Names differ from the first Architect message (`MAX_*`); see decisions |
| B-18 session | `GET /api/v1/session` must return `limits` and `isOwned` (contract exists, route does not fill it yet) | `session.ts` `GET /` |
| B-19 doc | Dated amendment line in `docs/handoffs/proposals/board-access-decisions-2026-10-27.md` (edge doc F-12 names lines 7 and 16) | Required by the Architect |
| B-20 | Close `POST /api/v1/workspaces` (410, typed code); restrict `GET /api/v1/workspaces` to owned; disable `POST /api/v1/workspaces/:id/transfer-ownership` (F-06, 410) | Callers: 7 test files and 3 audit scripts use the POST as fixture setup (F-20). Replace with a fixture helper that calls `ensurePersonalWorkspace` or inserts directly. Web does not call it. |
| B-21 | Migration `0019`: create personal workspace for users without one (idempotent: `NOT EXISTS`, deterministic id `ws_` + md5 of user id); index `idx_workspaces_owner`; nullable `boards.created_by` (F-22). Migration test: second run inserts 0 rows | Deployment counts users without a workspace read-only first |
| B-22 | Member cap (active, owner excluded) and pending cap (unexpired pending; create and resend refuse at `pending >= 50` or `active + pending >= 50`; accept refuses at `active >= 50`). Resend spends `invite-inviter` and `invite-project` buckets and refuses expired invitations (F-07). Lock order for accept and resend: project quota lock first, then invitation row (F-04) | `invitations.ts` create, resend, accept |
| Accept gaps | Accept into archived project: `409 READ_ONLY_CONTEXT` (F-18). Invite with `needsName`: `409 NAME_REQUIRED` on invite create (F-24) | `invitations.ts` |
| Names rule | Project and board names refuse the B-16 character set (F-17, U+202E, U+200B). Email strips `\p{Cf}` too | contracts `projects.ts`, `boards.ts`; `invitation-email.ts` |
| Matrix | Update the route-authorization probe inputs if new routes need entries; document new routes in `docs/API.md` | The matrix is a probe under `docs/reviews/`, not a test (see decisions) |
| Docs | `docs/API.md`: POST /api/v1/projects, QUOTA_EXCEEDED shapes, limits, `RATE_LIMITED`, retired routes, grant creator rule | |

## 4. Edge-case findings: status

Closed in code (uncommitted, needs tests): F-01 (both create routes), F-02 (board create lock order), F-03 (user lock before row locks), F-09 (both reopen routes), F-10 (current only for Owner on boards), F-12 (creator grant only from createBoard, audited), F-16 (env parse), F-19 (replay before rate limit), F-30 (reopen refuses archived project), F-31 (429 code aligned).

Still to do (blockers and highs must be closed before the commit that ends this work):
- F-04 blocker: accept and resend lock order (project lock, then invitation row). Not started.
- F-06 high: disable transfer-ownership. Not started.
- F-07 high: resend rate limit and expired-invitation refusal. Not started.
- F-11 high: invite and accept caps under concurrency. Not started.
- F-05 high: fixed workspace name. Done in helper (`e6fb32b`). Backfill (0019) must use the same fixed name. Not started.
- F-08 high: no backstop totals (not approved). Board-create rate limit is implemented per rule 14 (see decisions).

Medium and low: F-13 (is_personal flag, deferred, see decisions), F-14 (UI key per dialog, UI chat), F-15 (done via helper), F-17 (not started), F-18 (not started), F-20 (not started, big), F-21 (doc note), F-22 (migration 0019), F-23 (UI chat), F-24 (not started), F-25 (count excludes owner; done in count), F-26 (doc note), F-27 (index in 0019), F-28 (doc note), F-29 (ensure not in accept, done by omission; reply to Architect), F-30 (done for reopen; archive path to check).

## 5. Decisions and deviations to confirm with the Architect

1. Scope names: first message names used (`owned_projects`, `boards_per_project`, `members`, `pending_invitations`). Edge doc rule 16 uses different names. Not yet confirmed.
2. Env names: `FB_LIMIT_OWNED_PROJECTS`, `FB_LIMIT_BOARDS_PER_PROJECT`, `FB_LIMIT_MEMBERS_PER_PROJECT`, `FB_LIMIT_PENDING_INVITES_PER_PROJECT` (edge doc rule 15), not `MAX_*` from the B-18 message. Already told the Architect.
3. Board-create and project-create rate limits and seat reservation (`active + pending`) are in edge doc rule 14 and 6, but the doc's own section 6 calls them proposals needing the user's yes. Implemented as written in the binding section 2, to be confirmed.
4. Backstop totals (20 projects, 25 boards including archived) are NOT implemented. The addendum says do not implement unless the user says yes.
5. F-29: invitation accept does not call `ensurePersonalWorkspace` (B-17 asked for it). Reason: accept needs no workspace and adds a lock-order case. Needs Architect confirmation.
6. F-13 (is_personal flag): deferred. Decision 4 chose helper plus lock. Transfer is being disabled (F-06), so a second owned workspace can no longer arise, which removes the risk.
7. `RATE_LIMITED` replaces `TOO_MANY_REQUESTS` everywhere (F-31). Tests updated.
8. Matrix: the route-authorization matrix is a probe script in `docs/reviews/GEMINI-AUDIT-20261030/probes/execute-route-matrix.mjs` with a dated JSON, not an automated test. No test fails when a route is missing. The Architect asked for the matrix test to be updated; the honest state is that no such test exists. Ask before adding a coverage test.
9. Closing routes: use 410 with a typed code for the retired POST /workspaces and transfer-ownership (Architect allowed 404 or 410). Not yet implemented.

## 6. Concurrency rules the code must keep

- Quota advisory locks first, before any row lock: user (`fb:quota:user:<id>`), then project (`fb:quota:project:<id>`). `ensurePersonalWorkspace` takes the user lock again; re-entrant within one session, which is intended.
- Then the existing authorization locks, then the idempotency replay, then the rate windows, then the count, then the insert.
- Never take a row lock and then upgrade it to an advisory or FOR UPDATE lock on the same row (F-02 deadlock). Never take the invitation row before the project quota lock (F-04).
- Replays must never be refused and must spend no rate token.

## 7. Tests the next session must add (minimum)

From the addendum section 5, plus the Architect's list:
- Member and Viewer get 403 on `POST /projects/:id/boards`; Manager gets 201 and a creator grant on that board only.
- Invitee in each role creates their own project via `POST /api/v1/projects` and is owner there.
- 4th owned project refused (both routes); 6th board refused (both routes); archived project does not count; archive then create works.
- Concurrent creates at cap (forced interleaving with two clients): never exceed the limit; no 40P01.
- Reopen at cap refused; after archiving one, reopen works.
- Idempotent replay at cap returns the original 201.
- Owner sees `current`; Manager gets no `current` at board cap.
- Body-supplied `workspaceId` refused (422) on `POST /api/v1/projects`.
- Cross-project isolation: a project in user A's workspace is never visible to B.
- Double Google callback yields one workspace (done, `b17-personal-workspace.test.ts`).
- Invite and resend at `active + pending = 50`: refused; accept at 50 active: refused; expired pending not counted.
- Grandfathered project with 7 boards: create refused, archive and edits allowed.
- Migration 0019: second run inserts 0 rows; index exists.
- Env parser: `''`, `'0'`, `'3O'`, `'-1'`, `'5000'` fall back to defaults (unit test).

## 8. How to verify

Local disposable Postgres only (container on 127.0.0.1:55621 or 55432; the local harness role password is documented in docs/reviews notes; do not copy it into new files). Run from `apps/api`:

```
npm test
```

with `DATABASE_URL` and `FLOWBOARD_ACCESS_TEST_DATABASE_URL` pointing at the local harness. The access suite needs its own database (`flowboard_access_test`, created with the CREATE DATABASE line in the B-15/B-16 reports). Contracts: `cd packages/contracts && npm test`. Root: `npm run typecheck`.

Report counts with the access-suite state stated explicitly. Do not run against UAT or production. Do not push or deploy.

## 9. Hard rules from the Architect

- Never touch any database or secret. Read-only counts are Deployment's job.
- No per-user allowlist or backdoor. Limits are constants with env overrides only.
- Over-limit existing data is grandfathered: block new creates, never delete.
- Backstop totals not implemented unless the user says yes.
- Commit per task, local only. Report each commit with exact counts and the finding IDs it closes.

## 6. Architect answers to section 5 (2026-10-31, confirmed with the user's earlier approvals)

1. **Scope names:** keep `owned_projects`, `boards_per_project`, `members`, `pending_invitations`. Add `owned_projects_total` and `boards_per_project_total` for the backstop, with remedy `none` for the backstop scopes (add `none` to the remedy enum).
2. **Env names:** `FB_LIMIT_OWNED_PROJECTS`, `FB_LIMIT_BOARDS_PER_PROJECT`, `FB_LIMIT_MEMBERS_PER_PROJECT`, `FB_LIMIT_PENDING_INVITES_PER_PROJECT`, plus `FB_LIMIT_OWNED_PROJECTS_TOTAL` and `FB_LIMIT_BOARDS_PER_PROJECT_TOTAL`. Invalid values fall back to the default. Document all in `docs/API.md` and the `wrangler` comments.
3. **Rate limits and seat reservation:** confirmed as implemented per edge doc rules 14 and 6 (project create 5 per minute and 30 per hour; board create 10 per minute and 60 per hour; invitations count against `active + pending`). These are beta defaults.
4. **Backstop totals: APPROVED BY THE USER.** Implement 20 owned projects (archived included) and 25 boards per project (archived included). The earlier "do not implement" note is withdrawn. Required tests: an archive-then-create cycle reaches the backstop and is refused; archived items count toward it; grandfathering still applies.
5. **F-29 accepted:** invitation accept does not call `ensurePersonalWorkspace`. Required instead: a test that an invitee who has no personal workspace can create their own project (the create route ensures it), as Member and as Viewer.
6. **F-13 deferred**, accepted (helper plus lock, transfer disabled).
7. **`RATE_LIMITED` replaces `TOO_MANY_REQUESTS`:** confirmed.

Ownership transfer (F-06) is to be disabled for the beta (410, typed code). Production has 0 users and UAT 2 users, each with a workspace (read-only counts, 2026-10-31), so the 0019 backfill is expected to insert 0 rows on both.

## 10. Codex to Claude continuation handoff — 31 October 2026

**Status: implementation in progress; no independent acceptance review has passed for this work.** The user asked Claude to continue. Read `docs/CODEX_IMPLEMENTATION_HANDOFF_2026-10-31.md`, this document and its linked decisions/edge cases first. The older sections above describe Claude's earlier handoff and are superseded where they conflict with this section. Keep the seven-task order and the boundaries: never touch or stage `apps/web/` or `design/`, stage only explicit paths, no push/deploy/hosted database or secrets. Existing UI/design working-tree changes belong to another chat; preserve them.

### Completed local commits

1. `d76fc98 feat(api): enforce own-project and board quotas` — completed the partial B-18 changes. Adds the workspace-less project route, shared active quotas and actor rate windows, Manager creator grant, and mounted tests for Member/Viewer 403, Manager creation, owned projects for shared roles with no workspace, 422 workspace injection, active caps, replay, quota privacy, archive/reopen, grandfathering, and forced concurrent creates (including cross-workspace projects). Fixed a real reopen bug: checking board writability rejected the archived board being reopened; it now checks the project context and only counts the quota when the board was archived. Updated old fixtures for the creator grant and active board cap. **Verification:** API 714 passed, 0 failed, 0 skipped, access suite enabled; contracts 108 passed; expanded B-18 regression separately 11 passed; typecheck passed. The full run preceded the final additions to the test file only; the expanded test was rerun separately.
2. `55d884b feat(api): enforce archived-item backstops and expose limits` — adds approved total caps 20 owned projects/25 boards including archived, additive error scopes `owned_projects_total` and `boards_per_project_total` with remedy `none`, the six `FB_LIMIT_*` settings, session `limits` and `isOwned`, and Node runtime override handling. It also aligns 429 fallback code to `RATE_LIMITED` and uses the actual retry interval in the HTTP header. Added tests for archive cycles, 20/25 defaults, Manager count privacy, replays, shared/owned session values, and local Node/Worker handler overrides. **Verification:** API 722 passed, 0 failed, 0 skipped with access suite enabled; contracts 108 passed; expanded backstop regression separately 7 passed; typecheck and `tsc -p apps/api/tsconfig.build.json --noEmit` passed. The full run preceded the final test-only addition; the latest test was run separately. There is no configured `lint` script (`npm run lint --if-present` performs no lint).
3. B-19 decision amendment is in the same commit as this handoff: it documents the new-board creator grant and Owner-only administration. **Verification:** API 723 passed, 0 failed, 0 skipped with access suite enabled; contracts 108 passed, 0 failed, 0 skipped; typecheck passed. The mounted creator-grant, audit-row and Owner-only administration regressions are in the B-18 commit. This is implementation evidence, not an independent review.

### Work in progress at handoff

- Task 3/B-19 is implemented and its decision amendment accompanies this handoff. The B-18 test in `apps/api/test/b18-own-projects.test.ts` checks the creator's one grant, audit event, no grant on an existing board and the concealed 404/no mutation when a Manager tries to grant someone else. The full run exited 0: `/tmp/flowboard-b19-suite.log`, API 723/723 and contracts 108/108, access suite enabled. No lint script exists. Continue with task 4/B-20.
- The user explicitly approved testing migration 0019 **only in a new disposable local PostgreSQL database**. This resolves the apparent conflict between “do not apply 0019 to any database” and the required twice-run test. UAT, production, Neon, Cloudflare and other hosted systems remain off limits. No 0019 file was written or applied by Codex.
- Local test setup used disposable PostgreSQL `17-alpine` at image digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, port **55635**, with databases named `flowboard_harness`, `flowboard_access_test`, and `flowboard_b18_test`. Access tests used `flowboard_access_test`; the two B-18 focused files used `flowboard_b18_test`. Docker container `flowboard-codex-implementation-local` was stopped and removed after the run (`docker rm -f`, exit 0); Claude must create a fresh disposable local instance. Construct local test URLs without pasting them in a handoff or log. Preserve no test data as production evidence.
- The user authorized a later message to the existing **Flowboard UI** chat when the corresponding backend is actually ready. Codex has not sent that message. Respect `BACKEND_REVIEW_GATE.md`: no claim of backend verification or UI integration readiness until a fresh independent reviewer approves the exact target. The UI chat has its own uncommitted work; do not modify it.

### Remaining work, in order

4. **B-20:** close authenticated `POST /api/v1/workspaces` and `POST /api/v1/workspaces/:id/transfer-ownership` with typed 410 responses; preserve unauthenticated 401; make `GET /api/v1/workspaces` owner-only. Replace workspace POST fixture setup with a local fixture helper in the named suites, including `worker.test.ts`; update the route-authorization probe and the three listed audit scripts after verifying their actual use. The existing `board-access.test.ts` contains ownership-transfer race tests: preserve their authorization/lock coverage using a controlled synthetic owner change rather than silently deleting the tests. `acc-lifecycle.test.ts` also assumes transfer succeeds before later cases; update its fixture carefully and test the disabled route explicitly. Add non-Owner and stranger negative cases.
5. **B-21:** add migration `0019` with fixed-name personal workspace backfill, idempotence, `idx_workspaces_owner`, and nullable `boards.created_by`; synchronize embedded migrations. Test against a **new disposable local database only**, including second execution inserting zero rows and existing data survival. Do not apply to UAT/production. Check backfill/sign-in lock ordering; the helper creates random IDs, so `NOT EXISTS` alone does not serialize a live sign-in.
6. **B-22:** implement active-member and unexpired-pending invitation caps and seat reservations, invite/resend windows and expired resend refusal, project quota lock before invitation-row lock for accept/resend, archived-project accept refusal, `NAME_REQUIRED` on invite creation, name character rules on project/board contracts and `Cf` stripping in email. Include forced concurrent accept/resend and cap tests, not only sequential calls.
7. Resolve every blocker/high finding in edge-case section 3 or record a dated, specific deferral in section 4. In particular F-30 still needs the **board archive** path checked in an archived project; reopen was fixed/tested. Check the binding edge-case section 2 for the Owner-only board usage in project overview and the effective-limit startup logging/initialization requirement; these were not completed in tasks 1–3. Verify the route-authorization probe covers new/retired routes. Update API docs and final handover; do not claim historical scripts or prior scores are fresh approval.

### Failed attempts and remaining verification

- Initial local full baseline: 704 API tests, 681 passed, 23 failed, access suite enabled. The meaningful causes included the archived-board reopen bug, tests that manually duplicated new creator grants, a lock-order test creating more boards than the new quota, a 429 code mismatch, and a local Worker harness requiring a synthetic password. These were addressed and the later B-18 run passed.
- First backstop full run: 719 API tests, 716 passed, 3 failed, access suite enabled; its lock-order stress fixture hit the new 25-board total. The fixture now explicitly uses a higher **test-only** total and its seven forced-lock checks pass; the subsequent full API run passed 722/722, contracts 108/108.
- Focused grant-admin tests initially used a numeric access revision and expected 403; the existing contract requires a string and intentionally conceals the Owner-only route with 404. Corrected regression passes and asserts no grant was created.
- `npm run lint --if-present` exited 0 but there is no lint script; never report this as a lint pass. No push, deploy, production access, or hosted service verification was performed. A fresh Codex auditor must run the round-4 brief against the eventual frozen commit and UAT only when the owner authorizes that separate step.


## 11. B-23 same-name numbers: privacy finding (2026-10-31)

Numbers are computed over all active members of the project (the Owner first), not over the rows a caller can see, so filters and boards do not change them. What a caller can learn from a number:

- GET /projects/:id/people is open to every active project member and already returns every active member's name and role. A Viewer can already count same-named members, so a number reveals nothing new about who exists.
- The number reveals join order among same-named members (a "(2)" is later than the unnumbered one). Membership timestamps are not returned.
- A board-filtered people view (boardId or mention purpose) shows only people with board access. The number is still project-wide, so a Member with access to one board can learn that a hidden same-named member exists in the project. This is the one new fact. We chose project-wide numbering anyway, for consistency across screens, as the Architect instructed. Decision needed: accept this, or number per board view (which would break agreement between screens).
- Workspace-wide activity (listWorkspaceActivity) has no single project, so its actors are not numbered. A same-name pair can look identical there. Decision needed.
- Project overview assignee and activity rows (project-overview.ts) are not PersonDisplay objects in the contract, so they are not numbered either. Adding nameSuffix to that shape is a contract change.
