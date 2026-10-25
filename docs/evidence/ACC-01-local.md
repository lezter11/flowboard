# ACC-01 — Sign in and session evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Backend. Status: **verified locally for ACC-01**.

## Scope and Files

- Session Store Adapter: `apps/api/src/adapters/session.ts`
  - `createSession(userId, ttlHours)`: Generates 256-bit cryptographically secure random session tokens (`crypto.randomBytes(32)`), stores them in PostgreSQL `sessions` with `expires_at`, and returns the session record.
  - `getSessionWithUser(sessionId)`: Joins `sessions` with `users`, asserts `expires_at > NOW()`, and returns `{ session, user }` (or `null` if expired/missing).
  - `revokeSession(sessionId)`: Deletes session records from PostgreSQL.
  - `createDevUserAndSession(email, displayName)`: Upserts user and issues an active session.
- Authentication Middleware: `apps/api/src/http/middleware/auth.ts`
  - `authMiddleware`: Extracts cookie `flowboard_session`, looks up active session with user, sets `c.set('actor', user)` and `c.set('sessionId', session.id)`. Throws HTTP 401 `UNAUTHORIZED` on missing or expired session.
  - `optionalAuthMiddleware`: Populates actor and sessionId if cookie is present, without failing unauthenticated requests.
- Routes: `apps/api/src/http/routes/session.ts`
  - `GET /api/v1/session`: Returns authenticated actor, owned workspaces, and accessible projects conforming to `getSessionResponseSchema`.
  - `POST /api/v1/session/logout`: Revokes session in DB, clears cookie with `Max-Age=0`, returns `{ data: { success: true } }`.
  - `POST /api/v1/session/dev-login`: Authenticates/creates user, issues session, and sets `Set-Cookie: flowboard_session=...; HttpOnly; SameSite=Lax; Path=/`.
- Automated Test Suite: `apps/api/test/acc01-session.test.ts` (5 tests passing).

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: 0 errors.

2. **Integration Test Suite**:
   ```sh
   WRANGLER_SEND_METRICS=false node --test apps/api/test/acc01-session.test.ts
   ```
   Result: **5 passed, 0 failed, 0 skipped** (~90ms).
   - Dev login creates user, session in DB, and sets cookie.
   - Valid cookie returns actor, owned workspaces, and accessible projects matching `@flowboard/contracts` schema.
   - Missing cookie returns 401 UNAUTHORIZED.
   - Expired session returns 401 UNAUTHORIZED.
   - Logout revokes DB session and clears cookie (`Max-Age=0`).

3. **Subagent Independent Audit**:
   - Evaluated by `Auth and RBAC Validation Auditor`:
     - 1. Session extraction & cookie validation: 2.5 / 2.5
     - 2. Database session store & expiry: 2.5 / 2.5
     - 3. Session query & 401 behavior: 2.5 / 2.5
     - 4. Logout session revocation: 2.5 / 2.5
   - Overall Audit Score: **10.0 / 10.0** (Threshold: >= 8.5 / 10.0). Status: Certified Pass.

## Limitations

- External OAuth providers (Google, GitHub) are reserved for later hosted deployment tasks; local tests exercise cookie-backed session storage and dev-login.
