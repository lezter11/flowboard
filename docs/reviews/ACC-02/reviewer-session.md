# Independent Review Session for ACC-02: Sign out and expired session

- **Reviewer Session ID**: `5b4e0975-7baf-4cac-99fe-0f396b9bb498`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T12:34:41.223095+00:00`
- **Feature ID**: `ACC-02`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Server-side session revocation: POST /api/v1/session/logout deletes session record from DB
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/adapters/session.ts:revokeSession. Tested in apps/api/test/acc-lifecycle.test.ts step ACC-02 asserting 204 No Content.

### Cookie clearing: Response returns Set-Cookie header with flowboard_session=; Max-Age=0
- **Assessment**: PASS
- **Evidence**: Verified in session.ts:getClearSessionCookieOptions. Tested in acc-lifecycle.test.ts asserting Set-Cookie clearing header.

### Immediate revocation effect: Requests with revoked session cookie return 401 UNAUTHORIZED
- **Assessment**: PASS
- **Evidence**: Verified in authMiddleware checking active DB session. Tested in acc-lifecycle.test.ts asserting 401 on subsequent requests.

### Expired session handling: Sessions past expires_at return 401 UNAUTHORIZED
- **Assessment**: PASS
- **Evidence**: Verified in session.ts:getSessionWithUser where expires_at > NOW() is required. Tested in acc-lifecycle.test.ts with expired session.

## System Design Teaching: Use server-side revocable session tokens stored in PostgreSQL rather than stateless JWTs.
- **Benefits**: Enables instantaneous session revocation upon user logout, account deletion, or administrative access termination.
- **Drawbacks**: Requires a fast indexed database lookup on authenticated requests.
- **Alternatives Considered**: Stateless JWT tokens (rejected: impossible to revoke immediately without maintaining a distributed blocklist).
