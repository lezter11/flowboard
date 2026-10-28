# Projects portfolio card aggregation: backend proposal

> **SUPERSEDED (2026-10-27):** User clarified that access is granted separately for each board and the product combines boards only within one project. This proposal's assumptions that project grants alone authorize all child boards, and its suggested owner workspace aggregation, are no longer current. Preserve this file as historical proposal only; do not implement its endpoint/API guidance. Follow [the revised board access contract handoff](project-board-access-v2-2026-10-27.md). Backend work is paused pending contract design.

Date: 2026-10-27  
Status: proposed, source-informed; not an implementation or verified handoff.  
Audience: Architect and Backend role; this file does not change shared API contracts or generated checklist evidence.

## Actions and decision

Use the existing `project` entity as the container and `board` as its child workflow. Example: the `MyFashion` project can contain Web, Marketing, and Operations boards. Do not introduce a second nested “project” entity to represent these divisions. A card remains attached to exactly one project, board, and column. The proposed portfolio screen is a read-only query over those existing relationships; moving a card remains a normal board-local move and never clones it or reassigns it to another board.

Add one bounded backend capability after an Architect decision on owner scope:

- Project portfolio: `GET /api/v1/projects/:projectId/cards/portfolio`
- Optional owner portfolio: `GET /api/v1/workspaces/:workspaceId/cards/portfolio`

The project endpoint may be made to reuse `GET /projects/:pid/cards/search` only if its response and cursor are explicitly extended to include provenance and stable paging. A separate `portfolio` route makes its distinct ordering, status normalization, and UI summary semantics easier to keep explicit. Do not call the existing `GET /me/tasks` “all cards”: it returns only the current actor’s assignments and has neither pagination nor broad portfolio semantics.

## Current source facts vs gaps

| Present in source/contracts | Missing for this scope |
|---|---|
| A project owns multiple boards; each card persists `workspace_id`, `project_id`, `board_id`, `column_id`. | No owner-wide or project-wide all-card page with board/column provenance. |
| Project grants authorize child boards/cards; workspace membership alone does not grant sibling project access. Owner can access owned workspace projects. | No settled policy whether project portfolio is available to all project readers or only Owner/Manager; no board-specific grants exist. |
| `columns.category` is `todo`, `active`, or `done`; it is configurable per column. | No universal “completed” meaning apart from the column category. A column named “Finished” can be `active`; do not infer from its name. |
| Active card, assignee, priority, date and per-board/project queries exist. | Current project search returns `nextCursor: null`, limited result shape, and may search description. Current `/me/tasks` returns assigned cards only with project/board/column names. |
| Workspace stores a timezone; project context can derive the local `asOfDate`. | No explicit cross-project rule for “overdue” when workspace timezones differ. |
| Current DB has indexes on project, board, card state, column/position and assignee user. | No matching composite indexes proven for the proposed filter/order/page workload; no query plan or benchmark evidence. |

Existing feature IDs QRY-01/QRY-02 cover project-scoped search and filters; QRY-03 covers actor-assigned tasks. This proposal is a new, dependency-ready feature slice (suggested ID `QRY-04` after Architect registers it in `docs/features.tsv`); do not update the canonical registry/checklist from this proposal.

## Proposed behavior and response

Require the authenticated session and current database authorization on every request. The project scope should default to active cards in non-archived boards and project; archived project access remains readable only according to the established role policy, but archived cards/boards should be excluded by default and represented in explicit scope metadata if the UI later asks for them. Trashed/purged cards never appear in this active portfolio.

For `workspaceId` aggregation, first resolve workspace existence and actor authority. Only the workspace Owner may enumerate all projects in that workspace. A non-owner, including an Owner invited into some other project, gets a non-enumerating 404/403 policy consistent with existing API patterns. If product later wants a “projects I can access” roll-up, it must be a distinct grant-filtered mode, never silently broaden Owner mode.

Suggested filters: `projectId` only on workspace route, `boardId`, `columnId`, `q` (title only for v1), `priority`, `assigneeId`, `due=overdue|today|upcoming|none`, `completion=all|open|done`, `includeArchived=false` (Owner/Manager only if explicitly authorized). Filter values are validated and bound into the cursor. Define `today` per each card’s workspace timezone; for a single project this is one timezone. Across workspaces is out of scope. `overdue` is `due_date < local-today AND category <> 'done'`.

Proposed response:

```json
{
  "data": [{
    "id": "card-id",
    "project": {"id":"p1", "name":"MyFashion"},
    "board": {"id":"b1", "name":"Web"},
    "column": {"id":"c1", "name":"In progress", "category":"active"},
    "title":"Publish spring landing page",
    "priority":"high",
    "dueDate":"2026-11-04",
    "assigneeIds":["u1"],
    "position":1200,
    "version":4,
    "commentCount":2,
    "imageCount":1,
    "createdAt":"...",
    "updatedAt":"..."
  }],
  "nextCursor":"opaque-or-null",
  "scope":{"kind":"project","projectId":"p1","asOfDate":"2026-10-27"},
  "counts":{"active":83,"matching":16,"done":12,"open":71},
  "countScope":"authorized active cards; counts match documented archive/filter policy"
}
```

Counts are optional and should be omitted if their cost cannot be bounded. If returned, calculate them using the same authorized project set, card states, archive semantics, and filters as the page; label whether `active` is pre-filter or matching. Do not count inaccessible sibling projects in any field. Counts can be explicitly approximate/stale only with a documented freshness window; otherwise they must be from the same statement snapshot as page rows and labeled `asOf`.

`column.category=done` is the only v1 completion signal. Preserve the source column name and category in each result so different boards’ custom labels remain understandable. Filter `completion=open` as category != `done`, `done` as category = `done`; no magic-name matching. A done column is board-local metadata and should not be confused with card lifecycle `state` (active/trash/purge).

## Ordering and cursor

Use a total deterministic order, for example `dueDate ASC NULLS LAST, updatedAt DESC, projectId, boardId, cardId` (or updated-at-first if product confirms). Include all sort values and the complete normalized scope/filter hash in a signed opaque cursor, plus a cursor version. Keyset predicate must exactly implement null ordering and tie breakers; reject changed filters/scope/sort with 400 `INVALID_CURSOR`. Do not use `OFFSET` or per-board cursors concatenated in application memory.

For pages that must not skip/repeat under concurrent card edits, bind to a database snapshot/revision or use a documented weaker consistency contract (keyset pagination avoids offset shifts but does not promise immutable snapshot across independent HTTP requests). Prefer snapshot token only if a bounded, server-side token lifecycle can be justified; otherwise return a stable keyset order and state that concurrent edits may move rows between pages, with refresh resetting the cursor. Cursor must not be an authorization grant: re-authorize the entire requested scope each page, and reject if a project/board grant has been removed or the owner-scope check fails.

## Authorization and privacy rules

- Authorize the project/workspace and derive the set of visible projects before executing row/count queries. Join `projects` to `workspaces`, active project memberships, and owner identity using server actor ID; never accept actor or role from query/body.
- For project endpoint, inaccessible project returns 404 to hide its existence. For workspace endpoint, require `workspaces.owner_id = actor.id`; invited membership elsewhere provides no enumeration.
- Apply the exact same authorized project predicate to page, counts, related assignee IDs, and any metadata. Do not first fetch broad card IDs and filter them in application code after pagination.
- Do not include email, descriptions, comments, image bytes/URLs, or deleted-card content. For assignees, return only IDs in the card summary initially; display names should be a batch fetched from eligible identities inside the same authorized scope if the API/UI needs them. Removed assignees can remain historically referenced but should not expose unrelated profile fields.
- Board-specific grants are not part of current contracts. If that requirement arises, add them as an explicit policy and include them in every query and mutation guard; do not let this aggregation endpoint invent partial board authority.
- `includeArchived` must not bypass project grants. Archived projects/boards are read-only, and their active cards should be included only with explicit UI/product semantics and a count label. Default excludes archived project/board contexts.

## SQL shape, indexes and query budget

Implement one authorization-scoped keyset page query joining cards → columns → boards → projects/workspaces and filtered grants. Aggregate assignee IDs via a lateral/grouped query for only the page card IDs; batch comment/image counts for those IDs. Do not issue one query per board, column or card. Target a constant small number of SQL statements (e.g. 1 page + 1 batched assignee aggregation + 1 batched counts query, with an optional same-snapshot count query), regardless of project/board count. Use a transaction/repeatable-read snapshot only if the runtime/transaction helper supports it and the bounded duration is acceptable.

Candidate indexes, to be confirmed against `EXPLAIN (ANALYZE, BUFFERS)` on representative disposable PostgreSQL fixtures:

- `boards(project_id, archived, id)` for project board scope.
- `cards(project_id, state, due_date, updated_at DESC, id)` for due-first project portfolio if that exact order is selected; a separate board-scoped index may be necessary for owner workspace aggregation.
- `cards(board_id, state, due_date, updated_at DESC, id)` for board filters.
- `card_assignees(user_id, card_id)` already has `idx_card_assignees_user(user_id)` but verify whether its selectivity/join plan suffices; use composite only if plans show benefit.
- Existing `columns(board_id, position)` is useful for provenance but a unique `columns(id, board_id)` / FK consistency audit may be needed because current text foreign keys do not by themselves prove that a card's `column_id` belongs to its `board_id` and project. Do not add constraints without checking migration compatibility/data.

Avoid indexing arbitrary `%q%` title search with a B-tree; either keep v1 title search prefix/exact, use PostgreSQL trigram only after extension/policy approval and measured need, or defer q to a separate search feature. No search extension is selected by this proposal.

## Sequenced backend units and acceptance evidence

1. **Contract/design freeze (Architect-owned).** Add a new feature ID and validated response/query/cursor schemas plus OpenAPI; define project reader roles, owner workspace scope, archive defaults, counts freshness, title-only search, sort, cursor mutation consistency. Acceptance: schema tests reject unknown/invalid fields; written role matrix includes owner, manager/member/viewer, removed member, invited owner in sibling workspace and outsider. No handler implementation before this freeze.
2. **Project portfolio endpoint (Backend-owned, sensitive cross-project read).** Add project-scoped page endpoint, DB query, provenance fields, default active lifecycle and exact authorization before LIMIT/count. Acceptance against PostgreSQL: active grant sees only its project; sibling project and outsider get non-enumerating response; removed grant denied on next page; no email/description/body data; custom column category respected; done excluded from overdue; cursor stable across equal/null due dates and filter mismatch rejected; archive policy/count consistency.
3. **Owner workspace aggregate (separate backend unit, high cross-project isolation).** Add workspace route only if user confirms utility. Owner sees owned workspace projects; invited owner sees no unrelated projects; project-scoped member is never admitted to workspace-wide mode. Acceptance includes multiple workspaces and sibling roles with sentinel card titles proving zero leak in data, count, page boundary, cursor, and assignee expansion.
4. **Measured query/index tuning and independent review.** Create realistic fixtures with many boards/cards; measure bounded statement count and inspect query plan. Acceptance: no N+1 with increased board/card count, bounded page ≤100 and related rows ≤ page×20 assignees, query plan uses suitable indexes or documented reason; run required API/contract/type/build checks on exact frozen target. Fresh independent reviewer and `docs/reviews/...` record must pass the current `BACKEND_REVIEW_GATE.md` including strict >8.5, every category minimum and no blocker. Only then produce the role-owned handoff/reviewPath and regenerate checklist evidence.

Risks: global row totals are sensitive metadata even if titles are hidden; do not return them before authorization. A single cross-project list can be operationally expensive, so keep it paged, indexed and explainable. Per-project timezones complicate a portfolio “today”; workspace aggregation is one workspace and therefore has one timezone, but multi-workspace aggregation is excluded. Archive and custom status semantics need the explicit decisions above.

## Evidence and limits

Source inspection found the existing Postgres relationships/indexes and query shapes described above; this proposal ran no tests, migrations, query plans, performance measurements, UI integration, or hosted checks. The prior source readiness report and older PRJ handoffs are not approval. The latest Stage 2 repair README records failed independent BRD (7.810), CRD (7.135), and COM/DEL (6.775) reviews and says all 32 backend handoffs remain blocked; the review gate must be satisfied for the exact changed target before any new UI handoff is marked verified.


## UI Architect delivery direction and provisional policy

User explicitly authorized handing the backend coding part to the existing Flowboard Backend chat on 27 October 2026. This proposal is that bounded implementation request, not backend acceptance. The UI chat owns the local HTML prototype and does not edit apps/api, migrations or shared contracts.

Working policy for this first slice, pending replies to two user questions: project grants continue to cover all child boards; no board-level grants or nested projects are introduced. Owner can view all boards in a project and all projects in one owned workspace. Other project readers may view their granted project's combined board cards only; they cannot use Owner-wide workspace aggregation. The user has been asked whether separate board membership is needed and whether both aggregate scopes are desired. If those answers change the policy, stop affected contract work and report the required adjustment. Do not silently implement another permission model.

Proceed feature-first: confirm route/schema proposal against the current tree, implement the smallest read-only project portfolio slice with canonical provenance and bounded paging/tests, then Owner workspace aggregation as a separate verifiable unit. Preserve current failed backend reviews and stop/retry rules; do not treat this request as authorization to reopen unrelated card-ordering or purge repairs automatically. Use independent exact-source acceptance strictly above 8.5, category minimums and no blockers before marking any backend handoff verified. Do not wire the UI prototype to the API before its prerequisites and role-owned handoffs pass.

For the response contract prefer unambiguous `counts.matching`, `counts.open`, `counts.done`, and a documented pre-filter `counts.total` when returned; avoid the overloaded word active (lifecycle active vs workflow active). Any totals must describe the same authorized scope and snapshot; omit costly counts instead of estimating silently. Return project, board and source column IDs/names/category for each card. Workspace scope stays within one owned workspace, not every workspace on the account.

UI direction: Projects overview with connected project→board navigation, project-only All boards, and an Owner All projects workbench with project/board/search/stage/priority filters. The aggregate view is read-only; original columns remain visible and movement/editing goes back to the source board. No synthetic frontend count is an API commitment.
