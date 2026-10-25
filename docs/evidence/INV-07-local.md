# INV-07 — Remove project access evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-07**.

## Scope and Implementation

- Adapter: `apps/api/src/adapters/members.ts` (`removeProjectMember`)
  - Role check & authority enforcement:
    - Workspace Owner can remove any member from the project.
    - Project Manager can remove members and viewers only.
    - Project Manager cannot remove peer managers or workspace owner (`403 FORBIDDEN`).
    - Project Manager cannot remove themselves via this endpoint (`403 FORBIDDEN` - self-leave is handled via INV-08 `POST /projects/:pid/leave`).
    - Non-member outsiders attempting deletion receive `404 NOT_FOUND` to protect sibling project confidentiality.
    - Members and viewers attempting deletion receive `403 FORBIDDEN`.
  - Immediate Revocation Semantics:
    - Database row status is transitioned to `'removed'` and version incremented:
      ```sql
      UPDATE project_memberships
      SET status = 'removed', version = version + 1, updated_at = NOW()
      WHERE project_id = $1 AND user_id = $2
      RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
      ```
    - Active membership query filters (`status = 'active'`) immediately exclude the revoked user from project reads and mutations.
    - Subsequent requests by the revoked user to `GET /api/v1/projects/:projectId` or any project-scoped endpoint immediately return `404 NOT_FOUND` (sibling privacy guarantee).
- Route: `apps/api/src/http/routes/members.ts` (`DELETE /api/v1/projects/:projectId/members/:userId`)
  - Protected by `authMiddleware`.
  - Returns `200 { data: { success: true } }`.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/inv06-inv07.test.ts
   ```
   Result: **13 passed, 0 failed, 0 skipped**.
   - Test 7: Immediate revocation test:
     - 7a. Eve can read project before revocation (200 OK).
     - 7b. Project Manager Bob calls `DELETE /api/v1/projects/:projectId/members/:userId` -> returns 200 OK.
     - 7c. Direct SQL check confirms `status = 'removed'` and `version = 2`.
     - 7d. Immediate revocation check: Eve's subsequent `GET /api/v1/projects/:projectId` returns `404 NOT_FOUND`.
   - Test 8: Project manager cannot DELETE another manager -> returns `403 FORBIDDEN` (`Project managers cannot modify other managers.`).
   - Test 9: Project manager cannot DELETE themselves -> returns `403 FORBIDDEN` (`Cannot modify own membership.`).
   - Test 10: Non-member outsider attempting DELETE returns `404 NOT_FOUND`.
   - Test 11: Member attempting DELETE returns `403 FORBIDDEN`.
   - Test 12: Manager of sibling project in same workspace attempting to delete/manage members in another project receives `404 NOT_FOUND` (sibling privacy).

## Limitations

- Hard deletion of user profile or workspace account is out of scope; project access revocation sets membership status to `removed` for auditability and preserves activity logs.
