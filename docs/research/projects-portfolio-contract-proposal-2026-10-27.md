# Project portfolio API contract proposal

Date: 2026-10-27. Status: Backend proposal for Architect contract freeze; no route or shared schema is implemented by this document.

This proposes only the project-scoped read-only portfolio endpoint. The Owner workspace aggregation remains a separate feature/review after this slice. It follows the handoff's provisional rule that current project grants inherit to every child board; no board grants or nested project entity are added.

## Endpoint

`GET /api/v1/projects/:projectId/cards/portfolio`

All authenticated project readers (Owner, Manager, Member, Viewer) may read cards in that one authorized project. A removed member, sibling-project user or outsider receives the same non-enumerating `404 NOT_FOUND` as other inaccessible project reads. Authorization runs before any card, assignee, comment/image-count or paging query. An archived project returns `404 NOT_FOUND`, consistent with existing project card search. Archived boards, trashed cards and purged cards are excluded.

## Query schema

All fields are optional; reject unknown keys rather than silently ignoring a UI typo.

| Field | Rule |
|---|---|
| `q` | Trimmed title-only substring, 1–100 characters; no description search in this endpoint. |
| `boardId` | One board in the authorized project; foreign/nonexistent board produces an empty page, not cross-project details. |
| `columnId` | One column in the authorized project; never broadens scope. |
| `priority` | Existing `none/low/medium/high/urgent` enum. |
| `assigneeId` | One user ID; match only assignments on cards already in this project. |
| `due` | Existing `overdue/today/upcoming/none` values, evaluated against this project's workspace timezone. `overdue` excludes `category='done'`. |
| `completion` | `all/open/done`, based only on the source column's stable category (`done` vs not `done`), never the column label. |
| `limit` | Integer 1–100; default 50. |
| `cursor` | Versioned opaque keyset cursor, bound to project, normalized filters, sort, and effective workspace-local `asOfDate`. |

Sort is fixed for v1: `updatedAt DESC, id DESC`. It is deterministic, useful for a cross-board work view, and avoids inventing cross-board position semantics. A later product decision can add selectable sorts as a versioned contract.

## Response

```json
{
  "data": [{
    "id": "card-id",
    "project": {"id": "project-id", "name": "My Fashion"},
    "board": {"id": "board-id", "name": "Web"},
    "column": {"id": "column-id", "name": "In progress", "category": "active"},
    "title": "Publish spring landing page",
    "priority": "high",
    "dueDate": "2026-11-04",
    "assigneeIds": ["user-id"],
    "position": 1200,
    "version": 4,
    "commentCount": 2,
    "imageCount": 1,
    "createdAt": "2026-10-27T00:00:00.000Z",
    "updatedAt": "2026-10-27T00:00:00.000Z"
  }],
  "nextCursor": "opaque-or-null",
  "scope": {"kind": "project", "projectId": "project-id", "asOfDate": "2026-10-27"}
}
```

No totals are returned in v1. The current project-search counts are full scans and are not required to render a bounded page; do not add expensive or misleading counts just to fill summary tiles. The API returns only safe card summary fields and canonical project/board/column provenance; no description, emails, comment bodies, activity, image URL/bytes, or deleted content.

The cursor seeks on `(updated_at,id) < (cursor.updatedAt,cursor.id)` and pages with `limit+1`. Malformed, cross-project, changed-filter/sort or changed-`asOfDate` cursors return `409 STALE_CURSOR`, matching the existing board cursor API. Keyset pagination avoids offset shifts but is not an immutable snapshot when cards are edited between HTTP page requests; document that clients should restart from page one after a refresh or filter/date change. Every page reauthorizes the project, so cursor bytes never grant access.

## Query and acceptance boundaries

Use one project authorization/context lookup, one joined keyset page query over cards/columns/boards/projects, and a fixed small number of batched related-data queries for only page IDs. Query count must not grow with board count or card count; never concatenate independently paginated board results in application memory. Return at most 100 cards per page and at most 20 existing assignee IDs per card per contract.

Mounted PostgreSQL acceptance must cover:

- Owner/Manager/Member/Viewer access to only the named project; sibling member, outsider, removed member and wrong project get private 404.
- An unauthorized request performs no card-page/count/related-data SQL; no `counts` response exists in this v1 contract.
- Project/board archive defaults, trashed/purged exclusion, status/category provenance and custom column labels.
- Done-category cards are excluded from overdue; date boundaries use project workspace timezone around local midnight.
- Empty results; limit validation/cap; stable `updatedAt,id` tie ordering; page concatenation; malformed, cross-project, altered-filter and new-`asOfDate` cursors.
- Title-only matching; no description, email, comment, activity or image data leakage; board/column/assignee filters cannot broaden project scope.
- Query count remains constant when fixtures add boards and cards; assess index/query plan separately on representative fixtures before claiming performance.

## Shared changes that need Architect approval

1. Register `QRY-04` in `docs/features.tsv` with dependencies `BRD-03,RBAC-01` and its backend/UI/integration gates.
2. Add validated request/response and cursor semantics to `packages/contracts/src/cards.ts`, contract tests and OpenAPI route catalog.
3. Add the API endpoint/response to `docs/API.md` and a feature-specific acceptance criteria file before handler work.

This proposal is informed by current source: existing project search lacks cursors and provenance; `listBoardCards` demonstrates a bounded keyset path; `getWorkspaceToday` provides timezone-local dates; `searchProjectCards` currently provides a precedent for done-category overdue semantics. Those source facts are not implementation or review evidence.
