# PRJ-05 — Project people directory evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for PRJ-05**.

## Scope and Files

- Adapters: `apps/api/src/adapters/projects.ts`
  - `getProjectMembers`:
    - Validates project ancestry and actor access.
    - Accessible by Workspace Owner and all active project members (Manager, Member, Viewer).
    - Outsiders and sibling project members receive 404 `NOT_FOUND` (sibling privacy).
    - Returns active project members with user info (`id`, `name`, `email`, `avatarUrl`, `role`, `status`, `version`).
    - Workspace owner is automatically synthesized and included with `role = 'owner'` even when not explicitly present in the `project_memberships` table.
    - Sibling project members from other projects in the same workspace are strictly excluded.
    - Removed members (`status = 'removed'`) are excluded from the directory, and their directory access is revoked.
  - `getProjectPeople`:
    - Helper for purpose-specific person selection (`display`, `assignee`, `mention`) with search query filtering.
- Routes: `apps/api/src/http/routes/projects.ts`
  - `GET /api/v1/projects/:projectId/members`
  - `GET /api/v1/projects/:projectId/people`
- Contracts: `packages/contracts/src/projects.ts`
  - `projectDirectoryResponseSchema`, `projectDirectoryMemberSchema`, `projectPeopleResponseSchema`
- Automated Test Suite: `apps/api/test/prj02-prj05.test.ts` (Tests PRJ-05.1 to PRJ-05.4)

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Execution**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/prj02-prj05.test.ts
   ```
   Result: **15 passed, 0 failed, 0 skipped** (~204ms).
   - PRJ-05.1: Owner sees project members directory including workspace owner (Alice with role `owner`) and active members (Bob, Charlie, Diana); sibling project member Eve is excluded.
   - PRJ-05.2: Project Manager, Member, and Viewer can all view the project directory.
   - PRJ-05.3: Sibling project member & outsider get 404 `NOT_FOUND` on members directory.
   - PRJ-05.4: Removed project member is excluded from directory and cannot access it.

## Limitations

- Card assignment eligibility (assignee picker restricting viewers) is consumed by CRD-06; the underlying people directory returns all authorized readers with their scoped role.
