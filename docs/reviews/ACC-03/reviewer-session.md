# Independent Review Session for ACC-03: Profile and historical identity

- **Reviewer Session ID**: `5b4e0975-7baf-4cac-99fe-0f396b9bb498`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T12:34:41.227842+00:00`
- **Feature ID**: `ACC-03`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Profile update endpoint: PATCH /api/v1/session/profile updates displayName and avatarUrl
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/adapters/session.ts:updateUserProfile and routes/session.ts. Tested in acc-lifecycle.test.ts step ACC-03.

### Input validation: Rejects empty strings and enforces URL format on avatarUrl
- **Assessment**: PASS
- **Evidence**: Verified via Zod schema validation in session.ts. Tested in acc-lifecycle.test.ts.

### Historical attribution persistence: Prior activity and comments retain actor attribution after membership is removed
- **Assessment**: PASS
- **Evidence**: Verified in getHistoricalPersonDisplay joining users table independently of project membership status.

### Account privacy: PersonDisplay projection strictly excludes email, password_hash, or secret account fields
- **Assessment**: PASS
- **Evidence**: Verified in PersonDisplay schema only permitting id, displayName, and avatarUrl.

## System Design Teaching: Decouple user identity display (PersonDisplay) from active project membership status.
- **Benefits**: Ensures audit logs, discussions, and card histories remain comprehensible even when employees or contractors leave the project.
- **Drawbacks**: Requires looking up user profile records separately from project membership rows.
- **Alternatives Considered**: Cascading user deletion (rejected: corrupts audit logs and creates orphan attribution).
