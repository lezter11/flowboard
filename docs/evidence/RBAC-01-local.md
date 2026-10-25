# RBAC-01 — Owner manager member viewer matrix evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for RBAC-01**.

## Scope and Files

- RBAC Resolver Adapter: `apps/api/src/adapters/rbac.ts`
  - `resolveWorkspaceRole(workspaceId, userId)`: Checks `workspaces.owner_id = userId`, returning `'owner'` or `null`.
  - `resolveProjectRole(projectId, userId)`:
    - Checks project parent workspace: if `workspaces.owner_id = userId`, returns `'owner'` (workspace owners inherit full ownership across all owned projects).
    - Checks `project_memberships` for `status = 'active'`, returning `'manager' | 'member' | 'viewer'`.
    - Returns `null` if no active grant exists or project does not exist.
  - `getOwnedWorkspaces(userId)` and `getAccessibleProjects(userId)` for actor session summaries.
- RBAC Middleware: `apps/api/src/http/middleware/rbac.ts`
  - `requireWorkspaceRole(minRole: 'owner')`: Returns 404 `NOT_FOUND` if unauthorized to protect container existence.
  - `requireProjectRole(minRole: 'manager' | 'member' | 'viewer')`:
    - Enforces hierarchy: `owner (4) > manager (3) > member (2) > viewer (1)`.
    - If user has no active grant in the project (`role === null`), throws 404 `NOT_FOUND` (strictly enforcing sibling project privacy so unauthorized users cannot enumerate projects).
    - If user has a grant but lower than `minRole` (e.g. viewer attempting to write), throws 403 `FORBIDDEN`.
    - Sets `c.set('projectRole', role)`.
- Automated Test Suite: `apps/api/test/rbac01-matrix.test.ts` (6 tests passing).

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac01-matrix.test.ts
   ```
   Result: **6 passed, 0 failed, 0 skipped** (~112ms).
   - Workspace owner role derivation & automatic inheritance across all owned projects.
   - Project manager permissions in granted projects.
   - Member write access allowed, but manager actions blocked with 403 FORBIDDEN.
   - Viewer read access allowed, but write/manage actions blocked with 403 FORBIDDEN.
   - Sibling project privacy: user in Project 1 querying Project 2 gets 404 NOT_FOUND.
   - Inactive/removed membership revocation drops permissions immediately and returns 404 NOT_FOUND.

3. **Subagent Independent Audit**:
   - Evaluated by `Auth and RBAC Validation Auditor`:
     - 1. Workspace owner role derivation: 2.5 / 2.5
     - 2. Project role resolution & inheritance: 2.5 / 2.5
     - 3. Permission enforcement & sibling privacy: 2.5 / 2.5
     - 4. Full permission matrix unit & integration tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- RLS (Row Level Security) remains an optional defense-in-depth layer to be evaluated after dedicated connection pooler benchmarking; application-level middleware enforces project isolation.
