# INV-04 — Resend and revoke invitation evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-04**.

## Scope and Implementation

- Route & Adapter: `apps/api/src/http/routes/invitations.ts` and `apps/api/src/adapters/invitations.ts` (`resendInvitation` & `revokeInvitation`)
  - **Resend Invitation** (`POST /api/v1/projects/:projectId/invitations/:invitationId/resend`):
    - Requires `Idempotency-Key` header validated via `idempotencyKeySchema`.
    - Authority enforcement:
      - Workspace Owner can resend invitations for any role (`manager`, `member`, `viewer`).
      - Project Manager can resend invitations for `member` and `viewer` roles only. Attempts to resend a `manager` invitation are rejected with `403 FORBIDDEN` (`Only workspace owners can resend invitations for managers.`).
      - Project members and viewers receive `403 FORBIDDEN`.
      - Outsiders receive `404 NOT_FOUND` to preserve project privacy.
    - Target status verification:
      - Only `pending` or `expired` invitations can be resent.
      - Already `accepted` invitations return `400 INVALID_INVITATION` (`Cannot resend an invitation that has already been accepted.`).
      - Already `revoked` invitations return `400 INVALID_INVITATION` (`Cannot resend an invitation that has been revoked.`).
    - Cryptographic Token Rotation:
      - Generates fresh 32-byte cryptographically secure random token (`crypto.randomBytes(32).toString('hex')`).
      - Computes SHA-256 hash (`crypto.createHash('sha256').update(newRawToken).digest('hex')`) and updates `token_hash`.
      - Resets `expires_at = NOW() + INTERVAL '7 days'`, `status = 'pending'`, and `updated_at = NOW()`.
      - The prior token immediately ceases to function (attempting to accept it returns `400 INVALID_INVITATION`).
    - Outbox event:
      - Emits a fresh `invitation.created` transactional record into the `outbox` table with the rotated invitation ID and metadata.
    - Idempotency:
      - Duplicate requests with identical keys replay cached responses with `replayed: true`.
    - Response:
      - Returns `200 { data: { id, email, role, status, expiresAt, token: newRawToken }, replayed: false }`.

  - **Revoke Invitation** (`POST /api/v1/projects/:projectId/invitations/:invitationId/revoke`):
    - Requires `Idempotency-Key` header validated via `idempotencyKeySchema`.
    - Authority enforcement:
      - Workspace Owner can revoke invitations for any role.
      - Project Manager can revoke member and viewer invitations only (rejects manager invitations with `403 FORBIDDEN`).
      - Members and viewers receive `403 FORBIDDEN`; outsiders receive `404 NOT_FOUND`.
    - Target status verification:
      - Target invitation must be `pending`. If already `accepted` or `revoked`, returns `400 INVALID_INVITATION`.
    - State transition:
      - Updates `status = 'revoked'`, `updated_at = NOW()`.
      - Revoked invitation token can no longer be accepted (returns `400 INVALID_INVITATION`).
    - Response:
      - Returns `200 { data: { success: true, id, status: 'revoked' }, replayed: false }`.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/inv04-inv08.test.ts
   ```
   Result: **25 passed, 0 failed, 0 skipped**.
   - INV-04: PM cannot resend manager invitation -> 403 FORBIDDEN.
   - INV-04: Member / Viewer / Outsider cannot resend invitation -> 403 / 404.
   - INV-04: Owner resends manager invitation -> succeeds, rotates token, outbox event emitted.
   - INV-04: Old rotated token cannot be accepted (400 INVALID_INVITATION).
   - INV-04: Idempotency replay on resend returns identical token and replayed=true.
   - INV-04: PM resends member invitation -> succeeds.
   - INV-04: PM cannot revoke manager invitation -> 403 FORBIDDEN.
   - INV-04: PM revokes member invitation -> succeeds.
   - INV-04: Revoked invitation token cannot be accepted -> 400 INVALID_INVITATION.
   - INV-04: Revoked invitation cannot be revoked again or resent -> 400 INVALID_INVITATION.
   - INV-04: Newly rotated token can be accepted; accepted invite cannot be resent -> 400.

## Limitations

- Physical email delivery worker consumes the new outbox records in INV-02.
