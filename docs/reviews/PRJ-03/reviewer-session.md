# Independent Backend Acceptance Review Session: PRJ-03

**Feature ID**: PRJ-03 (Project settings: OCC & mandatory idempotency)  
**Reviewer Actor ID**: `antigravity-acceptance-auditor`  
**Reviewer Session ID**: `0715d43b-fc65-4541-bec2-434e91be2f91`  
**Reviewer Model**: `gemini-2.5-pro`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for PRJ-03:
- `docs/reviews/PRJ-03/criteria.json` (frozen criteria)
- `docs/reviews/PRJ-03/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/PRJ-03/test.log` (execution log of mandatory tests)
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

1. **Authorized update**:
   - `PATCH /api/v1/projects/:projectId` allows Workspace Owner and granted Project Manager to update project name and description.
   - Inspected lines: `apps/api/src/adapters/projects.ts:266-267`.
   - Verified in test: `prj02-prj05.test.ts` steps PRJ-03.1 & PRJ-03.2.

2. **Role restrictions**:
   - Regular project members and viewers receive `403 FORBIDDEN`.
   - Outsiders and sibling project members receive `404 NOT_FOUND` (sibling privacy).
   - Inspected lines: `apps/api/src/adapters/rbac.ts:325-335`.
   - Verified in test: `prj02-prj05.test.ts` steps PRJ-03.3 & PRJ-03.4.

3. **Workspace ownership inviolability**:
   - Project Manager can only modify `name` and `description` of the project row.
   - Project Manager cannot alter workspace ownership, workspace name, or project workspace assignment (the `UPDATE` statement only modifies `name`, `description`, `version`, and `updated_at`).
   - Inspected lines: `apps/api/src/adapters/projects.ts:293-299`.

4. **Optimistic Concurrency Control (OCC)**:
   - Request body requires `expectedVersion` integer.
   - Updates compare `version = $expectedVersion`. If the version in the database is different, it aborts with `409 STALE_VERSION`.
   - Upon successful update, `version` is incremented (`version = version + 1`).
   - Inspected lines: `apps/api/src/adapters/projects.ts:278-280, 296, 311-313`.
   - Verified in test: `prj02-prj05.test.ts` steps PRJ-03.1, PRJ-03.2, & PRJ-03.5.

5. **Input validation & Idempotency**:
   - `updateProjectInputSchema` validates that `name` cannot be empty string (min 1, max 100), `description` cannot exceed 2000 chars, and at least one of name or description must be supplied.
   - `Idempotency-Key` header is mandatory; missing key returns `400 IDEMPOTENCY_KEY_REQUIRED`.
   - Idempotency replay verifies cached response and re-validates permissions before returning `replayed: true`.
   - Inspected lines: `apps/api/src/http/routes/projects.ts:247-253, 275-286`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-03.0 & PRJ-03.1.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Mandatory `acquireWriteGrantLock` with `FOR SHARE` row-level lock on project membership prevents race conditions against concurrent member demotions or revocations; strict role check ensures only owners and managers can update settings; outsiders and sibling PMs receive 404 NOT_FOUND.
  *Evidence*: `apps/api/src/adapters/projects.ts:266`; `apps/api/src/adapters/rbac.ts:292-335`; `apps/api/test/prj02-prj05.test.ts`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Exact REST PATCH semantics, Zod schema validation requiring at least one mutable field, proper error codes (400, 403, 404, 409), and version incrementing.
  *Evidence*: `apps/api/src/http/routes/projects.ts:239-325`; `packages/contracts/src/projects.ts:17-26`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Optimistic Concurrency Control (OCC) with atomic `version = version + 1 WHERE id = $5 AND version = $6` inside transactional boundary guarantees lost updates cannot occur during concurrent edits.
  *Evidence*: `apps/api/src/adapters/projects.ts:293-314`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: 6 dedicated tests in `prj02-prj05.test.ts` verifying mandatory idempotency header, owner OCC update, manager OCC update, member & viewer 403 rejection, sibling PM & outsider 404 rejection, and stale version 409 conflict.
  *Evidence*: `apps/api/test/prj02-prj05.test.ts:318-532`; `docs/reviews/PRJ-03/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean integration between route middleware, grant lock helper, and OCC database execution; type-safe contract interfaces.
  *Evidence*: `apps/api/src/adapters/projects.ts:241-339`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Single round-trip transactional UPDATE with RETURNING clause; immediate connection release in finally block on success or failure.
  *Evidence*: `apps/api/src/adapters/projects.ts:334-338`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Optimistic Concurrency Control (OCC) and Write Grant Locking
When two project managers (e.g., Alice and Bob) edit project settings simultaneously, there is a risk of a "lost update": Alice changes the project name to "Core Platform", while Bob concurrently changes the description to "Backend systems". If both send unconditional `UPDATE` statements, whichever request commits second overwrites the first without realizing it.

#### Flowboard's OCC Solution
Every project row has an integer `version` column (starts at 1).
1. When a client reads the project, it receives `{ "version": 1, ... }`.
2. When submitting updates via `PATCH /api/v1/projects/:projectId`, the client must send `{ "expectedVersion": 1, "name": "Core Platform" }`.
3. The database executes:
   ```sql
   UPDATE projects
   SET name = 'Core Platform', version = version + 1
   WHERE id = 'prj_123' AND version = 1
   RETURNING id;
   ```
4. If Alice's update succeeds, the project's version becomes 2.
5. When Bob's update arrives expecting version 1, the `WHERE` condition matches 0 rows. The server immediately detects this and returns `409 STALE_VERSION`. Bob's client can prompt him to reload the latest changes rather than silently destroying Alice's edit!

#### Concurrency with Write Grant Locking (`FOR SHARE`)
What if a workspace owner revokes Bob's manager role at the exact instant Bob sends an update?
Flowboard executes `acquireWriteGrantLock(client, projectId, actor.id, 'manager')` before checking OCC:
- It issues `SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE`.
- This PostgreSQL row-level shared lock prevents any concurrent transaction attempting to `UPDATE` or `DELETE` Bob's membership (such as a role revocation) from sneaking in before Bob's settings update commits.
- **Benefit**: Immune to time-of-check to time-of-use (TOCTOU) authorization race conditions.
- **Drawback**: Requires an active database transaction and connection during the update.
- **Alternative**: Unlocked reads are faster, but create exploitable windows where revoked users can commit unauthorized writes. Flowboard strictly requires grant locking for mutating actions.
