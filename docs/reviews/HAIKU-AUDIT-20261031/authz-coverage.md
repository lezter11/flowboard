# Authorization coverage audit (read-only)

Date: 2026-10-31. Scope: every route registered in `apps/api/src/http/routes/*.ts` and `apps/api/src/http/app.ts`, the adapters those handlers call for authorization, and the test suite under `apps/api/test`.

Method and limits:
- Read-only. No file was edited except this report. No server was started and nothing ran against a database or network service. Only reads and `grep`/script text matching were used.
- Route table built by script from the `*Routes.<method>(...)` registrations, with mount prefixes from `app.ts:174-189`. 99 registrations total: 97 under `/api/v1`, plus 2 probes in `app.ts`.
- Basis column: `read` means the handler or adapter body was read; `grep` means the call site was confirmed by search only.
- Test coverage is a path-level text match (route path, with `:params` as wildcards, searched in `apps/api/test`). It does not check the HTTP method or the asserted status code, so "referenced" means "some test calls this path", not "every role is asserted".

## Summary

- Routes: 99 registrations (97 `/api/v1`, 2 probes).
- Guard type: 87 `authMiddleware`, 2 `optionalAuthMiddleware` (`GET /api/v1/boards/:boardId`, `POST /api/v1/session/logout`), 10 with no session middleware.
- The 10 without session middleware: 7 public by design (`/health/live`, `/health/ready`, `/api/v1/activity/health`, `/api/v1/notifications/health`, `/api/v1/auth/google`, `/api/v1/auth/google/start`, `/api/v1/auth/google/callback`), 1 env-gated (`/api/v1/session/dev-login`), 2 admin-secret gated (`/api/v1/system/status`, `/api/v1/system/migrate`).
- Routes that take a project, board, card, comment, image or invitation id and have no project or board access check, in the route or in the adapter it calls: none found.
- Recently changed routes checked (POST /api/v1/projects, PATCH /api/v1/session/name, POST and GET /api/v1/workspaces, the two 410 retirements, leave-project, board create and reopen, invitation resend, GET /projects/:id/people): all enforce the expected check. Findings are in section 2.
- Tests: 95 of 99 routes are referenced by path somewhere in `apps/api/test`. 4 have no reference (table 3). The only role matrix (`rbac01-matrix.test.ts`) exercises test-only routes, not production routes. Production authz is covered by the per-feature board-access and RBAC suites.
- Mass assignment: no pass-through found. Every handler reads named fields from the parsed body. 4 body schemas plus 1 manual check reject unknown keys. The other 26 body uses (POST/PATCH/DELETE, including aliases) are not `.strict()`: unknown keys are silently dropped, not stored (table 4).

## 1. Guard map (all 99 registrations)

Columns: # | Method | Path | Handler file:line | Session guard | Role / access check (where) | Basis

| # | Method | Path | Handler | Session guard | Role / access check (where) | Basis |
|---|---|---|---|---|---|---|
| 1 | GET | /api/v1/activity/health | activity.ts:21 | none | public health probe | read |
| 2 | GET | /api/v1/cards/:cardId/activity | activity.ts:24 | authMiddleware | adapter listCardActivity: lockBoardAccess (owner or board grant), card must match project and workspace | read |
| 3 | GET | /api/v1/projects/:projectId/activity | activity.ts:44 | authMiddleware | adapter listProjectActivity: lockProjectActivityAccess (owner or active member, board scope) | read |
| 4 | GET | /api/v1/workspaces/:workspaceId/activity | activity.ts:77 | authMiddleware | adapter listWorkspaceActivity: owner only, else 403 or 404 | read |
| 5 | GET | /api/v1/boards/:boardId/access | board-grants.ts:49 | authMiddleware | route lockOwnedBoard: board owner only | read |
| 6 | PUT | /api/v1/boards/:boardId/grants/:userId | board-grants.ts:107 | authMiddleware | route: body must be exactly `{expectedAccessRevision}`; writeGrant calls lockOwnedBoard (owner only) | read |
| 7 | DELETE | /api/v1/boards/:boardId/grants/:userId | board-grants.ts:107 | authMiddleware | same as 6 | read |
| 8 | POST | /api/v1/projects/:projectId/boards | boards.ts:50 | authMiddleware | checkOrReplayProjectWriteReceipt(manager) at :74; createBoard; manager gets creator grant at :108 | read |
| 9 | GET | /api/v1/projects/:projectId/boards | boards.ts:144 | authMiddleware | lockProjectBoardReadScope at :152 | read |
| 10 | GET | /api/v1/boards/:boardId | boards.ts:165 | optionalAuthMiddleware | board existence check before auth (:169-173), then getBoardSnapshot calls lockBoardAccess (adapters/boards.ts:1122). See section 2, item 1 | read |
| 11 | PATCH | /api/v1/boards/:boardId | boards.ts:185 | authMiddleware | checkOrReplayProjectWriteReceipt(manager, boardId) at :217; adapter updateBoard: owner only for name and description (adapters/boards.ts:342-345) | read |
| 12 | POST | /api/v1/boards/:boardId/columns | boards.ts:276 | authMiddleware | checkOrReplayProjectWriteReceipt(manager, boardId) at :307 | read |
| 13 | PATCH | /api/v1/boards/:boardId/columns/:columnId | boards.ts:360 | authMiddleware | same guard at :392 | read |
| 14 | POST | /api/v1/boards/:boardId/columns/reorder | boards.ts:445 | authMiddleware | same guard at :476 | read |
| 15 | DELETE | /api/v1/boards/:boardId/columns/:columnId | boards.ts:529 | authMiddleware | same guard at :583 | read |
| 16 | GET | /api/v1/boards/:boardId/columns/:columnId/placement | boards.ts:636 | authMiddleware | lockBoardAccess at :648 | read |
| 17 | GET | /api/v1/boards/:boardId/cards | boards.ts:669 | authMiddleware | lockBoardAccess at :682 | read |
| 18 | POST | /api/v1/boards/:boardId/archive | boards.ts:695 | authMiddleware | lockBoardAccess :711; acquireWriteGrantLock(manager, boardId) :712; project writable :714 | read |
| 19 | POST | /api/v1/boards/:boardId/reopen | boards.ts:814 | authMiddleware | lockBoardAccess :833; acquireWriteGrantLock(manager, boardId) :834; project writable :866 | read |
| 20 | POST | /api/v1/boards/:boardId/cards | cards.ts:38 | authMiddleware | checkOrReplayProjectWriteReceipt(member, boardId) at :67 | read |
| 21 | GET | /api/v1/cards/:cardId | cards.ts:112 | authMiddleware | adapter getCard: resolveProjectRole, then requireCardBoardAccess (adapters/cards.ts:423-460) | read |
| 22 | PATCH | /api/v1/cards/:cardId | cards.ts:135 | authMiddleware | checkOrReplayProjectWriteReceipt(member, boardId) at :165 | read |
| 23 | POST | /api/v1/cards/:cardId/move | cards.ts:210 | authMiddleware | checkOrReplayProjectWriteReceipt(member, boardId) at :240; adapter moveCard: destination column must belong to the card's board | read |
| 24 | POST | /api/v1/cards/:cardId/move-undo | cards.ts:285 | authMiddleware | checkOrReplayProjectWriteReceipt(member, boardId) at :321 | read |
| 25 | GET | /api/v1/projects/:projectId/cards/search | cards.ts:417 | authMiddleware | lockProjectBoardReadScope at :431 | read |
| 26 | GET | /api/v1/me/tasks | cards.ts:444 | authMiddleware | lockProjectBoardReadScope at :460 (projectId required) | read |
| 27 | GET | /api/v1/workspaces/:workspaceId/my-tasks | cards.ts:473 | authMiddleware | lockProjectBoardReadScope at :489. workspaceId is a filter only, not checked. See section 2, item 3 | read |
| 28 | GET | /api/v1/cards/:cardId/comments | comments.ts:32 | authMiddleware | lockBoardAccess at :51 | read |
| 29 | POST | /api/v1/cards/:cardId/comments | comments.ts:67 | authMiddleware | checkOrReplayProjectWriteReceipt(member, boardId) at :120; adapter postComment: acquireWriteGrantLock(member) | read |
| 30 | PATCH | /api/v1/comments/:commentId | comments.ts:171 | authMiddleware | route acquireWriteGrantLock(member) at :209; adapter editComment: author only (adapters/comments.ts, "Only the author") | read |
| 31 | DELETE | /api/v1/comments/:commentId | comments.ts:284 | authMiddleware | route acquireWriteGrantLock(member) at :331; adapter deleteComment: author, or manager for others | read |
| 32 | GET | /api/v1/auth/google | google-auth.ts:111 | none | public sign-in; sets state cookie | read |
| 33 | GET | /api/v1/auth/google/start | google-auth.ts:112 | none | public sign-in (alias) | read |
| 34 | GET | /api/v1/auth/google/callback | google-auth.ts:280 | none | public; state must equal cookie (:122-129); email must be verified (:184) | read |
| 35 | POST | /api/v1/cards/:cardId/image-uploads | images.ts:79 | authMiddleware + requireImageStorage | checkOrReplayProjectWriteReceipt(member, boardId) at :108 | read |
| 36 | PUT | /api/v1/image-uploads/:uploadId/content | images.ts:157 | authMiddleware + requireImageStorage | adapter receiveImageContent: requireImageBoardAccess, acquireWriteGrantLock(member) | read |
| 37 | POST | /api/v1/image-uploads/:uploadId/finalize | images.ts:189 | authMiddleware + requireImageStorage | checkOrReplayProjectWriteReceipt(member, boardId) at :223; adapter finalize: acquireWriteGrantLock(member) | read |
| 38 | GET | /api/v1/image-uploads/:uploadId | images.ts:258 | authMiddleware + requireImageStorage | adapter getImageUpload: requireImageBoardAccess plus project role | read |
| 39 | DELETE | /api/v1/image-uploads/:uploadId | images.ts:272 | authMiddleware + requireImageStorage | adapter cancelImageUpload: board access, and uploader or owner or manager | read |
| 40 | GET | /api/v1/cards/:cardId/images | images.ts:301 | authMiddleware + requireImageStorage | adapter listCardImages: requireImageBoardAccess; trashed card limited to owner or manager | read |
| 41 | GET | /api/v1/images/:imageId/content | images.ts:338 | authMiddleware + requireImageStorage | adapter getImageContent: requireImageBoardAccess; trashed card limited to owner or manager | read |
| 42 | GET | /api/v1/images/:imageId/thumbnail | images.ts:360 | authMiddleware + requireImageStorage | same as 41 | read |
| 43 | DELETE | /api/v1/images/:imageId | images.ts:382 | authMiddleware + requireImageStorage | checkOrReplayProjectWriteReceipt(member, boardId) at :412; adapter deleteCardImage: uploader, owner or manager (adapters/images.ts, deleteCardImage) | read |
| 44 | GET | /api/v1/import/template | imports.ts:76 | authMiddleware | template only; no board id | read |
| 45 | GET | /api/v1/boards/:boardId/card-import-template | imports.ts:77 | authMiddleware | lockBoardAccess in handleDownloadTemplate (:49) | read |
| 46 | GET | /api/v1/boards/:boardId/import-template | imports.ts:78 | authMiddleware | same as 45 | read |
| 47 | POST | /api/v1/boards/:boardId/imports | imports.ts:141 | authMiddleware | adapter createCardImport: acquireWriteGrantLock(manager, boardId) and writable context | read |
| 48 | POST | /api/v1/boards/:boardId/card-imports | imports.ts:142 | authMiddleware | same as 47 (alias) | read |
| 49 | GET | /api/v1/imports/:importId | imports.ts:171 | authMiddleware | adapter getCardImportStatus: acquireWriteGrantLock(manager, board) | read |
| 50 | GET | /api/v1/card-imports/:importId | imports.ts:172 | authMiddleware | same as 49 (alias) | read |
| 51 | POST | /api/v1/imports/:importId/mappings | imports.ts:200 | authMiddleware | adapter updateImportMappings: lockImportBoard, acquireWriteGrantLock(manager, board) | read |
| 52 | POST | /api/v1/card-imports/:importId/mappings | imports.ts:201 | authMiddleware | same as 51 (alias). No test reference | read |
| 53 | POST | /api/v1/imports/:importId/commit | imports.ts:291 | authMiddleware | route acquireWriteGrantLock(manager) at :233; checkOrReplayProjectWriteReceipt(manager) at :247; adapter commit re-checks | read |
| 54 | POST | /api/v1/card-imports/:importId/commit | imports.ts:292 | authMiddleware | same as 53 (alias) | read |
| 55 | DELETE | /api/v1/imports/:importId | imports.ts:317 | authMiddleware | adapter cancelCardImport: lockImportBoard, acquireWriteGrantLock(manager) | read |
| 56 | DELETE | /api/v1/card-imports/:importId | imports.ts:318 | authMiddleware | same as 55 (alias) | read |
| 57 | GET | /api/v1/imports/:importId/report | imports.ts:350 | authMiddleware | adapter getImportReport: acquireWriteGrantLock(manager, board) | grep |
| 58 | GET | /api/v1/card-imports/:importId/report | imports.ts:351 | authMiddleware | same as 57 (alias). No test reference | grep |
| 59 | POST | /api/v1/projects/:projectId/invitations | invitations.ts:35 | authMiddleware | acquireWriteGrantLock(manager) :62; owner only for manager role :65-67; name required :89; inviter and seat limits :94-95 | read |
| 60 | POST | /api/v1/invitations/accept | invitations.ts:139 | authMiddleware | token hashed and matched in adapter acceptInvitation; authenticated email must equal invitation email (EMAIL_MISMATCH); pending and not expired | read |
| 61 | GET | /api/v1/projects/:projectId/invitations | invitations.ts:253 | authMiddleware | acquireWriteGrantLock(manager) :265; listInvitations never selects token_hash | read |
| 62 | POST | /api/v1/projects/:projectId/invitations/:invitationId/resend | invitations.ts:286 | authMiddleware | acquireWriteGrantLock(manager) :314; invitation must belong to project (:318); manager invitations owner only (:324) | read |
| 63 | POST | /api/v1/projects/:projectId/invitations/:invitationId/revoke | invitations.ts:393 | authMiddleware | acquireWriteGrantLock(manager) :419; invitation scoped to project (:423); manager invitations owner only (:429) | read |
| 64 | POST | /api/v1/projects/:projectId/leave | invitations.ts:483 | authMiddleware | no route-level project check. adapter leaveProject: owner refused (403); non-member 404. See section 2, item 4 | read |
| 65 | PATCH | /api/v1/projects/:projectId/members/:userId | members.ts:51 | authMiddleware | adapter updateProjectMember: acquireWriteGrantLock(manager) (adapters/members.ts:43); self, owner and manager targets refused; only owner may appoint managers | read |
| 66 | DELETE | /api/v1/projects/:projectId/members/:userId | members.ts:139 | authMiddleware | adapter removeProjectMember: acquireWriteGrantLock(manager) (adapters/members.ts:212); same rules | read |
| 67 | GET | /api/v1/notifications/health | notifications.ts:21 | none | public health probe. No test reference | read |
| 68 | GET | /api/v1/notifications | notifications.ts:24 | authMiddleware | own rows only (user_id = actor) | read |
| 69 | PATCH | /api/v1/notifications/:id/read | notifications.ts:44 | authMiddleware | adapter markNotificationRead: WHERE n.id and n.user_id = actor | read |
| 70 | POST | /api/v1/notifications/mark-all-read | notifications.ts:60 | authMiddleware | adapter markAllNotificationsRead: own rows only | read |
| 71 | GET | /api/v1/projects | projects.ts:82 | authMiddleware | adapter getAllAccessibleProjects: owner or active membership (actor-scoped) | read |
| 72 | POST | /api/v1/workspaces/:workspaceId/projects | projects.ts:98 | authMiddleware | owner pre-check (:108-114); owner re-check FOR SHARE (:137-139); checkOrReplayReceipt; quota | read |
| 73 | POST | /api/v1/projects | projects.ts:195 | authMiddleware | creates in the actor's own personal workspace (ensurePersonalWorkspace); body strict; quota and room checks | read |
| 74 | GET | /api/v1/workspaces/:workspaceId/projects | projects.ts:249 | authMiddleware | owner, else active membership in that workspace (:268-274) | read |
| 75 | GET | /api/v1/projects/:projectId | projects.ts:285 | authMiddleware | row returned only if owner or active member (:321) | read |
| 76 | GET | /api/v1/projects/:projectId/overview | projects.ts:345 | authMiddleware | adapter getProjectOverview: owner or active member (project-overview.ts:56-66); board counts limited by board_grants (:42) | read |
| 77 | PATCH | /api/v1/projects/:projectId | projects.ts:355 | authMiddleware | acquireWriteGrantLock(manager) :380; acquireWritableProjectContextLock :381; adapter updateProjectSettings: defaultBoardId owner only (adapters/projects.ts, "Only the project owner can change the default board") | read |
| 78 | GET | /api/v1/projects/:projectId/members | projects.ts:436 | authMiddleware | lockProjectBoardReadScope at :447 | read |
| 79 | GET | /api/v1/projects/:projectId/people | projects.ts:458 | authMiddleware | lockProjectBoardReadScope :478; boardId or cardId checked by lockBoardAccess with projectId match (:491-501) | read |
| 80 | GET | /api/v1/projects/:projectId/access-summary | projects.ts:523 | authMiddleware | lockProjectBoardReadScope at :535 | read |
| 81 | POST | /api/v1/projects/:projectId/archive | projects.ts:548 | authMiddleware | lockProjectOwner :570; resolveProjectRole must be owner (:596-602) | read |
| 82 | POST | /api/v1/projects/:projectId/reopen | projects.ts:663 | authMiddleware | lockProjectOwner :687; resolveProjectRole must be owner (:713-719) | read |
| 83 | GET | /api/v1/session | session.ts:45 | authMiddleware | own session and own data | read |
| 84 | PUT | /api/v1/session/last-location | session.ts:82 | authMiddleware | adapter writeLastLocation: canReadLocation for project and board (last-location.ts:76-85) | read |
| 85 | PATCH | /api/v1/session/profile | session.ts:95 | authMiddleware | own user; body strict (auth.ts:150-159) | read |
| 86 | PATCH | /api/v1/session/name | session.ts:111 | authMiddleware | own user (saveUserName(actor.id)); body strict (auth.ts:88-93) | read |
| 87 | POST | /api/v1/session/logout | session.ts:126 | optionalAuthMiddleware | revokes only the caller's own session | read |
| 88 | POST | /api/v1/session/dev-login | session.ts:145 | none | env gate :152-156 returns 404 when HYPERDRIVE or DATABASE_URL is bound, or outside test or dev. Existing email needs x-dev-secret (:173-178). See section 2, item 2 | read |
| 89 | GET | /api/v1/system/status | system.ts:9 | none | x-dev-secret vs configured admin secret (admin-secret.ts:15-19); 403 otherwise | read |
| 90 | POST | /api/v1/system/migrate | system.ts:22 | none | same admin-secret check; runs migrations. See section 2, item 5 | read |
| 91 | POST | /api/v1/cards/:cardId/delete | trash.ts:24 | authMiddleware | checkOrReplayProjectWriteReceipt(manager, boardId) at :61 | read |
| 92 | GET | /api/v1/projects/:projectId/trash | trash.ts:117 | authMiddleware | acquireWriteGrantLock(manager) :132; titles limited to granted boards | read |
| 93 | POST | /api/v1/cards/:cardId/restore | trash.ts:156 | authMiddleware | checkOrReplayProjectWriteReceipt(manager, boardId) at :193; adapter restoreCard: toColumnId must belong to the card's board | read |
| 94 | POST | /api/v1/workspaces | workspaces.ts:19 | authMiddleware | retired: always 410 after auth | read |
| 95 | GET | /api/v1/workspaces | workspaces.ts:26 | authMiddleware | WHERE owner_id = actor (:45) | read |
| 96 | PATCH | /api/v1/workspaces/:workspaceId | workspaces.ts:64 | authMiddleware | owner only (:105-108), then version check | read |
| 97 | POST | /api/v1/workspaces/:workspaceId/transfer-ownership | workspaces.ts:160 | authMiddleware | retired: always 410 after auth, no ownership logic | read |
| 98 | GET | /health/live | app.ts:154 | none | public probe | read |
| 99 | GET | /health/ready | app.ts:155 | none | public probe; 503 when DB unreachable | read |

## 2. Unguarded or suspicious routes

No route takes a project, board, card, comment, image or invitation id without a project or board access check in its route or adapter. The items below are the ones that need a decision or a note.

| # | Route | file:line | Issue | Basis | Severity |
|---|---|---|---|---|---|
| 1 | GET /api/v1/boards/:boardId | boards.ts:165-177 | Board existence is checked before authentication. An anonymous caller gets 404 for an unknown id and 401 for an existing board id, so board UUIDs can be probed. Actual board data is still protected by lockBoardAccess. | read | Low (information leak) |
| 2 | POST /api/v1/session/dev-login | session.ts:145-178 | No session middleware. Gated by env: 404 if HYPERDRIVE or DATABASE_URL is bound, or NODE_ENV is not test or development (:152-156). The existing-user impersonation check at :175 calls `adminSecretMatches` without the `deployed` argument, unlike system.ts. admin-secret.ts:8-12 notes that a bundled Worker can inherit NODE_ENV=test. If a deployed runtime ever lacked the bindings while NODE_ENV was test, dev-login would issue sessions for any new email. Existing accounts would still need x-dev-secret. | read (config-dependent risk: inferred) | Medium if the bindings were missing; Low today |
| 3 | GET /api/v1/workspaces/:workspaceId/my-tasks | cards.ts:473-499 | The path workspaceId is never checked against the project's workspace. It only filters the query (adapters/cards.ts getMyTasks). Results still come from lockProjectBoardReadScope on projectId. Not exploitable as read here, but the route is inconsistent with the rest of the workspace routes. | read | Low |
| 4 | POST /api/v1/projects/:projectId/leave | invitations.ts:483-553 | No route-level project check. All authority is in the adapter (adapters/invitations.ts leaveProject, :934+): owner refused, non-member 404. Its replay branch (:516-531) re-checks owner only. | read | Low (defence in depth) |
| 5 | POST /api/v1/system/migrate | system.ts:22-50 | Runs schema migrations behind one shared secret header and no session. admin-secret.ts closes the route when the secret is unset or shorter than 32 characters. | read | Low (secret-gated, high impact) |
| 6 | Systemic: per-handler checks | src/http/middleware/rbac.ts:26, :49 | `requireWorkspaceRole` and `requireProjectRole` are defined but used by no production route (grep: only definitions, and test-only routes in rbac01-matrix.test.ts). Every production route therefore depends on a helper call inside its handler or adapter. A future route that omits the call would fail open with no middleware to catch it. | grep | Medium (design risk) |
| 7 | POST /api/v1/invitations/accept and invitation create or resend | invitations.ts:119, :372 | The raw invitation token is returned in the JSON response to the inviting manager (by design, to share the link). Token hashes are never listed (adapters/invitations.ts listInvitations: "never select token_hash"). Noted for confirmation. | read | Info |
| 8 | GET /api/v1/projects/:projectId/people?purpose=display | projects.ts:458-520 | Any active member gets every active project identity (PRJ-05 directory). Intended, noted for completeness. Assignee and mention purposes do check board access. | read | Info |
| 9 | POST and GET /api/v1/workspaces (retired) | workspaces.ts:19-23, :160-164 | Retired with 410 after authentication, with no ownership logic. Nothing to exploit. | read | Info |

## 3. Routes without tests (path-level match)

Four routes have no reference in `apps/api/test`. Every other route is referenced by at least one test.

| # | Method | Path | file:line | Notes |
|---|---|---|---|---|
| 1 | GET | /api/v1/activity/health | activity.ts:21 | Public health probe. Low risk. |
| 2 | POST | /api/v1/card-imports/:importId/mappings | imports.ts:201 | Alias of /imports/:importId/mappings, which is tested (imp01-imp06). The alias has no coverage. |
| 3 | GET | /api/v1/card-imports/:importId/report | imports.ts:351 | Alias of /imports/:importId/report, which is tested. The alias has no coverage. |
| 4 | GET | /api/v1/notifications/health | notifications.ts:21 | Public health probe. Low risk. |

Matrix observation: `apps/api/test/rbac01-matrix.test.ts` ("RBAC-01: Owner/Manager/Member/Viewer Matrix") registers its own test routes (`/api/v1/workspaces/:wid/admin`, `/api/v1/projects/:pid/manage|read|write`, lines 16-40) and exercises the middleware helpers on them. It does not call any production route. `rbac-advanced.test.ts` likewise covers helpers and a few routes. The production authorization matrix is spread across the board-access suites (`board-access.test.ts`, `board-access-cards-images.test.ts`, `board-access-boards-imports-trash.test.ts`, `board-access-activity-notifications.test.ts`), `inv04-inv08.test.ts`, `inv06-inv07.test.ts`, `activity-coverage-b5.test.ts` and others. No single table-driven test covers all 99 routes by role. The path-level match also does not confirm status codes.

## 4. Mass assignment (POST, PATCH, and DELETE with a body)

"Strict" means zod `.strict()` or an equivalent manual key check, which rejects unknown keys with 422 or 400. "Stripped" means zod's default: unknown keys are dropped silently. "Pass-through" would mean an unknown key reaches storage. None was found: the handlers use named fields, and a grep for spreads (`...body`, `...input`, `Object.assign`) in `http/` and `adapters/` found nothing relevant.

| # | Route | Handler file:line | Schema (contracts) | Unknown keys | Basis |
|---|---|---|---|---|---|
| 1 | POST /api/v1/projects | projects.ts:210 | createOwnProjectInputSchema = createProjectInputSchema.strict() (projects.ts:254) | rejected (strict) | read |
| 2 | PATCH /api/v1/session/profile | session.ts:103 | updateProfileInputSchema .strict() (auth.ts:150-159) | rejected (strict) | read |
| 3 | PATCH /api/v1/session/name | session.ts:118 | saveNameInputSchema .strict() (auth.ts:88-93) | rejected (strict) | read |
| 4 | PUT /api/v1/session/last-location | session.ts:89 | updateLastLocationInputSchema .strict() (auth.ts:48-53) | rejected (strict) | read |
| 5 | PUT and DELETE /api/v1/boards/:boardId/grants/:userId | board-grants.ts:111-115 | manual: body must have exactly one key, expectedAccessRevision | rejected (manual) | read |
| 6 | POST /api/v1/workspaces/:workspaceId/projects | projects.ts:125 | createProjectInputSchema (projects.ts:53) | stripped | read |
| 7 | PATCH /api/v1/workspaces/:workspaceId | workspaces.ts:72 | updateWorkspaceInputSchema (workspaces.ts:14) | stripped | read |
| 8 | PATCH /api/v1/projects/:projectId | projects.ts:372 | updateProjectInputSchema (projects.ts:64); body passed whole to updateProjectSettings (adapters/projects.ts), which reads named fields | stripped | read |
| 9 | POST /api/v1/projects/:projectId/invitations | invitations.ts:52 | createInvitationInputSchema (invitations.ts:35) | stripped | read |
| 10 | POST /api/v1/invitations/accept | invitations.ts:154 | acceptInvitationInputSchema (invitations.ts:48) | stripped | read |
| 11 | PATCH /api/v1/projects/:projectId/members/:userId | members.ts:69 | updateProjectMemberInputSchema (projects.ts:94) | stripped | read |
| 12 | POST /api/v1/projects/:projectId/boards | boards.ts:63 | createBoardInputSchema (boards.ts:24) | stripped | read |
| 13 | PATCH /api/v1/boards/:boardId | boards.ts:198 | updateBoardInputSchema (boards.ts:34) | stripped | read |
| 14 | POST /api/v1/boards/:boardId/columns | boards.ts:289 | createColumnInputSchema (boards.ts:87) | stripped | read |
| 15 | PATCH /api/v1/boards/:boardId/columns/:columnId | boards.ts:374 | updateColumnInputSchema (boards.ts:95) | stripped | read |
| 16 | POST /api/v1/boards/:boardId/columns/reorder | boards.ts:458 | reorderColumnsInputSchema (boards.ts:108) | stripped | read |
| 17 | DELETE /api/v1/boards/:boardId/columns/:columnId | boards.ts:529-545 | deleteColumnInputSchema (boards.ts:120), from query or body | stripped | read |
| 18 | POST /api/v1/boards/:boardId/cards | cards.ts:48 | createCardInputSchema (cards.ts:18); idempotency hashes rawBody, so extra keys change the fingerprint but are not stored | stripped | read |
| 19 | PATCH /api/v1/cards/:cardId | cards.ts:145 | updateCardInputSchema (cards.ts:40) | stripped | read |
| 20 | POST /api/v1/cards/:cardId/move | cards.ts:220 | moveCardInputSchema (cards.ts:71) | stripped | read |
| 21 | POST /api/v1/cards/:cardId/move-undo | cards.ts:295 | inline z.object (cards.ts:295-299): expectedVersion, expectedBoardVersion | stripped | read |
| 22 | POST /api/v1/cards/:cardId/comments | comments.ts:84 | postCommentInputSchema (discussion.ts:41) | stripped | read |
| 23 | PATCH /api/v1/comments/:commentId | comments.ts:188 | editCommentInputSchema (discussion.ts:51) | stripped | read |
| 24 | DELETE /api/v1/comments/:commentId | comments.ts:310 | deleteCommentInputSchema (discussion.ts:62); body optional, expectedVersion from query | stripped | read |
| 25 | POST /api/v1/cards/:cardId/image-uploads | images.ts:89 | createImageUploadInputSchema (images.ts:16) | stripped | read |
| 26 | DELETE /api/v1/images/:imageId | images.ts:392 | deleteImageInputSchema (images.ts:95) | stripped | read |
| 27 | POST /api/v1/cards/:cardId/delete | trash.ts:41 | softDeleteCardInputSchema (trash.ts:4) | stripped | read |
| 28 | POST /api/v1/cards/:cardId/restore | trash.ts:173 | restoreCardInputSchema (trash.ts:10) | stripped | read |
| 29 | POST /api/v1/imports/:importId/mappings (and card-imports alias) | imports.ts:183 | updateImportMappingsInputSchema (imports.ts:102) | stripped | read |
| 30 | POST /api/v1/imports/:importId/commit (and card-imports alias) | imports.ts:214 | commitImportInputSchema (imports.ts:95) | stripped | read |
| 31 | POST /api/v1/session/dev-login | session.ts:163 | devLoginRequestSchema (session.ts:30): email, displayName | stripped | read |

Not applicable: the 410 retirements and the POST/PATCH endpoints with no body (archive, reopen, resend, revoke, leave, mark-all-read, notification read, logout) do not parse a body.

## Findings to act on (ranked)

1. Systemic (section 2, item 6): production routes use no `requireProjectRole` or `requireWorkspaceRole` middleware. Authorization is correct today but depends on each handler calling the right helper. Consider a route-coverage test that fails for any `/api/v1` route without a recognised helper call.
2. dev-login (section 2, item 2): add the same `deployed` flag to the impersonation check that `system.ts` uses, and confirm the deployed Worker sets `DEV_LOGIN_ENABLED` and bindings. Not reproduced here: this is a code-path read only.
3. Board GET existence oracle (section 2, item 1): return 401 for an unauthenticated request before the existence check, or 404 for both cases.
4. Test gaps (section 3): add one test each for the `card-imports` mappings and report aliases.
5. my-tasks workspace id (section 2, item 3): validate that workspaceId owns projectId, or drop the path parameter.

No file other than this report was written. No tests, servers, or databases were run.
