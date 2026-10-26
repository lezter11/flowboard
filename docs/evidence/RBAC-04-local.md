# RBAC-04 — Picker and Notification Privacy Evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for RBAC-04**.

## Scope and Files

- RBAC Privacy Adapter: `apps/api/src/adapters/rbac.ts`
  - `getProjectPeople(clientOrPool, projectId, purpose, query, cursor, limit)`:
    - Queries project context, workspace owner, and active project members.
    - Sibling project members from other projects in the same workspace are strictly excluded.
    - If `purpose === 'assignee'`, returns only active workspace owner and active managers/members (viewers and removed members are excluded).
    - If `purpose === 'mention'`, returns active workspace owner and active managers/members/viewers (viewers can be mentioned).
    - If `purpose === 'display'`, returns all active project members.
    - Includes cursor-based pagination and search filter.
  - `getEligibleAssignees(clientOrPool, projectId, query)`:
    - Convenience helper returning `PersonDisplay[]` eligible for card assignment.
  - `getEligibleMentionees(clientOrPool, projectId, query)`:
    - Convenience helper returning `PersonDisplay[]` eligible for comments/mentions.
  - `getHistoricalPersonDisplay(clientOrPool, projectId, userId)`:
    - Returns historical `PersonDisplay` for removed users with `activeInProject: false`, `assignable: false`, `mentionable: false`.
- HTTP Route: `apps/api/src/http/routes/projects.ts`
  - `GET /api/v1/projects/:projectId/people`:
    - Authenticates actor.
    - Resolves actor's project role; returns `404 NOT_FOUND` for outsiders and sibling project members.
    - Parses `purpose`, `query`, `cursor`, `limit` using `projectPeopleQuerySchema`.
    - Returns `{ data: PersonDisplay[], nextCursor: string | null }`.
- Contracts: `packages/contracts/src/projects.ts`
  - Exports `projectPeopleQuerySchema` and `projectPeopleResponseSchema`.
- Automated Test Suite: `apps/api/test/rbac-advanced.test.ts`
  - Verifies assignee and mentionee lists enforce role and sibling privacy.
  - Verifies removed member flagged as historical and not assignable/mentionable.
  - Verifies HTTP `GET /api/v1/projects/:projectId/people` with purpose filtering and search.
  - Verifies sibling project member and stranger receive 404 `NOT_FOUND`.

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
   - `RBAC-04: getEligibleAssignees and getEligibleMentionees enforce role and sibling privacy`
   - `RBAC-04: HTTP GET /api/v1/projects/:projectId/people enforces privacy and purpose filtering`

3. **Subagent Independent Audit**:
   - Evaluated against pre-established criteria:
     - 1. Project-scoped person resolution with workspace owner inheritance: 2.5 / 2.5
     - 2. Strict role differentiation (assignees exclude viewers; mentionees include viewers): 2.5 / 2.5
     - 3. Sibling member exclusion and removed member historical handling: 2.5 / 2.5
     - 4. HTTP endpoint validation, pagination, and automated tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- People picker responses are cached per request; long-lived client caching is disabled (`Cache-Control: no-store`).
