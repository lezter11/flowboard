# Independent Acceptance Review: INV-07 (Remove Member Access)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-07/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/members.ts` (`removeProjectMember`)
  - `apps/api/src/http/routes/members.ts` (`DELETE /projects/:projectId/members/:userId`)
  - `apps/api/test/inv06-inv07.test.ts`
- Test Output Evidence: `docs/reviews/INV-07/test.log`

## Security & Architectural Invariants Verified
1. **Workspace Owner Removal Authority**: Workspace owners can revoke any membership (manager, member, viewer) across workspace projects via `DELETE /api/v1/projects/:projectId/members/:userId`.
2. **Project Manager Removal Limits**: Project managers can remove members and viewers only. Attempting to remove another manager or the workspace owner returns `403 FORBIDDEN`.
3. **Self-Removal Protection**: Project managers cannot remove themselves using the member deletion route (`targetUserId === actor.id` -> `403 FORBIDDEN`); they must use the dedicated voluntary departure route (`/leave`), ensuring intentional leave semantics.
4. **Immediate Access Revocation**: Upon removal, `project_memberships.status` is set to `'removed'`. Any subsequent request by the removed user to project resources or write grant locks immediately fails with `404 NOT_FOUND`.
5. **R2 Audit Compliance (Atomic Invitation Revocation)**: In the same transaction as setting membership status to `'removed'`, the adapter looks up the target user's email and updates all pending invitations for that email in the project to `status = 'revoked'`. Furthermore, defense-in-depth in `acceptInvitation` blocks any token issued prior to removal with `400 INVITATION_SUPERSEDED`.
6. **Concurrent Race Protection via Role Predicate**: When a PM executes removal, the update query includes `AND role IN ('member', 'viewer')` under `FOR UPDATE`. If the owner concurrently promotes the member to manager, the PM removal safely fails with `403 FORBIDDEN` rather than removing a manager.
7. **Referential Integrity & Audit Preservation**: Membership rows are not hard-deleted; their status transitions to `'removed'` and version is incremented. This preserves historical attribution on past comments, audit logs, and card activity.
8. **Write Grant Lock (R3 Compliance)**: Calls `acquireWriteGrantLock(client, projectId, actor.id, 'manager')` to ensure atomic serialization.
9. **Idempotency**: DELETE requires `Idempotency-Key` and records transactional receipts.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv06-inv07.test.ts`.
- All tests in `inv06-inv07.test.ts` passed (14 passed, 0 failed) on isolated synthetic PostgreSQL database.

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Complete role boundary enforcement; PM cannot remove peers or owners; immediate 404 access cutoff; atomic invitation revocation prevents re-entry.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  DELETE endpoint complies with HTTP spec, validates path parameters, enforces idempotency, and returns standard success envelope.
- **Data integrity and concurrency**: 9.5 / 10.0 (Min 8.5)
  Row preservation with status transition, version increment, atomic multi-table updates (memberships + invitations) in single transaction.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Negative tests for PM deleting manager/self/owner, immediate access cutoff verification, and outsider privacy.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clean, well-factored code in `members.ts` with explicit transaction handling.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Indexed lookups and fast transactional updates with immediate rollback on error.

**Overall Unrounded Weighted Score**: **9.475 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
