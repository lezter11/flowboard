# ACC-04 — Create workspace and owner evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for ACC-04**.

## Scope and Files

- Idempotency Adapter: `apps/api/src/adapters/idempotency.ts`
  - Canonical JSON serializer (`canonicalJson`) sorting object keys and preserving array order.
  - `checkOrReplayReceipt` and `saveReceipt` calculating SHA-256 digests of method path and request body, checking `idempotency_receipts` inside active transactions, replaying cached responses (`replayed: true`), and rejecting mismatched payloads with 409 `IDEMPOTENCY_CONFLICT`.
- Routes: `apps/api/src/http/routes/workspaces.ts`
  - `POST /api/v1/workspaces`: Requires authenticated session, validates `Idempotency-Key` header, validates body via `createWorkspaceInputSchema`, executes transactional check-or-replay, inserts workspace with `owner_id = actor.id`, and saves receipt.
  - `GET /api/v1/workspaces`: Lists owned workspaces and workspaces containing granted projects.
- Automated Test Suite: `apps/api/test/acc04-workspaces.test.ts` (7 tests passing).

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/acc04-workspaces.test.ts
   ```
   Result: **7 passed, 0 failed, 0 skipped** (~105ms).
   - Unauthenticated request returns 401.
   - Missing or short idempotency key returns 400 `IDEMPOTENCY_KEY_REQUIRED`.
   - Empty name or invalid timezone returns 422 `VALIDATION_ERROR`.
   - Atomic creation sets `owner_id = actor.id` and returns 201 `{ replayed: false }`.
   - Identical idempotency key replay returns 201 `{ replayed: true }` and does not insert extra rows.
   - Replay with altered body returns 409 `IDEMPOTENCY_CONFLICT`.
   - Listing workspaces returns owned workspace.

3. **Subagent Independent Audit**:
   - Evaluated by `Workspace and Project Validation Auditor`:
     - 1. Atomic creation with owner_id = actor.id: 2.5 / 2.5
     - 2. Single owner enforcement & validated timezone/name: 2.5 / 2.5
     - 3. Idempotency-Key support & duplicate protection: 2.5 / 2.5
     - 4. Automated verification tests: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- Receipts retain response bodies with a 7-day TTL; background cleanup jobs for expired receipts will run in scheduled worker tasks.
