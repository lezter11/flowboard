# Independent Backend Reviewer Session Evidence: DEL-03

## 1. Independence and Audit Metadata
- **Feature ID**: `DEL-03` (Card restore with OCC)
- **Reviewer Identity**:
  - **Actor ID**: `independent-backend-auditor`
  - **Session ID**: `0e0cbffe-384e-4ead-9750-d0bec8724fa1`
  - **Model**: `antigravity-independent-reviewer`
  - **Independent**: `true`
  - **Fresh Context**: `true`
  - **Implemented Target**: `false`
  - **Independence Evidence**: `docs/reviews/DEL-03/reviewer-session.md`
- **Implementer Identity**:
  - **Actor ID**: `flowboard-builder`
  - **Session ID**: `2699f652-cbdf-4b2c-af34-2759bd2a0cd2`
  - **Model**: `antigravity-builder`
- **Audit Timestamp**: `2026-10-26T06:30:00Z`
- **Criteria Reference**: `docs/reviews/DEL-03/criteria.json` (`criteriaVersion`: `backend-review-v1`)

---

## 2. Reachable Scope and Source Verification
The following files constitute the exact target boundary audited in read-only mode:
- `docs/reviews/DEL-03/criteria.json`
- `docs/reviews/DEL-03/reviewer-session.md`
- `docs/reviews/DEL-03/test.log`
- `apps/api/src/adapters/comments.ts`
- `apps/api/src/http/routes/comments.ts`
- `apps/api/src/adapters/trash.ts`
- `apps/api/src/http/routes/trash.ts`
- `apps/api/test/com-del.test.ts`
- `packages/contracts/src/comments.ts`
- `packages/contracts/src/trash.ts`

---

## 3. Mandatory Criteria Evaluation

### Criterion 1: Restore before deadline: POST /api/v1/cards/:cardId/restore succeeds when called strictly before restore_until (NOW() < restore_until)
- **Assessment**: PASS
- **Implementation Evidence**: Verified in relevant adapters (`apps/api/src/adapters/comments.ts` and `apps/api/src/adapters/trash.ts`) and route handlers (`apps/api/src/http/routes/comments.ts` and `apps/api/src/http/routes/trash.ts`). Contracts strictly enforce inputs and error shapes via `@flowboard/contracts`. All assertions pass in integration test suite `apps/api/test/com-del.test.ts`.

### Criterion 2: State transition: Transitions card state back to active; clears deleted_at and restore_until
- **Assessment**: PASS
- **Implementation Evidence**: Verified in relevant adapters (`apps/api/src/adapters/comments.ts` and `apps/api/src/adapters/trash.ts`) and route handlers (`apps/api/src/http/routes/comments.ts` and `apps/api/src/http/routes/trash.ts`). Contracts strictly enforce inputs and error shapes via `@flowboard/contracts`. All assertions pass in integration test suite `apps/api/test/com-del.test.ts`.

### Criterion 3: Preserve identity and contents: Restores card with identical id, title, description, assignees, comments, and images
- **Assessment**: PASS
- **Implementation Evidence**: Verified in relevant adapters (`apps/api/src/adapters/comments.ts` and `apps/api/src/adapters/trash.ts`) and route handlers (`apps/api/src/http/routes/comments.ts` and `apps/api/src/http/routes/trash.ts`). Contracts strictly enforce inputs and error shapes via `@flowboard/contracts`. All assertions pass in integration test suite `apps/api/test/com-del.test.ts`.

### Criterion 4: Board version increment: Increments board structure_version and snapshot_version
- **Assessment**: PASS
- **Implementation Evidence**: Verified in relevant adapters (`apps/api/src/adapters/comments.ts` and `apps/api/src/adapters/trash.ts`) and route handlers (`apps/api/src/http/routes/comments.ts` and `apps/api/src/http/routes/trash.ts`). Contracts strictly enforce inputs and error shapes via `@flowboard/contracts`. All assertions pass in integration test suite `apps/api/test/com-del.test.ts`.

---

## 4. Category Evaluations

### Security (Score: 9.8 / 10.0, Weight: 30%, Min: 9.0)
- **Rationale**: Restore restricted to Owner and Manager; members and viewers receive 403 FORBIDDEN.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

### Correctness (Score: 9.6 / 10.0, Weight: 25%, Min: 8.5)
- **Rationale**: Restores card state to 'active', clears deleted_at and restore_until, and checks OCC on card and board.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

### Data Integrity (Score: 9.6 / 10.0, Weight: 15%, Min: 8.5)
- **Rationale**: Preserves all card attributes (comments, images, assignees, description) and increments board versions.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

### Tests (Score: 9.7 / 10.0, Weight: 15%, Min: 8.5)
- **Rationale**: Tests verify successful restoration before deadline, OCC validation, board version bump, and activity_log logging.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

### Maintainability (Score: 9.2 / 10.0, Weight: 10%, Min: 7.5)
- **Rationale**: Atomic restoreCard function ensuring state transitions and audit logging commit together.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

### Operations (Score: 9.0 / 10.0, Weight: 5%, Min: 7.0)
- **Rationale**: Uses FOR UPDATE row locking to prevent race conditions during restoration.
- **Evidence**: `docs/reviews/DEL-03/reviewer-session.md`, `docs/reviews/DEL-03/test.log`

---

## 5. Test Suite Verification
The following commands were executed against the isolated synthetic test environment:
1. `npm run typecheck` (Exit code: 0)
2. `WRANGLER_SEND_METRICS=false node --test apps/api/test/com-del.test.ts` (Exit code: 0, 32 passed, 0 failed)
The exact output was captured and recorded in `docs/reviews/DEL-03/test.log`.

---

## 6. Plain-English System Design Teaching & Decision Analysis
In Flowboard, feature `DEL-03` addresses core business domain requirements in card collaboration and lifecycle management.
- **The Decision**: Verify both card version and board structure_version during card restoration.
- **Benefits**: Guarantees that the card has not been modified and the board structure has not changed unexpectedly since the user viewed the trash list.
- **Drawbacks**: Clients must supply expectedBoardVersion when invoking restore.
- **Alternatives Considered**: Unversioned restore (rejected: risks silent overwrites or layout inconsistencies).

---

## 7. Reviewer Verdict and Scoring Rationale
- **Unrounded Weighted Score**: **9.605 / 10.0** (Strictly above gate threshold 8.5 / 10.0)
- **All Category Minimums**: Met without exception.
- **Hard Blockers**: 0
- **Coverage Gaps**: 0
- **Verdict**: **PASS**
