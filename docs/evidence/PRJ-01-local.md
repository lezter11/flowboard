# PRJ-01 — Create multiple projects evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for PRJ-01**.

## Scope and Files

- Routes: `apps/api/src/http/routes/projects.ts`
  - `POST /api/v1/workspaces/:workspaceId/projects`:
    - Verifies actor is the workspace owner (`owner_id = actor.id`). Non-owners receive 404 `NOT_FOUND` to protect container existence.
    - Validates `Idempotency-Key` header and payload via `createProjectInputSchema`.
    - Transactional execution: checks receipt replay, inserts project with `isArchived = false, version = 1`, saves idempotency receipt scoped to workspace, commits and returns 201 `{ data: project, replayed: false }`.
  - `GET /api/v1/projects/:projectId`:
    - Authorizes actor via workspace ownership OR active project membership. Non-members receive 404 `NOT_FOUND` (sibling privacy).
  - `GET /api/v1/workspaces/:workspaceId/projects`:
    - Workspace owner sees all projects in workspace.
    - Non-owners see only granted projects where they hold an active membership.
- Automated Test Suite: `apps/api/test/prj01-projects.test.ts` (7 tests passing).

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/prj01-projects.test.ts
   ```
   Result: **7 passed, 0 failed, 0 skipped** (~115ms).
   - Owner creates Project Alpha and Project Beta in the same workspace.
   - Non-owner attempting to create project in workspace returns 404 `NOT_FOUND`.
   - Sibling project privacy: Bob granted in Project Alpha requesting Project Beta gets 404 `NOT_FOUND`.
   - Role-scoped project listing: Bob sees 1 project, Alice sees 2, Charlie (outsider) gets 404.
   - Idempotency replay returns `replayed: true` and preserves original project record.
   - Idempotency conflict with altered payload returns 409 `IDEMPOTENCY_CONFLICT`.

3. **Subagent Independent Audit**:
   - Evaluated by `Workspace and Project Validation Auditor`:
     - 1. Project creation in owned workspace: 2.5 / 2.5
     - 2. Enforces only owner can create projects: 2.5 / 2.5
     - 3. Sibling project privacy & independent memberships: 2.5 / 2.5
     - 4. Idempotency-Key support & automated tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- Initial project creation does not automatically populate default boards or columns; board and column creation follows in BRD-01.
