# Independent Review Session for BRD-08: Archive and reopen board

- **Reviewer Session ID**: `6a12bd24-7baf-4cac-99fe-0f396b9bb499`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T13:17:19.361349+00:00`
- **Feature ID**: `BRD-08`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Owner and manager authorization: Workspace owner and project manager can archive and reopen board; members receive 403
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/http/routes/boards.ts checking role === 'owner' || role === 'manager'. Tested in lifecycle-undo.test.ts step BRD-08 with member receiving 403.

### Read-only context enforcement: Writes on archived boards are blocked with 409 READ_ONLY_CONTEXT
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/adapters/rbac.ts:acquireWritableProjectContextLock. Tested in lifecycle-undo.test.ts asserting 409 on card creation.

### Card retention: No cards or columns are deleted when a board is archived
- **Assessment**: PASS
- **Evidence**: Verified in lifecycle-undo.test.ts querying card details on archived board.

### Safe reopening: Reopening sets archived = FALSE and immediately resumes write operations
- **Assessment**: PASS
- **Evidence**: Verified in routes/boards.ts reopen handler. Tested in lifecycle-undo.test.ts asserting successful card creation after reopen.

## System Design Teaching: Support board-level archiving independently of project archiving.
- **Benefits**: Enables teams to retire completed sprints or seasonal boards without archiving the entire project or losing historic sprint data.
- **Drawbacks**: Requires checking both project.archived and board.archived in the writable context lock.
- **Alternatives Considered**: Only permitting project-level archiving (rejected: forces teams to either keep cluttered old boards active or delete them).
