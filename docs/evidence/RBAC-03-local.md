# RBAC-03 — Revocation Versus Writes Lock Protocol Evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for RBAC-03**.

## Scope and Files

- RBAC Lock Protocol Adapter: `apps/api/src/adapters/rbac.ts`
  - `acquireWriteGrantLock(client, projectId, userId, minRole = 'member')`:
    - Executes within an active write transaction (`BEGIN`).
    - Verifies workspace owner: workspace owners have permanent inherited owner authority across all boards and projects in their workspace, returning `{ role: 'owner', isOwner: true }`.
    - For non-owner members, queries `project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE`.
    - If the user has status `'removed'`, immediately aborts the write transaction with `404 NOT_FOUND` (`Project not found or access revoked.`).
    - If the user has role `'viewer'`, aborts with `403 FORBIDDEN` (`Viewers cannot perform write operations.`).
    - If user is not found, aborts with `404 NOT_FOUND`.
    - Serializes in-flight write mutations against concurrent role revocations:
      - If revocation transaction commits first, the write transaction unblocks, sees `status = 'removed'`, and immediately aborts.
      - If write transaction acquires `FOR SHARE` first, revocation `UPDATE` blocks until write transaction commits, preventing concurrent race conditions.
- Automated Test Suite: `apps/api/test/rbac-advanced.test.ts`
  - Role hierarchy validation: owner, manager, member succeed; viewer returns 403; removed and outsider return 404.
  - Concurrency scenario A: In-flight write transaction aborts when concurrent role revocation commits first.
  - Concurrency scenario B: Writer holding `FOR SHARE` lock blocks concurrent revocation until write commits.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac-advanced.test.ts
   ```
   Result: **13 passed, 0 failed, 0 skipped** (~147ms).
   - `RBAC-03: acquireWriteGrantLock validates role hierarchy and removed status`
   - `RBAC-03: Concurrency: In-flight write transaction aborts when concurrent role revocation wins`
   - `RBAC-03: Concurrency: Writer holding grant lock blocks concurrent revocation until write commits`

3. **Subagent Independent Audit**:
   - Evaluated against pre-established criteria:
     - 1. Grant lock protocol implementation using PostgreSQL row lock: 2.5 / 2.5
     - 2. Workspace owner authority verification: 2.5 / 2.5
     - 3. Immediate revocation enforcement for removed members: 2.5 / 2.5
     - 4. Real PostgreSQL concurrent transaction serialization tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- Lock protocol applies within transaction scopes; endpoints should call `acquireWriteGrantLock` early in their write transaction before executing entity mutations.
