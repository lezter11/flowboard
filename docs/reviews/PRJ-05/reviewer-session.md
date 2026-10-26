# Independent Backend Acceptance Review Session: PRJ-05

**Feature ID**: PRJ-05 (Project people directory: synthesized owner & boundary privacy)  
**Reviewer Actor ID**: `antigravity-acceptance-auditor`  
**Reviewer Session ID**: `0715d43b-fc65-4541-bec2-434e91be2f91`  
**Reviewer Model**: `gemini-2.5-pro`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for PRJ-05:
- `docs/reviews/PRJ-05/criteria.json` (frozen criteria)
- `docs/reviews/PRJ-05/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/PRJ-05/test.log` (execution log of mandatory tests)
- `apps/api/src/adapters/projects.ts` (project adapter methods)
- `apps/api/src/http/routes/projects.ts` (project HTTP handlers)
- `apps/api/src/adapters/idempotency.ts` (idempotency transactional receipts)
- `apps/api/src/adapters/rbac.ts` (role resolution and grant locking)
- `apps/api/src/adapters/postgres.ts` (PostgreSQL connection pool management)
- `apps/api/src/adapters/session.ts` (session creation and authentication)
- `apps/api/src/adapters/migrations.ts` (schema migrations)
- `apps/api/src/http/errors.ts` (HTTP error taxonomy)
- `apps/api/src/http/middleware/auth.ts` (session authentication middleware)
- `apps/api/src/http/app.ts` (Hono application factory and route mounting)
- `packages/contracts/src/projects.ts` (Zod schemas and contracts)
- `packages/contracts/src/common.ts` (common schemas)
- `packages/contracts/src/index.ts` (contracts entry point)
- `apps/api/test/prj02-prj05.test.ts` (isolated PostgreSQL integration test suite)

---

## 2. Mandatory Acceptance Criteria Audit

1. **People directory scoping**:
   - `GET /api/v1/projects/:projectId/members` and `/people` return active eligible members for the specified project.
   - All legitimate project roles (owner, manager, member, viewer) are authorized to view the directory.
   - Inspected lines: `apps/api/src/adapters/projects.ts:378-384, 468-502`.
   - Verified in test: `prj02-prj05.test.ts` steps PRJ-05.1 & PRJ-05.2.

2. **Workspace owner inclusion**:
   - The workspace owner has inherent authority and must appear in the directory as role `owner` with active status, even if not explicitly seeded in the `project_memberships` table.
   - `getProjectMembers` checks if the workspace owner user is present in `project_memberships` rows; if not, synthesizes a directory member with role `'owner'`, status `'active'`, version `1`, and membershipId `pm_owner_${ownerUser.id}`.
   - Inspected lines: `apps/api/src/adapters/projects.ts:430-444`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-05.1 (Alice is not in `project_memberships` but appears with role 'owner').

3. **Strict sibling exclusion**:
   - Members from sibling projects or unrelated workspaces are never returned; directory queries strictly filter on `pm.project_id = $1`.
   - Zero cross-project leakage of member names or email addresses.
   - Inspected lines: `apps/api/src/adapters/projects.ts:408`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-05.1 (Eve from Project Beta is verified absent from Project Alpha).

4. **Removed members excluded**:
   - Users with `pm.status = 'removed'` are strictly excluded by the query filter `AND pm.status = 'active'`.
   - Removed members cannot access the directory (`member_status !== 'active'` returns 404 NOT_FOUND).
   - Inspected lines: `apps/api/src/adapters/projects.ts:381-383, 408`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-05.4 (Charlie removed, excluded from directory, and denied access with 404).

5. **Privacy and role checks**:
   - Outsiders probing the directory endpoint receive `404 NOT_FOUND` rather than empty lists or 403, preserving project existence privacy.
   - Inspected lines: `apps/api/src/adapters/projects.ts:380-384`.
   - Verified in test: `prj02-prj05.test.ts` step PRJ-05.3.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Complete isolation of member data per project; zero sibling leakage; workspace owner synthesis handles inherent permissions without granting backdoor membership to others; outsiders and removed members receive 404 NOT_FOUND.
  *Evidence*: `apps/api/src/adapters/projects.ts:378-384, 408-410`; `apps/api/test/prj02-prj05.test.ts`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Matches REST and GraphQL requirements for project directories; supports people pickers with assignee/mention filtering purposes; returns structured member profiles with roles and statuses.
  *Evidence*: `apps/api/src/adapters/projects.ts:428-502`; `packages/contracts/src/projects.ts:77-106`.

- **Data integrity and concurrency**: **9.0 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Reads consistent state directly from active membership and user rows; workspace owner lookup links to `workspaces.owner_id` ensuring single source of truth for ownership.
  *Evidence*: `apps/api/src/adapters/projects.ts:414-425`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: 4 dedicated integration tests in `prj02-prj05.test.ts` testing owner directory view, synthesized owner inclusion, PM/member/viewer permissions, sibling member exclusion, outsider 404, soft-removed member exclusion, and revoked member access rejection.
  *Evidence*: `apps/api/test/prj02-prj05.test.ts:537-650`; `docs/reviews/PRJ-05/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Cohesive adapters for both full directory display and person picker widgets (`getProjectMembers` and `getProjectPeople`); fully typed Zod validation schemas.
  *Evidence*: `apps/api/src/adapters/projects.ts:348-502`.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Indexed queries over `pm.project_id` and `pm.status`; single round-trip queries without N+1 query patterns; graceful 404 handling.
  *Evidence*: `apps/api/src/adapters/projects.ts:408`.

**Unrounded Weighted Score**: **9.350 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Workspace Owner Synthesis vs. Denormalized Membership Rows
In a hierarchical role-based system (Workspace $\to$ Projects), the Workspace Owner is implicitly an administrator of all projects inside their workspace. However, there are two contrasting ways to represent this in the database:

#### Approach A: Eager Denormalization
Whenever an owner creates a project, insert a row into `project_memberships` for the owner.
- *Problem*: If the workspace ownership transfers to another user later, background jobs must find and update every single project membership row across potentially thousands of projects. If any row fails to update, ownership state becomes corrupted and inconsistent. Furthermore, an accidental `DELETE FROM project_memberships` could leave the owner locked out of their own project.

#### Approach B: Owner Synthesis (Flowboard's Design)
Flowboard keeps `workspaces.owner_id` as the single authoritative source of truth. When `getProjectMembers` runs:
1. It queries active rows from `project_memberships` for `projectId`.
2. It fetches the user record corresponding to `workspaces.owner_id`.
3. If the owner does not already have an explicit row in `project_memberships`, Flowboard **synthesizes** a virtual member record with role `'owner'`.
4. If the owner transfers ownership of the workspace, every project directory instantly reflects the new owner without touching a single project row.
- **Benefit**: Zero synchronization lag, impossible to corrupt or desynchronize on ownership transfers, and the owner is never locked out.
- **Drawback**: Read queries perform an extra lightweight join against the workspace owner, and application code must handle synthesizing the object.
- **Alternative**: Denormalizing membership rows simplifies read queries at the expense of fragile write synchronization and potential data corruption. Flowboard chooses the synthesized approach for consistency and safety.
