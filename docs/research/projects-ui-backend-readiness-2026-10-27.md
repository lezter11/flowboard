# Projects UI redesign: backend readiness map

> Latest user decision (27 October 2026): boards have separate access, and cards may be combined only inside ONE project. Earlier inheritance or Owner-wide aggregation recommendations below are historical source/design context, superseded by [the revised board-access handoff](../handoffs/proposals/project-board-access-v2-2026-10-27.md). Existing backend source behavior is not acceptance of this new requirement.


Date: 2026-10-27. Scope: read-only source inspection for the next Projects section UI/UX redesign. This is a contract/readiness note, not implementation or acceptance evidence.

## Recommendation

The current backend has usable project list, project read, create, settings, member-directory, people-picker, access-summary, archive, and reopen routes. These support a data-driven redesign of project browsing, project overview/settings, team display, and Owner-only archive controls. The supplied `design/flowboard-ui/screens/projects.*` and `project.*` files are static behavioral prototypes: their values come from `window.FB`/`window.SD`, and archive/reopen explicitly mutate local demo state. They do not call the API.

Treat backend feature handoffs as historical claims, not UI authorization. Although PRJ-01–05 handoff JSON files say `verified`, the latest Stage 2 repair round re-audited the broader backend against a frozen source target and failed all three group reviews (BRD 7.810, CRD 7.135, COM/DEL 6.775); the review README says all 32 handoffs remain blocked. No UI feature should be called integrated or backend-approved based on the older PRJ records. This affects confidence in integration, not the fact that routes and schemas exist in source.

## Current API map

All routes below are under `/api/v1` and require the authenticated session middleware.

| UI need | Current route and source behavior | Returned project/list fields |
|---|---|---|
| Browse all visible projects | `GET /projects?limit=&cursor=`; cross-workspace accessible list. Also `GET /workspaces/:workspaceId/projects?limit=&cursor=` for one workspace. | Paginated `{data, nextCursor}`; each project has `id, workspaceId, name, description, isArchived, version, createdAt, updatedAt`. Default page size 50, max 100. |
| Create project | `POST /workspaces/:workspaceId/projects`, Owner only. Input `name` and optional `description`; requires `Idempotency-Key`. | `201 {data: Project, replayed}`. Create does not automatically create a board. |
| View one project | `GET /projects/:projectId`; Owner or active project grant. Inaccessible project returns 404 to hide existence. | `{data: Project}`. |
| Edit name/description | `PATCH /projects/:projectId`; Owner or Manager; `expectedVersion`, plus at least one of name/description; requires `Idempotency-Key`. Stale version yields conflict. | `{data: Project, replayed}`. |
| View project people | `GET /projects/:projectId/members`; the route delegates to the adapter's directory read. `GET /projects/:projectId/people?purpose=display|assignee|mention&query=&cursor=&limit=` supplies eligible picker identities. | Members include role/status/version and user display data; picker is project-scoped and purpose-specific. |
| Explain current access | `GET /projects/:projectId/access-summary`. | Access summary schema includes project/workspace and inherited Owner information; inspect response schema before binding exact UI copy. |
| Archive / reopen | `POST /projects/:projectId/archive` or `/reopen`; Owner only; requires idempotency key. | `{data: Project, replayed}`. Archive is a read-only state in the product contract; trash deadlines continue. |

Route registrations and handlers are in [projects.ts](../../apps/api/src/http/routes/projects.ts#L37); list scoping/pagination is in [projects adapter](../../apps/api/src/adapters/projects.ts#L52). Project and people schemas are in [contracts/projects.ts](../../packages/contracts/src/projects.ts#L11). Mutation responses/errors should follow the shared API contract: paginated/resource envelopes; 401 for missing session, 403 for insufficient role in a visible project, 404 for inaccessible project, 409 for stale/domain conflict; mutations are idempotent.

## Authority and operation constraints

- Project access is an explicit grant. Under the revised requirement, board visibility is a separate grant that intersects the project grant for non-owners; the workspace Owner keeps implicit access to every board in owned projects. The current source still treats project membership as access to all descendant boards, so it does not implement this requirement yet. A user's access to another project or workspace alone grants no sibling project visibility.
- Owner alone creates, archives, reopens, appoints/removes Managers, and transfers ownership. Owner and Manager can edit project settings and manage project boards. Managers may invite/manage Members and Viewers only; Members work with cards, comments and uploads; Viewers read.
- Archive is reversible, but makes project boards read-only. Deleted-card recovery deadlines continue while archived. Project/card deletion is not an established operation in this UI scope; do not present a destructive delete action.
- The currently inspected project route file has invitation and membership reads, but no membership-write routes. The intended invitation/role management authority is documented, while actual invite/resend/revoke and member-role update readiness must be checked against their own route modules before a redesigned screen promises those actions.
- Project creation creates only the project row; board creation is a separate operation. Any create flow that promises a ready-to-use board needs a separately confirmed board-creation step or explicit follow-up UI.

These authority boundaries are product requirements in [PRD](../../PRD.md) and [FEATURE_SPEC](../FEATURE_SPEC.md); the source route checks are in [projects.ts](../../apps/api/src/http/routes/projects.ts#L53) and [projects.ts](../../apps/api/src/http/routes/projects.ts#L239). Role checks must remain server-enforced; hiding a button in the browser is not access control.

## What the prototypes currently show

`projects.html/js` now renders a connected project map (default) or a compact list: a project root with authorized board count, card/open/overdue totals, completion and active/archived state, connected board branches with per-board stats and access labels, search, create project, and Owner archive/reopen. `project.html/js` renders one project's board tree, at-a-glance completion, Owner-only people reach or a non-owner access list, a create-board dialog with initial grants, an Owner-only per-board grant editor, and an archived read-only state. `all-work.html/js` renders authorized cards from exactly one project in list or board layout, with a board strip, filters, paging and a read-only card preview. These remain fixture-driven: demo counts, people reach, grants, activity and archive metadata are not live API data, and board creation or grant editing has no backend route.

Source: [projects.js](../../design/flowboard-ui/screens/projects.js#L49) (board branch fields), [projects.js](../../design/flowboard-ui/screens/projects.js#L65) (project root/actions), [projects.js](../../design/flowboard-ui/screens/projects.js#L140) (empty state), [project.js](../../design/flowboard-ui/screens/project.js#L44) (overview actions), [project.js](../../design/flowboard-ui/screens/project.js#L96) (boards), [project.js](../../design/flowboard-ui/screens/project.js#L124) (people reach/aside), [project.js](../../design/flowboard-ui/screens/project.js#L178) (board access editor), [project.js](../../design/flowboard-ui/screens/project.js#L262) (board creation), and [project.js](../../design/flowboard-ui/screens/project.js#L341) (local archive mutation).

### Implemented design revision (27 October 2026)

The Projects screens were rebuilt around the per-board access requirement and the supplied connected-map references. `projects.html` now shows a project root with authorized board branches (Map, default) or compact rows (List); `project.html` shows a connected board tree, an at-a-glance donut, Owner-only People reach, a non-owner “Your access” list, a create-board dialog with initial grants, and an Owner-only per-board grant editor; `all-work.html` shows one project's authorized cards in list or board layout with a board strip, filters, paging and a read-only card preview. All records still come from `portfolio-model.js` fixtures and `sessionStorage`; no API route is called.

This raises the contract gap rather than closing it: the index and overview display board/card/overdue/people-reach counts that the current Project schema does not return, and board creation with initial grants has no route. The required read models, board-creation contract and tests are specified in [the revised handoff](../handoffs/proposals/project-board-access-v2-2026-10-27.md#implemented-ui-design-and-required-read-models-27-october-2026). Treat the current screens as design coverage only.

## Existing vs proposed vs blocked evidence

| Area | Evidence status today | Implication for redesign |
|---|---|---|
| Routes and shared project shape | Present in source; PRJ-01–05 backend handoffs and local evidence exist. | Good basis for mockups/API mapping; handoff claims are not current approval. |
| List/create/settings/archive route behavior | Present in route source and contracts. PRJ handoffs describe earlier passing targeted tests. | Design those flows, but label UI design as prototype until current backend review gate is resolved and actual API integration is verified. |
| Current backend acceptance | Latest `docs/reviews/STAGE2-REPAIR-20261026/README.md` records failed independent group reviews and says all 32 handoffs blocked. | No backend-ready/integrated status. Broader board/card/discussion/trash problems may affect overview counts, archive consequences and detail navigation. |
| Project screen design | Static prototypes with local fixture state; the 27 October revision adds the map/tree/workbench layout and per-board grant editor. | Visual/design coverage only; not app implementation, API behavior or production data proof. |
| Board/card/person/activity counts on project list | No such fields in the Project schema; the revised screens now display board, card, overdue and Owner-only people-reach counts. | Requires the explicit summary read models in the revised handoff, scoped before aggregation. Do not infer them from the list endpoint. |
| Archived-by/time metadata | Not in the Project schema or archive response. | The prototype's archived actor/time should not be represented as server truth without a contract change. |
| Pending invitation count/state | Not part of Project/list response. | Requires invitation list/count calls and authorization-aware loading; do not infer from member directory. |
| Backend UI handoffs | Existing PRJ evidence files and reviews are preserved; broader current acceptance fails. | No checklist closure or handoff acceptance is implied by this research note. |

## Backend fields and actions suitable for design

- Project identity card/details: `name` (1–100 chars), nullable `description` (up to 2,000), active/archive state, created/updated timestamps, optimistic `version`.
- List navigation: cursor pagination, accessible projects only. API list has no search parameter; a local search can filter only the loaded page and must not imply complete server search.
- Create: Owner-only, name plus optional description; default board creation is separate.
- Settings: Owner and Manager may update name/description with `expectedVersion`; design a stale-edit conflict state and preserve typed changes.
- Archive/reopen: Owner-only confirmation and clear read-only/reopen consequences. Use current server response/refetch; no archive actor/timestamp available.
- Team list and picker: project-scoped roles/people. Do not expose email broadly in project cards; directory schema currently includes email, so the screen should fetch only where needed and the product owner should confirm intended visibility.
- Role-specific empty/forbidden states: unknown or ungranted project can be hidden as 404; do not promise a “request access” workflow unless separately scoped.

## Questions to settle during the redesign

1. Is the redesigned destination a cross-workspace project switcher/list, or one workspace's Projects screen? Both list APIs exist; workspace picker/context is not part of the project record.
2. Should project cards show only project fields, or should a separate backend summary contract be planned for board/card/people counts? The current project payload does not include them.
3. Should the Projects view expose team/invitation management shortcuts, or keep those in a dedicated project People screen? Invite and membership mutation readiness needs separate contract/source review.
4. Should archived projects be visible to every currently granted role, as the sample does, or only Owners/Managers? Confirm product visibility before designing role-specific archive tabs.
5. Is email visible to all project readers in the team directory? Current directory schema includes email; picker/display schema is more privacy-limited.
6. What should happen after create: stay in Projects, open Settings, or prompt to create the first board? Backend does not create that board automatically.

## Evidence limits and next step

This report is source inspection plus existing repository evidence; no tests, browser run, database execution, hosted behavior or performance measurement was performed. The current prototypes are not wired to backend routes. Use this map to design the next Projects UI concept, then scope UI implementation only after the product decisions above and current backend acceptance/handoff state are explicitly handled.

Relevant source path pointers: [API contract](../API.md), [feature scope](../FEATURE_SPEC.md), [handoff rules](../handoffs/README.md), [current failed review record](../reviews/STAGE2-REPAIR-20261026/README.md).
