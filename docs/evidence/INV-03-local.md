# INV-03 — Accept matching invitation evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-03**.

## Scope and Implementation

- Adapter: `apps/api/src/adapters/invitations.ts` (`acceptInvitation`)
  - Cryptographic hash lookup:
    - Computes SHA-256 of incoming rawToken string.
    - Queries `project_invitations` table by `token_hash = $1` with `FOR UPDATE` lock.
  - State and expiry checks:
    - If no invitation found or `status !== 'pending'`, throws `400 INVALID_INVITATION`.
    - If `expires_at <= NOW()`, marks invitation `status = 'expired'`, commits transition, and throws `400 INVITATION_EXPIRED`.
  - Email verification:
    - Verifies `invitation.email.toLowerCase() === actor.email.toLowerCase()`.
    - If emails do not match, throws `403 EMAIL_MISMATCH` and creates no membership.
  - Transactional state transition and membership upsert:
    - Updates invitation `status = 'accepted', updated_at = NOW()`.
    - Upserts into `project_memberships`:
      ```sql
      INSERT INTO project_memberships (
        id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'active', 1, NOW(), NOW()
      )
      ON CONFLICT (project_id, user_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        status = 'active',
        version = project_memberships.version + 1,
        updated_at = NOW()
      RETURNING id
      ```
    - Returns `{ success: true, projectId, workspaceId, role, membershipId }`.
- Route: `apps/api/src/http/routes/invitations.ts` (`POST /api/v1/invitations/accept`)
  - Protected by `authMiddleware`.
  - Validates payload via `acceptInvitationInputSchema`.
  - Executes `acceptInvitation` inside transactional boundary.
  - Returns status `200 { data: { success: true, projectId, workspaceId, role } }`.

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
   - Test 5: Accept matching invitation -> updates status to accepted, upserts `project_memberships` row; user gains immediate project access on `GET /api/v1/projects/:projectId` and in `/api/v1/session`.
   - Test 6: Accept with mismatched email (signed in as another user) -> returns 403 `EMAIL_MISMATCH`, no membership created, invitation remains pending.
   - Test 7: Single-use token enforcement & expiry:
     - Accepting already accepted token returns 400 `INVALID_INVITATION`.
     - Accepting expired token returns 400 `INVITATION_EXPIRED` and marks DB status `expired`.
     - Non-existent token returns 400 `INVALID_INVITATION`.
