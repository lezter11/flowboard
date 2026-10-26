# INV-05 — Pending invitations list evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-05**.

## Scope and Implementation

- Route & Adapter: `apps/api/src/http/routes/invitations.ts` and `apps/api/src/adapters/invitations.ts` (`listInvitations`)
  - **List Project Invitations** (`GET /api/v1/projects/:projectId/invitations`):
    - Protected by `authMiddleware`.
    - Authority enforcement:
      - Workspace Owner and Project Manager can view all invitations for this project.
      - Members and viewers receive `403 FORBIDDEN` (`Only workspace owners and project managers can view project invitations.`).
      - Outsiders receive `404 NOT_FOUND` to protect project existence and boundaries.
    - Security & Token Secrecy:
      - `token_hash` is never selected from the database and never exposed in the response payload.
      - Output schema strictly conforms to `invitationListResponseSchema`.
    - Dynamic Expiry Mapping:
      - Invitations with `status = 'pending'` whose `expires_at <= NOW()` are dynamically returned with `status = 'expired'`.
      - Provides accurate, real-time lifecycle status to clients without requiring a preceding background reconciliation cron.
    - Fields returned per item:
      - `id`, `projectId`, `email`, `role`, `status`, `expiresAt`, `createdAt`, `updatedAt`, `invitedBy`.
    - Envelope:
      - Returns `200 { data: Invitation[], nextCursor: null }`.

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
   - INV-05: Workspace owner lists invitations -> succeeds, matches schema, token_hash omitted.
   - INV-05: Project Manager can list invitations -> succeeds.
   - INV-05: Member / Viewer cannot list invitations -> 403 FORBIDDEN.
   - INV-05: Outsider attempting to list invitations -> 404 NOT_FOUND.
   - INV-05: Past-due pending invitations are accurately returned with status 'expired'.

## Limitations

- Cursor-based deep pagination will be extended when large enterprise invitation volumes demand cursor offsets.
