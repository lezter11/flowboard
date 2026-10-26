# Independent Reviewer Session Evidence: RBAC-04

## 1. Independence and Audit Metadata
- **Feature ID**: RBAC-04 (Picker and notification privacy, assignee vs mention filtering)
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
  - `getProjectPeople(clientOrPool, projectId, purpose, query, cursor, limit)`:
    - Builds a unified CTE of project identities:
      1. Workspace Owner (`projects p JOIN workspaces w ON p.workspace_id = w.id JOIN users u ON w.owner_id = u.id`) with `scoped_role = 'owner'`, `status = 'active'`, `priority = 1`.
      2. Explicit project members (`project_memberships pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = $1`) with `scoped_role = pm.role`, `status = pm.status`, `priority = 2`.
    - Dedupes by user ID using `DISTINCT ON (id) ORDER BY id, priority ASC` (workspace owner takes precedence over explicit membership).
    - Derives `assignable = isActive && (role === 'owner' || role === 'manager' || role === 'member')`.
    - Derives `mentionable = isActive`.
    - Filters:
      - `purpose === 'assignee'`: strictly filters for `p.assignable === true` (excludes viewers and removed users).
      - `purpose === 'mention'`: strictly filters for `p.mentionable === true` (includes viewers, excludes removed users).
      - `purpose === 'display'`: returns active project users.
    - Sibling isolation: the SQL query strictly filters by `pm.project_id = $1` and the workspace owner of `p.workspace_id`. Users from sibling projects are never included in candidates.
- `apps/api/src/http/routes/projects.ts`:
  - `GET /api/v1/projects/:projectId/people`:
    - Checks `actorRole = await resolveProjectRole(projectId, actor.id, pool)`.
    - If `!actorRole` (outsider or sibling project member), throws `404 NOT_FOUND` with zero metadata leakage.
    - Parses query using `projectPeopleQuerySchema` and delegates to `getProjectPeople`.

## 3. Mandatory Criteria Evaluation
1. **Picker privacy**: Verified. When `purpose=assignee`, only workspace owner and active managers/members are returned. Diana Viewer and Zack Removed are excluded.
2. **Mention privacy**: Verified. When `purpose=mention`, workspace owner, active managers, members, and viewers are returned. Zack Removed is excluded.
3. **Sibling project isolation**: Verified. Sam Sibling and Sally Sibling (members of `prj_sibling`) are never returned in queries for `prj_main`.
4. **Boundary enforcement**: Verified. Non-members querying `/api/v1/projects/:projectId/people` receive `404 NOT_FOUND`.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac-advanced.test.ts`
Tests specifically covering RBAC-04:
- `RBAC-04: getEligibleAssignees and getEligibleMentionees enforce role and sibling privacy` (pass)
- `RBAC-04: HTTP GET /api/v1/projects/:projectId/people enforces privacy and purpose filtering` (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
In collaborative platforms, users frequently need to assign tasks or @mention teammates.
- **The Privacy Risk**: In a multi-tenant workspace with separate projects (e.g. Finance, Legal, Engineering), showing a global company directory in card assignees or @mentions leaks employee identities across sensitive boundaries (e.g. an external auditor seeing private project members).
- **The Role Difference**:
  - **Assignees**: Can only be people who have write permission in that project. Assigning a card to a "Viewer" makes no sense because viewers cannot move or update cards.
  - **Mentions**: Can include Viewers because a viewer might need to be notified or read a comment, but must never include removed former employees.
- **The Decision**: Flowboard's people picker endpoint (`/api/v1/projects/:projectId/people`) enforces purposeful filtering and strict project boundaries:
  - If you are not in Project A, querying Project A's people returns 404 (you cannot discover who works on Project A).
  - Purpose `assignee` only returns users who can write (Owner, Manager, Member).
  - Purpose `mention` returns read-only viewers as well.
  - Sibling project members and removed users are strictly filtered out at the SQL level.
