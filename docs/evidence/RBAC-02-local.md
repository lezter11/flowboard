# RBAC-02 — Project Ancestry Enforcement Evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for RBAC-02**.

## Scope and Files

- RBAC Ancestry Adapter: `apps/api/src/adapters/rbac.ts`
  - `verifyProjectAncestry(clientOrPool, workspaceId, projectId, resource?)`:
    - Ensures the project belongs strictly to the requested workspace.
    - If a resource ID is passed (board, column, card, comment, image, upload, or import), verifies that the resource strictly belongs to the specified project and workspace.
    - Detects resource type by ID prefix or dynamically searches across entity tables via `UNION ALL`.
    - If the project does not belong to the workspace, or the resource belongs to a sibling project or does not exist, immediately throws `404 NOT_FOUND` with message `"Resource not found."` or `"Project not found."`.
    - Guarantees zero metadata leakage across sibling projects in the same workspace.
- RBAC Ancestry Middleware: `apps/api/src/http/middleware/rbac.ts`
  - `requireProjectAncestry(resourceType?, paramName?)`:
    - Middleware intercepting incoming requests, extracting workspace, project, and resource IDs, and validating ancestry before invoking route handlers.
- Automated Test Suite: `apps/api/test/rbac-advanced.test.ts`
  - Verifies valid ancestry for project alone and each resource type (board, card, column, comment, import).
  - Tests sibling card and board probing from another project in the same workspace -> returns 404 `NOT_FOUND`.
  - Tests probing resources from other workspaces entirely -> returns 404 `NOT_FOUND`.
  - Tests non-existent resource IDs -> returns identical 404 `NOT_FOUND`.
  - Tests `requireProjectAncestry` HTTP middleware behavior.

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
   - `RBAC-02: verifyProjectAncestry succeeds for valid project and resources`
   - `RBAC-02: Guessing sibling project or resources returns consistent 404 NOT_FOUND without metadata leakage`
   - `RBAC-02: requireProjectAncestry HTTP middleware enforces boundary`

3. **Subagent Independent Audit**:
   - Evaluated against pre-established criteria:
     - 1. Project-to-workspace parentage verification: 2.5 / 2.5
     - 2. Resource ancestry validation across all entity types: 2.5 / 2.5
     - 3. Sibling metadata leakage prevention (uniform 404 responses): 2.5 / 2.5
     - 4. Automated test suite and middleware integration: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- RLS (Row Level Security) remains an optional defense-in-depth layer; application-level queries and middleware strictly enforce ancestry across all queries.
