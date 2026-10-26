# Independent Backend Acceptance Review Session: PRJ-01

**Feature ID**: PRJ-01 (Create multiple projects & sibling isolation)  
**Reviewer Actor ID**: `antigravity-acceptance-auditor`  
**Reviewer Session ID**: `0715d43b-fc65-4541-bec2-434e91be2f91`  
**Reviewer Model**: `gemini-2.5-pro`  
**Review Date**: 2026-10-26  
**Independence Declaration**: The reviewer is an independent auditor operating with a fresh context who did not implement the target code, tests, or migrations. All evaluations are read-only and verified strictly against `BACKEND_REVIEW_GATE.md`.

---

## 1. Scope and Target Manifest

The following reachable files constitute the frozen target scope for PRJ-01:
- `docs/reviews/PRJ-01/criteria.json` (frozen criteria)
- `docs/reviews/PRJ-01/reviewer-session.md` (reviewer independence evidence)
- `docs/reviews/PRJ-01/test.log` (execution log of mandatory tests)
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
- `apps/api/test/prj01-projects.test.ts` (isolated PostgreSQL integration test suite)

---

## 2. Mandatory Acceptance Criteria Audit

1. **Owner-only project creation**:
   - `POST /api/v1/workspaces/:workspaceId/projects` queries `workspaces` table with `WHERE id = $1 AND owner_id = $2`.
   - Non-owners or ungranted workspace callers receive `404 NOT_FOUND` (preventing workspace probing).
   - Inspected lines: `apps/api/src/http/routes/projects.ts:63-69`.
   - Verified in test: `prj01-projects.test.ts` step 2 returns `404 NOT_FOUND`.

2. **Project isolation**:
   - Each project is assigned a distinct UUID prefixed with `prj_` and references its workspace via foreign key. Memberships and boards are scoped strictly per project.
   - Inspected lines: `apps/api/src/http/routes/projects.ts:105-123`.

3. **Sibling project privacy**:
   - `GET /api/v1/projects/:projectId` joins `workspaces` and `project_memberships` for `actor.id`. If caller is neither workspace owner nor active project member, it returns `404 NOT_FOUND`.
   - Sibling project members receive `404 NOT_FOUND`, leaking no project existence or metadata.
   - Inspected lines: `apps/api/src/http/routes/projects.ts:209-223`.
   - Verified in test: `prj01-projects.test.ts` step 4 returns `404 NOT_FOUND`.

4. **Project listing scoping**:
   - `GET /api/v1/workspaces/:workspaceId/projects` returns all projects for workspace owners.
   - Non-owner members see only projects where they hold an active membership (`pm.status = 'active'`).
   - Outsiders with zero grants in the workspace receive `404 NOT_FOUND`.
   - Inspected lines: `apps/api/src/adapters/projects.ts:74-115`.
   - Verified in test: `prj01-projects.test.ts` step 5.

5. **Input validation**:
   - `createProjectInputSchema` validates non-empty `name` (1-100 chars) and optional `description` (max 2000 chars). Unknown fields are stripped/rejected by Zod parsing.
   - Inspected lines: `packages/contracts/src/projects.ts:11-15`.

6. **Idempotency support**:
   - `POST /api/v1/workspaces/:workspaceId/projects` requires `Idempotency-Key` header.
   - Transactional check and replay via `checkOrReplayReceipt` and `saveReceipt` inside a single DB transaction (`BEGIN ... COMMIT`).
   - Replays return `replayed: true` with cached status code and payload; payload mismatches return `409 IDEMPOTENCY_CONFLICT`.
   - Inspected lines: `apps/api/src/http/routes/projects.ts:71-168`.
   - Verified in test: `prj01-projects.test.ts` steps 6 & 7.

---

## 3. Rubric Evaluation and Category Scores

- **Security and authority boundaries**: **9.5 / 10.0** (Weight: 30, Min: 9.0)  
  *Reason*: Strict workspace ownership verification on project creation; non-owners get 404 NOT_FOUND to prevent enumeration; sibling privacy completely hides projects from non-members with 404 NOT_FOUND; zero cross-project leakage.
  *Evidence*: `apps/api/src/http/routes/projects.ts:63-69, 209-223`; `apps/api/test/prj01-projects.test.ts`.

- **Functional and API correctness**: **9.5 / 10.0** (Weight: 25, Min: 8.5)  
  *Reason*: Full REST API contract fulfilled for project creation, detail fetch, and workspace listing; accurate error codes (400, 404, 409); structured data envelopes.
  *Evidence*: `apps/api/src/http/routes/projects.ts:52-185`; `packages/contracts/src/projects.ts:11-73`.

- **Data integrity and concurrency**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: Creation and idempotency receipt creation executed inside atomic PostgreSQL transaction; ON CONFLICT handling prevents race conditions on duplicate inserts.
  *Evidence*: `apps/api/src/adapters/idempotency.ts:121-144`; `apps/api/src/http/routes/projects.ts:84-164`.

- **Test quality and independent evidence**: **9.5 / 10.0** (Weight: 15, Min: 8.5)  
  *Reason*: 8 node:test integration tests executed against real PostgreSQL instance; covers owner creation, outsider rejection, sibling isolation, role scoping, idempotency replay, and payload mismatch conflicts.
  *Evidence*: `apps/api/test/prj01-projects.test.ts`; `docs/reviews/PRJ-01/test.log`.

- **Maintainability and portability**: **9.0 / 10.0** (Weight: 10, Min: 7.5)  
  *Reason*: Clean separation between Hono HTTP route handlers, PostgreSQL adapters, and Zod contract definitions; fully typed with zero TypeScript errors.
  *Evidence*: `npm run typecheck` passing cleanly.

- **Operations, performance and failure recovery**: **9.0 / 10.0** (Weight: 5, Min: 7.0)  
  *Reason*: Fast transactional execution, bounded request bodies and headers, automatic rollback on error with connection release in finally block.
  *Evidence*: `apps/api/src/http/routes/projects.ts:163-167`.

**Unrounded Weighted Score**: **9.425 / 10.0** (Strictly > 8.5, all category minimums passed).

---

## 4. Plain-English System Design Teaching Explanation

### Concept: Sibling Project Privacy and Idempotent Creation
In multi-tenant project management systems like Flowboard, users often belong to the same parent workspace (e.g., an organization), but should not see or know about other projects within that workspace unless explicitly granted access.

#### Flowboard Example
Suppose Alice owns the workspace "Acme Corp", and creates two projects: "Project Alpha" (public engineering) and "Project Stealth" (confidential acquisition). Bob is invited to "Project Alpha" as a member. If Bob attempts to probe `GET /api/v1/projects/prj_stealth`, the system returns `404 NOT_FOUND` rather than `403 FORBIDDEN`.

#### Why 404 instead of 403?
- **Benefit (Metadata Privacy)**: Returning `403 FORBIDDEN` confirms that "Project Stealth" actually exists, leaking organizational secrets and enabling enumeration attacks. Returning `404 NOT_FOUND` treats an unauthorized project as completely nonexistent to that user.
- **Drawback**: Debugging client permissions can be slightly harder for developers because a missing grant looks identical to a bad URL ID.
- **Alternative**: Returning `403 FORBIDDEN` makes access denial explicit, but leaks project existence. Flowboard strictly chooses `404 NOT_FOUND` for privacy.

#### Transactional Idempotency Receipts
When Alice creates a project via mobile network, packets may drop on the return path after the database commits the project row. If Alice's app retries with the same `Idempotency-Key`:
- Flowboard's `checkOrReplayReceipt` recognizes the key, verifies the request payload hash matches, and returns the previous 201 response with `replayed: true` without creating a duplicate project.
- If an attacker attempts to reuse the same idempotency key with a different project name, Flowboard detects the hash mismatch and immediately aborts with `409 IDEMPOTENCY_CONFLICT`.
