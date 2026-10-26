# Independent Backend Acceptance Review Session: PRJ-02

**Feature ID**: PRJ-02 (Project navigation and list: cursor pagination & sibling privacy)  
**Reviewer Actor ID**: `antigravity-acceptance-auditor`  
**Reviewer Session ID**: `0715d43b-fc65-4541-bec2-434e91be2f91`  
**Reviewer Model**: `gemini-2.5-pro`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for PRJ-02:
- `docs/reviews/PRJ-02/criteria.json` (frozen criteria)
- `docs/reviews/PRJ-02/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/PRJ-02/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/projects.ts` (project adapter methods)
- `apps/api/src/http/routes/projects.ts` (project HTTP handlers)
- `apps/api/src/adapters/idempotency.ts` (idempotency transactional receipts)
- `apps/api/src/adapters/rbac.ts` (role resolution and grant locking)
- `apps/api/src/adapters/postgres.ts` (PostgreSQL connection pool management)
- `apps/api/src/adapters/session.ts` (session creation and authentication)
- `apps/api/src/adapters/migrations.ts` (schema migrations)
- `apps/api/src/http/errors.ts` (HTTP error taxonomy)
- `apps/api/src/http/middleware/auth.ts` (session authentication middleware)
- `apps/api/src/http/app.ts` (Hono application factory and route mounting)
- `packages/contracts/src/projects.ts` (Zod schemas and contracts)
- `packages/contracts/src/common.ts` (common schemas)
- `packages/contracts/src/index.ts` (contracts entry point)
- `apps/api/test/prj02-prj05.test.ts` (isolated PostgreSQL integration test suite)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Workspace project list scoping**:
   - `GET /api/v1/workspaces/:workspaceId/projects` returns all projects in the workspace if `actor.id == owner_id`.
   - If actor is not owner, queries active project memberships (`pm.status = 'active'`) and returns strictly granted projects.
   - Inspected lines: `apps/api/src/adapters/projects.ts:98-115`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-02.1 & PRJ-02.3.

2. **Cross-workspace project listing**:
   - `GET /api/v1/projects` lists all projects accessible to the authenticated actor across all workspaces.
   - Projects are annotated with the actor's resolved role (`owner`, `manager`, `member`, `viewer`).
   - Inspected lines: `apps/api/src/adapters/projects.ts:158-231`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-02.5.

3. **Sibling project privacy**:
   - Outsiders with zero grants in a workspace attempting to list workspace projects receive `404 NOT_FOUND` rather than empty lists or forbidden errors.
   - Inspected lines: `apps/api/src/adapters/projects.ts:77-86`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-02.4.

4. **Keyset cursor pagination**:
   - Endpoints support keyset pagination ordered by `name ASC, id ASC`.
   - Cursors are encoded and decoded as base64url JSON payloads `{ name, id }`.
   - Default page size is 50, bounded at 100.
   - Malformed limits (NaN, negative values) safely fall back to bounded limits without throwing database syntax/parameter errors.
   - Inspected lines: `apps/api/src/adapters/projects.ts:34-50, 88-92`, `apps/api/src/http/routes/projects.ts:29-34`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-02.2 & PRJ-02.6.

5. **No metadata leakage**:
   - Inaccessible projects leak no name, count, or existence. Outsiders cannot determine if a workspace exists or how many projects it has.
   - Inspected lines: `apps/api/src/adapters/projects.ts:77-86`.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict scoping guarantees no project data is leaked across siblings; ungranted workspaces return 404 NOT_FOUND; cross-workspace listing enforces authenticated session with strict active grant join.
  *Evidence*: `apps/api/src/adapters/projects.ts:76-86, 107-115, 182-194`; `apps/api/test/prj02-prj05.test.ts`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Full implementation of keyset cursor pagination (nextCursor, base64url payload), cross-workspace listing with role annotation, and bounded limits (max 100).
  *Evidence*: `apps/api/src/adapters/projects.ts:34-50, 88-150`; `packages/contracts/src/projects.ts:71-73`.

- **Data integrity and concurrency**: **9.0 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Keyset pagination (`name > $curName OR (name = $curName AND id > $curId)`) guarantees deterministic ordering even during concurrent inserts or page shifts, eliminating offset-drift duplicates or omissions.
  *Evidence*: `apps/api/src/adapters/projects.ts:102, 111, 191`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: 6 comprehensive integration tests in `prj02-prj05.test.ts` testing owner visibility, cursor pagination with limit 1, member grant scoping, outsider 404, global project listing across multiple workspaces, and NaN/negative/excess limit robustness.
  *Evidence*: `apps/api/test/prj02-prj05.test.ts:157-310`; `docs/reviews/PRJ-02/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Generic `PaginatedResult<T>` and `PaginationOptions` interfaces; reusable `encodeProjectCursor`/`decodeProjectCursor` helpers; strict TypeScript types.
  *Evidence*: `apps/api/src/adapters/projects.ts:19-50`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Cursor pagination utilizes indexed sorting (`name ASC, id ASC`) avoiding expensive `OFFSET` scans; limits are strictly capped at 100 to prevent DOS via huge limit requests.
  *Evidence*: `apps/api/src/http/routes/projects.ts:29-34`.

**Unrounded Weighted Score**: **9.350 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Keyset Cursor Pagination vs. Offset Pagination
When displaying lists of projects in a web dashboard, applications must paginate through results to keep response times fast and memory usage predictable.

#### The Problem with Offset Pagination (`OFFSET 50 LIMIT 50`)
1. **Performance degradation**: In SQL databases, `OFFSET 10000` requires the database engine to scan and discard 10,000 rows before returning the next 50 rows.
2. **Page drift / Phantom reads**: If an item is added to page 1 while a user is navigating to page 2, all items shift downward by one. The user sees the last item of page 1 repeated on page 2. If an item is deleted, an item is skipped entirely!

#### Flowboard's Solution: Keyset Cursor Pagination
Flowboard sorts projects deterministically by `(name ASC, id ASC)` and passes the values of the last seen project as a base64url cursor to the next request:
```sql
WHERE (name > $lastName) OR (name = $lastName AND id > $lastId)
ORDER BY name ASC, id ASC
LIMIT 51
```
- **Benefit (Stability & Speed)**: The database directly jumps to the next row via indexed b-tree comparison in $O(\log N)$ time, regardless of whether you are on page 1 or page 1,000. New items inserted before or after do not cause items to be duplicated or missed.
- **Drawback**: You cannot jump directly to an arbitrary page number (e.g. "jump to page 7") without traversing sequentially.
- **Alternative**: Offset pagination allows jumping to arbitrary page numbers, but degrades quadratically under high concurrency and scale. Flowboard adopts keyset cursor pagination because navigation feeds and project directories are browsed sequentially.
