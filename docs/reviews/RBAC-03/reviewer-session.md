# Independent Reviewer Session Evidence: RBAC-03

## 1. Independence and Audit Metadata
- **Feature ID**: RBAC-03 (Grant revocation locking vs writes protocol)
- **Reviewer Actor ID**: `independent-backend-reviewer`
- **Reviewer Session ID**: `b54e0975-7baf-4cac-99fe-0f396b9bb498`
- **Implementer Actor ID**: `builder`
- **Implementer Session ID**: `builder-session-id`
- **Reviewer Model**: `gemini-2.5-pro`
- **Fresh Context**: Yes, clean auditor session with no implementation crossover
- **Read-Only Audit**: Reviewer did not write or modify production code under audit
- **Environment**: macOS arm64, Node.js 24.15.0, PostgreSQL 17 isolated synthetic test database

## 2. Reachable Scope and Source Verification
- `apps/api/src/adapters/rbac.ts`:
  - `acquireWriteGrantLock(client, projectId, userId, minRole)`:
    - Step 1: Queries `projects p JOIN workspaces w` to verify project exists and checks if `w.owner_id === userId`. If workspace owner, returns `{ role: 'owner', isOwner: true }`.
    - Step 2: Queries `project_memberships` with `FOR SHARE` row-level lock:
      ```sql
      SELECT role, status
      FROM project_memberships
      WHERE project_id = $1 AND user_id = $2
      FOR SHARE
      ```
    - If no row exists or `status === 'removed'`, aborts with `404 NOT_FOUND`.
    - If `role === 'viewer'`, aborts with `403 FORBIDDEN` (viewers cannot perform write mutations).
    - If `minRole === 'manager'` and `role !== 'manager'`, aborts with `403 FORBIDDEN`.
- `apps/api/src/http/routes/members.ts`:
  - `DELETE /api/v1/projects/:projectId/members/:userId`:
    - Begins transaction.
    - Locks target row with `FOR UPDATE` lock.
    - If caller is manager: enforces predicate `role IN ('member', 'viewer')`. If target has role `manager` or `owner`, throws `403 FORBIDDEN`.
    - Updates status to `'removed'`, commits transaction.
- `apps/api/src/adapters/projects.ts`:
  - `updateProjectSettings(client, actor, projectId, input)`:
    - Calls `acquireWriteGrantLock(client, projectId, actor.id, 'manager')` inside the write transaction before performing updates.

## 3. Mandatory Criteria Evaluation
1. **Row-level locking protocol**: Verified. Write transactions call `acquireWriteGrantLock` which executes `SELECT ... FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE`. Multiple writers can hold `FOR SHARE` simultaneously, but any write conflicts with `FOR UPDATE` or `UPDATE` on the membership row.
2. **Revocation serialization**: Verified. Member removal or demotion issues an `UPDATE project_memberships SET status = 'removed'` or `SELECT ... FOR UPDATE`, which requires an exclusive lock. If a write is holding `FOR SHARE`, the revocation waits until the write commits. Once revocation commits, subsequent writes re-read `status = 'removed'` and abort.
3. **Immediate abortion on removed status**: Verified. When `status === 'removed'`, `acquireWriteGrantLock` immediately throws `404 NOT_FOUND`.
4. **No write commit after revocation**: Verified. In `rbac-advanced.test.ts`, when a revocation transaction commits first, the writer transaction's subsequent `acquireWriteGrantLock` call reads the committed `status = 'removed'` and immediately rejects with 404 NOT_FOUND.
5. **R3 Audit compliance & Concurrency Probes**: Verified via real PostgreSQL tests:
   - **Probe 1**: Mounted `PATCH /api/v1/projects/:projectId` holds `FOR SHARE` grant lock. Concurrently, Owner calls mounted `DELETE /api/v1/projects/:projectId/members/:actorId`. Connection 2 is blocked until Connection 1 commits. Then Connection 2 commits. Subsequent writes by the removed actor fail with 404 NOT_FOUND.
   - **Probe 2**: Manager begins `DELETE /api/v1/projects/:projectId/members/:targetId`. While paused after grant lock acquisition, Owner calls `PATCH` promoting target to manager. When Manager's DELETE resumes and locks target row, it reads role `manager` and fails with 403 FORBIDDEN.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac-advanced.test.ts`
Tests specifically covering RBAC-03:
- `RBAC-03: acquireWriteGrantLock validates role hierarchy and removed status` (pass)
- `RBAC-03: Concurrency: In-flight write transaction aborts when concurrent role revocation wins` (pass)
- `RBAC-03: Concurrency: Writer holding grant lock blocks concurrent revocation until write commits` (pass)
- `RBAC-03: Concurrency Probe 1: Mounted updateProjectSettings serializes with concurrent actor revocation` (pass)
- `RBAC-03: Concurrency Probe 2: Manager starts removeProjectMember while Owner concurrently promotes target; deletion rejected with 403 FORBIDDEN` (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
In distributed web applications, authorization checks usually happen in memory before database queries are issued.
- **The Threat (Time-of-Check to Time-of-Use / TOCTOU)**: Imagine Member Bob issues a `PATCH` request to move a confidential card. At millisecond 0, the server checks: "Is Bob an active member? Yes." At millisecond 1, Project Owner Alice kicks Bob out of the project. At millisecond 2, Bob's card move commits to the database! Bob made unauthorized changes after being kicked out.
- **The Decision**: Flowboard implements a database row-level locking protocol (`acquireWriteGrantLock`). Every write transaction queries Bob's membership row in PostgreSQL using `FOR SHARE`.
- **How it Works**:
  - In PostgreSQL, multiple writers can hold `FOR SHARE` on Bob's membership row at the same time, so normal throughput is not blocked.
  - However, when Alice kicks Bob out, her transaction issues an `UPDATE` on Bob's membership row (requiring an exclusive row lock).
  - If Bob's write is in progress, Alice's kick transaction waits until Bob's transaction completes.
  - If Alice kicks Bob first and commits, Bob's transaction attempts `FOR SHARE`, reads `status = 'removed'`, and immediately aborts with 404 NOT_FOUND!
- **Benefits**: Mathematically prevents post-revocation writes and race conditions without needing distributed locks or Redis.
- **Drawbacks**: Requires all mutating endpoints to participate in the transaction and locking protocol.
