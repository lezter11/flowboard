# Independent Acceptance Review: INV-04 (Resend & Rotate Invitation Token)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-04/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/invitations.ts` (`resendInvitation`, `revokeInvitation`)
  - `apps/api/src/http/routes/invitations.ts` (`POST /projects/:projectId/invitations/:invitationId/resend`, `POST /projects/:projectId/invitations/:invitationId/revoke`)
  - `apps/api/test/inv04-inv08.test.ts`
- Test Output Evidence: `docs/reviews/INV-04/test.log`

## Security & Architectural Invariants Verified
1. **Delegation Bounds on Resend & Revoke**: Workspace owners can resend or revoke any invitation across the workspace. Project managers can only resend or revoke invitations for member and viewer roles. Any PM attempt to resend or revoke a manager invitation returns `403 FORBIDDEN`.
2. **Sibling Privacy & Outsider Protection**: Any non-member or outsider attempting to resend or revoke invitations receives `404 NOT_FOUND`.
3. **Cryptographic Token Rotation**: Resending an invitation generates a brand-new 32-byte cryptographic token (256-bit entropy), replaces the SHA-256 hash in `project_invitations`, refreshes `expires_at` to `NOW() + INTERVAL '7 days'`, resets status to `'pending'`, and emits a new outbox event for asynchronous email delivery.
4. **Immediate Invalidation of Previous Token**: Because `token_hash` is updated, the previous raw token immediately fails any acceptance attempt with `400 INVALID_INVITATION`.
5. **Clean Revocation State Machine**: Revoking an invitation sets `status = 'revoked'` under a `FOR UPDATE` lock. Revoked invitations cannot be accepted, resent, or revoked again (all return `400 INVALID_INVITATION`).
6. **Concurrent Race Protection**: Both `resendInvitation` and `revokeInvitation` acquire PostgreSQL `FOR UPDATE` row locks on the invitation row, cleanly serializing concurrent accept vs resend vs revoke requests so that at most one valid state transition succeeds.
7. **Idempotency Guarantee**: Both `/resend` and `/revoke` endpoints require `Idempotency-Key` and store receipts, ensuring network retries return identical responses without emitting duplicate side effects.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv04-inv08.test.ts`.
- All 33 test cases in `inv04-inv08.test.ts` passed cleanly (33 passed, 0 failed) on isolated synthetic PostgreSQL database.

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Owner vs PM authority limits enforced; manager invitations protected from PM manipulation; 404 for outsiders; cryptographic token rotation.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  Endpoints `/resend` and `/revoke` adhere to contracts, return proper HTTP status codes (200, 400, 403, 404) and response payloads.
- **Data integrity and concurrency**: 9.5 / 10.0 (Min 8.5)
  `FOR UPDATE` row lock on target invitation; atomic update of token_hash, status, and outbox event dispatch in a single transaction.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Thorough tests covering PM authority boundaries, invalidation of old tokens, rejection of revoked/accepted re-resends, and idempotency replays.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Code structure cleanly separates resend and revoke handlers with consistent validation and transaction management.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Efficient indexed queries by primary key with row locking; transactional outbox event ensures reliable notification dispatch.

**Overall Unrounded Weighted Score**: **9.475 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
