# Frontend → backend handoff: contract and runtime gaps

Date: 2026-10-26
Reviewed checkout: `6120e51` (`fix(backend): complete R1-R7 repairs and pass independent review gate for all 22 backend features`)
Author role: UI/Architect review. **No backend source was changed for this report.**

Scope: the frontend behavior work in [`docs/FRONTEND_BEHAVIOR_CHECKLIST.md`](../FRONTEND_BEHAVIOR_CHECKLIST.md) and [`docs/FRONTEND_BEHAVIOR_SPEC.md`](../FRONTEND_BEHAVIOR_SPEC.md), checked against the mounted API, shared contracts and PostgreSQL schema. This is a list of backend work needed before UI implementation can rely on the affected behavior. It does not replace the backend review gate or the 98-feature delivery gate.

## Status snapshot

- 22 of 98 backend features have passing independent reviews at this commit.
- **21 product handlers are mounted.** 17 match an operation declared in `OPENAPI_ROUTES`; 4 are mounted but not declared (`POST /session/dev-login`, `GET /projects`, `GET /projects/:pid/access-summary`, `DELETE /projects/:pid/members/:uid`).
- **67 operations are declared in `OPENAPI_ROUTES`; 50 have no mounted handler.**
- Missing route groups: boards, columns, cards, comments, images/uploads, imports, trash/restore, activity, notifications, search and `/me/tasks`.
- `apps/web` does not exist. The UI checklist is 0/98; integrated acceptance is 0/98.
- The design screens are synthetic artifacts only. No screen claims API, persistence, authorization or integration verification.

## How to read this

- **P0** blocks a correct or safe frontend integration and should be fixed before the first real vertical slice.
- **P1** blocks a specific product screen or forces a fragile frontend workaround.
- **P2** is hardening or contract cleanup that can follow the first slice.
- “Contract” means `packages/contracts/src/*`; “runtime” means `apps/api/src/*`; “DB” means `database/migrations/*`.
- Recommended fixes are proposals for the backend owner. Where a change alters an approved requirement, the Architect must record the decision first.

---

## P0 — fix before wiring real screens

### P0-1. There is no production sign-in or callback contract

**Evidence**

- `apps/api/src/http/routes/session.ts` mounts only `GET /session`, `POST /session/logout` and `POST /session/dev-login`.
- `POST /session/dev-login` is disabled only when `NODE_ENV === 'production'` (`session.ts:70-73`). It returns the raw `session.id` in JSON (`session.ts:113-121`) as well as setting the cookie.
- `GET /session` returns actor, owned workspaces and accessible projects, but no session expiry (`packages/contracts/src/auth.ts:35-45`).
- No OAuth/provider, callback, state/nonce, account-linking or sign-out-everywhere contract exists in `docs/API.md` or the OpenAPI routes.

**Frontend impact**

The Sign in screen cannot be wired. The frontend cannot show “session expires at”, cannot distinguish “not signed in” from “expired”, and cannot implement a real provider flow without guessing routes and payloads. The design library currently omits Sign in rather than invent one.

**Recommended fix**

1. Choose the production identity provider and document the exact browser flow, callback route, failure codes and post-login redirect rules.
2. Add a session contract with `expiresAt` and an explicit `401 UNAUTHORIZED` shape for expired/absent sessions.
3. Gate dev-login on an explicit opt-in flag (not only `NODE_ENV`), require the dev secret for every dev-login, and stop returning raw session IDs in JSON once the cookie is the transport.
4. Document cookie attributes per environment and the CSRF model.

**Acceptance evidence needed**

- Mounted-route tests for successful login, cancelled/failed callback, expired session, logout, and a production-mode request proving dev-login is absent.
- A contract test proving `GET /session` exposes expiry and never exposes a raw session secret.

---

### P0-2. The declared API is much larger than the mounted API

**Evidence**

- Mounted handlers: session (3), workspaces (2), projects (8), invitations (6), members (2) = 21.
- `OPENAPI_ROUTES` declares 67 operations. 50 have no handler; see the missing list in “Status snapshot”.
- `OPENAPI_ROUTES` has no `status`/`implemented` field, so generated documentation cannot distinguish planned from live behavior.
- `docs/API.md` describes boards, cards, comments, images, imports, trash, activity, notifications and `/me/tasks` as if they are part of the product contract.

**Frontend impact**

A frontend engineer reading `docs/API.md` or the OpenAPI document will code against routes that return `404`. This is the largest source of accidental integration claims.

**Recommended fix**

1. Add `status: 'implemented' | 'planned'` (and optionally `since`) to every OpenAPI operation and generate the docs from it.
2. Mount or explicitly mark each missing group. Do not let a declared operation imply a working handler.
3. Add a CI check that every `status: 'implemented'` operation has a mounted handler and a route-level test.
4. Publish a small “UI-ready operations” list per release.

**Acceptance evidence needed**

- A test or script that compares declared implemented operations with mounted handlers.
- The first UI handoff names only operations that pass that check.

---

### P0-3. The error contract cannot be safely consumed by the frontend

**Evidence**

- `errorDetailSchema.code` is `z.string()` and `details` is `z.record(z.unknown())` (`packages/contracts/src/common.ts:28-33`).
- `STANDARD_ERROR_CODES` (`common.ts:3-23`) omits codes the runtime emits, including `MALFORMED_REQUEST`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `DEADLINE_EXCEEDED`, `IDEMPOTENCY_KEY_REQUIRED` and `IDEMPOTENCY_CONFLICT`.
- Invitation/member adapters also throw `ALREADY_MEMBER`, `INVITATION_ALREADY_EXISTS`, `INVALID_INVITATION`, `INVITATION_EXPIRED`, `EMAIL_MISMATCH` and `INVITATION_SUPERSEDED`.
- `apps/api/src/http/middleware/error-handler.ts` maps some errors to `VALIDATION_ERROR`, some to `MALFORMED_REQUEST`, and passes adapter codes through unchanged.
- `details` is not typed per code, so field names, limits and restore/preview metadata are not contractually stable.

**Frontend impact**

The failure matrix in `FRONTEND_BEHAVIOR_SPEC.md` requires different UI for stale version, stale cursor, expired preview, restore-window expiry, idempotency conflict, rate limiting, payload too large and validation failure. Today the browser would have to branch on undocumented strings and untyped details. That is exactly the guessing the handoff rules forbid.

**Recommended fix**

1. Make `errorDetailSchema.code` a closed union (or a documented extensible union with a safe fallback) and add every emitted code.
2. Define typed `details` variants per code, for example:
   - `VALIDATION_ERROR`: `{ fields: Array<{ path: string; message: string }> }`
   - `STALE_VERSION`: `{ currentVersion: number }`
   - `STALE_CURSOR`: `{ reason: 'unknown' | 'expired' | 'scope_changed' }`
   - `PAYLOAD_TOO_LARGE`: `{ limitBytes: number; actualBytes?: number }`
   - `RATE_LIMITED`: `{ retryAfterSeconds: number }`
   - restore/preview errors: the authoritative deadline and resource id
3. Standardize one envelope for 400/401/403/404/409/410/413/422/429/5xx and test it at the mounted-route level.
4. Ensure `Retry-After` is present on 429 and `Server-Timing`/request id behavior is documented.

**Acceptance evidence needed**

- Contract tests for each code and details shape.
- Route tests proving the same error shape from middleware, adapter and not-found paths.

---

### P0-4. Global 1 MiB body limit and 5 s deadline conflict with images and imports

**Evidence**

- `apps/api/src/http/app.ts:63-67` applies `bodyLimitMiddleware(1 MiB)` and `deadlineMiddleware(5000 ms)` to every route.
- `packages/contracts/src/images.ts` allows 10 MiB images.
- `docs/IMPORT_SPEC.md` allows a 5 MiB XLSX workbook.
- `apps/api/src/http/middleware/limits.ts:5-6` hard-codes the defaults; `createApp` accepts a single global override only.

**Frontend impact**

Large image uploads and XLSX imports cannot succeed through the mounted app even if the feature routes are added. A 413 from the global limit is indistinguishable from a feature-level limit, and a 5 s deadline can abort a legitimate import commit after it has started.

**Recommended fix**

1. Replace the single global limit with route-class limits: JSON mutations (small), image content (10 MiB + overhead), XLSX upload (5 MiB + overhead), and a documented max for multipart metadata.
2. Replace the single deadline with per-route deadlines; import validation/commit needs a longer, documented budget or an asynchronous job contract.
3. Return `PAYLOAD_TOO_LARGE` with `details.limitBytes` and the route class.
4. Document client retry/abort behavior for `DEADLINE_EXCEEDED`, including the “outcome unknown” case from the behavior spec.

**Acceptance evidence needed**

- Route tests at 1 byte under/over each limit.
- A test proving a long import does not return a misleading 504 after commit, or an explicit job-based contract if it does.

---

### P0-5. Invitation tokens are exposed and there is no safe preview/acceptance contract

**Evidence**

- `invitationSchema.token` is optional (`packages/contracts/src/invitations.ts:28-39`).
- `POST /projects/:pid/invitations` returns `token: rawToken` (`apps/api/src/http/routes/invitations.ts:80-92`).
- Resend returns a raw token as well; the idempotency receipt stores the response body containing it.
- `GET /projects/:pid/invitations` returns `nextCursor: null` and has no status filter (`invitations.ts:200-218`).
- No invitation preview route exists. Acceptance requires an authenticated session plus an `Idempotency-Key`.
- `docs/API.md` does not define a token-safe preview shape or a token-free create/resend response.

**Frontend impact**

The Invitation accept screen cannot safely show “You were invited to X as Y” before login, and the admin list cannot page or filter. Returning the raw token to the inviter also makes it easy to leak into logs, analytics, screenshots and idempotency receipts.

**Recommended fix**

1. Remove `token` from `invitationSchema`, create/resend responses and receipt bodies. Deliver the token only through the email/outbox channel (or a one-time server-side handoff).
2. Add `GET /invitations/preview?token=…` returning only safe metadata: project name, inviter display name, role, expiry, status, and whether the signed-in actor’s email matches. No member list, no project description, no token echo.
3. Define preview failure states: invalid, expired, revoked, accepted, superseded, email mismatch, already member.
4. Add cursor pagination and `status` filtering to the invitation list; return bounded results and a real `nextCursor`.
5. Define whether acceptance is idempotent and what the response contains on replay.

**Acceptance evidence needed**

- Tests proving no token appears in any JSON response or receipt row.
- Preview tests for every failure state and for an unauthenticated request.
- Pagination/filter tests with more than one page.

---

### P0-6. The member directory is broader than the documented administration view and is unpaginated

**Evidence**

- `GET /projects/:pid/members` is described as an Owner/Manager administration view in `docs/API.md:36` and `OPENAPI_ROUTES` (`minimumRole: 'manager'`).
- The mounted handler calls `getProjectMembers` (`apps/api/src/http/routes/projects.ts:328-337`), which authorizes any active project role (`apps/api/src/adapters/projects.ts:378-384`).
- The response includes member emails (`projects.ts:77-88`).
- It returns every membership with `nextCursor: null` and synthesizes the workspace owner with `membershipId: pm_owner_<id>` and `version: 1`.
- `PATCH /members/:uid` requires both `role` and `status` (`packages/contracts/src/projects.ts:36-40`), so a role-only change is not expressible.
- `DELETE /members/:uid` has no `expectedVersion` and no declared OpenAPI operation.

**Frontend impact**

The People screen can show a directory that is broader than the documented role boundary, leaks emails to viewers, and cannot paginate. The UI cannot safely implement role-only edits or optimistic concurrency on removal.

**Recommended fix**

1. Decide and document the intended reader set. If this is an admin view, enforce Owner/Manager at the handler and keep the picker on `GET /people` for viewers.
2. If all project roles must see the roster, define a separate privacy-safe shape (display name/avatar/role, no email) and keep emails for admins only.
3. Add cursor pagination with a stable sort and return `nextCursor`.
4. Stop synthesizing the owner membership; expose the owner as an explicit inherited principal (the access-summary shape already has this idea) or give it a real stable identifier.
5. Allow partial `PATCH` input (`role?`, `status?`, `expectedVersion`) with a “at least one field” refinement.
6. Add `expectedVersion` to `DELETE` and declare the operation in OpenAPI.

**Acceptance evidence needed**

- Role-matrix tests for Owner, Manager, Member, Viewer and outsider.
- Pagination test with a stale/invalid cursor.
- PATCH tests for role-only, status-only, both, and stale version.
- DELETE test for stale version.

---

### P0-7. Idempotency replay can bypass current authorization

**Evidence**

- `POST /projects/:pid/invitations` checks the receipt before `createInvitation` acquires the write grant (`apps/api/src/http/routes/invitations.ts:47-69`).
- Resend and revoke do the same (`invitations.ts:245-258`, `:330-345`).
- `PATCH /projects/:pid/members/:uid` and `DELETE` replay before `updateProjectMember`/`removeProjectMember` reauthorize (`apps/api/src/http/routes/members.ts:39-69`, `:103-...`).
- `PATCH /projects/:pid` is the counter-example: it rechecks the current role before replay (`projects.ts:275-286`).
- `docs/API.md` requires a current access recheck on replay.

**Frontend impact**

A removed or demoted actor can replay an old key and receive a previously authorized response, or trigger a stale mutation path. The frontend cannot compensate for this; it is a server invariant.

**Recommended fix**

1. Extract one `authorizeReplay(actor, scope, methodPath)` check and call it before every replay return.
2. Recompute the current role/status from the database, not from the receipt.
3. If access is gone, return the same privacy-preserving `404 NOT_FOUND` used by the live path (or `403 FORBIDDEN` where the live path does).
4. Add a test that revokes the actor between the first request and the replay, then asserts the replay is denied.

**Acceptance evidence needed**

- Replay-after-revocation tests for invitation create/resend/revoke and member PATCH/DELETE.
- A test that a legitimate replay still returns the original result.

---

### P0-8. Logout and session-expiry contracts disagree with the runtime

**Evidence**

- `POST /session/logout` returns `204` with no body (`apps/api/src/http/routes/session.ts:65`).
- `logoutResponseSchema` expects `{ data: { success: true } }` (`packages/contracts/src/auth.ts:47-51`).
- `GET /session` has no `expiresAt`.
- The cookie options and clear-cookie options duplicate fields (`apps/api/src/adapters/session.ts:18-32`), which invites drift.

**Frontend impact**

A schema-validating client rejects the logout response or treats a successful logout as malformed. The UI also cannot show or react to expiry.

**Recommended fix**

1. Choose one logout contract. If 204 is intentional, remove `logoutResponseSchema` and document “no body”. If JSON is intentional, return the envelope.
2. Add `expiresAt` to the session response.
3. Share one cookie-options type between set and clear.
4. Document the client behavior for an expired session on a protected route (`401` + redirect to sign-in, preserving a safe return path).

**Acceptance evidence needed**

- Contract/runtime agreement test for logout.
- Session response test with expiry.
- Expired-session route test.

---

## P1 — screen-specific contract gaps

### Projects and Project overview

**Gaps**

1. `GET /projects` returns `role` at runtime (`apps/api/src/adapters/projects.ts:211-221`), but `projectListResponseSchema` uses `projectSchema`, which omits `role` (`packages/contracts/src/projects.ts:56-71`). A validating client loses the field that decides which actions to show.
2. `GET /workspaces/:wid/projects` returns no `role` and has no archive filter (`apps/api/src/adapters/projects.ts:98-115`). Owners see all projects; members see granted projects including archived ones. The UI cannot implement “active vs archived” without client-side filtering of an incomplete page.
3. `projectSchema` has `isArchived` but no `archivedAt`/`archivedBy`; the DB has only `archived BOOLEAN` (`database/migrations/0001_initial.sql:26-35`).
4. No mounted archive/reopen handlers, despite OpenAPI declarations.
5. No project counts (boards, members, active cards) in the list/detail contract, although the design shows them.

**Recommended fix**

- Add `role` to `projectSchema` or create a distinct `projectListItemSchema` with `role`.
- Add an explicit `archived` query filter (`active | archived | all`, default active) to both list routes and apply it in SQL before pagination.
- Add `archivedAt`/`archivedBy` to the contract and migration, and populate them on archive/reopen.
- Mount archive/reopen or mark them planned.
- Add counts only if they are cheap and authorized; otherwise remove them from the UI or compute them from a separate bounded endpoint.

**Screen readiness:** list/create can be partially wired after the role/filter fix; archive/reopen and counts remain blocked.

### People

**Gaps**

1. The people cursor is an id, not an opaque cursor; a stale/unknown id silently restarts at index 0 (`apps/api/src/adapters/rbac.ts:453-460`).
2. The project cursor decoder returns `null` for malformed input and restarts at the beginning (`apps/api/src/adapters/projects.ts:38-50`).
3. `GET /people` and `GET /members` overlap but have different shapes and authorization. The frontend needs a clear rule for which to call.
4. `PersonDisplay.scopedRole` is optional and can be `owner`, while `projectRoleSchema` excludes `owner`; the UI must handle an inherited owner carefully.

**Recommended fix**

- Make cursors opaque and versioned; return `409 STALE_CURSOR` with a safe reason instead of silently restarting.
- Document the People vs Members split with a decision table.
- Define the owner representation once and reuse it.

**Screen readiness:** display/picker can be wired with client-side care; administration remains blocked by P0-6.

### Inbox and Activity

**Gaps**

1. Activity `action` is `z.string()` and `safeChanges` is `z.record(z.unknown())` (`packages/contracts/src/discussion.ts:88-98`), so the UI cannot render typed facts.
2. Notifications lack `projectId`, `cardId`, actor display data, `readAt` and an unread count (`discussion.ts:110-119`).
3. There is no response schema for `POST /notifications/:id/read`.
4. No mounted notification/activity routes.
5. The Inbox design has “Mark all as read”, while `docs/FRONTEND_BEHAVIOR_SPEC.md:106` says “Do not add mark-all notifications.” This is a product conflict, not just a backend gap.

**Recommended fix**

- Replace `action: z.string()` with a closed action union and a discriminated `safeChanges` schema per action.
- Add `projectId`, `cardId`, actor summary and `readAt` to notifications; define an unread-count field or endpoint.
- Define the read response as the updated notification (or a mutation receipt) and make it idempotent.
- Resolve the mark-all conflict with the Architect before implementing either side.

**Screen readiness:** synthetic only until the action/notification contract and routes exist.

### My tasks

**Gaps**

- `GET /me/tasks` is declared in OpenAPI but has no mounted handler and no response schema.
- `cardSummarySchema` lacks project/board context, so a cross-project task list cannot render where a card lives (`packages/contracts/src/cards.ts:79-94`).
- No sort/filter contract for due date, priority or project.

**Recommended fix**

- Define `myTaskSchema` with card summary + project id/name + board id/name + column id/name + role-safe links.
- Define filters (`due`, `priority`, `projectId`), a stable sort and opaque pagination.
- Mount the route and test that it only returns cards from currently accessible projects.

**Screen readiness:** blocked.

### Board and card detail

**Gaps**

1. `cardSchema` has `assigneeIds` and `imageCount` but no `people` display objects and no finalized image metadata (`cards.ts:96-117`).
2. `cardSummarySchema` has no project context.
3. `boardSnapshotQuerySchema.due` is `z.string()` rather than the `cardDueFilterSchema` enum (`packages/contracts/src/boards.ts:174-180`).
4. No mounted board/card/comment/image routes.
5. Search is declared but has no schema beyond the route description.

**Recommended fix**

- Add `people: PersonDisplay[]` and `images: CardImage[]` (bounded) to card detail, or document separate bounded endpoints the UI must call.
- Reuse `cardDueFilterSchema` in the board query.
- Define the search response as card summaries with project/board context.
- Mount and test the routes before UI wiring.

**Screen readiness:** the approved board artifact remains synthetic; real wiring is blocked.

### Import

**Gaps**

1. `importRowSchema` has no description excerpt, despite the import spec requiring a preview of the description (`packages/contracts/src/imports.ts:42-53`).
2. `updateImportMappingsInputSchema.mappings` is `z.record(z.string())` with no mapping-table shape, allowed source columns or validation result.
3. `importStatusSchema.rows` is an unbounded array with a `nextCursor`, which is ambiguous: is the array the page or the whole preview?
4. No mounted import routes; no route-specific 5 MiB limit (see P0-4).
5. The template route has no contract test for content type, filename or checksum.

**Recommended fix**

- Add a bounded `descriptionExcerpt` and document truncation.
- Define a typed mapping table (source header, target field, required, sample value, validation state).
- Make the rows page explicit: `rows` is the current page, `nextCursor` pages it, and `counts` is global.
- Add route-specific body limits and tests for malformed XLSX, wrong MIME type, oversized workbook, formula/date edge cases and duplicate external IDs.

**Screen readiness:** synthetic only.

### Trash and images

**Gaps**

1. `card_images` has no `version`, `width`, `height` or `deleted_at` (`database/migrations/0001_initial.sql:177-190`), while the image contract/lifecycle needs versioned deletion and dimensions.
2. No mounted trash/image routes.
3. Trash list metadata needs actor and `restoreUntil`; the contract exists but the DB/runtime do not.
4. Image content/thumbnail access must recheck current project/card visibility; no handler exists to prove it.

**Recommended fix**

- Add the missing image columns and a migration/backfill plan.
- Mount the routes with authorization tests for removed access, trashed cards and archived projects.
- Define the exact 410/409 behavior for expired restore and stale image versions.

**Screen readiness:** synthetic only.

### Settings

**Gaps**

1. No account/profile update contract beyond session read.
2. No workspace update/transfer-owner handlers, despite OpenAPI declarations.
3. No session expiry or sign-out-everywhere contract.
4. The design’s notification preferences have no backend model.

**Recommended fix**

- Decide whether Settings is read-only for v1. If so, remove unsupported controls.
- Otherwise define profile, workspace and preference contracts with validation and authorization.
- Add session expiry and a documented logout response.

**Screen readiness:** partially synthetic; only session read can be wired after P0-1/P0-8.

---

## P2 — hardening and contract cleanup

1. **CSRF/Origin:** `docs/API.md` describes Origin enforcement, but no middleware checks `Origin`/`Sec-Fetch-Site` (grep found none under `apps/api/src`). Add it for cookie-authenticated mutations, with an explicit allowlist and tests.
2. **Cookie policy:** document `HttpOnly`, `SameSite`, `Secure`, `Path` and max-age per environment; test that production never issues a non-secure cookie.
3. **Dev-login:** replace the `NODE_ENV` check with an explicit flag, require the secret for all dev-login requests, and never return the session id in JSON.
4. **Idempotency receipts:** stop storing token-bearing response bodies; define receipt expiry and cleanup; add a test that an expired receipt does not replay.
5. **Cursor semantics:** return `409 STALE_CURSOR` for invalid/expired cursors instead of silently restarting (people and projects).
6. **OpenAPI status:** add `implemented | planned` and a CI parity check (see P0-2).
7. **Not-found shape:** ensure `notFoundHandler` and the error handler agree on the envelope for unknown routes.
8. **Rate limiting:** if `TOO_MANY_REQUESTS` is emitted, document the limit, window and `Retry-After`; otherwise remove the code path.
9. **`SERVICE_UNAVAILABLE`:** document when it is returned and whether it is retryable.
10. **Request IDs:** document the `x-request-id` contract and whether clients may supply one.
11. **Deadline semantics:** document whether a 504 can occur after commit and what the client should do.
12. **Contract fixtures:** add fixtures for every error code and for archived/trashed/removed-access states so frontend tests can use them.

---

## Screen readiness matrix

| Screen | Can wire today? | Blocker |
|---|---|---|
| Sign in | No | P0-1 (no production flow), P0-8 (expiry) |
| Invitation accept | No | P0-5 (no preview, token exposure) |
| Projects list | Partial | P1 role/filter/counts; create is available |
| Project overview | Partial | P1 archive metadata; boards/cards routes missing |
| Board / card detail | No | Board/card/comment/image routes missing; P1 detail shape |
| Add card | No | Card create route missing |
| People | Partial | P0-6 (authorization/pagination), P1 cursor |
| Inbox | No | P1 notification/activity contract and routes |
| Activity | No | P1 typed actions and routes |
| My tasks | No | P1 no route/schema |
| Trash | No | P1 routes and DB metadata |
| Import | No | P0-4 limits, P1 mapping/report contract, routes |
| Settings | Partial | P0-1/P0-8; profile/preferences undefined |

“Partial” means some read paths could be wired with synthetic fallbacks, but the screen would not meet the behavior checklist and should not be claimed as integrated.

---

## Recommended backend order

1. **Contract truth:** P0-2 OpenAPI status + parity check, P0-3 error union/details.
2. **Auth/session:** P0-1 production sign-in, P0-8 logout/expiry.
3. **Safety:** P0-7 replay authorization, P0-6 member directory boundary, P0-5 invitation token/preview.
4. **Runtime limits:** P0-4 route-class body/deadline limits.
5. **Screen contracts:** project role/filter/archive metadata, notifications/activity, My tasks, card detail, import mappings.
6. **Route implementation:** boards/cards/comments/images/trash/imports in the order the UI will consume them.
7. **P2 hardening** as the routes land.

Do not mark a feature UI-ready until its backend handoff references a passing independent review and the UI has a matching integration record.

---

## Evidence and reproduction

Commands used for this review (run from the repository root):

```bash
git rev-parse HEAD
grep -n "Routes\.\(get\|post\|patch\|delete\|put\)(" apps/api/src/http/routes/*.ts
grep -n "method: '" packages/contracts/src/openapi/index.ts
grep -n "path: '/" packages/contracts/src/openapi/index.ts
nl -ba apps/api/src/http/app.ts
nl -ba apps/api/src/http/middleware/limits.ts
nl -ba apps/api/src/http/middleware/error-handler.ts
nl -ba packages/contracts/src/common.ts
nl -ba packages/contracts/src/auth.ts
nl -ba packages/contracts/src/projects.ts
nl -ba packages/contracts/src/invitations.ts
nl -ba packages/contracts/src/discussion.ts
nl -ba packages/contracts/src/cards.ts
nl -ba packages/contracts/src/boards.ts
nl -ba packages/contracts/src/imports.ts
nl -ba database/migrations/0001_initial.sql
```

The mounted/declared comparison is reproducible by extracting `method`/`path` pairs from `packages/contracts/src/openapi/index.ts` and normalizing `:param` to `{param}`. Current result: 67 declared operations, 17 matched, 50 without a handler, 4 mounted without a declaration.

## What this document does not claim

- It does not change any backend code, contract, migration or review record.
- It does not re-review the 22 passing backend features; it reviews the frontend-facing surface they expose.
- It does not approve the 49 proposed frontend safeguards. Those need explicit product agreement before they become mandatory scope.
- It does not verify the design screens against a live API. All screen behavior remains synthetic.
- It does not override `BACKEND_REVIEW_GATE.md`; the backend owner still needs a fresh independent review for every change.
