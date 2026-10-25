> Historical API v0.2, superseded by docs/API.md v0.3. Do not implement the old access/archive defaults.

# API contract v0.2

Status: design contract for the next implementation phase; no endpoints run yet. Prefix `/api/v1`, same-origin JSON, authenticated cookie session. Shared TypeScript schemas and OpenAPI must be generated/validated together during the first implementation slice; this document is the initial source of truth.

## Conventions

Opaque string IDs; never infer access from their shape. UTC ISO timestamps, date-only due dates. List envelope `{data: [], nextCursor: string|null}`; default limit 50, maximum 100. Stable opaque cursors bind to filter and scope. Snapshot collections explicitly indicate whether more items exist. Single resources use `{data: resource}`. Errors use `{error: {code, message, requestId, details?}}` without SQL/provider internals.

400 malformed JSON or cursor; 401 no valid session; 403 known workspace but insufficient role; 404 missing or inaccessible cross-workspace resource; 409 revision/idempotency/nonempty-column conflict; 422 field or relation validation; 429 rate limited with Retry-After. Version bodies use 409 (we are not using HTTP If-Match/412 in v0.1).

Domain writes require `Idempotency-Key` and strict Origin/CSRF validation. Keys are scoped to workspace+actor; workspace creation, invite acceptance and actor-global inbox writes use `actor_operation_receipts`, hashing method/path/body. Logout is inherently idempotent: clear the cookie and return 204 even if already logged out, with no receipt required. Write responses include canonical resource versions. Retry transient/network failures with the same key and identical body. Do not auto-retry a conflict with invented versions. Reads check membership again, including notification and idempotency replay paths; creation replay must recheck access to its created workspace.

Proposed receipt policy: keys are 16–128 ASCII characters from `[A-Za-z0-9._:-]` (UUID recommended); keep successful receipts at least 7 days. Hash method, normalized resource path and validated canonical JSON: object keys sorted, array order preserved, omitted fields distinct from null, field normalization applied consistently before hash. Whitespace/key-order differences in JSON do not create a new intent. Retrying clients stop automatic retries within 24 hours and never silently repeat an old command after receipt expiry. After the retention window a purged key may be treated as new; replay guarantees explicitly end then. Conflict/permanent validation results do not become success receipts.

## Core shapes

```ts
type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
type ColumnCategory = 'todo' | 'active' | 'done';
type Card = {
  id: string; workspaceId: string; boardId: string; columnId: string;
  title: string; description: string; priority: Priority;
  dueDate: string | null; assigneeIds: string[];
  position: number; version: number; archivedAt: string | null;
  createdAt: string; updatedAt: string;
};
type Comment = {
  id: string; cardId: string; authorId: string;
  body: string; mentions: {userId: string; start: number; end: number}[];
  version: number; createdAt: string; updatedAt: string;
};
```

Mention offsets use JavaScript UTF-16 code units, start inclusive/end exclusive, matching the displayed mention substring. Validate boundaries, no overlaps, active membership and length; emoji can span two units. User IDs are authoritative, text is display only. Notify each user once per comment creation; self-mentions do not notify. Comment edits update mention rows but do not notify again in v0.1. Soft-deleted comments render a tombstone and hide body/mentions.

Server validates: trimmed title 1–200, description ≤20,000, comment 1–10,000, column label 1–80, at most 20 assignees/mentions; dueDate is a real Gregorian calendar date or null. These limits are proposed contract defaults. Unknown fields are rejected. Patch absent means unchanged; null clears only nullable fields. `position`, creator, workspace, role and author are never client-editable card properties.

## Identity and organization

| Method and route | Purpose / payload |
|---|---|
| GET `/session` | Current actor and active workspace memberships, or 401 |
| POST `/session/logout` | Revoke server session, clear cookie |
| GET `/workspaces` | Actor's workspaces |
| POST `/workspaces` | `{name, timezone}`; atomically create owner membership |
| GET `/workspaces/:wid/members` | Paginated active members; mention/assignment picker |
| POST `/workspaces/:wid/invitations` | Admin/owner, `{email, role: 'member'|'viewer'}` |
| POST `/invitations/accept` | Authenticated verified email matches hashed, unexpired, single-use token |
| PATCH `/workspaces/:wid/members/:uid` | Role/status change with expected membership version, ownership protections |
| GET/POST `/workspaces/:wid/projects` | List/create; create `{name}` for admin/owner |
| GET/POST `/projects/:pid/boards` | List/create; create `{name}` with default columns atomically |

Login/callback routes depend on the identity provider and must be finalized before hosted authentication work. A workspace cannot be client-selected to bypass membership. Invite email delivery is a separate integration: initial local tests can use synthetic invite acceptance without sending email. Ownership transfer is a separate transactional command to define before enabling account administration in production.

## Board and cards

| Method and route | Purpose / payload |
|---|---|
| GET `/boards/:bid` | Board metadata, columns, structureVersion, counts, first page of active cards per column and per-column nextCursor; a bounded consistent snapshot |
| GET `/boards/:bid/cards` | `columnId`, `cursor`, `limit`, title query, assigneeId, priority, due filter; canonical order |
| GET `/boards/:bid/columns/:cid/placement` | Read canonical neighbors excluding movingCardId, for `at=first|last|before|after` (anchorCardId required for before/after); returns structureVersion, previousCardId, nextCardId |
| POST `/boards/:bid/columns` | `{name, category, color, expectedBoardVersion}`; admin/owner |
| PATCH `/boards/:bid/columns/:cid` | Label/category/color + expectedBoardVersion; admin/owner |
| POST `/boards/:bid/columns/reorder` | Full ordered column IDs + expectedBoardVersion; admin/owner |
| DELETE `/boards/:bid/columns/:cid` | Empty columns only; expectedBoardVersion body; 409 COLUMN_NOT_EMPTY otherwise |
| POST `/boards/:bid/cards` | title, columnId, optional description/priority/dueDate/assigneeIds, expectedBoardVersion; append to target column |
| GET `/cards/:id` | Canonical full card; permission through its board/workspace |
| PATCH `/cards/:id` | title/description/priority/dueDate/assigneeIds + expectedVersion |
| POST `/cards/:id/move` | See move command below |
| POST `/cards/:id/archive` | expectedVersion + expectedBoardVersion; does not permanently delete |
| POST `/cards/:id/restore` | destination columnId, expectedVersion + expectedBoardVersion; append |
| GET `/cards/:id/activity` | Paginated immutable events; sanitize exposed metadata |

No generic PATCH of columnId/position: all movement goes through one command. Column/card creation, archive/restore and column edits invalidate structureVersion. Every card or column mutation also increments a separate board snapshotVersion atomically, including title/priority/assignee/due-date edits. Return snapshotVersion on snapshots/list pages; bind list cursors to it and return 409 STALE_CURSOR if it changes. Otherwise a field edit could skip or duplicate filtered cards without changing order. Read board metadata/columns/first cards in a consistent primary batch, not unrelated cached queries. Count all matching cards, not only the first page. Column deletion requires no referencing cards, including archived cards.

## Snapshot and display identity contract

Proposed pilot bounds: at most 12 columns per board; snapshot `cardLimitPerColumn` defaults to 10, range 1–15, so at most 180 card summaries return. Adding a column beyond the cap returns 422 COLUMN_LIMIT. These are explicit initial product limits to review after benchmarking, not a reference-image restriction. Regular card-list pages retain the general maximum 100.

Snapshot data shape: `{board:{id,workspaceId,projectId,name,structureVersion,snapshotVersion}, filters, asOfDate, totals:{activeCardCount,matchingCardCount}, columns:[{id,name,category,color,position,activeCardCount,matchingCardCount,cards:CardSummary[],nextCursor}], people:PersonDisplay[]}`. `asOfDate` is workspace today in YYYY-MM-DD. Filters match the card-list filter contract. Active counts exclude archived cards and ignore current filters; matching counts apply all current filters. Per-column matching counts cover the entire column, never just the page. Snapshot contains every column within the configured cap, even if it has no matching cards.

`CardSummary` contains id, boardId, columnId, title, priority, dueDate, assigneeIds, position, version, createdAt, updatedAt; descriptions/comments/activity load in details. `PersonDisplay` contains id, displayName, avatarUrl|null, activeInWorkspace. Each resource envelope provides a deduplicated `people` list for the IDs actually referenced by that response, including removed historical authors/assignees (activeInWorkspace=false). No email address or global user directory is exposed. Comment-list data includes author IDs and corresponding people; details includes assignee displays. Active-member search remains the picker source for new assignments/mentions.

The placement endpoint runs an authorized bounded first/last/adjacent query in canonical order without traversing every card page. It validates movingCardId and anchor ancestry and excludes the moving card from its result. UI submits returned neighbors and structureVersion to move. A concurrent change may still cause 409; this is expected and requires refresh, not unsafe overwrite. Filtered views use this endpoint with the Move menu.

```json
{
  "toColumnId": "col_testing",
  "previousCardId": "card_a",
  "nextCardId": "card_b",
  "expectedVersion": 3,
  "expectedBoardVersion": 18
}
```

Both neighbor IDs are nullable. Both null means empty destination, not arbitrary append. To append use previous=last and next=null; to prepend use previous=null and next=first. References exclude the moving card. Server validates adjacency in canonical destination order and membership in the same board. Filtered views use the Move menu and fetch the unfiltered destination boundary before submitting; ambiguous drag reordering is disabled in v0.1. Never reorder only the filtered subset. Response: `{data: {card, structureVersion, destinationCards?}}`; destinationCards, if supplied after compaction, is bounded and carries pagination.

Conflict example:

```json
{"error":{"code":"STALE_VERSION","message":"This board changed. Refresh before moving the card.","requestId":"req_example","details":{"currentBoardVersion":19}}}
```

## Comments and inbox

| Method and route | Purpose / payload |
|---|---|
| GET `/cards/:id/comments` | Paginated comments, stable `(createdAt,id)` order |
| POST `/cards/:id/comments` | `{body, mentions}`; atomic activity + outbox |
| PATCH `/comments/:id` | `{body, mentions, expectedVersion}`; author or moderator |
| DELETE `/comments/:id` | `{expectedVersion}`; soft deletion + audit event |
| GET `/notifications` | Actor-only, paginate, recheck current workspace access |
| POST `/notifications/:id/read` | Idempotent actor-owned read marker |

Notifications contain IDs, not unrestricted snapshots of private comment text. Initial polling refetches board/card/comment queries in foreground and on reconnect. No websocket, email or offline synchronization promise in this contract.

## Test fixture requirements

First shared fixtures must cover: two workspaces, owner/member/viewer, empty and populated columns, unassigned and multiple-assignee cards, null/date-only due dates, long title, archived card, emoji before a mention, pagination, revoked membership, stale versions and replayed idempotency keys. Synthetic content only. UI can build against those fixtures while Backend implements the same contract.
