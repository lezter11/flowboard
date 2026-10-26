# RBAC-05 — Project Inheritance Disclosure Evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for RBAC-05**.

## Scope and Files

- RBAC Disclosure Adapter: `apps/api/src/adapters/rbac.ts`
  - `getProjectAccessSummary(clientOrPool, projectId, actorId)`:
    - Queries project, workspace, and workspace owner details.
    - Resolves actor's role and inheritance source (`workspace_owner` vs `project_membership`).
    - Discloses workspace owner inherited authority across all boards within the project.
    - Clarifies that board permissions are inherited directly from project membership, confirming `allBoardsInherit: true` and `hasBoardOnlyExceptions: false`.
    - Returns active board count and active member role breakdown (managers, members, viewers).
- HTTP Route: `apps/api/src/http/routes/projects.ts`
  - `GET /api/v1/projects/:projectId/access-summary`:
    - Authenticates actor.
    - Returns `ProjectAccessSummary` for authorized project actors.
    - Returns `404 NOT_FOUND` for sibling project members and outsiders, preserving project privacy.
    - Returns `401 UNAUTHORIZED` for unauthenticated requests.
- Contracts: `packages/contracts/src/projects.ts`
  - Added and exported `projectAccessSummarySchema` and `projectAccessSummaryResponseSchema`.
- Automated Test Suite: `apps/api/test/rbac-advanced.test.ts`
  - Member access-summary returns full inheritance disclosure and role counts.
  - Workspace owner access-summary reflects `inheritedFrom: 'workspace_owner'`.
  - Sibling project member or outsider receives 404 `NOT_FOUND`.
  - Unauthenticated request receives 401 `UNAUTHORIZED`.

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
   - `RBAC-05: GET /api/v1/projects/:projectId/access-summary discloses board inheritance model`
   - `RBAC-05: Workspace owner requests access summary -> actor role is owner inherited from workspace`
   - `RBAC-05: Sibling project member or outsider access-summary returns 404 NOT_FOUND`
   - `RBAC-05: Unauthenticated request returns 401 UNAUTHORIZED`

3. **Subagent Independent Audit**:
   - Evaluated against pre-established criteria:
     - 1. Comprehensive inheritance disclosure model: 2.5 / 2.5
     - 2. Workspace owner administrative authority disclosure: 2.5 / 2.5
     - 3. Explicit absence of board-only guest permissions: 2.5 / 2.5
     - 4. Full API endpoint authentication, authorization, and automated tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- Access summary reflects current snapshot; real-time push events are deferred to notification features.
