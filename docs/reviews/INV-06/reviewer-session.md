# Independent Acceptance Review: INV-06 (Change Member Roles)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-06/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/members.ts` (`updateProjectMember`)
  - `apps/api/src/http/routes/members.ts` (`PATCH /projects/:projectId/members/:userId`)
  - `apps/api/test/inv06-inv07.test.ts`
- Test Output Evidence: `docs/reviews/INV-06/test.log`

## Security & Architectural Invariants Verified
1. **Workspace Owner Role Authority**: Workspace owners have full authority to modify any project member's role (manager, member, viewer) or status via `PATCH /api/v1/projects/:projectId/members/:userId`.
2. **Project Manager Authority Limits**: Project managers can alter roles only between `member` and `viewer`. Attempting to promote a member to `manager` or modify an existing `manager`'s role returns `403 FORBIDDEN` ('Only workspace owners can appoint managers.').
3. **Self-Modification & Peer Protection**: A Project Manager cannot modify their own membership (`targetUserId === actor.id` -> `403 FORBIDDEN`), cannot modify the workspace owner (`targetUserId === grant.ownerId` -> `403 FORBIDDEN`), and cannot modify peer managers (`targetMember.role === 'manager'` -> `403 FORBIDDEN`).
4. **Optimistic Concurrency Control (OCC)**: The payload requires `expectedVersion`. The adapter compares `targetMember.version !== expectedVersion` and rejects stale updates with `409 STALE_VERSION`. The SQL update includes `version = version + 1` and matches on `version = $5`.
5. **Concurrent Race Protection via Role Predicate**: In addition to row-level locks, non-owner updates include the SQL predicate `AND role IN ('member', 'viewer')`. This guarantees that if an owner concurrently promotes a user to manager, any in-flight PM update targeting that member will fail rather than overwriting the promotion.
6. **Write Grant Lock (R3 Compliance)**: The adapter invokes `acquireWriteGrantLock(client, projectId, actor.id, 'manager')`, holding a PostgreSQL `FOR SHARE` lock on the acting manager's membership to ensure role changes serialize with concurrent project access changes.
7. **Idempotency**: Requires `Idempotency-Key` header; records transactional receipt in `idempotency_receipts`.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv06-inv07.test.ts`.
- All tests in `inv06-inv07.test.ts` passed (14 passed, 0 failed) on isolated synthetic PostgreSQL database.

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Rock-solid boundary enforcement; PM cannot elevate privileges, modify self, or alter peers; SQL role predicate closes race conditions.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  PATCH route validates input with `updateProjectMemberInputSchema`, properly handles version mismatch (409) and missing headers (400).
- **Data integrity and concurrency**: 9.5 / 10.0 (Min 8.5)
  `acquireWriteGrantLock` FOR SHARE, `FOR UPDATE` row lock on target member, and OCC version check ensure bulletproof concurrency.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Test suite specifically exercises owner promotion, PM forbidden promotions, self-update rejection, peer manager protection, stale versions, and outsider privacy.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clear helper structure in `members.ts` with explicit connection and transaction management.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Single atomic transaction with proper rollback in `catch` block and pool client release in `finally`.

**Overall Unrounded Weighted Score**: **9.475 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
