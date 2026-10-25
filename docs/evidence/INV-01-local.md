# INV-01 — Project invitation evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-01**.

## Scope and Implementation

- Adapter: `apps/api/src/adapters/invitations.ts` (`createInvitation`)
  - Email normalization: Trims and downcases incoming email address.
  - Role check & hierarchy enforcement:
    - Resolves actor's role in the target project.
    - Workspace owner can invite `manager`, `member`, or `viewer`.
    - Project manager can invite `member` or `viewer` only.
    - Attempts by a project manager to invite a `manager` are rejected with `403 FORBIDDEN` (`Only workspace owners can invite managers.`).
    - Members, viewers, or outsiders attempting to invite are rejected with `403 FORBIDDEN` (or `404 NOT_FOUND` for outsiders to preserve project existence privacy).
  - Cryptographic token generation:
    - Generates 32-byte cryptographically secure random token (`crypto.randomBytes(32).toString('hex')`).
    - Computes SHA-256 hash (`crypto.createHash('sha256').update(token).digest('hex')`) for persistence in database table `project_invitations.token_hash`.
  - Expiry:
    - Automatically sets `expires_at = NOW() + INTERVAL '7 days'`.
  - Transactional side effects:
    - Inserts invitation into `project_invitations` with `status = 'pending'`.
    - Inserts asynchronous delivery event into `outbox` table with `event_type = 'invitation.created'` and `{ invitationId, email, role, projectId, workspaceId }` payload.
    - Persists transactional idempotency receipt in `idempotency_receipts`.
- Route: `apps/api/src/http/routes/invitations.ts` (`POST /api/v1/projects/:projectId/invitations`)
  - Protected by `authMiddleware`.
  - Validates `Idempotency-Key` header via `idempotencyKeySchema`.
  - Validates payload via `createInvitationInputSchema`.
  - Checks idempotency receipt replay; returns `201 { data, replayed: true }` on duplicate identical requests, or `409 IDEMPOTENCY_CONFLICT` on mismatched payloads.
  - Returns `201 { data: { id, email, role, status, expiresAt, token }, replayed: false }`.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/inv01-inv03.test.ts
   ```
   Result: **8 passed, 0 failed, 0 skipped**.
   - Test 1: Workspace owner invites a manager -> succeeds, token_hash stored in DB, outbox record created.
   - Test 2: Project manager invites a member -> succeeds.
   - Test 3: Project manager attempts to invite another manager -> returns 403 FORBIDDEN (`Only workspace owners can invite managers.`).
   - Test 4: Member/viewer attempts to invite someone -> returns 403 FORBIDDEN; outsider returns 404 NOT_FOUND.
   - Test 8: Idempotency replay returns `replayed: true` without duplicate invitation/outbox entries; idempotency conflict returns 409 `IDEMPOTENCY_CONFLICT`.

## Limitations

- Physical email delivery worker consumes `outbox` records in INV-02.
