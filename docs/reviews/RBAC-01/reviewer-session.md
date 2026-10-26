# Independent Reviewer Session Evidence: RBAC-01

## 1. Independence and Audit Metadata
- **Feature ID**: RBAC-01 (Core role-based access matrix derivation, Owner/Manager/Member/Viewer & sibling 404)
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
  - `resolveWorkspaceRole(workspaceId, userId)`: Queries `workspaces` table for `owner_id`. If `owner_id === userId`, resolves role as `'owner'`.
  - `resolveProjectRole(projectId, userId)`:
    - Step 1: Checks workspace owner inheritance (`projects p JOIN workspaces w ON p.workspace_id = w.id`). If `w.owner_id === userId`, returns `'owner'` unconditionally. Workspace owners automatically possess administrative authority over all contained projects.
    - Step 2: Checks explicit project membership (`SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2 AND status = 'active'`).
    - Returns `'manager' | 'member' | 'viewer'` or `null` if no active membership exists.
- `apps/api/src/http/middleware/rbac.ts`:
  - `requireWorkspaceRole(minRole)`: Resolves workspace role. Throws `401 UNAUTHORIZED` if unauthenticated, and uniform `404 NOT_FOUND` if workspace does not exist or user has no owner rights.
  - `requireProjectRole(minRole)`: Resolves project role using `ROLE_RANK` mapping (`owner: 4 > manager: 3 > member: 2 > viewer: 1`).
    - If `resolveProjectRole` returns `null` (such as a sibling project where the user has no grant), throws `404 NOT_FOUND`. This satisfies the strict sibling project privacy requirement by preventing project enumeration.
    - If the user has a grant but lower rank than required (e.g. member attempting manager operation), throws `403 FORBIDDEN`.
  - Removed/inactive members: `project_memberships.status = 'active'` filter ensures removed members immediately lose access and receive `404 NOT_FOUND`.

## 3. Mandatory Criteria Evaluation
1. **Session-derived authorization**: Verified. All endpoints inspect verified session cookies via `authMiddleware` and extract `actor.id`.
2. **Owner authority inheritance**: Verified. In `resolveProjectRole`, workspace owner joins `projects` to `workspaces` and returns `'owner'`, granting full access to all projects without needing explicit `project_memberships` rows.
3. **Project-scoped manager authority**: Verified. Project Manager rights derive strictly from `project_memberships` in the specific `project_id`. When querying a sibling project, `resolveProjectRole` returns `null`, denying access.
4. **Member and viewer privilege boundaries**: Verified. In `rbac01-matrix.test.ts`, members attempting manager actions receive `403 FORBIDDEN`. Viewers attempting write actions receive `403 FORBIDDEN`.
5. **Sibling project privacy**: Verified. Sibling project queries return uniform `404 NOT_FOUND` with no indication of whether the sibling project exists.
6. **No insecure development bypass**: Verified. In production, dev login and test bypasses are excluded.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac01-matrix.test.ts`
All 7 integration tests passed:
- Workspace Owner role resolution and inheritance (pass)
- Project Manager permissions in granted project (pass)
- Project Member write/read and 403 on manager action (pass)
- Project Viewer read and 403 on write/manage (pass)
- Sibling Project Privacy 404 NOT_FOUND (pass)
- Inactive/removed membership instant 404 NOT_FOUND (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
In Flowboard, workspaces group projects, but access is granted per project, except for the Workspace Owner who owns the entire workspace.
- **The Decision**: Rather than returning HTTP 403 (Forbidden) when a user tries to access a project in their workspace that they were not added to, Flowboard returns HTTP 404 (Not Found).
- **Benefits**: This prevents sibling project metadata leakage. For instance, if an engineering contractor is added to Project A, they cannot probe URLs like `/projects/merger-acquisition-secret` to see if a secret project exists. A 403 error would confirm the project exists but is forbidden; a 404 error tells them nothing.
- **Drawbacks**: Client-side debugging requires checking user memberships when a 404 is encountered, as a missing project and an ungranted project look identical.
- **Alternatives Considered**: HTTP 403 Forbidden with generic message (rejected due to information disclosure of project existence).
