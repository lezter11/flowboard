# Independent Acceptance Review: INV-08 (Leave Project)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-08/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/invitations.ts` (`leaveProject`)
  - `apps/api/src/http/routes/invitations.ts` (`POST /projects/:projectId/leave`)
  - `apps/api/test/inv04-inv08.test.ts`
- Test Output Evidence: `docs/reviews/INV-08/test.log`

## Security & Architectural Invariants Verified
1. **Voluntary Departure for Granted Roles**: Active project managers, members, and viewers can voluntarily leave a granted project via `POST /api/v1/projects/:projectId/leave`.
2. **Workspace Owner Protection**: A workspace owner cannot leave a project in their own workspace (`project.owner_id === actor.id` -> `403 FORBIDDEN` with message 'Workspace owners cannot leave their project. Transfer workspace ownership instead.'). This prevents orphaned projects without workspace ownership.
3. **Outsider Rejection**: Users without an active membership in the project receive `404 NOT_FOUND`, maintaining privacy and preventing existence probing.
4. **Immediate Access Cut-Off**: Leaving transitions `project_memberships.status` to `'removed'` under a `FOR UPDATE` lock and increments the membership version. Subsequent attempts by the departed user to read or write to the project immediately return `404 NOT_FOUND`.
5. **Atomic Revocation of Pending Invitations**: The adapter looks up the departing user's email and marks any pending invitations for that email in the project as `status = 'revoked'` in the same transaction.
6. **Historical Attribution Intact**: Membership rows are not hard-deleted; status transitions to `'removed'`. Historical references on cards, comments, and audit entries continue to resolve cleanly.
7. **Idempotency Guarantee**: Requires `Idempotency-Key` and records transactional receipts. Repeated requests with the same idempotency key replay safely with `200 OK` and `{ replayed: true }`.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv04-inv08.test.ts`.
- All tests for INV-08 passed cleanly (including owner forbidden, outsider 404, member/viewer/manager leave, access cutoff, idempotency replay, and pending invitation revocation).

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Owner cannot orphan project; outsiders get 404; immediate 404 cutoff upon leave; pending invites revoked.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  Adheres strictly to the `/projects/:projectId/leave` specification with proper status codes (200, 403, 404) and payload.
- **Data integrity and concurrency**: 9.5 / 10.0 (Min 8.5)
  `FOR UPDATE` lock on actor's membership; transactional multi-table update of membership and invitations; OCC version increment.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Comprehensive test coverage across all member roles (Manager, Member, Viewer), owner restriction, and replay behavior.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clean implementation in `invitations.ts` with explicit parameterized queries.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Direct indexed lookup and atomic transition within a single short-lived transaction.

**Overall Unrounded Weighted Score**: **9.475 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
