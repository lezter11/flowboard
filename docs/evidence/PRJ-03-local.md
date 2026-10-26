# PRJ-03 — Project settings evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for PRJ-03**.

## Scope and Files

- Adapters: `apps/api/src/adapters/projects.ts`
  - `updateProjectSettings`:
    - Validates project and workspace existence.
    - Role authorization: Workspace Owner and active Project Manager can update project name and description.
    - Rejection bounds: Members and Viewers rejected with 403 `FORBIDDEN`. Outsiders and sibling project managers rejected with 404 `NOT_FOUND` (sibling privacy).
    - Optimistic Concurrency Control (OCC): requires `expectedVersion`. Checks that DB version matches `expectedVersion`; rejects stale updates with 409 `STALE_VERSION`.
    - Increments project `version` by 1 and updates `updated_at`.
    - Ownership boundary: Managers cannot alter workspace ownership.
- Routes: `apps/api/src/http/routes/projects.ts`
  - `PATCH /api/v1/projects/:projectId`
- Contracts: `packages/contracts/src/projects.ts`
  - `updateProjectInputSchema`, `projectSchema`
- Automated Test Suite: `apps/api/test/prj02-prj05.test.ts` (Tests PRJ-03.1 to PRJ-03.5)

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
   - PRJ-03.1: Workspace Owner updates project name and description with OCC; version increments from 1 to 2.
   - PRJ-03.2: Project Manager updates project description with OCC; version increments from 2 to 3.
   - PRJ-03.3: Member & Viewer cannot update project settings -> rejected with 403 `FORBIDDEN`.
   - PRJ-03.4: Sibling PM & Outsider get 404 `NOT_FOUND` on project settings (project existence not leaked).
   - PRJ-03.5: Stale `expectedVersion` rejected with 409 `STALE_VERSION`.

## Limitations

- Archiving and reopening projects are managed separately under PRJ-04 / PRJ-06; settings update is strictly scoped to name and description changes.
