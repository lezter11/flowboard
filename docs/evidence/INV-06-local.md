# INV-06 — Change member roles evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-06**.

## Scope and Implementation

- Adapter: `apps/api/src/adapters/members.ts` (`updateProjectMember`)
  - Role check & authority enforcement:
    - Resolves actor's role in the target project and workspace ownership.
    - Workspace Owner has total authority: can promote, demote, and modify any project member's role (`manager`, `member`, `viewer`).
    - Project Manager can modify `member` and `viewer` roles only.
    - Attempts by a Project Manager to promote anyone to `manager` return `403 FORBIDDEN` (`Project managers cannot appoint managers.`).
    - Self-modification protection: Project Managers cannot modify their own membership (self-promotion or self-demotion blocked with `403 FORBIDDEN`).
    - Peer protection: Project Managers cannot modify another `manager` or the workspace owner (`403 FORBIDDEN`).
    - Non-member outsiders attempting to modify members receive `404 NOT_FOUND` to protect sibling project confidentiality.
    - Members and viewers attempting to modify members receive `403 FORBIDDEN`.
  - Optimistic Concurrency Control (OCC):
    - Enforces version check using SQL:
      ```sql
      UPDATE project_memberships
      SET role = $1, status = $2, version = version + 1, updated_at = NOW()
      WHERE project_id = $3 AND user_id = $4 AND version = $5
      RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
      ```
    - If `expectedVersion` does not match the current database row version (zero rows updated), throws `409 STALE_VERSION` (`Member was concurrently updated. Refresh and try again.`).
- Route: `apps/api/src/http/routes/members.ts` (`PATCH /api/v1/projects/:projectId/members/:userId`)
  - Protected by `authMiddleware`.
  - Validates request payload against `updateProjectMemberInputSchema` (`role`, `status`, `expectedVersion`).
  - Returns updated member record with incremented version: `200 { data: ProjectMember }`.

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
   - Test 1: Workspace owner promotes a member to manager -> succeeds, version increments to 2.
   - Test 2: Project manager attempts to promote a member to manager -> returns `403 FORBIDDEN` (`Project managers cannot appoint managers.`).
   - Test 3: Project manager modifies role between member and viewer -> succeeds.
   - Test 4: Project manager attempts to modify another manager -> returns `403 FORBIDDEN` (`Project managers cannot modify other managers.`).
   - Test 5: Project manager attempts to modify themselves -> returns `403 FORBIDDEN` (`Cannot modify own membership.`).
   - Test 6: Stale version in PATCH returns `409 STALE_VERSION` (`Member was concurrently updated. Refresh and try again.`).
   - Test 10: Non-member outsider attempting to manage members returns `404 NOT_FOUND`.
   - Test 11: Member attempting to manage members returns `403 FORBIDDEN`.
   - Test 12: Manager of sibling project in same workspace attempting to manage members in another project receives `404 NOT_FOUND` (sibling privacy).

## Limitations

- Card-level assignee reassignment upon role demotion to viewer is handled in downstream card assignment logic (CRD-03).
