# Independent Review Session for UX-04: Refresh reconnect and safe polling

- **Reviewer Session ID**: `7b23cd45-8cbf-4cac-99fe-0f396b9bb500`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T13:22:27.530951+00:00`
- **Feature ID**: `UX-04`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Versioned snapshot exposure: Board snapshot returns structureVersion and snapshotVersion
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/adapters/boards.ts:getBoardSnapshot. Tested in apps/api/test/ux-integration.test.ts step UX-04.

### Stale overwrite prevention: Outdated tab write is rejected with 409 STALE_VERSION without corrupting newer server data
- **Assessment**: PASS
- **Evidence**: Verified in updateCard, moveCard, and deleteCard OCC checks. Tested in ux-integration.test.ts step UX-04.

### Cursor-based safe polling: Keyset cursors ensure reconnecting tabs paginate without missed or duplicate entries
- **Assessment**: PASS
- **Evidence**: Verified in listBoardCards and listCardComments.

### Safe version reconciliation: Clients can re-fetch snapshot to reconcile state upon reconnecting
- **Assessment**: PASS
- **Evidence**: Verified in ux-integration.test.ts re-fetching board snapshot after conflict.

## System Design Teaching: Combine board structure versions (structureVersion) with individual entity versions (card.version).
- **Benefits**: Separates layout-altering structural changes (column additions/deletions) from card field edits, preventing unnecessary board re-renders during simple text updates.
- **Drawbacks**: Mutations that move cards between columns must validate both the card version and the board structure version.
- **Alternatives Considered**: A single monolithic workspace version (rejected: any edit anywhere invalidates all active tabs).
