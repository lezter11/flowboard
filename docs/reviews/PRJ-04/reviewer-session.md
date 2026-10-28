# Independent Review Session for PRJ-04: Archive and reopen project

- **Reviewer Session ID**: `6a12bd24-7baf-4cac-99fe-0f396b9bb499`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T13:17:19.356848+00:00`
- **Feature ID**: `PRJ-04`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Owner-only authorization: Workspace owner can archive and reopen; non-owners receive 403 FORBIDDEN
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/http/routes/projects.ts checking role === 'owner'. Tested in apps/api/test/lifecycle-undo.test.ts step PRJ-04 with manager receiving 403.

### Read-only context enforcement: Writes in archived projects are blocked with 409 READ_ONLY_CONTEXT
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/adapters/rbac.ts:acquireWritableProjectContextLock. Tested in lifecycle-undo.test.ts asserting 409 on write.

### Data and history preservation: Project, boards, columns, and cards remain queryable via GET
- **Assessment**: PASS
- **Evidence**: Verified in lifecycle-undo.test.ts querying project and card detail during archived state.

### Safe reopening: Reopening sets archived = FALSE and immediately resumes write operations
- **Assessment**: PASS
- **Evidence**: Verified in routes/projects.ts reopen handler. Tested in lifecycle-undo.test.ts asserting successful card creation after reopen.

## System Design Teaching: Enforce project read-only status at the database transaction lock boundary (acquireWritableProjectContextLock) rather than scattered route-level checks.
- **Benefits**: Guarantees that no mutation route (cards, columns, boards, imports, comments, images) can bypass the archived check, even under high concurrency or race conditions.
- **Drawbacks**: Requires acquiring a FOR SHARE lock on project and board rows during write transactions.
- **Alternatives Considered**: Checking archived status in HTTP middleware before starting the transaction (rejected: vulnerable to time-of-check to time-of-use race conditions).
