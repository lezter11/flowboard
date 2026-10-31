# docs/API.md drift audit (read-only)

Date: 2026-10-31. Auditor: Haiku 5.5 (read-only; no files edited except this report).
Base for all paths: `/Users/shubham/Documents/Flowboard/`. Doc = `docs/API.md` (224 lines). Code = `apps/api/src`. Contracts = `packages/contracts/src`.
Verification: "verified" means both the doc line and the code line were read. "inferred" means the conclusion rests on a grep or on a partial trace.

## Summary

| Area | Items checked | Drift items | Matches |
|---|---|---|---|
| (1) Routes, code to doc and doc to code | 95 route registrations in `routes/*.ts` plus 2 in `app.ts` | 7 rows covering 17 undocumented routes; 0 doc routes missing from code | all doc route rows |
| (2) Retired and changed routes | 6 | 1 (POST /api/v1/projects has no doc row) | 5 |
| (3) Error codes | 104 catalog codes, all HttpError and code literals in `apps/api/src` | 10 | catalog statuses match thrown statuses except 6 sites (4 intended dual-status) |
| (4) Response fields and details | 8 | 2 | 6 |
| (5) `FB_LIMIT_*` env | 6 names, defaults, parser | 0 | all |
| **Total drift items** | | **19 rows** (2 are doc gaps with no code change) | |

Undocumented codes: 71 catalog codes that carry an HTTP status are not named in `docs/API.md`. 13 more catalog codes have status 0 (row-level import outcomes, not HTTP).

Top five mismatches:
1. `POST /api/v1/projects` and `GET /api/v1/projects` are live in code (`projects.ts:195`, `projects.ts:82`) but have no row in `docs/API.md`. The new create route, with its strict body and Idempotency-Key, is only mentioned in prose (`API.md:41`).
2. `NAME_REQUIRED` is thrown as 409 (`invitations.ts:90,158`, via `NAME_REQUIRED_CODE` in `contracts/src/auth.ts:107`) and documented (`API.md:60,70`), but it is missing from `ERROR_CATALOG` (`common.ts:7-112`).
3. `QUOTA_EXCEEDED` docs name 4 of the 6 scopes and omit remedies `archive_project` and `archive_board`. The missing scopes are `owned_projects` and `boards_per_project` (`API.md:3,67`; `quotas.ts:8`, `common.ts:249-251`).
4. Catalog status is 0 for `DATABASE_UNAVAILABLE` (returned as 503 at `app.ts:163`) and `MIGRATION_FAILED` (returned as 500 at `system.ts:70`). The docs name neither code.
5. Undocumented operator and legacy routes: `POST /api/v1/system/migrate` (a mutating route, `system.ts:22`), `GET /api/v1/system/status`, `GET /health/live` and `GET /health/ready`, and the legacy board import family `/api/v1/imports/...` and `/api/v1/import/template` (`imports.ts:76-350`). `API.md` documents only the `card-imports` family (`API.md:196-202`).

---

## (1) Routes

Doc to code: every route row in `docs/API.md` (sections S1 to S5, lines 33 to 204) maps to a registration in `apps/api/src/http/routes/*.ts`. Path params are compared by shape (`:pid` = `:projectId`). Result: 0 missing in code.

Code to doc: 17 registered routes are not in `docs/API.md`.

| # | Doc file:line | Code file:line | What differs | Suggested doc fix | Status |
|---|---|---|---|---|---|
| R1 | `docs/API.md:41` and `:45` | `apps/api/src/http/routes/projects.ts:195` (`POST /api/v1/projects`) | Route is live, with `authMiddleware`, an actor check, and an Idempotency-Key path (`projects.ts:221`). It has no row. Line 41 only says "Create projects with POST /api/v1/projects". Line 45 documents only `POST /workspaces/:wid/projects`. | Add a row: `POST /projects {name, description?}`, strict body, Idempotency-Key, personal-workspace project create, rate limits. Link it from line 41. | verified |
| R2 | (absent) | `apps/api/src/http/routes/projects.ts:82` (`GET /api/v1/projects`) | Live list route with no doc row. | Add a row for the list: scope (owned plus accessible), pagination, what it returns. | verified |
| R3 | (absent; `docs/API.md:21` says the access model is pending) | `apps/api/src/http/routes/board-grants.ts:49` (`GET /api/v1/boards/:boardId/access`) | Live route, not documented. Line 21 says the grant contract is "revision pending", so the row is missing rather than wrong. | Add a row marked "board-access cutover pending" with its authority rule. | verified |
| R4 | (absent; doc has only `card-imports`, `API.md:196-202`) | `apps/api/src/http/routes/imports.ts:76` (`GET /api/v1/import/template`), `:78` (`GET /api/v1/boards/:boardId/import-template`), `:141` (`POST /api/v1/boards/:boardId/imports`), `:171` (`GET /api/v1/imports/:importId`), `:200` (`POST .../imports/:importId/mappings`), `:291` (`POST .../imports/:importId/commit`), `:317` (`DELETE .../imports/:importId`), `:350` (`GET .../imports/:importId/report`) | Eight live routes in the board-import (non-card) family. The doc describes only the `card-imports` family. | Document the `/imports` family, or mark it legacy with its removal plan. | verified |
| R5 | (absent) | `apps/api/src/http/routes/activity.ts:21` (`GET /api/v1/activity/health`), `apps/api/src/http/routes/notifications.ts:21` (`GET /api/v1/notifications/health`) | Health probes under `/api/v1` with no doc row. | Add one line under "Scheduled maintenance": health probes, unauthenticated, never rate-limited (`API.md:11` already says health is never limited). | verified |
| R6 | (absent) | `apps/api/src/http/routes/system.ts:9` (`GET /api/v1/system/status`), `:22` (`POST /api/v1/system/migrate`) | Operator routes. `migrate` mutates the schema and returns `MIGRATION_FAILED` (`system.ts:70`). Neither route is documented, and the doc does not say who may call them. | Add a short "Operator" section: both routes, the authority required, and the mutation warning for `migrate`. | verified |
| R7 | (absent) | `apps/api/src/http/app.ts:154` (`GET /health/live`), `:155` (`GET /health/ready`) | Platform health routes at the root, outside `/api/v1`. `/health/ready` returns `DATABASE_UNAVAILABLE` 503 (see E5). | Add the two root health routes and their response shapes. | verified |

Checked and matching (no action): `POST /workspaces` retired (`API.md:41`; `workspaces.ts:19-23`); `GET /workspaces` owned only (`API.md:40`; `workspaces.ts:26-45`); `POST /workspaces/:wid/transfer-ownership` retired (`API.md:43`; `workspaces.ts:160-163`); `PATCH /session/name` (`API.md:36`; `session.ts:111-121`); `GET /projects/:pid/people?purpose=assignee` without `boardId` gives 422 `BOARD_REQUIRED` (`API.md:54`; `projects.ts:473`).

Mount check: `app.ts:174-189` mounts each route file. `board-grants-draft.ts` only re-exports `boardGrantsRoutes` and registers nothing, so it adds no route.

---

## (2) Retired and changed routes

Verified against the list in the brief:

| Route | Doc | Code | Result |
|---|---|---|---|
| POST /api/v1/workspaces | `API.md:41`: 410 `WORKSPACE_CREATE_RETIRED`, anonymous 401 | `workspaces.ts:19-23`: `authMiddleware` first, then 410 | match |
| POST /api/v1/workspaces/:id/transfer-ownership | `API.md:43`: 410 `TRANSFER_OWNERSHIP_RETIRED` | `workspaces.ts:160-163`: 410 after `authMiddleware` | match |
| GET /api/v1/workspaces, owned only | `API.md:40` | `workspaces.ts:26-45`: `WHERE w.owner_id = $1` | match |
| POST /api/v1/projects, strict body, Idempotency-Key | Only prose at `API.md:41` | `projects.ts:195-221` | **drift, see R1** |
| PATCH /api/v1/session/name | `API.md:36` | `session.ts:111-121`; `contracts/src/auth.ts:88-94` (`.strict()`), `NAME_PART_MAX = 60` (`auth.ts:64`) | match |
| GET /projects/:pid/people, purpose=assignee needs boardId, else 422 BOARD_REQUIRED | `API.md:54` | `projects.ts:470-474`; `contracts/src/projects.ts:201-208` | match |

---

## (3) Error codes

### (3a) Catalog to doc and code

Catalog: `packages/contracts/src/common.ts:7-112` (104 codes). Every catalog code has a literal in `apps/api/src`. The doc names 20 of them: `ALREADY_FINALIZED`, `ASSIGNEE_NOT_ELIGIBLE`, `BOARD_ARCHIVED`, `BOARD_REQUIRED`, `COMMIT_IN_PROGRESS`, `CONFIG_ERROR`, `INVITATION_EXPIRED`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `PREVIEW_EXPIRED`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `READ_ONLY_CONTEXT`, `RESTORE_DESTINATION_REQUIRED`, `RESTORE_WINDOW_EXPIRED`, `SERVICE_UNAVAILABLE`, `STALE_CURSOR`, `TRANSFER_OWNERSHIP_RETIRED`, `VALIDATION_ERROR`, `WORKSPACE_CREATE_RETIRED`. None is documented but never thrown.

Thrown but not in the catalog: `NAME_REQUIRED` (see E1). Image-upload codes stored in the database are also outside the catalog (see E9).

### (3b) Undocumented codes (verified)

71 catalog codes with an HTTP status are not named in `API.md`. Most are reached through `HttpError` in the adapters. Examples with a code site: `ACCESS_CHANGED` (`adapters/boards.ts:1468`), `CARD_TRASHED` (`adapters/images.ts:168`), `COLUMN_HAS_ACTIVE_CARDS` (`adapters/boards.ts:874`), `CSRF_MISMATCH` (`http/routes/google-auth.ts:129`), `DUPLICATE_COLUMN_NAME` (`adapters/boards.ts:483`), `EMAIL_NOT_VERIFIED` (`http/routes/google-auth.ts:184`), `IDEMPOTENCY_KEY_REQUIRED` (`http/routes/comments.ts:79` and 27 more), `INVALID_CURSOR` (`http/routes/board-grants.ts:65`), `STALE_VERSION` (`adapters/comments.ts:514`), `UPLOAD_EXPIRED` (`adapters/images.ts:273`), `INTERNAL_ERROR` (`adapters/own-projects.ts:64`), `DEADLINE_EXCEEDED` (`http/errors.ts:237`), plus about 30 import-file codes (`services/excel-parser.ts`, such as `INVALID_WORKBOOK` at line 71 and `XXE_DETECTED` at line 215).

Doc fix for the group: add one table, "Error code catalogue", that links to `ERROR_CATALOG`, or state that the catalogue is the source. Status: verified.

The 13 status-0 codes are row-level import outcomes, not HTTP errors: `ASSIGNEE_LIMIT_EXCEEDED` (`excel-parser.ts:732`), `DUPLICATE_IN_BATCH` (`adapters/imports.ts:343`), `IMPORT_CONFLICT` (`adapters/imports.ts:408`), `INVALID_DATE` (`excel-parser.ts:696`), `INVALID_EMAIL_FORMAT` (`excel-parser.ts:741`), `INVALID_PRIORITY` (`excel-parser.ts:679`), `MAX_LENGTH_EXCEEDED` (`excel-parser.ts:639`), `NUMERIC_ID_REJECTED` (`excel-parser.ts:627`), `REQUIRED` (`excel-parser.ts:633`), `UNKNOWN_OR_INELIGIBLE_ASSIGNEE` (`adapters/imports.ts:359`), `UNRECOGNIZED_STATUS` (`adapters/imports.ts:374`), plus `DATABASE_UNAVAILABLE` and `MIGRATION_FAILED` (E5, E6). Doc fix: say in `API.md` that row outcomes are not HTTP errors. Status: verified.

### (3c) Drift rows

| # | Doc file:line | Code file:line | What differs | Suggested doc fix | Status |
|---|---|---|---|---|---|
| E1 | `docs/API.md:60`, `:70` (documents `NAME_REQUIRED` 409) | `packages/contracts/src/auth.ts:107` (`NAME_REQUIRED_CODE`); thrown at `apps/api/src/http/routes/invitations.ts:90`, `:158` (409); catalog `packages/contracts/src/common.ts:7-112` has no entry | Thrown and documented, but missing from `ERROR_CATALOG`. Any client or type that checks codes against the catalog rejects it. | Add `NAME_REQUIRED: { status: 409, hasDetails: false }` to `ERROR_CATALOG`. | verified |
| E2 | `docs/API.md:11` (lists 400 and 422 for classes, no VALIDATION_ERROR status) | `packages/contracts/src/common.ts:108` (`VALIDATION_ERROR` 422 only). Thrown as 400 at `apps/api/src/adapters/boards.ts:1018`, `:1028`, `apps/api/src/adapters/comments.ts:244`, `apps/api/src/http/routes/boards.ts:564` | Dual status is intentional (per the brief). The doc does not record the 400 case. The catalog records only 422. | Add to `API.md:11`: "VALIDATION_ERROR is 422 for body fields and 400 for missing or out-of-range placement anchors and version parameters." Record both statuses in the catalog. | verified |
| E3 | `docs/API.md:50` (`BOARD_ARCHIVED` 422 for `defaultBoardId`) | `packages/contracts/src/common.ts:14` (409 only). Thrown 422 at `apps/api/src/adapters/projects.ts:324`. Thrown 409 at `apps/api/src/adapters/imports.ts:251`, `:940` | Dual status is intentional. The doc covers only 422, and the catalog only 409. | Add to `API.md:50`: "409 when a board import targets an archived board; 422 for defaultBoardId." Record both in the catalog. | verified |
| E4 | `docs/API.md:60` (accept: "safe wrong/expired/revoked state", no status), `:68` (resend 409) | `packages/contracts/src/common.ts:68` (400). Accept thrown 400 at `apps/api/src/adapters/invitations.ts:335`. Resend thrown 409 at `apps/api/src/adapters/invitations.ts:556` | Dual status is intentional. Accept's 400 is not documented. | Add to `API.md:60`: "accept of an expired invitation is 400 INVITATION_EXPIRED". | verified |
| E5 | (not documented) | `packages/contracts/src/common.ts:29` (`DATABASE_UNAVAILABLE` status 0). Returned as 503 at `apps/api/src/http/app.ts:163-172` (`/health/ready`) | Catalog status 0 contradicts the 503 response. The doc does not name the code. | Set catalog status to 503. Add `DATABASE_UNAVAILABLE` to the health section of `API.md` (see R7). | verified |
| E6 | (not documented) | `packages/contracts/src/common.ts:73` (`MIGRATION_FAILED` status 0). Returned as 500 at `apps/api/src/http/routes/system.ts:70` | Catalog status 0 contradicts the 500 response. Not documented. | Set catalog status to 500. Document it with R6. | verified |
| E7 | (absent) | Catalog 71 HTTP-status codes (see 3b) | Not named in the doc. | See 3b. | verified |
| E8 | `docs/API.md:11` and the section "Errors" | `apps/api/src/http/errors.ts:25-119` (`MALFORMED_REQUEST` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` default 409) | The doc gives status classes and omits the code names `MALFORMED_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`. `FORBIDDEN` is the most common code in the source (49 sites). | Name the defaults in `API.md:11`: `MALFORMED_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`. | verified |
| E9 | `docs/API.md:214` (ImageUpload `error` is `{code,message,retryable}`, no code list) | `apps/api/src/adapters/images.ts:294-300` writes `code` from `ImageValidationError` or `INVALID_IMAGE`. Codes: `REJECTED_FORMAT` (`services/image-validator.ts:54`), `MALFORMED_IMAGE` (`:66`, `:80`), `MIME_SPOOF_DETECTED` (`:73`, `:99`), `DIMENSIONS_EXCEEDED` (`:328`), `MEGAPIXELS_EXCEEDED` (`:336`), `INVALID_DIMENSIONS` (`:321`), `EMPTY_FILE` (`:277`), `FILE_TOO_LARGE` (`:282`), `UNSUPPORTED_MEDIA_TYPE` (`:313`), `INVALID_IMAGE` (`images.ts:297`). None is in `ERROR_CATALOG`. | Either list these codes under `API.md:214` as the closed set for `ImageUpload.error.code`, or add them to the catalog. | verified (code); client impact inferred |
| E10 | `docs/API.md:3` (scopes `owned_projects_total`, `boards_per_project_total`, remedy `none`), `:67` (scopes `pending_invitations`, `members`; remedies `revoke_invitation`, `remove_member`) | `packages/contracts/src/common.ts:249` (6 scopes), `:251` (remedies `archive_project`, `archive_board` plus the 3 documented). Code: `apps/api/src/adapters/own-projects.ts:17` (`owned_projects`, remedy `archive_project`); `apps/api/src/http/routes/boards.ts:99`, `:872` (`boards_per_project`, remedy `archive_board`); `apps/api/src/adapters/quotas.ts:8` | Doc names 4 of 6 scopes and omits 2 remedies. `owned_projects` and `boards_per_project` are missing entirely. | Add both scopes and remedies to `API.md:3` and `:67`, with the owner-only `current` rule for boards (`boards.ts:99` passes `current` only for the owner). | verified |

Doc to catalog check: no doc code is absent from code. Status: verified.

---

## (4) Response fields and details

| # | Field | Doc file:line | Contract | Code | Result | Status |
|---|---|---|---|---|---|---|
| F1 | `PersonDisplay.nameSuffix` | `docs/API.md:62` (optional, additive; 2, 3, ...) | `packages/contracts/src/common.ts:221` (`int().min(2).nullable().optional()`) | Helper `apps/api/src/services/person-suffix.ts:72`; applied in `apps/api/src/adapters/cards.ts:501` | Match on shape. Full coverage of every endpoint named at line 62 was not traced. | verified (shape); inferred (coverage) |
| F2 | `limits` on GET /session | `docs/API.md:3` says "effective active limits" but gives no shape | `packages/contracts/src/auth.ts:111-118` (`ownedProjects {limit, used}`, `boardsPerProject {limit}`, `membersPerProject {limit}`, `pendingInvitationsPerProject {limit}`) | `apps/api/src/http/routes/session.ts:65-70` | Match, but the doc gives no shape. The total backstops (20/25) are not in `limits`. Doc gap. | Add the shape to `API.md:3`. State that the total backstops are not in `limits`. | verified |
| F3 | `isOwned` per project | `docs/API.md:3` | `packages/contracts/src/auth.ts:27` (optional boolean) | `apps/api/src/adapters/rbac.ts:163` (`isOwned: row.role === 'owner'`, inside `getAccessibleProjects` at `:119`) | Match. Doc does not say it is optional. | verified |
| F4 | `needsName`, `suggestedFirstName`, `suggestedLastName` on GET /session | `docs/API.md:33` | `packages/contracts/src/auth.ts:127-130` (required; suggestions nullable) | `apps/api/src/http/routes/session.ts:72-74` | Match. | verified |
| F5 | ASSIGNEE_NOT_ELIGIBLE `details` (`boardId`, `reasons`, `ineligibleUserIds`, `issues`, `invalidAssigneeIds`) | `docs/API.md:55` | `packages/contracts/src/common.ts` `assigneeNotEligibleDetailsSchema` (reasons enum `no_board_access`, `viewer`, `not_active`) | `apps/api/src/adapters/cards.ts:168-180` | Match. | verified |
| F5b | `reason` value `not_active` meaning | `docs/API.md:55` says `not_active` = "left or never a member" | Same enum | `apps/api/src/services/board-assignees.ts:57-60`: `not_active` is also the fallback when a granted, active, non-viewer user reaches the last line | Code returns `not_active` where doc does not describe it. The branch looks unreachable in practice. | verified (read); inferred (reachability) |
| F6 | QUOTA_EXCEEDED `details` | `docs/API.md:67`, `:3` | `common.ts:249-260` (`scope`, `limit`, `current?`, `remedy`) | `quotas.ts:90-94` | Shape matches. Scopes and remedies incomplete (E10). | verified |
| F7 | RATE_LIMITED `details` (`retryAfterSeconds`, `scope`) | `docs/API.md:61` | `common.ts:282-287` (scope enum `invitations`, `projects`, `general`) | `apps/api/src/adapters/rate-limit-postgres.ts:97-101`; `apps/api/src/services/rate-limit.ts:97-101` (scope mapping); `apps/api/src/services/rate-limit.ts:111` (`EDGE_RETRY_AFTER_SECONDS = 60`); `apps/api/src/http/middleware/rate-limit.ts:61` | Match. | verified |
| F8 | RESTORE_DESTINATION_REQUIRED `details` (`reason`, `boardId`, `columns`) | `docs/API.md:212` | `common.ts:288-294` | `apps/api/src/adapters/trash.ts:605-620` (`reason: 'destination_missing'`, `columns` listed when the caller can read the board) | Match. | verified |

---

## (5) Env variables

| # | Check | Doc | Code | Result | Status |
|---|---|---|---|---|---|
| V1 | Six `FB_LIMIT_*` names | `docs/API.md:3` | `apps/api/src/services/limits.ts:24-30` (`LIMIT_ENV_NAMES`); `apps/api/wrangler.jsonc:19-21` (comment) | Names match in all three places. | verified |
| V2 | Defaults 3, 5, 20, 25, 50, 50 | `docs/API.md:3` | `apps/api/src/services/limits.ts:15-21` (`DEFAULT_LIMITS`); `wrangler.jsonc:19-21` | Match. | verified |
| V3 | Value rule: whole numbers 1 to 1000, otherwise default | `docs/API.md:3` | `apps/api/src/services/limits.ts:34-38` (`^\d{1,4}$`, 1 to 1000, else fallback) | Match. | verified |
| V4 | Tests use the same names | n/a | `apps/api/test/b18-backstops-session.test.ts:40-59`, `:120-122` | Consistent. | verified |

Stale names found in other files, not in `API.md`: `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md:47` says the earlier Architect message used `MAX_*` names, and `:75` and `:132` record the switch to `FB_LIMIT_*`. This is historical context only, not a drift in `API.md`.

---

## Notes and limits of this audit

- No database, network or secret was touched. Environment variable values were not read; only names and defaults in source.
- Route extraction was done with a regex over `routes/*.ts` (method calls with a literal path, including multi-line calls at `invitations.ts:286` and `:393`) plus the mount table in `app.ts:174-189`. Route-level authorization was not reviewed.
- Error statuses were compared from literal `HttpError` call sites. Helper statuses come from `apps/api/src/http/errors.ts`. Calls that build a code at runtime were not traced.
- Doc sections on the authorization model and the board-access cutover (`API.md:19-27`, `:21` in particular) are marked pending in the doc itself, so they were not checked against code.
