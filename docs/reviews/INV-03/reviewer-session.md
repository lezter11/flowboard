# Independent Acceptance Review: INV-03 (Accept Matching Invitation)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-03/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/invitations.ts` (`acceptInvitation`)
  - `apps/api/src/http/routes/invitations.ts` (`POST /invitations/accept`)
  - `apps/api/test/inv01-inv03.test.ts`
- Test Output Evidence: `docs/reviews/INV-03/test.log`

## Security & Architectural Invariants Verified
1. **Row-Level Locking Under Concurrency**: When `POST /api/v1/invitations/accept` is called, the raw token is hashed via SHA-256 and looked up with a PostgreSQL `FOR UPDATE` lock on `project_invitations`. This completely eliminates race conditions where two concurrent accept requests might attempt to consume the single-use token simultaneously.
2. **Email Identity Enforcement**: The authenticated session actor's email is strictly compared (case-insensitive) against the recipient email in the invitation record. If they do not match, the request immediately terminates with `403 EMAIL_MISMATCH`, preventing token theft, interception, or link forwarding attacks.
3. **Expiration Fencing**: If `expires_at <= NOW()`, the invitation row status is immediately transitioned to `'expired'` and rejected with `400 INVITATION_EXPIRED`.
4. **Single-Use Invariant**: Only invitations with status `'pending'` can be accepted. Already accepted, revoked, or expired tokens reject reuse with `400 INVALID_INVITATION`.
5. **R2 Audit Compliance (Deliberately Removed Access)**: If an active member was previously removed (`status = 'removed'`), the adapter checks the creation timestamp of the invitation against the removal timestamp of the membership (`invitation.created_at <= existingMember.updated_at`). Any stale invitation issued prior to removal is rejected with `400 INVITATION_SUPERSEDED`. Only a fresh invitation issued after removal can restore access.
6. **Atomic Membership Upsert**: When valid, the transaction atomically transitions the invitation status to `'accepted'` and performs an upsert into `project_memberships` setting `status = 'active'`, `role = invitation.role`, and incrementing `version`.
7. **Idempotency**: Requires `Idempotency-Key` and returns identical response upon replay without creating duplicate memberships or side effects.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv01-inv03.test.ts`.
- All tests passed with 0 failures on isolated synthetic PostgreSQL database.

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Strict email identity check prevents token forwarding; R2 superseded-token fence prevents re-entry after removal; row-level lock prevents double-spend.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  Adheres strictly to the `/api/v1/invitations/accept` contract; returns proper payload and handles all status codes (200, 400, 403).
- **Data integrity and concurrency**: 9.5 / 10.0 (Min 8.5)
  Explicit `FOR UPDATE` lock on `project_invitations` and `project_memberships`; single atomic transaction prevents partial updates.
- **Test quality and independent evidence**: 9.4 / 10.0 (Min 8.5)
  Covers email mismatch, expired tokens, already accepted tokens, R2 superseded tokens, and idempotency replay.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clear logical division between token validation, expiry checking, identity verification, and membership upsert.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Bounded query lookups with index on `token_hash`; fast row locking prevents pool starvation.

**Overall Unrounded Weighted Score**: **9.460 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
