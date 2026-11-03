# Identity, access, projects and invitations: source discovery

Source: `917706ae0433df471c72736be4d548eb022236c4`. Date: 2026-11-03. Assigned stable IDs: 29.

## Actions

All 29 assigned features have source/test candidates; no feature is freshly verified or approved by this discovery. Retired workspace/transfer and old all-board inheritance rows require honest stable-ID reconciliation, not reimplementation.

This pass read source, contracts, tests and dated handoffs only. No tests, installs, database/cloud operations, credential reads, source edits, scoring or approvals occurred. Existing test filenames are candidates for execution, never fresh passing evidence. The paired JSON retains acceptance, specific references, gaps and a sampled SHA-256 dependency manifest.

## Why and options

A project grant is permission to join one project; a board grant is permission to open one board inside it. For example, Sam can appear in Website project while seeing only Marketing board. Granting Website must not reveal Web board counts, cards or people assignments. Owner access stays implicit inside owned projects, and a Manager creating a new board gets that board alone. This adds an indexed permission check but matches the accepted privacy boundary; restoring old all-board inheritance would change the product.

Current accepted limits are 3 active owned projects, 5 active boards/project, 20 total owned projects and 25 total boards including archived, 50 members and pending-seat reservation. Later answers at `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md:129-139` explicitly supersede its earlier unapproved-backstop text. No new approval is needed for those recorded choices.

Workspace create and ownership transfer are intentionally retired in beta. ACC-04 should cover safe personal-workspace ensure; ACC-07 should cover retirement. RBAC-05/INV-01 must disclose separate board grants. Their original catalogue/handoff wording is not current behavior. Keep IDs and supersession provenance, then obtain fresh review against replacement criteria.

## Evidence and limits

### Biggest closure blockers and risk candidates

- **ID-F01 (high; mandatory contract gap, source confirmed)** — Handwritten OpenAPI and historical feature/handoff prose contradict mounted retirement and board-access behavior; no schema-bearing generated agreement demonstrated. Affects FND-02, ACC-04, ACC-07, PRJ-05, RBAC-05. References: packages/contracts/src/openapi/index.ts:1-8; packages/contracts/src/openapi/index.ts:50-80; packages/contracts/src/openapi/index.ts:138-142; docs/handoffs/backend/RBAC-05.json:4.
- **ID-F02 (high; reproduced by root on mounted PostgreSQL)** — Member PATCH reinstatement bypasses shared seat-cap lock/count and ordinary role/status changes omit archived-context lock. Root baseline returned HTTP 200 at cap 1 and stored 2 active members; archived role PATCH returned HTTP 200 and persisted Viewer. See `raw/member-baseline.json` (root-produced evidence inspected by this agent). Affects INV-06, PRJ-04, RBAC-03. References: apps/api/src/adapters/members.ts:42-128; apps/api/src/http/routes/members.ts:97-105.
- **ID-F03 (high; mandatory visibility gap plus privacy source candidate)** — Invitation delivery failure is internal only; exhausted transient retries mark failed without clearing token/recipient/template payload. Affects INV-02, INV-05, FND-04. References: apps/api/src/adapters/invitations.ts:887-921; apps/api/src/adapters/notifications.ts:381-388; apps/api/src/adapters/invitation-delivery.ts:74-82.
- **ID-F04 (medium; policy mismatch; do not call confirmed authority exploit)** — Member/Viewer can read administrative member directory with emails, roles and membership IDs despite narrower catalogue/OpenAPI authority. Affects PRJ-05, RBAC-04. References: apps/api/src/adapters/projects.ts:493-568; apps/api/test/prj02-prj05.test.ts:584-607; packages/contracts/src/openapi/index.ts:138-142.
- **ID-F05 (medium; boundedness gap, source confirmed)** — Invitation list is unbounded across historical outcomes; 50-pending cap does not cap history. Affects INV-05, FND-04. References: apps/api/src/adapters/invitations.ts:887-903.
- **ID-F06 (medium; race coverage gap/source candidate)** — Invitation accept reads project archive state without holding writable-project row lock; sequential archive denial does not prove concurrent archive serialization. Affects INV-03, PRJ-04. References: apps/api/src/adapters/invitations.ts:338-341; apps/api/src/http/routes/projects.ts:617-620.
- **ID-F07 (medium; alternate-route parity gap/source candidate)** — PATCH status removal omits DELETE pending-invitation cleanup; timestamp supersession fence is relevant counterevidence to automatic rejoin exploit. Affects INV-06, INV-07. References: apps/api/src/adapters/members.ts:104-158; apps/api/src/adapters/members.ts:292-305; apps/api/src/adapters/invitations.ts:393-398.

Root supplied and executed the two-case `raw/member-baseline.json` probe on synthetic mounted handlers and PostgreSQL 17.11 at loopback 55931. This survey agent read that JSON after source discovery, and did not run the probe. It confirms ID-F02 on the recorded commit; it does not verify any full feature.

**Criteria reconciliation:** `board-access-decisions-2026-10-27.md:14-20` calls the archived-removal exception a working implementation choice: removing project membership must still revoke effective board access while archived. Root's new repair criteria initially reject every archived membership mutation. Resolve that exception explicitly before repair, preserving distinction between access revocation and role/reinstatement writes.

### Feature-by-feature acceptance and observed implementation

#### FND-01 — Local backend harness

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Pinned Node and actual local workerd start without cloud credentials; both mount the same product routes.
- A fresh disposable PostgreSQL instance proves parameterized query, committed positive control, rollback and safe unavailable DB; close pools/workers.

**Actual source:** Node binds loopback and injects a four-connection pool; Worker injects a request-scoped one-connection pool, 25-second deadline and environment limits. Local workerd tests exist, not just a Worker-shaped Node function.

**Source:** `package.json:11-15`; `apps/api/src/runtime/node.ts:15-34`; `apps/api/src/runtime/worker.ts:49-79`; `apps/api/src/http/app.ts:178-195`.

**Existing test candidates:** `apps/api/test/node.test.ts:9-84`; `apps/api/test/worker.test.ts:15-171`.

**Remaining:** Fresh local runtime/database checks have not run in this survey. Hosted Hyperdrive behavior is explicitly unverified and is not needed for local harness closure.

#### FND-02 — Shared API schemas and fixtures

Status: **mandatory_gap_source**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Request/response schemas and generated OpenAPI describe actual mounted paths, roles, fields, errors, retired routes, OAuth and token restrictions.
- Fixtures exercise distinct project memberships, hidden boards and shared-owner context; route inventory parity fails on undocumented/phantom routes.

**Actual source:** Zod schemas and distinct project fixtures exist. OPENAPI_ROUTES is handwritten descriptive metadata with no request/response schema generation; it advertises obsolete create/transfer and conflicts with live member-directory authority. Existing OpenAPI test only checks version, 30+ route count and logout.

**Source:** `packages/contracts/src/openapi/index.ts:1-8`; `packages/contracts/src/openapi/index.ts:50-80`; `packages/contracts/src/openapi/index.ts:138-142`; `packages/contracts/src/fixtures/index.ts:180-248`; `packages/contracts/test/contracts.test.ts:554-561`.

**Existing test candidates:** `packages/contracts/test/contracts.test.ts:554-561`; `packages/contracts/test/b17-own-projects.test.ts:1`.

**Remaining:** Concrete mandatory gap: no generated schema-bearing OpenAPI agreement evidenced; current catalogue is factually stale. Add mounted route/schema parity and current feature fixture coverage.

#### FND-03 — PostgreSQL schema and migrations

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Clean install plus realistic upgrade to migrations 0001-0020 enforce composite ancestry, versions, uniqueness, receipts and outbox.
- Failure rolls migration back; concurrent runners serialize; 0019 runs twice safely and races with personal-workspace creation; embedded Worker migration SQL equals filesystem SQL.

**Actual source:** PostgreSQL migration runner discovers filesystem migrations or uses embedded SQL, takes an advisory migration lock and commits each migration atomically. 0007 clears board grants on membership status changes; 0019 locks each user during deterministic workspace backfill.

**Source:** `apps/api/src/adapters/migrations.ts:42-123`; `database/migrations/0007_board_grants.sql:12-50`; `database/migrations/0019_personal_workspace_backfill.sql:13-44`; `database/migrations/0020_personal_access_tokens.sql:1`.

**Existing test candidates:** `apps/api/test/migrations.test.ts:31-597`; `apps/api/test/b21-migration-0019.test.ts:48-117`; `apps/api/test/b14-migration-0017.test.ts:1`.

**Remaining:** Read tests and SQL only; no clean/upgrade database evidence captured now. Require dedicated database per destructive migration suite, embedded SQL parity and final migration-version assertions.

#### FND-04 — Failure and observability baseline

Status: **implemented_source_only**. Source confidence: medium. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Correlation IDs, safe error bodies/logs, timing, no-store, origin checks, route body bounds and rate bounds cover actual Node and Worker entry points.
- Slow/dead request, DB refusal, invalid JSON and limiter failure expose no secrets; side-effect timing after an HTTP deadline is explicitly tested and recoverable through command receipts.

**Actual source:** Global middleware is mounted. PostgreSQL statement/query timeouts exist. HTTP deadline delegates to Hono timeout; source alone does not establish that underlying DB/provider work is cancelled. Body cap chooses a larger upload allowance by cookie presence, not session validity. System migration catch returns raw error.message.

**Source:** `apps/api/src/http/app.ts:122-155`; `apps/api/src/http/middleware/limits.ts:15-24`; `apps/api/src/http/middleware/limits.ts:54-58`; `apps/api/src/adapters/postgres.ts:13-23`; `apps/api/src/http/routes/system.ts:66-75`.

**Existing test candidates:** `apps/api/test/observability.test.ts:26-289`; `apps/api/test/rate-limit.test.ts:35-243`; `apps/api/test/origin-check.test.ts:7-61`; `apps/api/test/b7-body-caps.test.ts:42-116`.

**Remaining:** Deadline test covers a slow handler response, not delayed commit cancellation. Test invalid-cookie body caps before calling the large cap authenticated. Assess/sanitize system migration exception details; admin-authenticated scope limits exposure, no external incident established.

#### ACC-01 — Sign in and session

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Google OAuth state/cookie match and verified provider email precede identity/session issuance; failure issues neither.
- One normalized identity and one personal workspace survive concurrent first sign-in; sessions are random bearer secrets stored hashed with secure cookies.
- Hosted Worker never exposes email-only dev login; local opt-in requires proper environment/secret.

**Actual source:** Mounted Google start/callback uses server-side code exchange and verified userinfo email, email upsert, personal-workspace helper, hashed seven-day session, and redirect. Callback failures redirect to fixed sign-in state. Dev login explicitly refuses Worker bindings and requires test mode or deliberate local development configuration.

**Source:** `apps/api/src/http/routes/google-auth.ts:77-109`; `apps/api/src/http/routes/google-auth.ts:121-185`; `apps/api/src/http/routes/google-auth.ts:202-252`; `apps/api/src/http/routes/google-auth.ts:280-289`; `apps/api/src/http/routes/session.ts:145-176`; `apps/api/src/adapters/session.ts:110-135`.

**Existing test candidates:** `apps/api/test/google-auth-system.test.ts:19-128`; `apps/api/test/err-s10-google-redirects.test.ts:1`; `apps/api/test/b17-personal-workspace.test.ts:1`; `apps/api/test/acc01-session.test.ts:11-281`; `apps/api/test/token-boundaries.test.ts:1`.

**Remaining:** Provider fetches in local tests are synthetic; real signed-in UAT OAuth remains a later integration gate. Re-run Node and workerd negative config/callback cases and concurrency with isolated PostgreSQL.

#### ACC-02 — Sign out and expired session

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Logout revokes current hashed server session and clears correctly scoped cookie; repeated/expired logout is safe.
- Expired/revoked sessions cannot use reads, writes, private files or cached replays; UI preserves safe unsent drafts and clears protected content when loss is learned.

**Actual source:** GET session requires auth; middleware fetches nonexpired session per request; logout optionally authenticates then deletes server session and cookie.

**Source:** `apps/api/src/http/routes/session.ts:45-48`; `apps/api/src/http/routes/session.ts:125-140`; `apps/api/src/http/middleware/auth.ts:44-63`; `apps/api/src/adapters/session.ts:151-207`.

**Existing test candidates:** `apps/api/test/acc01-session.test.ts:130-181`; `apps/api/test/acc-lifecycle.test.ts:87-136`; `apps/api/test/origin-check.test.ts:7-61`.

**Remaining:** UI draft/expired-tab behavior and signed-in browser behavior belong to UI/integration evidence; not established by server tests. Clarify logout revokes this browser session; PAT revocation is separate, and PAT UI-session routes must remain denied.

#### ACC-03 — Profile and historical identity

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Confirmed first/last names and display-name updates persist; Google refresh does not overwrite chosen name.
- Avatar follows an explicitly agreed source; historical actors remain attributable without exposing email/account-private fields.

**Actual source:** Profile PATCH intentionally accepts display name only and rejects avatarUrl; name PATCH saves both names. Google callback refreshes provider avatar and preserves existing display name. Historical source/tests exist.

**Source:** `apps/api/src/http/routes/session.ts:94-122`; `apps/api/src/http/routes/google-auth.ts:209-218`; `apps/api/src/adapters/session.ts:257`; `packages/contracts/src/auth.ts:1`.

**Existing test candidates:** `apps/api/test/acc-lifecycle.test.ts:137-184`; `apps/api/test/b9-profile-name.test.ts:1`; `apps/api/test/b16-names.test.ts:1`; `apps/api/test/b23-same-name.test.ts:1`; `apps/api/test/parity-fields-privacy.test.ts:1`.

**Remaining:** Catalogue wording name/avatar updates is broader than intentional display-only profile API; resolve whether provider-synced avatar satisfies acceptance. Re-run removed-actor mapping across cards/comments/activity, not just profile success.

**Decision/input:** Architect to record intended avatar behavior from existing accepted scope; if arbitrary avatar editing is required, freeze a new bounded contract before implementation.

#### ACC-04 — Create workspace and owner

Status: **superseded_row_needs_reconciliation**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Replace obsolete explicit-workspace creation criteria with personal-workspace ensure on sign-in and POST /projects.
- Authenticated old workspace-create route returns typed 410 without writes; anonymous returns 401.
- Concurrent ensure and 0019 backfill produce one deterministic primary owned workspace without requiring every invite accept to create one.

**Actual source:** POST /workspaces is mounted but always retires after authentication. Personal workspace is ensured in Google callback/project creation under user quota advisory lock. 0019 backfills users without workspaces. Old backend handoff still claims workspace POST works.

**Source:** `apps/api/src/http/routes/workspaces.ts:18-23`; `apps/api/src/adapters/personal-workspace.ts:17-32`; `apps/api/src/http/routes/projects.ts:218-237`; `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md:129-160`; `docs/handoffs/backend/ACC-04.json:2-11`.

**Existing test candidates:** `apps/api/test/acc04-workspaces.test.ts:14-50`; `apps/api/test/b17-personal-workspace.test.ts:1`; `apps/api/test/b21-migration-0019.test.ts:48-117`.

**Remaining:** Accepted retirement has source/tests, but TSV/generated checklist/OpenAPI/handoff still describe old behavior; replacement acceptance and fresh review remain required. Do not revive POST workspace to satisfy stale row.

**Decision/input:** Architect must publish amended ACC-04 criteria and retire historical handoff wording; existing accepted decision already authorizes this direction.

#### ACC-05 — Workspace preferences

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner alone updates workspace name/timezone with expectedVersion; invalid zone/stale version fails without partial update.
- Date-only deadlines keep calendar day and overdue semantics use agreed workspace timezone.

**Actual source:** Workspace PATCH locks row FOR UPDATE, checks owner and version, then updates name/timezone. It does not require idempotency despite OpenAPI claiming it does. Nonowner existing workspace yields 403, missing workspace 404.

**Source:** `apps/api/src/http/routes/workspaces.ts:63-155`; `packages/contracts/src/openapi/index.ts:66-72`; `packages/contracts/src/workspaces.ts:1`.

**Existing test candidates:** `apps/api/test/acc-lifecycle.test.ts:185-233`; `apps/api/test/crd01-crd11.test.ts:1`; `apps/api/test/qry01-qry03.test.ts:1`.

**Remaining:** Align replay/header documentation with actual version-based update policy. Add date-only/overdue integration checks through preference changes and time-zone/DST boundaries; test fixture timezone alone is not proof. Assess workspace existence response distinction if workspace IDs are meant private.

#### ACC-06 — Owned and invited context switcher

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Session/project switcher shows only owned containers and explicit project grants; owner elsewhere gains no rights.
- Zero-board member still sees project but no hidden board names/counts/default-board IDs.
- Shared-only first visit lands /projects; remembered location is reauthorized after revoke/archive.

**Actual source:** Session derives ownedWorkspaces, accessibleProjects, limits, isOwned and validated lastLocation; project summary uses readable default-board join. Accessible session list is unbounded while primary GET /projects is paginated.

**Source:** `apps/api/src/http/routes/session.ts:51-75`; `apps/api/src/adapters/rbac.ts:119-171`; `apps/api/src/adapters/last-location.ts:1`; `docs/handoffs/proposals/own-projects-decisions-2026-10-31.md:9-27`.

**Existing test candidates:** `apps/api/test/acc-lifecycle.test.ts:234-266`; `apps/api/test/last-location.test.ts:1`; `apps/api/test/b18-backstops-session.test.ts:13-64`; `apps/api/test/board-description-default-board.test.ts:1`.

**Remaining:** Browser context switch clearing and first/remembered landing need UI/integration evidence. Unlimited invited memberships make session payload a later scaling risk; do not falsely call session pagination implemented.

#### ACC-07 — Owner transfer

Status: **superseded_row_needs_reconciliation**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Ownership transfer stays disabled in beta with authenticated typed 410, unauthenticated 401, and zero owner/version/quota change.
- Former-owner boundary tests may use controlled fixture DB changes; these cannot be called successful transfer API evidence.

**Actual source:** Mounted transfer-ownership route always throws TRANSFER_OWNERSHIP_RETIRED after auth. Accepted later handover explicitly disables beta transfer. Lifecycle test checks retirement then changes owner directly as a controlled fixture. Historical handoff/OpenAPI/TSV claim active transfer.

**Source:** `apps/api/src/http/routes/workspaces.ts:159-164`; `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md:139-160`; `apps/api/test/acc-lifecycle.test.ts:267-284`; `docs/handoffs/backend/ACC-07.json:2-8`; `packages/contracts/src/openapi/index.ts:74-80`.

**Existing test candidates:** `apps/api/test/acc-lifecycle.test.ts:267-312`; `apps/api/test/board-access.test.ts:1193-1198`.

**Remaining:** Add explicit anonymous and unrelated authenticated account retirement probes and assert owner/version unchanged. Amend feature/handoff records; do not revive transfer, nor mark old atomic-transfer acceptance fulfilled.

#### RBAC-01 — Owner manager member viewer matrix

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Every mounted route and alias enforces active session/PAT route scope, project role and board-grant intersection where board-derived.
- Owner implicit access stays within owned workspace; Manager administration is project-only; Member/Viewer cannot grant/change authority.
- Manager-created new board grants creator only; only Owner administers others.

**Actual source:** Shared role helpers resolve owner/project grant; write helper holds workspace/member/grant locks and checks board visibility before role. Board grants are mounted. PAT policy is global before routes, so current acceptance must include both identity modes.

**Source:** `apps/api/src/http/app.ts:125-126`; `apps/api/src/http/app.ts:178-195`; `apps/api/src/adapters/rbac.ts:49-87`; `apps/api/src/adapters/rbac.ts:300-379`; `apps/api/src/http/middleware/auth.ts:23-42`; `apps/api/src/http/routes/board-grants.ts:1`.

**Existing test candidates:** `apps/api/test/rbac01-matrix.test.ts:130-280`; `apps/api/test/board-access.test.ts:1`; `apps/api/test/b18-own-projects.test.ts:38-73`; `apps/api/test/token-boundaries.test.ts:1`.

**Remaining:** Helper/matrix coverage is not inventory coverage. Freeze complete actual route/method/alias matrix and distinguish retired routes; include token expiry/project binding/admin denial after MCP repair. Member-directory role mismatch and status PATCH path require resolution.

#### RBAC-02 — Project ancestry enforcement

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Known-hidden sibling project/board/card/comment/image/upload/import IDs and unknown IDs share agreed private 404 with no private sentinel metadata.
- Check actual endpoints, alternate query/body ID selectors, aliases, binary image routes and token project filters, not only verifyProjectAncestry helper.

**Actual source:** Ancestry helper verifies composite workspace/project relationships. Mounted board-aware read/write helpers protect descendants; full-family access test files exist. Database composite foreign keys backstop ancestry.

**Source:** `apps/api/src/adapters/rbac.ts:179-249`; `apps/api/src/adapters/rbac.ts:322-366`; `apps/api/src/http/routes/projects.ts:483-505`; `database/migrations/0007_board_grants.sql:19-23`.

**Existing test candidates:** `apps/api/test/rbac-advanced.test.ts:216-331`; `apps/api/test/board-access-cards-images.test.ts:1`; `apps/api/test/board-access-boards-imports-trash.test.ts:1`; `apps/api/test/board-access-activity-notifications.test.ts:1`; `apps/api/test/token-boundaries.test.ts:1`.

**Remaining:** No mounted family suite executed in this discovery. Re-run all route families against actual PostgreSQL and Node/workerd as claimed; privacy includes response bodies/counts/cursors/errors, not just status.

#### RBAC-03 — Revocation versus writes

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Two real DB connections prove write-before-revoke and revoke-before-write; no subsequent protected write commits after winning role/grant revocation.
- Project/board membership mutations, import commit, image finalization, card/comment writes and replay reauthorization follow one consistent lock order.

**Actual source:** Project write helper holds FOR SHARE workspace/membership and optional board-grant row; archived context helper locks project/board. Existing forced-interleave suites exercise mounted project update and member-promotion/removal. Full proof still depends on every caller.

**Source:** `apps/api/src/adapters/rbac.ts:300-439`; `apps/api/src/adapters/members.ts:42-61`; `apps/api/src/http/routes/members.ts:88-105`; `database/migrations/0007_board_grants.sql:27-50`.

**Existing test candidates:** `apps/api/test/rbac-advanced.test.ts:389-844`; `apps/api/test/lock-order-interleave.test.ts:19-113`; `apps/api/test/board-access.test.ts:508-1397`.

**Remaining:** FLOWBOARD_ACCESS_TEST_DATABASE_URL absence skips important suites; require explicit zero-skip evidence. Status PATCH quota/archive path is outside quota lock protocol; inventory all role/status mutators and test them.

#### RBAC-04 — Picker and notification privacy

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Display identities are project scoped; assignee/mention picker candidates can actually use target board and permitted role.
- Historical actors and notifications do not expose account-private fields or hidden board participation; revoked access immediately redacts deep links/content.

**Actual source:** People route requires boardId for assignees; mentions derive board from active card or explicit board, with empty result when no context. Query helper projects PersonDisplay, filters active grants and eligibility. Separate member-directory endpoint returns email to every active role.

**Source:** `apps/api/src/http/routes/projects.ts:460-521`; `apps/api/src/adapters/rbac.ts:453-488`; `apps/api/src/adapters/projects.ts:493-568`; `packages/contracts/src/projects.ts:179-207`.

**Existing test candidates:** `apps/api/test/rbac-advanced.test.ts:845-939`; `apps/api/test/b24-assignee-eligibility.test.ts:1`; `apps/api/test/b9-mention-access.test.ts:1`; `apps/api/test/parity-fields-privacy.test.ts:1`; `apps/api/test/board-access-activity-notifications.test.ts:1`.

**Remaining:** Resolve member-directory email/role policy separately from PersonDisplay. Test no-board/foreign-card/removed-actor/user-with-hidden-board cases and inbox after both role and board revocation.

**Decision/input:** Architect/product needs an explicit current directory-role and email-disclosure policy because source/tests permit all active roles while PRJ-05/OpenAPI describe Owner/Manager administration.

#### RBAC-05 — Project inheritance disclosure

Status: **superseded_row_needs_reconciliation**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Supersede all-board inheritance with explicit disclosure: project invite grants project only, nonowner needs a board grant, Owner implicitly sees own boards.
- Access-summary returns only accessible board counts and no hidden board IDs/counts; invite email cannot promise inherited all-board access.

**Actual source:** Access-summary mounted under project read lock returns model explicit_board_grants, allBoardsInherit false, hasBoardOnlyExceptions true and visible board count. Historical backend summary and TSV still state opposite inheritance model.

**Source:** `apps/api/src/http/routes/projects.ts:526-545`; `apps/api/src/adapters/rbac.ts:748-808`; `docs/handoffs/proposals/board-access-decisions-2026-10-27.md:3-19`; `docs/handoffs/backend/RBAC-05.json:4`.

**Existing test candidates:** `apps/api/test/rbac-advanced.test.ts:940-999`; `apps/api/test/board-access.test.ts:1`; `apps/api/test/b10-invitation-email.test.ts:99-145`.

**Remaining:** Refresh feature definition/handoff prose and invitation disclosure acceptance; source revised payload alone does not approve all affected read/write paths. No new policy decision needed to preserve explicit board grants.

#### PRJ-01 — Create multiple projects

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Any signed-in shared-role user can create an owned project through strict POST /projects without choosing/injecting workspace.
- New and legacy own-workspace route share 3 active/20 total owned-project caps, actor rate windows, transaction/receipt identity, concurrent serialization and grandfathering.
- No membership elsewhere counts toward owned quota; independent boards/memberships and versioned project metadata persist.

**Actual source:** POST /projects locks user quota, ensures workspace, replays receipt before rate/quota, inserts project and receipt atomically. Legacy own-workspace route remains active. Accepted later handover approves total caps and rates.

**Source:** `apps/api/src/http/routes/projects.ts:101-175`; `apps/api/src/http/routes/projects.ts:198-242`; `apps/api/src/services/limits.ts:15-30`; `docs/handoffs/proposals/own-projects-backend-handover-2026-10-31.md:129-137`.

**Existing test candidates:** `apps/api/test/prj01-projects.test.ts:75-251`; `apps/api/test/b18-own-projects.test.ts:64-220`; `apps/api/test/b18-backstops-session.test.ts:64-127`.

**Remaining:** Update obsolete Owner-only catalogue framing: every user becomes Owner of their own created context, with no increase inside invited project. Re-run concurrent creates/replay through both routes; full feature approval remains open.

#### PRJ-02 — Project list and navigation

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Paginated primary project lists include only owned/active granted projects, including zero-board members without hidden board hints.
- Invalid/stale cursors and archive filtering are deterministic; defaultBoardId is readable; no sibling name/count/existence leakage.

**Actual source:** GET /projects delegates to scoped paginated query and PAT project filter. Workspace list uses explicit owner/member locking. Session list is a separate unbounded summary path.

**Source:** `apps/api/src/http/routes/projects.ts:82-97`; `apps/api/src/http/routes/projects.ts:252-286`; `apps/api/src/adapters/projects.ts:174-245`; `apps/api/src/adapters/rbac.ts:119-171`.

**Existing test candidates:** `apps/api/test/prj02-prj05.test.ts:157-317`; `apps/api/test/board-description-default-board.test.ts:1`; `apps/api/test/board-access.test.ts:1321-1347`.

**Remaining:** Browser Yours/Shared grouping and navigation need UI integration. Test revocation during paginated queries, archived visibility and malformed cursors; do not treat unbounded session payload as paginated.

#### PRJ-03 — Project settings

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner/own-project Manager updates validated project name/description/brief with expectedVersion and receipt; Member/Viewer forbidden, sibling invisible.
- Stale/colliding retries cause no partial metadata/activity writes; archive context blocks edits; ownership/default-board authority remains separately Owner-only.

**Actual source:** Project PATCH takes actor write-grant lock and writable project lock before replay/update, then saves receipt and commits. Settings adapter owns version/role constraints.

**Source:** `apps/api/src/http/routes/projects.ts:357-435`; `apps/api/src/adapters/projects.ts:270-345`; `packages/contracts/src/projects.ts:53-88`.

**Existing test candidates:** `apps/api/test/prj02-prj05.test.ts:318-540`; `apps/api/test/project-overview-brief.test.ts:1`; `apps/api/test/board-description-default-board.test.ts:1`; `apps/api/test/rbac-advanced.test.ts:508-668`.

**Remaining:** Re-run stale replay/revocation races and assert canonical field/activity results. OpenAPI/schema agreement and UI draft conflicts remain separate gates.

#### PRJ-04 — Archive and reopen project

Status: **source_risk_requires_reproduction**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner-only project archive/reopen retains data/history, blocks domain writes/import/acceptance and does not pause card trash deadlines.
- Reopen checks active quota with receipt replay before quota; concurrent create/reopen cannot exceed cap.
- Removal/leave must stay available when archived if accepted board decision requires revocation while read-only; role reinstatement must not quietly mutate archived context.

**Actual source:** Archive/reopen routes exist with Owner lock/receipt; reopen acquires user quota then checks cap. Domain writes call writable-context helper; invitation accept only reads project archived flag without holding project row context lock. Member update normal path omits writable-context check while replay path includes it.

**Source:** `apps/api/src/http/routes/projects.ts:551-660`; `apps/api/src/http/routes/projects.ts:666-741`; `apps/api/src/adapters/rbac.ts:391-439`; `apps/api/src/adapters/invitations.ts:338-341`; `apps/api/src/adapters/members.ts:42-128`.

**Existing test candidates:** `apps/api/test/lifecycle-undo.test.ts:330`; `apps/api/test/b18-own-projects.test.ts:203-220`; `apps/api/test/b22-invitation-caps.test.ts:169-180`.

**Remaining:** Reproduce role/status PATCH in archived project and archive-vs-invite-accept forced interleave. Sequential archived accept refusal does not prove archive race. Verify card restore cutoff continues with actual clock boundaries.

#### PRJ-05 — Project people directory

Status: **needs_product_policy_reconciliation**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner/Manager administrative directory exposes authorized active members; ordinary pickers expose eligible public identity fields within approved project/board context.
- No unrelated project membership, email directory or hidden-board participation leaks; removed identities are excluded as new candidates.

**Actual source:** GET members authorizes active project membership of any role, returns full directory with emails, roles, membership IDs and versions, and nextCursor null. Contract requires email; test deliberately permits Manager/Member/Viewer. This conflicts with administrative OpenAPI minimumRole manager and narrower catalogue wording.

**Source:** `apps/api/src/http/routes/projects.ts:439-457`; `apps/api/src/adapters/projects.ts:463-580`; `packages/contracts/src/projects.ts:179-194`; `packages/contracts/src/openapi/index.ts:138-142`; `apps/api/test/prj02-prj05.test.ts:541-607`.

**Existing test candidates:** `apps/api/test/prj02-prj05.test.ts:541-648`; `apps/api/test/b11-cleanup-cap-people.test.ts:1`; `apps/api/test/board-access.test.ts:1321-1324`.

**Remaining:** Authority/email policy must be reconciled before declaring compliant. Pending decision is not proof source is an exploit: active members may intentionally share a directory, but email access is not explicitly settled by current accepted board decision. Pagination remains absent for administrative members; cap bounds active memberships but grandfathering needs consideration.

**Decision/input:** Record whether Member/Viewer may read administrative member emails. Prefer distinct Owner/Manager administration and email-free public identities unless existing accepted user decision states otherwise.

#### INV-01 — Project invitation

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner invites Manager/Member/Viewer; project Manager invites only Member/Viewer within own project.
- Invite establishes project membership only, no implicit board grants; email names exact project without hidden board disclosure.
- Name-confirmation, email normalization, 50 seats/pending reservations, rates, transactional activity/outbox/receipt, idempotent replay and duplicate-email race hold.

**Actual source:** Mounted route takes project quota then write grant/writable locks, checks role and name, replays before rate/caps, creates invite+outbox and schedules mail. No board-grant insertion is in invitation flow. Invitation response includes raw token on initial creation only; receipt minimization is separate.

**Source:** `apps/api/src/http/routes/invitations.ts:35-128`; `apps/api/src/adapters/invitations.ts:127-225`; `apps/api/src/adapters/invitations.ts:1055-1065`; `docs/handoffs/proposals/board-access-decisions-2026-10-27.md:10-17`.

**Existing test candidates:** `apps/api/test/inv01-inv03.test.ts:124-345`; `apps/api/test/b22-invitation-caps.test.ts:85-113`; `apps/api/test/b22-invitation-caps.test.ts:182-244`; `apps/api/test/b10-invitation-email.test.ts:99-145`.

**Remaining:** Catalogue inherited-boards clause is stale. Add/locate exact same-email parallel invite test; parallel cap tests alone do not prove duplicate-email behavior. UI invite confirmation/disclosure and real mail adapter delivery remain later evidence.

#### INV-02 — Invitation delivery

Status: **mandatory_gap_source**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Durable invite outbox survives restart and transient mail failures; configured adapter sends only configured-origin link.
- Delivery failure is visible and actionable to an authorized inviter without exposing link/token to logs.
- Every terminal state, including retry exhaustion, strips raw token/recipient/template payload; retries are bounded and do not falsely promise exactly-once external mail.

**Actual source:** Brevo adapter has timeout and outcome classification. Immediate Worker waitUntil send and scheduled outbox drain exist. Invitation list exposes invitation status only, not delivery state. Terminal permanent refusal/delivery sanitize payload, but retry-exhaustion drain branch only sets failed/time/retry_count.

**Source:** `apps/api/src/adapters/invitation-delivery.ts:30-82`; `apps/api/src/adapters/invitation-delivery.ts:150-170`; `apps/api/src/services/mailer.ts:54-90`; `apps/api/src/adapters/notifications.ts:363-388`; `apps/api/src/adapters/invitations.ts:887-921`; `apps/api/src/runtime/worker.ts:88-96`.

**Existing test candidates:** `apps/api/test/b10-invitation-email.test.ts:74-254`; `apps/api/test/b14-outbox-privacy.test.ts:64-140`; `apps/api/test/uat-immediate-invite-send.test.ts:93-199`.

**Remaining:** Mandatory visible-failure acceptance lacks API outcome exposure in inspected invitation list. Source candidate: exhausted transient retries retain secret payload until 30-day retention, unlike documented terminal sanitization. Test retry-count at max-1, then final retry, then inspect failed payload. No real provider email sent during discovery.

#### INV-03 — Accept matching invitation

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Only signed-in verified matching recipient with confirmed name accepts current unexpired hashed single-use token.
- Wrong email/expired/revoked/superseded token grants nothing; accepted state, membership, activity and receipt are atomic.
- Reaccept/replay after revocation fails; accepted project does not silently gain any board access; caps and archive hold under races.

**Actual source:** Accept route checks name and token input, locks project quota before invitation; adapter hashes token, FOR UPDATE locks invite, enforces state/expiry/email, supersession timestamp and member cap, then upserts membership. Replay checks active membership; project archive check is unlocked read.

**Source:** `apps/api/src/http/routes/invitations.ts:139-237`; `apps/api/src/adapters/invitations.ts:285-449`.

**Existing test candidates:** `apps/api/test/inv01-inv03.test.ts:345-706`; `apps/api/test/inv04-inv08.test.ts:761-923`; `apps/api/test/b22-invitation-caps.test.ts:114-132`; `apps/api/test/b22-invitation-caps.test.ts:248-290`.

**Remaining:** Verified email is established by OAuth/authentication chain, not token alone; test dev-login cannot stand for hosted verification. Add archive-vs-accept and replay-vs-removal interleavings; post-accept zero-board UI state needs integration.

#### INV-04 — Resend and revoke invitation

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Authorized resend rotates token and invalidates old pending email; revoke invalidates token; Manager cannot administer Manager invitation.
- Resend/revoke/accept races yield one consistent grant/outcome, no deadlock; exact pending/seat caps, expiry rules and replay-before-rate are applied.

**Actual source:** Resend route locks quota before invitation, validates state/rate/seats; adapter rotates token and supersedes earlier outbox payload. Revoke route and adapter enforce current role and invitation state. Expired resend refusal overrides older helper comment allowing expired invitations.

**Source:** `apps/api/src/http/routes/invitations.ts:286-390`; `apps/api/src/http/routes/invitations.ts:392-480`; `apps/api/src/adapters/invitations.ts:559-637`; `apps/api/src/adapters/invitations.ts:693-825`.

**Existing test candidates:** `apps/api/test/inv04-inv08.test.ts:159-419`; `apps/api/test/b22-invitation-caps.test.ts:133-168`; `apps/api/test/b22-invitation-caps.test.ts:271-290`; `apps/api/test/b10-invitation-email.test.ts:147-174`.

**Remaining:** Existing forced accept/resend case is not a complete accept/revoke, resend/revoke and duplicate-resend matrix. Include multiple actual connections, final token/status/grant/outbox invariants and stale replay authority.

#### INV-05 — Pending invitations list

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner and own-project Manager list authorized invitations with pending/expired/accepted/revoked state and actionable resend/revoke restrictions; Member/Viewer forbidden, siblings private.
- Never return token/token hash; history bounds/pagination and delivery outcomes are accurately documented.

**Actual source:** Mounted GET takes Manager grant lock then lists project rows with computed expired state; response nextCursor null, query has no LIMIT and includes all historical invitations. Token hash is never selected; delivery outcome not selected.

**Source:** `apps/api/src/http/routes/invitations.ts:253-275`; `apps/api/src/adapters/invitations.ts:835-922`; `packages/contracts/src/invitations.ts:53-74`.

**Existing test candidates:** `apps/api/test/inv04-inv08.test.ts:443-528`.

**Remaining:** 50 pending cap does not bound accepted/revoked/expired history, so list can grow without bound despite paginated envelope. Need bounded cursor query/schema/UI handoff; delivery-failure field/action tracked with INV-02.

#### INV-06 — Change member roles

Status: **source_risk_requires_reproduction**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner controls Manager roles; own-project Manager changes Member/Viewer only and cannot modify self/peer Manager/Owner.
- ExpectedVersion, replay authority and all status changes preserve project seat cap and pending-seat reservation under concurrency.
- Archived project blocks reinstatement/role writes; authorized removal remains possible if revocation exception applies.

**Actual source:** Member PATCH forwards both role and arbitrary valid active/removed status to updateProjectMember. Adapter locks actor/target and applies authority/OCC, then directly updates role/status. It never takes project quota lock, counts seats or checks archived context on normal path; replay helper checks archive.

**Source:** `packages/contracts/src/projects.ts:91-98`; `apps/api/src/http/routes/members.ts:51-105`; `apps/api/src/http/routes/members.ts:16-47`; `apps/api/src/adapters/members.ts:42-128`.

**Existing test candidates:** `apps/api/test/inv06-inv07.test.ts:143-344`; `apps/api/test/rbac-advanced.test.ts:668-844`; `apps/api/test/b22-invitation-caps.test.ts:85-132`.

**Remaining:** High source candidate: PATCH a removed Member to active at 50 active bypasses seat cap; concurrent PATCH reactivations can exceed it because only invite/accept use quota lock. Separate candidate: archived role/status write succeeds. Freeze reinstatement policy, reproduce mounted endpoints, then fix at responsible transaction layer.

**Decision/input:** Architect chooses whether member-role PATCH may reinstate removed users at all. If retained, it must obey the same quota/archive policy; fresh invite is the simpler existing alternative.

#### INV-07 — Remove project access

Status: **source_risk_requires_reproduction**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Owner removes any project grant; Manager removes Member/Viewer only; next protected API/file/import/replay is denied.
- Removal atomically clears board grants and supersedes/revokes prior invitations; rejoin cannot restore dormant boards.
- Both DELETE and PATCH status=removed implement consistent semantics and lock order; removed historical authors remain attributable.

**Actual source:** DELETE adapter locks target, sets removed, revokes pending project-email invitations and records activity. 0007 trigger clears grants on status change. PATCH status=removed also clears grants via trigger, but omits DELETE pending-invite cleanup and uses different archive/replay handling.

**Source:** `apps/api/src/http/routes/members.ts:139-206`; `apps/api/src/adapters/members.ts:211-325`; `apps/api/src/adapters/members.ts:104-158`; `database/migrations/0007_board_grants.sql:27-50`; `apps/api/src/adapters/invitations.ts:393-398`.

**Existing test candidates:** `apps/api/test/inv06-inv07.test.ts:345-462`; `apps/api/test/inv04-inv08.test.ts:761-867`; `apps/api/test/board-access.test.ts:265-277`; `apps/api/test/board-access-cards-images.test.ts:1`.

**Remaining:** PATCH removal is an alternate path requiring parity regression, including stale invitation created before removal. Supersession timestamp fence is counterevidence to automatic old-token escalation; do not call exploit confirmed without reproduction. Test delete and status patch versus held write/replay/import/file delivery.

#### INV-08 — Leave a project

Status: **implemented_source_only**. Source confidence: high. Runtime/test status: not run; no independent approval.

**Current criteria before implementation/review:**

- Active invitee can leave own project; Owner cannot leave ownership; repeated same-key leave returns original safe outcome.
- Leaving clears board grants, pending invitations and future API/file access while preserving historical authorship; leave remains possible in archived project per revocation policy.

**Actual source:** Leave route checks receipt, refuses Owner even on replay, and delegates transactional leave; helper removes membership and revokes pending project-email invites. 0007 clears old board grants. Replay intentionally returns own previous leave success without requiring active membership.

**Source:** `apps/api/src/http/routes/invitations.ts:483-551`; `apps/api/src/adapters/invitations.ts:930-1047`; `database/migrations/0007_board_grants.sql:27-50`.

**Existing test candidates:** `apps/api/test/inv04-inv08.test.ts:529-671`; `apps/api/test/inv04-inv08.test.ts:925`; `apps/api/test/board-grants-foundation.test.ts:1`.

**Remaining:** Browser confirmation, safe context clearing and historical attribution need UI evidence. Test concurrent leave/accept/reinvite, absent/removed membership, replay after leave and archived-project leave; no test run here.

### Suggested verification commands (not run)

Not executed. Resolve DATABASE_URL and FLOWBOARD_ACCESS_TEST_DATABASE_URL only to new isolated local synthetic PostgreSQL databases; never print complete URLs. Set both to avoid skipped access suites. Test fixture migrations mutate/reset their local schema.

**focused identity:**

```sh
cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/acc01-session.test.ts test/acc04-workspaces.test.ts test/acc-lifecycle.test.ts test/google-auth-system.test.ts test/b17-personal-workspace.test.ts test/b16-names.test.ts
```

**focused projects:**

```sh
cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/prj01-projects.test.ts test/prj02-prj05.test.ts test/b18-own-projects.test.ts test/b18-backstops-session.test.ts test/lifecycle-undo.test.ts
```

**focused invites:**

```sh
cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/inv01-inv03.test.ts test/inv04-inv08.test.ts test/inv06-inv07.test.ts test/b22-invitation-caps.test.ts test/b10-invitation-email.test.ts test/b14-outbox-privacy.test.ts test/uat-immediate-invite-send.test.ts
```

**focused authority:**

```sh
cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/rbac01-matrix.test.ts test/rbac-advanced.test.ts test/board-access.test.ts test/board-access-cards-images.test.ts test/board-access-boards-imports-trash.test.ts test/board-access-activity-notifications.test.ts test/token-boundaries.test.ts test/lock-order-interleave.test.ts
```

**focused foundation:**

```sh
cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/node.test.ts test/worker.test.ts test/migrations.test.ts test/b21-migration-0019.test.ts test/observability.test.ts test/rate-limit.test.ts test/origin-check.test.ts test/b7-body-caps.test.ts
```

Complete closure uses the root `npm run check`, actual review validator and feature checklist regeneration on the final unchanged manifest. The API command in `apps/api/package.json` runs a database preflight; direct focused commands above do not, so the operator must independently enforce local-only targets before invoking them. Never use existing audit-generator scripts as a substitute for a fresh reviewer.

No claim is made that dependencies are installed, runtime versions match, databases are available or tests currently pass. The historical MCP repair reports a bounded 787-pass run and independent review; those results do not independently approve these 29 broader feature criteria or all 98 features.

## Next / your input

1. **Architect: Reconcile stable feature IDs and accepted policy before edits.** Amend ACC-04 to personal-workspace ensure and retired public create; amend ACC-07 to retired beta transfer; amend RBAC-05/INV-01 to explicit per-board disclosure. Preserve stable IDs and historical failed/obsolete records. Record directory email/role and avatar interpretation; decide whether role PATCH may reactivate removed members. Accepted 3/5 active, 20/25 total and seat reservation require no new user approval. Freeze full route/method/alias/runtime/token-role inventory and per-feature criteria; attach exact source/dependency hashes.
2. **Backend plus independent reproduction reviewer: Reproduce smallest meaningful risky paths with synthetic PostgreSQL.** At active-seat cap, PATCH removed member to active; force two parallel reactivations; assert active+pending invariant under accept/reactivate. Archive project then PATCH role/status; force archive-vs-accept to assert one serialization order. Test DELETE and PATCH removal plus old invitations and board grants. Seed invitation at maxRetries-1 with unique token/email sentinel, force transient failure, inspect terminal payload and authorized delivery-status response. Use two actual DB clients and barriers, not time-only sleeps; retain positive/negative controls and failed attempts.
3. **Backend: Bounded source repairs after criteria freeze.** Unify permitted membership-state changes at quota/archive/authority transaction layer; preserve removal while archived when allowed and use consistent replay checks. Sanitize every terminal invitation outcome and expose minimal delivery state/retry action to authorized inviter. Bound invitation history with cursor. Implement authoritative request/response OpenAPI generation or a complete validated spec plus actual route parity; accurately describe retired endpoints, name/profile, project creation and token restrictions.
4. **Backend verification: Fresh local verification on immutable repaired manifest.** Provision only new local disposable PostgreSQL instances; inspect local target guard before tests; never reuse hosted URL. Run relevant focused suites then complete API/contracts/typecheck/build with all access suites enabled. Exercise real local workerd entrypoint and Node HTTP, clean migration/upgrade/0019 twice, table constraints and embedded SQL parity. Capture exact command, revision/manifest, DB/server version, exit and pass/fail/skip counts; current historical MCP 787-pass evidence is bounded to its repair and does not close all 98.
5. **Fresh independent reviewer then Architect/UI: Review and acceptance handoff.** Fresh read-only reviewer sees frozen full reachable target, all criteria/counterevidence and real logs; no source changes while reviewed. Require actual gate rubric and no blockers. Update role-owned records with matching passing reviewPath and regenerate checklist once through Architect; never blindly rerun historical score-generating scripts. UI verifies new/retired contracts, logout drafts, directory visibility, invitation failures and zero-board acceptance; integration verifies signed-in flows. Only after all 98 closure and release lock may authorized direct UAT deployment begin; no dev or production stage.

Architect input needed: directory roles/email disclosure, avatar acceptance interpretation and whether member PATCH reinstatement remains supported. No user action is needed for recorded retirement/board-access/cap decisions. Continue only with separately assigned bounded fix scope after this source survey. Direct UAT follows all-feature closure and final release lock under current user instruction; no dev stage or production changes.
