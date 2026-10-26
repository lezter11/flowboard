# Independent Reviewer Session Evidence: RBAC-05

## 1. Independence and Audit Metadata
- **Feature ID**: RBAC-05 (Access summary & role inheritance disclosure)
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
  - `getProjectAccessSummary(clientOrPool, projectId, actorId)`:
    - Joins `projects p`, `workspaces w`, and `users u` on `w.owner_id = u.id`.
    - If project not found, throws `404 NOT_FOUND`.
    - Checks `resolveProjectRole(projectId, actorId, pool)`. If `null` (outsider or sibling project member), throws `404 NOT_FOUND` to preserve privacy.
    - Queries active board count (`SELECT COUNT(*)::INT AS board_count FROM boards WHERE project_id = $1 AND archived = FALSE`).
    - Groups active project memberships by role to report `activeManagers`, `activeMembers`, `activeViewers`, and `totalActiveMembers`.
    - Constructs `ProjectAccessSummary` payload:
      - `workspaceOwner`: reports workspace owner details with `role: 'owner'`, `inherited: true`, and plain disclosure text.
      - `actor`: reports caller's ID, resolved `role`, and `inheritedFrom` (`'workspace_owner'` or `'project_membership'`).
      - `boardInheritance`: reports `{ model: 'project_scoped', allBoardsInherit: true, hasBoardOnlyExceptions: false, boardCount, disclosure }`.
- `apps/api/src/http/routes/projects.ts`:
  - `GET /api/v1/projects/:projectId/access-summary`:
    - Protected by `authMiddleware` (returns `401 UNAUTHORIZED` if no valid session).
    - Calls `getProjectAccessSummary` and wraps output in `{ data: summary }`.

## 3. Mandatory Criteria Evaluation
1. **Access summary disclosure**: Verified. Discloses board inheritance model where all boards in the project inherit project-level roles directly, and confirms `hasBoardOnlyExceptions: false`.
2. **Workspace owner resolution**: Verified. When the workspace owner requests the summary, `actor.role` is `'owner'` and `inheritedFrom` is `'workspace_owner'`.
3. **Sibling and outsider isolation**: Verified. Sibling members and outsiders receive uniform `404 NOT_FOUND`.
4. **Authentication enforcement**: Verified. Unauthenticated calls without session cookies receive `401 UNAUTHORIZED`.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac-advanced.test.ts`
Tests specifically covering RBAC-05:
- `RBAC-05: GET /api/v1/projects/:projectId/access-summary discloses board inheritance model` (pass)
- `RBAC-05: Workspace owner requests access summary -> actor role is owner inherited from workspace` (pass)
- `RBAC-05: Sibling project member or outsider access-summary returns 404 NOT_FOUND` (pass)
- `RBAC-05: Unauthenticated request returns 401 UNAUTHORIZED` (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
In many project management tools, permissions can become a confusing web of project permissions, board-level overrides, and secret folder rules. Users often ask: "Why can user X see Board 1 but not Board 2?"
- **The Design Decision**: Flowboard adopts a strict, transparent inheritance model: **all permissions are project-scoped**. Boards never have independent permissions, guest lists, or hidden exceptions.
- **Why an Access Summary Endpoint?**:
  - The UI needs to explain clearly to the user what permissions they have and why.
  - The `/access-summary` endpoint provides a single truth: it explains that board permissions inherit from project permissions, shows who the Workspace Owner is (and why they have full access), and summarizes active team counts.
- **Benefits**: Transparency for users and simplicity for developers. No tricky per-board ACL tables to debug.
- **Drawbacks**: Custom "view this board only" workflows require creating a separate project.
- **Alternatives Considered**: Board-level permission overrides (rejected as prone to configuration errors and permission leaks).
