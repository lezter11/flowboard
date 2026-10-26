# PRJ-02 — Project list and navigation evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for PRJ-02**.

## Scope and Files

- Adapters: `apps/api/src/adapters/projects.ts`
  - `getWorkspaceProjects`:
    - Validates workspace existence.
    - If actor is Workspace Owner: queries all projects in the workspace.
    - If actor is not owner: ensures actor has at least one active project membership; queries only active granted projects.
    - Keyset pagination with cursor encoding/decoding `(name ASC, id ASC)`.
    - Hidden projects leak no name, count, or existence; outsiders receive 404 `NOT_FOUND`.
  - `getAllAccessibleProjects`:
    - Queries all projects across all workspaces accessible to the session actor (owned workspaces or active project grants).
    - Returns `{ data: Project[], nextCursor: string | null }`. Outsiders with no accessible projects receive `{ data: [], nextCursor: null }` with status 200 OK.
- Routes: `apps/api/src/http/routes/projects.ts`
  - `GET /api/v1/workspaces/:workspaceId/projects`
  - `GET /api/v1/projects`
- Contracts: `packages/contracts/src/projects.ts`
  - `projectListResponseSchema`, `projectSchema`
- Automated Test Suite: `apps/api/test/prj02-prj05.test.ts` (Tests PRJ-02.1 to PRJ-02.5)

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
   - PRJ-02.1: Workspace Owner sees all projects in workspace, paginated.
   - PRJ-02.2: Cursor pagination for workspace projects successfully walks pages using `nextCursor`.
   - PRJ-02.3: Project Manager / Member sees only granted projects; sibling projects remain hidden.
   - PRJ-02.4: Outsider querying workspace projects gets 404 `NOT_FOUND` (sibling privacy guarantee).
   - PRJ-02.5: `GET /api/v1/projects` lists accessible projects across all workspaces for current session; outsider receives empty list `[]`.

## Limitations

- Project filtering and full-text search across titles/descriptions is specified under advanced search; basic keyset navigation and pagination is fully implemented and verified.
