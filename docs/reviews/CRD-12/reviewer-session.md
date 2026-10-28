# Independent Review Session for CRD-12: Move undo

- **Reviewer Session ID**: `6a12bd24-7baf-4cac-99fe-0f396b9bb499`
- **Builder Session ID**: `2630ea55-89d4-4c26-bc1e-b56f5555b3c5`
- **Review Date**: `2026-10-26T13:17:19.365628+00:00`
- **Feature ID**: `CRD-12`
- **Score**: `9.610 / 10.0`
- **Verdict**: `pass`

## Criteria Assessment

### Authorized versioned move: Undo executes a new move back to the previous column with position rank recalculation
- **Assessment**: PASS
- **Evidence**: Verified in apps/api/src/http/routes/cards.ts:move-undo calling moveCard. Tested in lifecycle-undo.test.ts step CRD-12.

### Activity log provenance: Prior destination is accurately derived from latest card_moved activity fact
- **Assessment**: PASS
- **Evidence**: Verified in routes/cards.ts querying activity_log where action = 'card_moved'.

### OCC conflict prevention: If card was modified in the interim, undo fails with 409 STALE_VERSION
- **Assessment**: PASS
- **Evidence**: Verified in routes/cards.ts comparing card.version to input.expectedVersion. Tested in lifecycle-undo.test.ts asserting 409 on stale undo.

### Single execution and idempotency: Undo succeeds once, increments card version, and retries return replayed: true
- **Assessment**: PASS
- **Evidence**: Verified in saveReceipt and checkOrReplayProjectWriteReceipt. Tested in lifecycle-undo.test.ts asserting replayed: true.

## System Design Teaching: Treat Move Undo as a new forward mutation with OCC checking rather than a database rollback or time-travel state restore.
- **Benefits**: Preserves audit history, updates timestamps and version numbers forward, and mathematically prevents overwriting intervening edits made by other collaborators.
- **Drawbacks**: Undo increases the version counter rather than restoring the previous version number.
- **Alternatives Considered**: Reverting card state to prior snapshot (rejected: overwrites concurrent field edits or comments added in the interim).
