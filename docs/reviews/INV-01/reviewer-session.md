# Independent Acceptance Review: INV-01 (Project Invitations Creation)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-01/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/invitations.ts` (`createInvitation`)
  - `apps/api/src/http/routes/invitations.ts` (`POST /projects/:projectId/invitations`)
  - `apps/api/test/inv01-inv03.test.ts`
- Test Output Evidence: `docs/reviews/INV-01/test.log`

## Security & Architectural Invariants Verified
1. **Workspace Owner Authority**: Workspace owners have full project delegation authority across their workspace. They can invite managers, members, and viewers to any project in the workspace via `POST /api/v1/projects/:projectId/invitations`.
2. **Project Manager Boundary Limits**: Project managers have bounded delegation authority: they can invite members and viewers, but any attempt to invite a manager is strictly rejected with `403 FORBIDDEN` ('Only workspace owners can invite managers.').
3. **Role Boundary Enforcement**: Regular members and viewers attempting to issue project invitations are rejected with `403 FORBIDDEN`. Outsiders or users without access to the project receive `404 NOT_FOUND`, preventing project existence disclosure.
4. **Cryptographic Token Hashing & Secret Protection**: Invitations generate a 32-byte cryptographically secure random token (`crypto.randomBytes(32).toString('hex')` providing 256 bits of entropy). The database schema only ever stores the SHA-256 hash (`token_hash`) in `project_invitations`. The raw token is returned once in the HTTP response and is never persisted in plaintext, never logged, and never included in outbox event payloads.
5. **Transactional Outbox Creation**: Every invitation atomically writes an outbox record (`invitation.created`) in the same PostgreSQL transaction, guaranteeing at-least-once asynchronous email delivery without risking inconsistent state if process crashes.
6. **Membership & Self-Invite Fencing**: The adapter queries existing workspace owners, active `project_memberships`, and existing pending invitations. Rejects self-invites and active members with `400 ALREADY_MEMBER`, and duplicate unexpired pending invitations with `400 INVITATION_ALREADY_EXISTS`.
7. **Idempotency Protection**: Enforces `Idempotency-Key` header with transactional receipt storage and replay verification.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv01-inv03.test.ts`.
- All 11 tests in `inv01-inv03.test.ts` passed cleanly (11 passed, 0 failed) on isolated synthetic PostgreSQL database.

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Strict privilege checks for Owner vs PM, 404 on outsiders, 256-bit crypto token hashing with SHA-256, no secrets in logs or outbox payload.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  Full adherence to API contracts, input validation with `@flowboard/contracts`, proper 201 response envelope and standard error envelopes.
- **Data integrity and concurrency**: 9.4 / 10.0 (Min 8.5)
  Single atomic PostgreSQL transaction for invitation insertion, outbox event creation, and idempotency receipt persistence.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Comprehensive test suite verifying owner invites, PM limits, negative authorization paths, duplicate rejections, and outbox event verification.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clean separation between HTTP routing and database adapter logic; clear typing and explicit parameterized SQL queries.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Transactional outbox enables asynchronous email delivery; idempotency prevents duplicated emails on client retry.

**Overall Unrounded Weighted Score**: **9.455 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
