# Flowboard product and API research

Research date: 26 October 2026, Asia/Kolkata. Status: research proposal for review; no application code, backend, integration, or deployment has been implemented or verified by this report.

## Authority and synthesis

The final source of truth for the next implementation phase is [PRODUCT.md](../PRODUCT.md), [API.md](../API.md), [ARCHITECTURE.md](../ARCHITECTURE.md), and [DELIVERY.md](../DELIVERY.md). They remain proposed v0.1 decisions, not user acceptance or shipped behavior. If this research and those contracts differ, implement those contracts and record any deliberate future amendment there.

The selected baseline uses **workspace-wide visibility; Owner/Admin/Member/Viewer roles; JSON `expectedVersion`/`expectedBoardVersion` with 409 conflicts; integer ranks with gaps; plain-text comment bodies with validated UTF-16 mention spans; and foreground polling/refetch first**. HTTP If-Match, SSE, separate board membership, dense reorder positions, and typed comment segments are explored below only as unselected alternatives.

## 1. Intent and evidence boundary

Build an independent, collaborative Kanban application inspired by Azure Boards. Preserve the useful interaction model while keeping the first version understandable and small.

The supplied references establish visual inspiration: a compact dark board with five columns and a light board with summaries. They do not establish a financial, bidding, vendor, procurement, or other business domain. Names, amounts, business stages, and aggregate values visible in reference imagery must not become product requirements or claims about real data.

The following distinction applies throughout this document:

| Classification | Meaning |
| --- | --- |
| Explicit requirement | Customizable columns; draggable cards; title, priority, due date, and assignees; a card detail modal; comments with @mentions; collaborative Azure Boards-like behavior. |
| Reference evidence | Compact board density, multi-column layout, and possible light/dark visual directions. Five columns and summary panels are reference characteristics, not fixed limits or approved information architecture. |
| Proposed MVP decision | Every role, limit, route, schema, default, notification rule, summary definition, and technical mechanism below. These are recommendations, not accepted requirements. |
| Unresolved | Final visual direction, sign-in provider, hosting/database choice, public sharing, organization structure, notification channels, delivery schedule, and expected load. |

The workspace was empty when this research began. During research, the coordinating architect wrote the v0.1 product, API, architecture, and delivery documents. Those documents are the authoritative implementation baseline; this report records supporting evidence and alternatives. No deployed system was available to validate. Do not claim Azure compatibility, synchronization, or enterprise readiness.

## 2. Findings from primary sources

### Azure behavior worth adapting

1. **Columns are configurable and administrative.** Azure supports adding, renaming, and reordering columns. Its documentation assigns configuration to project/team administrators and advises moving work out before removing a column. It also maps board columns to process workflow states. Flowboard should adopt the configurable columns and removal guard, while using a simpler direct column-based state model for the MVP. The separate Azure process/state hierarchy is not needed to satisfy this request. [Microsoft: manage columns](https://learn.microsoft.com/en-us/azure/devops/boards/boards/add-columns?view=azure-devops)
2. **Cards expose useful fields and can be ordered deliberately.** Azure supports choosing displayed fields, editing many fields directly on cards, and selecting between backlog-priority order and free ordering within columns. It also has an explicit Move to position action. Flowboard should begin with one manual ordering mode and the requested card fields. This keeps priority separate from physical position and gives users a predictable alternative to dragging. [Microsoft: customize cards](https://learn.microsoft.com/en-us/azure/devops/boards/boards/customize-cards?view=azure-devops)
3. **WIP limits communicate flow pressure.** Azure documents work-in-progress limits as soft constraints and highlights a column count when exceeded. For Flowboard, optional soft warnings are a useful later enhancement; they should not silently become transition-blocking rules. [Microsoft: WIP limits](https://learn.microsoft.com/en-us/azure/devops/boards/boards/wip-limits?view=azure-devops)
4. **A mention is an identity reference.** Azure uses a people picker and stable identity references, and notes that text copied to look like a mention need not trigger a notification. It supports email notifications and broader directory behavior. Flowboard should adopt identity selection but initially restrict it to active members who can access the board. Mentioning someone must never invite them or grant access implicitly. [Microsoft: @mentions](https://learn.microsoft.com/en-us/azure/devops/organizations/notifications/at-mentions?view=azure-devops)

These sources describe Azure, not Flowboard. Their licensing, process templates, Entra ID integration, group mentions, sprint structures, and permission hierarchy are not inherited requirements.

### Browser and collaboration constraints

- **Dragging needs a pointer alternative as well as keyboard access.** WCAG 2.2 SC 2.5.7 requires an equivalent single-pointer action without dragging; keyboard support alone does not satisfy that criterion. W3C explicitly gives a task-board menu and Kanban arrow controls as examples. Provide a clickable/tappable Move action that also works with keyboard controls. [W3C: dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- **A modal must manage focus.** WAI-ARIA APG describes initial focus inside the dialog, contained Tab/Shift+Tab navigation, Escape to close, an accessible name, and focus restoration to the opener or a logical fallback. Treat this as interaction guidance and test the implementation with real browser/assistive-technology combinations. [W3C: modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- **Suggestion selection must not break ordinary editing.** APG documents Down/Up navigation, Enter to accept, Escape to dismiss, expanded state, associated popup semantics, and avoiding interference with browser text-editing keys. Its combobox examples focus on single-line controls; a multiline mention editor needs deliberate adaptation and assistive-technology testing rather than blindly assigning roles to a textarea. [W3C: combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- **Concurrent edits need an explicit precondition.** HTTP `If-Match` uses strong entity-tag comparison and is designed to prevent lost updates. The server must not apply a failed condition; Flowboard can consistently return `412 Precondition Failed` and help the user reconcile their draft. [IETF: RFC 9110, section 13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)
- **Realtime transport does not make events durable.** The HTML EventSource standard defines reconnection, event IDs, and `Last-Event-ID`. Server-side retention, replay, and recovery still need an application design. [WHATWG: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- **A due date is a calendar date.** Browser date inputs normalize their value to `yyyy-mm-dd` without a time component. Preserve that representation instead of converting it through a local midnight timestamp. [MDN: date input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date)
- **Errors benefit from a common envelope.** RFC 9457 defines `application/problem+json`, standard problem members, and extensions. This gives a consistent place for validation codes, conflicting versions, and field errors. [IETF: RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)

Retrieval note: Microsoft pages displayed generic sign-in notices, but the cited article bodies were returned. One @mentions retrieval hit a Firecrawl rate limit and was subsequently retried successfully. These are documentation findings, not a live Azure behavior test.

## 3. Bounded MVP aligned to the v0.1 baseline

The useful first slice is a complete workspace → project → board → column → card flow with comments, active-member mentions, in-app notification delivery, persistence, and recoverable concurrency. The selected Cloudflare/GitHub direction and runtime details live in the architecture/delivery documents.

### Core behavior

1. A signed-in user opens a workspace and one of its boards. All active workspace members can read its projects/boards; private projects, per-board membership, and guests are deferred.
2. Owner/Admin creates and configures columns. Initial labels are Not started, In progress, Testing, Completed; labels, colors, and order remain configurable. A stable `todo | active | done` category defines semantics independently of display names.
3. Member creates a card with a required title. The detail dialog edits plain-text description, priority, date-only due date, and zero or more assignees. Priority values are `none | low | medium | high | urgent`. These are proposed defaults, not enumerations demanded by the screenshots.
4. Member moves/reorders a card with dragging or an equivalent visible Move action. The server owns canonical ordering. The card stays in exactly one column of its board; moving never silently changes title, date, priority, or assignment.
5. Member posts comments and selects active workspace members from a mention picker. Mentions create in-app notifications once per recipient per comment creation. Email/reminders are deferred.
6. A second open client sees committed changes through foreground polling and refetch on focus/reconnect. The first release promises persistence and conflict handling, not instantaneous presence or offline writes.

### Supporting scope

Include title search and filters for assignee, priority, and due date; archive/restore; paginated comments and column cards; immutable activity; and loading, empty, offline, forbidden, save-error, and conflict states. Keep user drafts across failed saves/refetches. Counts must distinguish total matching cards from the loaded page.

Defer custom field builders, dependencies, sprints, swimlanes, attachments, arbitrary HTML, recurring tasks, group mentions, public sharing, guest access, email/push, Azure synchronization, collaborative text editing, presence cursors, and analytics suites. Neither screenshot establishes monetary totals, vendor stages, bidding workflows, approval percentages, or business forecasting.

If summary tiles are included later, give each a precise scope and derivation. Useful candidates are active-card count, in-progress count, overdue count, and due-today count. Do not treat this list as approval to add a dashboard to v0.1.

## 4. Data model and invariants

The executable schema belongs to [0001_initial.sql](../../database/prototypes/d1/migrations/0001_initial.sql). The table below explains product intent, rather than prescribing a second incompatible schema.

| Entity/concept | Product role | Required invariant |
| --- | --- | --- |
| User, provider identity, session | Stable identity and authenticated actor | Display names are not unique identities; never trust a client-supplied actor or workspace header. |
| Workspace and membership | Tenant boundary, timezone, Owner/Admin/Member/Viewer | Every read/write/replay resolves active membership. Exactly one Owner initially; ownership changes must be transactional. |
| Project, board | Organize work within a workspace | A project/board cannot link across workspaces. Boards are visible to all active workspace members. |
| Column | Ordered, configurable workflow stage | Stable ID survives rename/reorder. `todo/active/done` category is independent of name/color. Active cards cannot become orphaned. |
| Card | Title, description, priority, due date, position, version, archive state | Exactly one board and column; column belongs to that board. Order is server-owned. |
| Card assignee | Many-to-many active teammate assignment | Unique pair; validate workspace membership in the write path. A card may be unassigned. |
| Comment and mention | Plain text plus structured recipient IDs/spans | Valid nonoverlapping UTF-16 ranges; canonical IDs are authoritative, display text is not. |
| Activity | Durable account of changes | Mutation and associated event commit together; immutable actor, object and occurrence metadata. |
| Outbox and notification | Retryable in-app mention delivery | Persist mention outbox with comment; idempotent consumer creates one event/recipient notification. |
| Idempotency receipt | Replay a lost-response write | Actor/workspace/key plus method/path/payload hash; duplicate with changed payload is a 409. |

### Dates and summary semantics

Store due dates as `YYYY-MM-DD` or null, timestamps as UTC instants. Interpret today against the **workspace timezone**, not whichever browser or server happens to read the card. Browser locale changes presentation only. A past date is a valid value; it represents overdue work rather than an invalid form.

Recommended derivation if summaries are implemented: active excludes archived; completed means current column category is `done`; overdue means a date earlier than workspace today and not completed; due today means equality and not completed. Due today is not overdue. Returning a completed card to an active column can make its original due date overdue again. Renaming a column never changes these calculations; changing its category can, so the settings flow should explain that effect.

Removed users retain historical authorship. Existing assignee references should display as inactive until explicitly replaced/removed; removed users must be unavailable for new assignments/mentions. Notifications and detail links recheck current access instead of exposing snapshots after membership revocation.

## 5. Permissions and workflows

The selected role matrix is in PRODUCT.md. All active roles read; Owner/Admin/Member create/edit/move/archive cards and comment; Viewer is read-only. Owner/Admin configures projects/boards/columns and manages member/viewer invitations. Only Owner grants Admin, transfers ownership, or deletes the workspace. Admin cannot demote/remove the Owner. Prevent owner-loss inside the mutation path, not just a button guard.

### Create and edit

- Quick add needs a valid trimmed title and a chosen column. New card position is assigned by the server, with expected board version and idempotency key.
- A card title/link opens an accessible dialog and a shareable card URL. Do not use a card-wide button containing other interactive buttons.
- Keep field editing separate from comment submission. Explicit Save/Cancel is a reasonable initial UI choice; a comment must not accidentally save unfinished card edits.
- On a stale version, keep the draft, fetch current values, explain the conflict, and let the user deliberately reapply changes. Never fabricate a newer expected version and silently retry an overwrite.
- An archived card, revoked permission, or removed destination must stop the pending action with a recoverable explanation.

### Move and reorder

- Provide a dedicated drag handle or activation threshold so scrolling, text selection, and title activation do not accidentally move cards.
- The same server command powers drag, the visible Move action, and Undo. Destination and position choices are operable by keyboard **and** click/tap without a dragging gesture. Include top/bottom or equivalent position choices.
- The canonical API uses previous/next neighbor IDs excluding the moving card, expected card version, and expected board structure version. Both null means empty destination. Append uses the canonical last card as previous; prepend uses the canonical first as next. Verify adjacency in the full server order.
- During filtered views, hidden cards remain in canonical order. Resolve actual adjacent boundaries through server state or refetch the canonical column; never renumber only the visible subset. If the UI cannot resolve the boundary, temporarily disable relative reorder and explain the next step.
- The selected implementation uses integer ranks with gaps and guarded destination compaction. Rank values never come from the client. Sort deterministically by `(position, id)`.
- Show pending state and commit only the canonical response. On failure refresh the affected state and remove provisional placement without duplicating or losing a card. Prevent overlapping moves of the same pending card.
- Undo is a new authorized command with current expected versions, not a blind local rollback. If later changes invalidate it, keep current server state and offer Move again. Preserve focus and announce outcome.

### Columns

Owner/Admin may rename/reorder populated columns without changing card IDs or state links. A nonempty column cannot be deleted; offer an explicit bulk-move workflow before deletion rather than silently cascading cards. Empty-column removal and final-column protection should be explicit API invariants. Archived cards/history need an intentional reference/restore policy; do not assume archiving alone makes foreign-key deletion safe.

### Comments and mentions

- Chronological order uses stable `(createdAt,id)` pagination. User text renders literally; arbitrary HTML is not accepted.
- `@` and an explicit mention/picker action both reach active workspace-member suggestions. Duplicate display names need disambiguation. Member search cannot enumerate other workspaces.
- The selected API stores `body` and `mentions: {userId,start,end}[]`. Offsets are JavaScript UTF-16 code units, start inclusive/end exclusive. Validate that ranges do not split surrogate pairs, overlap, or exceed body length, and that selected text matches the intended mention token. Include emoji/IME/non-Latin fixtures.
- Plain `@displayName` text without a validated ID/span is ordinary text. Never infer delivery from styling or invite/grant access because a name was typed.
- Comment creation, validated mention relations, activity, idempotency receipt and outbox commit atomically. An idempotent consumer creates in-app notifications; this delivery may be asynchronous. Notify each recipient once; suppress self-mentions.
- Author/moderator edits require expected comment version. Edits update mention rows but do not re-notify in v0.1. Deletion leaves a tombstone and hides body/mentions. Historical delivery cannot be “unsent.”
- A notification contains IDs; reads/deep links check current workspace access. Never preserve an unrestricted private comment preview after access disappears.

## 6. API contract guidance

[API.md](../API.md) owns exact route names, shapes, limits and status codes. Implement it through shared validation/TypeScript schemas and a generated or validated OpenAPI document during the first slice.

### Selected contract conventions

- `/api/v1`, authenticated same-origin cookie session, strict Origin/CSRF checks for writes; opaque IDs; UTC timestamps; date-only due dates.
- List envelope `{data: [], nextCursor: string|null}`, default 50/max 100; single resource `{data: resource}`. Cursor is bound to scope/filter/revision. Board snapshot is bounded and exposes per-column pagination and full counts. The separate board `snapshot_version` covers changes affecting filtered pagination; do not substitute structure/order version for it.
- All writes require `Idempotency-Key`. Recheck permission on receipt replay as well as first execution. Retry an identical failed network request with the same key/body; changed payload or a stale revision requires deliberate resolution. Workspace creation uses actor-scoped operation receipts before a workspace exists; other receipts use the documented workspace scope.
- Card/comment changes use JSON `expectedVersion`; board structure/order changes use `expectedBoardVersion`. Stale versions return **409**, not 412. Missing expected versions fail validation; no unconditional overwrite default.
- PATCH omitted means unchanged; null clears only nullable fields. Unknown/immutable writable fields are rejected. Clients cannot edit position, author, creator, role, workspace, or board ancestry through a generic card PATCH.
- Errors use the selected `{error: {code,message,requestId,details?}}` envelope. 400 malformed, 401 invalid session, 403 visible but insufficient role, consistent 404 missing/inaccessible cross-workspace object, 409 revision/idempotency/domain conflict, 422 field/relation validation, 429 rate limit. No raw SQL/provider errors.

The selected limits are title 1–200 trimmed characters, description up to 20,000, comment 1–10,000, column label 1–80, at most 20 assignees/mentions. Date must be a real Gregorian date. These are contract defaults to validate and test, not reference-image facts.

### Representative command

```http
POST /api/v1/cards/card_104/move
Content-Type: application/json
Idempotency-Key: 446ab40b-e657-4785-9525-1258b9cf4af4

{
  "toColumnId": "col_testing",
  "previousCardId": "card_a",
  "nextCardId": "card_b",
  "expectedVersion": 3,
  "expectedBoardVersion": 18
}
```

The server checks active membership, complete resource ancestry, role, versions, destination/neighbor adjacency, then commits one guarded mutation. Canonical result returns card version and board structure version; any compaction response must remain bounded/paginated. A failed precondition causes no card move, activity, notification, or idempotency receipt falsely describing success.

Required endpoint groups are session/workspaces/membership/invitations, projects/boards/columns, cards/move/archive/restore/activity, comments, and recipient-only notifications. Exact paths and invitation behavior are in API.md. Invitation email is a separate integration; a synthetic local acceptance flow does not prove external mail delivery.

## 7. Collaboration and consistency guidance

The selected baseline is one TypeScript application/API on Cloudflare Workers with D1 canonical storage and a transactional outbox. Do not implement generic database locking advice literally on D1: its atomic prepared-statement batches differ from an interactive read/compute/write transaction. The architecture's conditional update plus mutation-guard pattern needs runtime integration tests. A zero-row update is not by itself an SQL error.

For ordering mutations, check both card version and board structure version. Create/archive/restore/column changes invalidate structure version. Ordinary card content edits use the card version without needlessly changing order. Comments/activity may change without structure version; polling must not use structure version as its only change signal.

Poll/refetch while foregrounded, after local writes, on browser focus, and on reconnect. Mark refreshing/offline states honestly. Keep drafts while replacing server state. No offline write queue in v0.1. Never present a stale board as guaranteed live.

Persist card/comment changes, activity, receipt, and mention outbox together. An idempotent consumer creates inbox records once per event/recipient and retries failed rows with leases/bounded attempts. Membership revocation must apply in writes, reads, receipt replay and notification access, including open tabs on their next request. Shared authenticated caches must not continue serving old access.

Proposed load verification should begin with a clearly recorded synthetic board size, member/session count, request rate and browser/network environment. A useful initial exercise is 500 cards, 50 members, and 10 concurrent editor sessions, but these are **research test-envelope suggestions, not API limits or demonstrated capacity**. Measure D1 scanned rows, write contention, conflict rate, latency, payload size and full-page loading. Polling interval and performance targets belong in the implementation plan after measurement.

## 8. Accessibility handoff requirements

These are proposed acceptance requirements based on cited W3C guidance, not a claim of completed WCAG conformance.

- Prefer column headings, card lists, and native buttons/links/inputs. Do not declare an ARIA grid unless the complete two-dimensional keyboard interaction contract exists.
- Every drag operation has an equivalent **visible click/tap Move action** that also works by keyboard. Cover cross-column movement and within-column positioning. Keyboard drag support alone does not satisfy the non-dragging pointer alternative.
- If keyboard dragging is added, document pickup/drop/cancel keys, announce destination/position in a polite live region, and preserve focus. It supplements the Move action.
- Opening details places focus inside a named modal; background is inert; Tab/Shift+Tab remain inside; Escape dismisses an inner suggestion popup before the outer dialog; unsaved drafts get a clear discard/keep choice. Closing restores opener focus or a logical nearby card/column.
- Mention suggestions support Up/Down, Enter and Escape, while standard editing keys and IME composition continue to work. Enter accepts a selected suggestion without posting the comment. Provide an explicit Post control and an accessible member-picker fallback. A single-line combobox pattern cannot simply be pasted onto a multiline editor without testing.
- Priority, overdue, selection and permissions have text cues, not color alone. Avatar controls expose names; overflow opens the complete assignee list.
- Visible focus is not clipped by sticky headers/scroll areas. Respect reduced motion. At narrow widths, board scrolling is obvious and Move/detail controls remain usable without two-axis dragging.
- Test keyboard, touch-only, click-only, screen readers, 200% zoom, long titles, duplicate member names, emoji, non-Latin scripts, empty columns, loading and errors.

## 9. Implementation acceptance matrix

These scenarios supplement the canonical acceptance list and make the evidence needed for handoff explicit.

| ID | Scenario | Observable pass condition |
| --- | --- | --- |
| PR-01 | Board configuration | Owner/Admin add/rename/reorder columns; refresh preserves order; populated deletion conflicts; existing card IDs and links survive rename. |
| PR-02 | Card create/edit | Valid title/defaults persist once under a lost-response retry; date/priority/multiple assignees save; foreign workspace IDs and unknown fields fail without partial save. |
| PR-03 | Pointer and keyboard moves | Drag, click/tap Move and keyboard Move produce the same saved position, including empty destination/top/bottom. |
| PR-04 | Filtered ordering | Full canonical neighbors are respected; hidden cards retain valid order; client never writes ranks or reorders only its filtered page. |
| PR-05 | Concurrent edits | Two sessions edit version N; one commits, the other gets 409 and keeps its draft; no overwrite with guessed versions. |
| PR-06 | Concurrent structure | Simultaneous move/create/archive/column edits yield one canonical list; stale board version rolls back activity/outbox/receipt alongside data. |
| PR-07 | Undo | A valid compensating move works; stale Undo cannot overwrite later work and explains conflict. |
| PR-08 | Modal and picker | Focus trap/restoration, nested Escape, unsaved drafts, IME and suggestion acceptance work with keyboard/screen reader. |
| PR-09 | Mentions | Creation delivers once per eligible recipient; self/duplicates do not multiply delivery; plain text/draft/failed write notify nobody; edits follow no-renotify policy. |
| PR-10 | Comment integrity | Unicode ranges, stable pagination, edits, deletion tombstones and literal HTML handling match the contract after refresh. |
| PR-11 | Tenant and roles | Viewer writes fail; cross-workspace IDs fail; revoked user reads/replays/notifications fail; ownership protection holds in a transaction. |
| PR-12 | Poll/refetch recovery | Focus/reconnect updates canonical data; drafts survive; comment changes are discovered even when structure version is unchanged. |
| PR-13 | Dates/counts | Chosen day survives browser timezones; workspace date/category drives overdue; count includes more than first page; pagination never silently hides cards. |
| PR-14 | Archive/restore | Archived card disappears from active lists and can restore only into a valid active column; history remains attributed. |
| PR-15 | Outbox retry | Duplicate/retried processing produces one recipient notification; failed delivery remains retryable; revocation prevents exposing content. |
| PR-16 | Capacity/errors | Agreed synthetic load is measured; failures retain drafts, release pending UI, and show useful errors without false success. |

Use domain/date tests, database integration tests for conditional mutations/idempotency, API tests for tenant/role enforcement, and real browser interaction tests for drag/focus/touch. SQLite schema smoke tests are useful design evidence but do not establish Workers/D1 runtime correctness or live collaboration. No application behavior was executed by this research agent.

## 10. Explicitly unselected research alternatives

These options may inform later review; they are **not the v0.1 implementation contract**.

| Alternative | Potential benefit | Why not the selected baseline / future condition |
| --- | --- | --- |
| HTTP ETag + `If-Match` / 412 | Standard conditional resource update with strong validators; avoids lost updates. | The selected API consistently uses JSON expected versions and 409. Do not mix mechanisms accidentally. Revisit only with an explicit contract migration. |
| RFC 9457 problem+json | Common extensible error format. | v0.1 selects its own documented error envelope. Avoid a second incompatible error shape. |
| Board-scoped membership and Admin/Editor/Viewer | Private boards and finer access. | v0.1 uses workspace-wide visibility and Owner/Admin/Member/Viewer. Adds permission/identity complexity without an explicit private-board requirement. |
| Typed text/mention segments instead of offsets | Avoids parser ambiguity and Unicode-index drift. | v0.1 selects body plus UTF-16 spans. Keep strict boundary/surrogate/overlap validation and emoji fixtures. |
| Append-only comments | Simpler notification policy and history. | v0.1 includes author/moderator edits with expected versions and no re-notification. |
| Dense integer position renumbering on every move | Easy bounded-board mental model. | v0.1 uses ranks with gaps and compacts only when needed. Both must stay server-owned and transactionally guarded. |
| SSE + persisted event replay | Faster server-to-client updates without bidirectional text collaboration. | Poll/refetch is the first slice. Future SSE requires consistent snapshot cursors, dedupe, retention/reset, authorization and reconnect behavior. |
| Soft WIP warning | Makes workload bottlenecks visible, informed by Azure. | Useful follow-on, not explicitly required. Warning-only versus hard cap must be deliberate; default research preference is warning-only. |

For a later SSE design, the HTML standard supplies event parsing/reconnect/`Last-Event-ID`, not durable replay. Send committed events only, persist a per-board cursor, bridge snapshot-to-subscription gaps, deduplicate, and reset/refetch when history expires. Native EventSource does not expose arbitrary request headers; same-origin cookies are straightforward, while a bearer-only design needs deliberate transport handling. Never put long-lived credentials in URLs. Presence or distributed ordering may justify Durable Objects/WebSockets later; they do not automatically make D1 and a second store one atomic transaction.

## 11. Next decisions

Review the first board/detail/Move/comment flow against the preserved images and the accepted requirement boundary. Choose the identity provider, GitHub organization/repository policy, Cloudflare account/domain/plan, expected load, and residency needs before claiming hosted readiness. Final theme/layout, summary inclusion, email and public sharing remain explicit review items.

This report supports implementation planning. It does not approve deployment, verify a production service, or make the visual reference's embedded business content part of Flowboard.
