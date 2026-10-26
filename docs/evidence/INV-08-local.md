# INV-08 — Leave a project evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for INV-08**.

## Scope and Implementation

- Route & Adapter: `apps/api/src/http/routes/invitations.ts` and `apps/api/src/adapters/invitations.ts` (`leaveProject`)
  - **Leave Project** (`POST /api/v1/projects/:projectId/leave`):
    - Protected by `authMiddleware`.
    - Requires `Idempotency-Key` header validated via `idempotencyKeySchema`.
    - Authority enforcement:
      - Any active project member (`manager`, `member`, `viewer`) can leave the project.
      - Workspace Owner **CANNOT** leave their own project/workspace (`403 FORBIDDEN`: `Workspace owners cannot leave their project. Transfer workspace ownership instead.`).
      - Outsiders and already-removed members receive `404 NOT_FOUND` (`Project not found or not an active member.`).
    - State transition & Versioning:
      - Atomically updates `project_memberships.status = 'removed'`, increments `version = version + 1`, and updates `updated_at = NOW()`.
      - Immediate access revocation: subsequent requests to `GET /api/v1/projects/:projectId` return `404 NOT_FOUND`.
    - Historical Integrity Preserved:
      - Preserves user identity foreign keys: historical activity log entries (`activity_log`), card assignees (`card_assignees`), and comment authors (`comments`) remain intact and attributed to the user without breaking audit trails or cascading deletions.
    - Idempotency:
      - Replays with identical `Idempotency-Key` return cached `200 { data: { success: true }, replayed: true }`.
    - Response:
      - Returns `200 { data: { success: true }, replayed: false }`.

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
   - INV-08: Workspace owner cannot leave their own project -> 403 FORBIDDEN.
   - INV-08: Outsider attempting to leave project -> 404 NOT_FOUND.
   - INV-08: Charlie (Member) leaves project -> status="removed", version incremented.
   - INV-08: Charlie subsequent access to project returns 404 NOT_FOUND.
   - INV-08: Charlie leave request idempotency replay returns 200 replayed=true.
   - INV-08: Dave (Viewer) leaves project -> succeeds.
   - INV-08: Bob (Manager) leaves project -> succeeds.

## Limitations

- Ownership transfer flow is scoped to ACC-05 / S6.
