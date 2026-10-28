# Independent Review Session for ACC-05: Workspace preferences

- **Reviewer Session ID**: `5b4e0975-7baf-4cac-99fe-0f396b9bb498`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T12:34:41.231696+00:00`
- **Feature ID**: `ACC-05`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Owner-only authorization: Workspace owner can update name and timezone; non-owners receive 403 FORBIDDEN
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/http/routes/workspaces.ts checking current.owner_id === actor.id. Tested in acc-lifecycle.test.ts step ACC-05 with member receiving 403.

### OCC version protection: Updating requires expectedVersion; stale version returns 409 STALE_VERSION
- **Assessment**: PASS
- **Evidence**: Verified in routes/workspaces.ts comparing current.version to body.expectedVersion. Tested in acc-lifecycle.test.ts with stale version.

### Timezone validation: Accepts valid timezone strings (e.g. UTC, America/New_York)
- **Assessment**: PASS
- **Evidence**: Verified via updateWorkspaceInputSchema. Tested in acc-lifecycle.test.ts.

### Date-only deadline invariance: Date-only task deadlines remain fixed calendar dates regardless of workspace timezone change
- **Assessment**: PASS
- **Evidence**: Verified in cards adapter where due_date is stored as Gregorian DATE without timezone shifting.

## System Design Teaching: Store task due dates as Gregorian calendar dates (DATE) rather than UTC timestamps with timezone offsets.
- **Benefits**: A deadline set for 'October 31' remains October 31 for all team members globally regardless of individual or workspace timezone settings.
- **Drawbacks**: Overdue calculations require converting current instant to calendar date in the workspace's designated timezone.
- **Alternatives Considered**: Storing due date as UTC timestamp (rejected: causes deadline date to shift when viewed across different timezones).
