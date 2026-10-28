# Project portfolio with per-board access: revised contract handoff

Date: 2026-10-27  
Status: proposed contract freeze. The later [user decisions](board-access-decisions-2026-10-27.md) supersede conflicting options and open questions below: no automatic backfill, Owner-only board-grant administration, and Managers may create boards. Full enforcement and backend acceptance remain outstanding.  
Audience: Architect and Backend role. This supersedes the project-wide inheritance assumptions in the prior proposal.  
Scope: A project may combine the cards from boards within that one project, but every non-owner user has separate access per board. No cross-project card aggregation and no workspace-wide cards endpoint.

UI status: a local Projects design artifact now exists for this model (index, project overview, project work) using synthetic fixtures. It is not API integration, persistence or authorization evidence and does not change the backend status above.

## Actions and product model

Keep the current entity tree: workspace → project → boards → columns → cards. A project remains a useful business container such as `MyFashion`; boards can be `Web`, `Marketing`, and `Operations`. A portfolio is a combined, read-only view over the subset of boards the current person may access inside that single project. It must not create nested project entities or move/copy cards across boards.

A project grant establishes project membership and role but no longer implies visibility of every board for non-owners. Board grants are an additional, intersecting boundary: a non-owner must have an active project grant **and** an active grant to that specific board. The workspace Owner has access to all boards in owned projects without a board grant. Being a workspace Owner invited to another workspace/project gives only the explicit destination project and board grants; ownership elsewhere never grants cross-workspace access.

The former QRY-04 workspace-level aggregation idea is withdrawn. Implement only a project portfolio endpoint, and only after this contract and the board-grant model are frozen and reviewed. Product decision still needed before migration: how existing project members receive their first board grants. Do not silently assign every existing member to every board as a “backfill.”

## Proposed API policy

### Portfolio read

`GET /api/v1/projects/:projectId/cards/portfolio?boardId=&columnId=&q=&priority=&assigneeId=&due=&completion=&cursor=&limit=`

- Return active cards from authorized boards in the requested project only. Each card carries its project, board, and column `{id,name,category}` provenance, title, priority, due date, assignee IDs, canonical identifiers/version/position, summary counts if approved, and timestamps. Never return description/comment bodies/image bytes/URLs/email.
- The user must have the project grant; a non-owner sees rows only where an active board grant exists. The workspace Owner sees all boards in that owned project.
- A project member with no board grants may still see the project name/details if project-level access allows it, but portfolio returns a generic empty result with zero accessible-board counts. Do not reveal hidden board names, IDs, counts, archive flags, activity, or existence through errors, facets, pagination, cursor validation, or timing-prone per-board lookups.
- Supplied `boardId` must be authorized. For a hidden or foreign board, use the same non-enumerating inaccessible response as unknown resource; never distinguish “exists but denied.” `columnId` must be resolved inside an authorized board and the project. Cursor scope binds project, authorized-board-set revision/digest, filters, sort, and cursor version; every page rechecks current project and board grants. Revocation invalidates old cursors.
- Page query and counts must use the identical authorized-board predicate **before** LIMIT, aggregation, count calculation, and related metadata fetch. Never page broad project rows and filter in application code afterward. Counts mean only cards on currently authorized boards and must label lifecycle/archive/filter scope. Prefer no totals if they add broad or unbounded reads.
- Use a deterministic keyset order with a complete tie-breaker, e.g. due date ascending nulls last, updated descending, project/board/card IDs. Bind sort and filters into a signed opaque cursor. No `OFFSET`, concatenated board streams, or cursor that acts as a bearer authorization token. On grant change, reject the cursor and ask the UI to refresh.
- `completion=done` uses `columns.category='done'`; `open` uses category != done. Preserve each custom column name/category. Never infer completion from labels such as “Finished.” Overdue excludes `done` columns; trash/purged cards are excluded. Date “today” uses this project’s workspace timezone. Workspace-wide or cross-timezone portfolio is out of scope.
- Existing per-project search may be revised only if all its result, count, related identity and pagination paths enforce these same board grants. It must not remain a bypass for title/description searches across hidden boards.

### Board grant administration

Suggested endpoints, subject to route-shape review:

- `GET /api/v1/boards/:boardId/access` — board Owner and, if explicitly delegated later, an authorized administrator only; returns grants for that board, not other boards.
- `PUT /api/v1/boards/:boardId/grants/:userId` — `{roleScope?}` or a grant-only status shape; project role continues to determine actions. Board grant adds read/write reach only within the existing project role and cannot elevate a Viewer to Member/Manager.
- `DELETE /api/v1/boards/:boardId/grants/:userId` — revokes that board only.

Initial least-privilege policy: only the workspace Owner may administer board grants. Do not assume a Manager can delegate board access; that question is unresolved and must be explicitly decided before adding delegated administration. No actor may grant themselves access or elevate their project role through a board grant. The Owner must retain implicit full access even if a corrupt or stale row purports to revoke it. Validate target user has an active project grant before adding a board grant; reject removed/nonmember users. Grant creation/removal is audited and versioned, and revocation immediately affects the next request.

Project-level invitation and membership operations do not silently grant every board. Invitation acceptance can create the project membership only. Board grants must be explicitly assigned through a clearly authorized flow, and invitation emails must not disclose inaccessible board names. Removing a project grant removes effective access to all boards immediately even if dormant board-grant records remain; those records must not reactivate access if the project grant is later restored without a deliberate policy.

## Migration and backfill: required product closure

The current schema has `project_memberships` only and `resolveProjectRole()` currently treats project membership as access to all descendant boards. A separate table and authorization cutover are required; simply adding `board_memberships` while old paths keep calling `resolveProjectRole()` is not a security fix.

Candidate model (exact fields/indexes to be decided during contract freeze): `board_memberships(board_id, project_id, workspace_id, user_id, status, version, created_at, updated_at)` with unique `(board_id,user_id)`, ancestry integrity, FK/restrict behavior, project/user lookup indexes, and audit events. A role column is unnecessary if permissions always intersect the project role; avoid a second role system unless product needs per-board role differences. Owner is implicit and not represented by grants.

**Do not choose a backfill policy without product authorization.** Viable policy choices and consequences:

1. Owner-only initial grants: safest privacy default, but current non-owner members lose board access at cutover until an Owner assigns grants.
2. Copy current project membership to all current project boards: preserves behavior but grants broad access the user has not explicitly approved under the revised requirement; do not do this silently.
3. Explicit staged cutover: deploy grant tables and administrative UI first, let Owners assign board access, then enforce with a scheduled/deadline transition. Requires a clear product deadline and must avoid a period where the UI implies stronger separation than backend enforcement.

Architect must obtain the product's decision. Migration must be transactional/restartable, preserve auditability, support rollback only before enforcement, and report rows/grants created without exposing user data in logs. Never make a local historical SQLite migration stand in for PostgreSQL migration evidence.

## Access impact inventory: every path must be closed under board grants

Current repository source often authorizes only by `resolveProjectRole(projectId, actorId)`. Before cutover, Backend must inventory every route/service/runtime and pass the board ID or a resource-derived board context into authorization. The new predicate is project grant ∧ board grant, except workspace Owner implicit access.

| Surface | Current source pattern/evidence | Required board-scope enforcement |
|---|---|---|
| Project/session listings and project details | `getAccessibleProjects`, project routes; project itself may remain visible to project members. | Keep project name/details at project scope if authorized, but never embed hidden board names/counts or all-board summaries. Any board list returns only authorized boards. |
| Board list, snapshot, columns, card pages and placement | `GET /projects/:pid/boards`, `GET /boards/:id`, board route operations and snapshots. | Filter hidden boards before selecting metadata. Deny unknown/hidden board uniformly. Every column/configuration/read endpoint checks grant. |
| Board mutations | Create/rename/archive/reopen board, add/edit/reorder/delete columns. | Owner implicit access; otherwise project role plus board grant and existing write-role rule. Board creation is project administration; if the creator is an authorized grant administrator it may also carry explicit initial grants (see below). It never grants every project member by default. |
| Card reads, create/update/move, project search, My Tasks | `cards.ts` and board card routes resolve project role; `/me/tasks` is assignment scoped but can leak names/status for inaccessible boards. | Enforce board grant on card ancestry for every read/write/search/assignment query and before idempotency replay. Omit inaccessible assignments from My Tasks. Cross-board card movement remains unsupported; no duplicate/move semantics are introduced. |
| Descriptions and card detail/deep links | `GET /cards/:id` and card detail uses card→project authorization. | Treat card existence as hidden without board grant. Description is particularly sensitive; no alternate detail path may bypass board access. |
| Comments and mentions | Comment list/create/edit/delete and activity helpers authorize project. | Enforce board grant for all comment bodies, authors, mention payloads, counters, writes, notification creation and retries. Mention pickers must be limited to users eligible for that board or to an explicitly approved project-wide directory that reveals no hidden-board participation. |
| Images and uploads | Image handlers resolve project role from card/image/upload ancestry; private proxy endpoints. | Check current board grant on stage, content PUT, finalize, inspect, cancel, list, proxy content/thumbnail, remove, retry and cleanup visibility. Revocation must deny already-issued upload/image IDs and URLs on next request; no durable public URL. |
| People and assignee pickers | `/projects/:id/people` is project scoped; assignee eligibility uses project membership. | Define whether project people directory is intentionally project-wide. Even if names can be listed, never reveal which hidden board a person is on or hidden-board card assignments. Assignee picker for a specific board should be explicitly board-scoped; creating an assignment also checks board grant plus project eligibility. |
| Import/export/template | Board import/template routes; imports store project and board IDs and previews/reports are import-ID reads. | Authorize current board grant on upload, template, status, rows, mapping, commit, cancel and report. Recheck on commit and report download. Export endpoints, if any, must obey same board scope. No project-wide export of hidden boards. |
| Trash/restore/purge | Delete/restore by card ID; project trash list currently project scoped. | Trash list must include only authorized boards (or board-specific route). Delete/restore require board grant plus project Owner/Manager role; no access to hidden titles, deleted-by actor, deadlines, restore eligibility/counts. Purge worker stays internal but cannot expose content; worker authorization is service-level, not human grant. |
| Activity, audit and notifications | Card activity resolves project role; project/workspace activity can cross boards/projects. | Card activity and notification payload/deep links require current board access. Project activity feeds must redact/omit hidden-board events, counts, actors/reasons and pagination effects. Workspace activity remains Owner-only and is not a portfolio endpoint; if it includes board data, preserve the Owner boundary. |
| Idempotency receipts and replay | Receipt helpers check project grant/context locks; routes often know boardId but current permission is project-level. | Re-check current board grant before returning replayed result, status, IDs, counts or errors. Revocation blocks replay. Lock order must serialize board-grant revocation against in-flight read/write and import/image effects. |
| Session cache, cursors, counts and caches | API rules require current read authorization; various cursor encodings currently bind project/filter/order. | Board grant is part of scope revision/digest. No stale session summary, cursor, count cache, browser cache, thumbnail, search result or notification preview may retain hidden-board data after revocation. Private/no-store response policy applies. |
| Owner/admin access summary | Project access summary currently reports inherited Owner and project grants. | Explain project membership separately from board reach. Board grant lists are shown only to authorized grant administrators and do not reveal other boards to users lacking project scope. |

This inventory is a minimum route map, not proof that all call sites have been enumerated. Backend must search mounted routes, shared adapters, worker/cleanup jobs, alternate aliases, OpenAPI and both Node/Worker entry points before closure.

## Implemented UI design and required read models (27 October 2026)

Status: local design artifact only, at `design/flowboard-ui/screens/projects.html`, `project.html` and `all-work.html` with `portfolio-model.js`. It reads synthetic fixtures, never the API, and proves no backend behavior. The screens now assume the projections below; Backend must not treat them as contracts until Architect freezes schemas and the authorization cutover in step 2 passes.

### A. Project index read model

The index renders every accessible project as a project root plus its authorized board branches. It needs, per project:

- Project identity: `id`, `name`, nullable `description`, active/archived state, `version` (for later edit/archive conflicts). The display mark and tone are presentation only and are **not** proposed API fields.
- Authorized board count and a compact list of authorized boards. Each board carries `id`, `name`, nullable `description`, state, and per-board card stats.
- Card stats scoped to authorized boards: total, open (`category != done`), done (`category = done`), overdue (not done, due before today in the project workspace timezone), and completion percentage. Archived/trash scope must be explicit in the response or query.
- Owner-only board reach per project member if the People aside is kept: `boardCount` and `boardTotal` per project member. A non-owner must not receive another person's board counts.

Contract options to decide: `GET /projects?include=summary` embedding board lists and stats, or a separate `GET /projects/:projectId/summary` plus `GET /projects/:projectId/boards`. The UI must not issue one board-list and one stats request per project (O(N) fan-out). If summaries are embedded, every aggregate must be computed from the same authorized-board predicate used by the board list. A zero-board project returns an empty board list and zero stats, not an error.

### B. Project overview read model

The overview needs the project identity, the authorized board list with stats, and:

- **Owner:** project members with their board reach inside this project only. Never include board names the Owner cannot administer; the Owner can administer all boards in an owned project.
- **Non-owner:** the current user's authorized board names only, labelled as project membership plus board grants. No sibling project data, no other members' grants, no hidden board IDs or counts.
- **Board grant editor (Owner only):** the project member directory (Owner included and locked), current grants for exactly one board, and the board identity. Saving replaces that board's grants; it never edits another board, project membership or project role in the same call.
- **At a glance:** the same authorized-board stats as the index. If the project is archived, stats must follow the agreed archived-card policy rather than silently dropping archived cards.

### C. Project work read model

Use the portfolio endpoint already specified above. The implemented screen additionally expects each row to carry `projectId`, `boardId`, `boardName`, `columnId`, `columnName`, `columnCategory`, card `key`, title, priority, due date, assignee IDs, and completion category. Board tone/mark are presentation only. Totals shown above the list must use the same authorized scope and filters as the rows, and must never be computed from a cross-project query.

### D. Board creation with initial grants

The Owner can create a board from the project overview and choose initial grants from **current project members only**. Proposed contract, subject to route-shape review:

`POST /api/v1/projects/:projectId/boards` with `{name, description?, initialGrants?: [userId], expectedProjectVersion?}` and an `Idempotency-Key`.

- Authorized by the same board-administration authority as grant editing (currently Owner-only in the UI). A Manager must not create a board or assign grants unless product explicitly delegates that authority.
- Validate `name` (1–100 characters) and optional `description` (up to 2,000). The UI blocks case-insensitive duplicate names inside one project; Backend must decide whether that is a contract rule or a UI-only check, and return a stable conflict if enforced.
- Validate every `initialGrants` user has an active project grant. The Owner is implicit and must not need or be able to lose a row. Reject non-members and self-elevation.
- Create the board, columns and grants in one transaction. A partial board with no grants is not acceptable when grants were requested. Replaying the same idempotency key returns the same board and grants.
- Do not copy project membership to the new board by default. A board with only the Owner is valid; the UI shows it as a zero-grant board for everyone else.
- Audit board creation and each initial grant. Revocation of a project grant immediately removes effective board access even if grant rows remain.
- Archived projects reject board creation until reopened.

### E. UI-observed design matrix (not API evidence)

Synthetic My Fashion fixtures in this pass:

| Preview identity | Boards shown | Cards | Board creation | Grant editor |
|---|---:|---:|---|---|
| Owner (Alice) | 3 | 10 | Yes, with initial grants | Yes |
| Manager (Charlie) | 1 (Web) | 4 | No | No |
| Member (David) | 2 (Web, Marketing) | 7 | No | No |
| Viewer (Eve) | 1 (Marketing) | 3 | No | No |

Revoking David's Web grant changed his project view to Marketing only and removed every Web card, name and count; restoring it returned both boards. Creating a project produced a zero-board project with only the Owner as a member, and creating its first board granted only the Owner. Archiving a project hid the board access editor and New board control. These are local browser-session observations, not backend tests.

### F. Required tests for these read models

- Authorized-board predicate applied before counts, facets, people reach, selectors and pagination. A hidden board contributes zero names, IDs, counts, cards, assignees and overdue totals.
- Zero-board project: project remains readable to a project member, board list empty, portfolio empty, no error and no fabricated counts.
- Board creation atomicity: board + columns + initial grants commit or roll back together; replay is idempotent; non-member grants rejected; Owner implicit; duplicate-name policy enforced consistently.
- Owner-only people reach; a non-owner response must not contain other members' board counts or hidden board identities.
- Stats semantics for archived projects, archived boards, trash and custom `done` categories, including timezone boundaries for overdue.
- Bounded statement count for one page of projects and one page of boards; no O(projects × boards) queries.
- Grant revocation between pages invalidates cursors and totals; no cached summary retains hidden-board data.
- No endpoint returns a cross-project card aggregate.

### G. Additional open decisions from the implemented design

- Summary contract: embedded project summaries versus separate summary/board-list routes, and whether totals are optional.
- Whether Manager may create boards or administer grants; the current UI is Owner-only.
- Whether initial grants are optional, required, or default to the Owner only.
- Duplicate board-name rule and its error code.
- Archived project grant editing: the UI hides the editor while archived; Backend must decide whether grants are frozen or still administrable.
- Whether people reach is Owner-only permanently or also visible to Manager.
- Board tone/mark and card board-chip colour are presentation-only; confirm they never enter the API.

## Sequenced contract and backend units

### 1. Contract freeze (Architect-owned; no backend coding)

Resolve and record: board-grant administrator (initially Owner-only unless product decides otherwise), Viewer/Member/Manager board actions as an intersection with project role, invitation and member-add semantics, migration/backfill, behavior for zero accessible boards, project-wide people directory visibility, archive/list semantics, project portfolio count scope, and immediate revocation/cursor/cache behavior. Add shared schemas/OpenAPI/error semantics and feature IDs only after these decisions. Acceptance: a truth table for Owner, project Manager/Member/Viewer, removed project member, active project member with/without board grant, board grant without active project grant, outsider, invited Owner in another workspace; tests written against the frozen matrix.

### 2. Grant model and authorization cutover (Backend-owned; sensitive/high risk)

Add PostgreSQL board-grant migration, repository/lock helpers, audit events and grant administration routes under approved authority. Convert each existing route/service to require resolved project+board ancestry and the new effective predicate. Avoid dual behavior where some endpoints still call project-only role checks. Revalidate parent/card/import/image ancestry and state inside transactions. Revocation and writes serialize under an explicit common lock order; revoked access must fail immediately on the next request, including cursor continuation and receipt replay.

Acceptance against isolated PostgreSQL: full matrix above for every read and write family; project membership removal wins against all boards; board revocation races with card write/import commit/image finalize; owner remains implicit; no self-grant/role elevation; foreign board/card/column IDs do not reveal existence; Node and Worker handlers use the same enforcement; no live-data migration. Validate rollback/restart migration behavior and preserve immutable manifests/reports.

### 3. Project-scoped portfolio query (only after step 2 passes)

Implement `GET /projects/:projectId/cards/portfolio` over authorized boards in that project. One authorization-scoped query applies effective grants before page/count; use stable keyset cursor binding board-grant revision, scope, filters and sort. Batch assignee identities/counts; do not perform N+1 queries. Counts and facets exclude hidden boards entirely. Test equal/null sort keys, grant changes between pages, hidden board selectors, `done` custom categories, archived/trash scope, unauthorized totals, and bounded statement count/index plans.

### 4. Fresh independent backend review and handoff

Freeze exact source/evidence manifest, run required type/build/API/contract and PostgreSQL checks, and obtain a fresh independent reviewer on the exact target. The current review gate requires unrounded weighted score strictly above 8.5/10, all category minimums, no blocker, complete route scope and passing tests. Preserve failed records. No automatic broad repair/review loop: current repository history already has failed independent BRD, CRD and COM/DEL reviews. Any separate repair scope must be explicitly directed. Only a passing current review record allows a board-grants backend handoff or checklist regeneration.

## Existing source evidence and status limits

- PostgreSQL schema currently has `project_memberships` and cards/boards/columns with project ancestry, but no `board_memberships` table. `resolveProjectRole()` returns project membership or owned-workspace Owner and is used across adapters. This is verified source observation, not runtime security acceptance.
- Current `docs/API.md` states that project grants authorize every board/card, so shared contracts and feature docs require Architect-owned revision before implementation.
- Current board and card endpoints exist, as do comment, image, import, trash, activity, search and task paths. Route/source inspection shows many check project role. This means the new requirement affects existing access semantics, not just the new portfolio endpoint.
- The project-access model conflicts with the new user requirement until every existing access path is migrated. Treat affected current implementation as potentially unsafe for the revised requirement; do not expose the redesigned portfolio to users or claim the scope is implemented before complete cutover.
- `docs/reviews/STAGE2-REPAIR-20261026/README.md` records failed independent reviews: BRD 7.810, CRD 7.135, COM/DEL 6.775 and says all 32 backend handoffs remain blocked. Those findings and gate status are independent of the newly requested board-grant feature. Do not treat a future board-grant review as retroactive approval of those groups, and do not restart automatic repair loops under this proposal.

## Plain-English system-design note

A project grant answers “may Sam be in this business workspace/project at all?” A board grant answers “which workflow can Sam open?” Both checks must pass for a non-owner. For example, if Sam can use MyFashion but only has a Marketing board grant, the project portfolio may show Marketing cards while Web and Operations contribute no names, totals, search results, people assignments, or cursor boundaries. This extra check costs an indexed authorization lookup and migration work, but gives the requested separation. Keeping one board-level rule in a shared authorization helper is simpler and safer than reimplementing it independently in each route; however, every route and background/API alias must actually call that helper. Verification must prove both the helper and the mounted endpoints enforce it.

## Evidence and limits

This is a source-grounded proposed handoff, not code or proof. No migration, endpoint, shared contract, UI, tests, query plan, hosting or production behavior was changed or verified. Current API/project behavior is documented as project-grant inheritance, which directly conflicts with this user clarification. The exact migration backfill, invitation grant flow, project-wide people directory, and grant-admin authority remain explicit decisions for Architect/product before implementation. The review status noted above remains failed and must stay separate from this new feature’s future evidence.
