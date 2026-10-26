# Independent Acceptance Review: INV-05 (List Project Invitations)

## Reviewer Identification & Independence Declaration
- **Reviewer Actor ID**: `independent-auditor-inv`
- **Reviewer Session ID**: `5664ffe4-311c-4302-85fd-63d6eac1ff11`
- **Reviewer Model**: `gemini-2.5-pro`
- **Builder Actor ID**: `backend-builder`
- **Builder Session ID**: `7e44e3cf-29d2-4f7d-ba58-a053cdb570fc`
- **Independence & Fresh Context**: The reviewer is an independent validation auditor running in a distinct subagent session, who did not implement any part of the target code. The audit was conducted strictly read-only against the target workspace.

## Audit Scope
- Target Criteria: `docs/reviews/INV-05/criteria.json`
- Reachable Source Code:
  - `apps/api/src/adapters/invitations.ts` (`listInvitations`)
  - `apps/api/src/http/routes/invitations.ts` (`GET /projects/:projectId/invitations`)
  - `apps/api/test/inv04-inv08.test.ts`
- Test Output Evidence: `docs/reviews/INV-05/test.log`

## Security & Architectural Invariants Verified
1. **Access Authorization Bounds**: Only Workspace Owners and Project Managers can view the list of invitations for a given project via `GET /api/v1/projects/:projectId/invitations`. Members and viewers are denied access with `403 FORBIDDEN`. Outsiders or sibling project members receive `404 NOT_FOUND`, keeping project membership rosters and existence private.
2. **Absolute Secret Redaction (Zero Token Leaks)**: The database query explicitly selects only non-sensitive columns (`id, project_id, email, role, invited_by, status, expires_at, created_at, updated_at`). The column `token_hash` is never selected from PostgreSQL. The returned objects conform strictly to `invitationSchema` with `token` and `token_hash` omitted, guaranteeing that secrets are never leaked to clients or browser devtools.
3. **Dynamic Expiration Status Mapping**: When querying invitations, any record that has `status = 'pending'` but where `expires_at <= NOW()` is dynamically mapped to `status = 'expired'` in the response payload. This gives users immediate and accurate feedback on whether an invitation can still be accepted or requires a resend.
4. **Ordering & Determinism**: Invitations are returned sorted deterministically by `ORDER BY created_at DESC, id DESC`.

## Test Verification
- Ran `npm run typecheck` and `WRANGLER_SEND_METRICS=false node --test apps/api/test/inv04-inv08.test.ts`.
- All tests for INV-05 passed cleanly (including schema validation, omission of token_hash, dynamic expired status verification, and negative authorization tests).

## Category Ratings & Rationale
- **Security and authority boundaries**: 9.6 / 10.0 (Min 9.0)
  Strict privilege checks; members/viewers get 403; outsiders get 404; token_hash is excluded at the database SELECT level.
- **Functional and API correctness**: 9.5 / 10.0 (Min 8.5)
  Returns standard `{ data: [...], nextCursor: null }` response matching `invitationListResponseSchema`; dynamic expiration mapping operates correctly.
- **Data integrity and concurrency**: 9.3 / 10.0 (Min 8.5)
  Read-only query executing with snapshot isolation against PostgreSQL.
- **Test quality and independent evidence**: 9.5 / 10.0 (Min 8.5)
  Dedicated tests verify schema compliance, absence of secret fields, expired date mapping, and negative permission barriers.
- **Maintainability and portability**: 9.2 / 10.0 (Min 7.5)
  Clean, straightforward adapter function with typed return values and contract schema parsing.
- **Operations, performance and failure recovery**: 9.0 / 10.0 (Min 7.0)
  Indexed query on `project_id` ensures efficient retrieval with minimal resource usage.

**Overall Unrounded Weighted Score**: **9.445 / 10.0** (> 8.5 threshold satisfied).
**Verdict**: **PASS**. No hard blockers. No coverage gaps.
