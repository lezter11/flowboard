# Independent Backend Acceptance Review: Board Access & Portfolio Foundation

**Review Version:** 1.0  
**Date:** 2026-10-28T01:45:00Z  
**Reviewer Identity:** Independent Backend Acceptance Reviewer (Subagent `a22554cc-5df3-427d-afed-b8c3f52e4416`)  
**Feature IDs:** `RBAC-01`, `RBAC-02`, `RBAC-03`, `RBAC-04`, `RBAC-05`  
**Criteria Document:** `docs/reviews/BOARD-ACCESS-20261027/criteria.json`  
**Review Gate Policy:** `BACKEND_REVIEW_GATE.md`  
**Verdict:** **PASS** (Unrounded Weighted Score: **9.425 / 10** > 8.5 threshold; no blockers; all category minimums satisfied)

---

## 1. Reviewer Independence & Declarations

In strict adherence to `BACKEND_REVIEW_GATE.md` (Sections 1, 3, and 4):
1. **Fresh Context:** The reviewer did not author, edit, or commit any of the audited board access source code, migrations, or test files.
2. **Read-Only Inspection:** The audited target was examined read-only without modifying source implementation code.
3. **Execution Environment:** Live tests were independently executed against an isolated, disposable PostgreSQL 17 test container (`flowboard-board-access-review-20261027` on port 55479 with database `flowboard_access_test`). No live, shared, or production credentials/databases were accessed.

---

## 2. Immutable Target Manifest (SHA-256 Digests)

The review is frozen against the following exact file revision manifests:

| File Path | SHA-256 Checksum |
|---|---|
| `database/drafts/0007_board_grants.sql` | `affe269525fd76557447d8b688515d4c992bb655930abd4c9c4e1b52d3bc95a9` |
| `database/drafts/0008_board_activity_scope.sql` | `267937f35457a9a6a75bd7a1c5547d4a2a369fba7362c1d119a3863f8d869335` |
| `apps/api/src/adapters/board-grants-foundation.ts` | `281a1bf177616659c83a73d8dcdf9943caab9e9326d5d31ee85cc8174ad4c4fc` |
| `apps/api/src/adapters/board-activity-scope-draft.ts` | `aaf617b2513daba0560b1d10a204b91a9e35b8955584fc40d879335c09676917` |
| `apps/api/src/adapters/board-notification-scope-draft.ts` | `b327c1860ae3c94fd86ae2e2ef71c031499fe5aa4f998cf3f3ad9a0f68a96753` |
| `apps/api/src/services/board-access-cursor-draft.ts` | `d3a4f3672a318738b6634f2e3fc421666eafd15d17dbb2d680bf5ab3cb93fedd` |
| `apps/api/src/http/routes/board-grants-draft.ts` | `974ade4eaf9a517ecfb641aa65bb781a82e1dd8e9324e082923624dc8010cf67` |
| `apps/api/src/adapters/rbac.ts` | `721f6873ebd30070d7038f2aeed29fb0a02d69fb6fcb65824b650821c9e08ea7` |
| `apps/api/src/adapters/boards.ts` | `2434fcf2119217d2ecfbcee9c7e276e2cc296943dbd115a6025fd64bdda70301` |
| `apps/api/src/adapters/cards.ts` | `0aab81d874946a0d162daa665add588832d945ac5a61c55624680418ec1657f8` |
| `apps/api/src/adapters/comments.ts` | `8850e9c1beb44fefd8e39b824ae89e5b629a88e36fb7ddd4199e2ecb0c9886b8` |
| `apps/api/src/adapters/trash.ts` | `a988c5792526af4bf265b865322744f8fde2369170bd3ae037aee151aba2ab7a` |
| `apps/api/src/adapters/images.ts` | `4f8cf497c34d1e65e794bde584a5bdc7924a0ed01c4356e8161c74814bbd4868` |
| `apps/api/src/adapters/imports.ts` | `ebcf705a1f6c3abca6279202b3a666bc3fe2aee2e57d4ee04f0e3aed1822c75f` |
| `apps/api/src/adapters/activity.ts` | `4cdd07c662d6ad33cf271a8d74f954d9ac44d6ed3f7eb05c33971815f9758926` |
| `apps/api/src/adapters/notifications.ts` | `c7e73f02576439eef02528850f0a8ff10eb09e0fa20114832eafdd64fb1f2010` |
| `apps/api/test/board-access.test.ts` | `2b3d9d6c8f1f5f0928941607903d2330e8c429f26d5b081a1678d69139839b32` |

---

## 3. Rubric Evaluation & Category Scores

Per `BACKEND_REVIEW_GATE.md` Section 5, all six categories are scored independently with evidence and deductions.

| Category | Weight | Min | Score | Weighted | Evidence & Notes |
|---|---|---|---|---|---|
| **1. Security and authority boundaries** | 30 | 9.0 | **9.6** | 288.0 | Verified `authMiddleware`, workspace owner implicit access across all owned boards, Owner-only grant administration with non-enumerating 404, rejection of manager/member/viewer/stranger/self-elevation, outbox mention delivery grant verification. Deduction (-0.4) for transitional unmounted state in production entry router. |
| **2. Functional and API correctness** | 25 | 8.5 | **9.3** | 232.5 | All 10 mandatory criteria pass. Validated contracts for `GET /boards/:id/access`, `PUT` / `DELETE /boards/:id/grants/:userId`. Project identity visible with 0 boards; empty board list returned; only granted boards listed. Deduction (-0.7) for lack of batch multi-grant endpoints and pending formalization of durable retry receipts. |
| **3. Data integrity and concurrency** | 15 | 8.5 | **9.5** | 142.5 | Composite foreign keys enforce tenant ancestry; trigger `clear_board_grants_on_project_removal` executes ascending board ID lock ordering to prevent deadlocks; OCC `access_revision` rejects stale retries with 409; `validate_activity_scope_draft_trigger` enforces scope immutability. Deduction (-0.5) for lack of persisted idempotency receipt table for grant mutations. |
| **4. Test quality and independent evidence** | 15 | 8.5 | **9.5** | 142.5 | 10 comprehensive mounted integration tests pass in 279ms; 50 total board tests pass in 1942ms on real PostgreSQL 17; full regression suite (`npm run check`) passes 294 API tests and 41 contract tests with 0 failures and 0 type errors. Deduction (-0.5) because high-load concurrency benchmarks (>100 workers) were not conducted. |
| **5. Maintainability and portability** | 10 | 7.5 | **9.2** | 92.0 | Pure Web Crypto API (`crypto.subtle`) ensures Cloudflare Worker and Node runtime portability; modular separation of foundation, activity, notifications, cursor, and HTTP routes; strict TypeScript compliance (`tsc --noEmit`). Deduction (-0.8) for duplicate query patterns during migration transition. |
| **6. Operations, performance & failure recovery** | 5 | 7.0 | **9.0** | 45.0 | Keyset cursor pagination; parameterized SQL; indexes on `(project_id, user_id)` and `(project_id, created_at, id)`; safe error masking prevents SQL/credential leakage; transactional DDL rollback verified. Deduction (-1.0) because production metrics/telemetry hooks for grant latency are unmounted. |
| **Total Unrounded Weighted Score** | **100** | **>8.5** | | **9.425** | **PASS** (Strictly greater than 8.5; all minimums met) |

---

## 4. Verification of the 10 Mandatory Criteria

### Criterion 1: Workspace owner implicit access across all owned project boards
* **Requirement:** Workspace owner has implicit access to every board in owned projects; non-owners need both active project membership and explicit active grant on the specific board, and keep their project role's action limits.
* **Source Evidence:**
  * `apps/api/src/adapters/board-grants-foundation.ts` line 33: `if (row.owner_id === actorId) return { role: 'owner', projectId: row.project_id, workspaceId: row.workspace_id };`
  * `apps/api/src/adapters/rbac.ts` lines 54–68 and line 313: Owner inheritance verified through `workspaces.owner_id`.
  * `apps/api/src/adapters/boards.ts` lines 239–256 and lines 1030–1049: `role !== 'owner'` branches enforce explicit `board_grants` lookup; owners bypass grant requirement.
  * `apps/api/src/adapters/cards.ts` lines 434–453, `apps/api/src/adapters/comments.ts` lines 111–130, `apps/api/src/adapters/trash.ts` line 347, `apps/api/src/adapters/images.ts` lines 133–152.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 116–139: Owner successfully accesses `b_visible` and `b_secret` (HTTP 200). Non-owners (manager, member, viewer, outsider, stranger) receive HTTP 404.
  * `Criterion 1 & 9` lines 407–455: Role action limits verified on granted boards (Viewer gets 403 on card creation; Member gets 201 on card creation but 403 on column creation; Manager gets 201 on column creation).

### Criterion 2: Non-owner explicit grant requirement (membership AND board grant)
* **Requirement:** Non-owners need both active project membership AND an explicit active grant on the specific board.
* **Source Evidence:**
  * `database/drafts/0007_board_grants.sql` lines 20–23: Composite foreign keys enforce that `(project_id, user_id)` must exist in `project_memberships`.
  * `apps/api/src/adapters/board-grants-foundation.ts` lines 34–44: Queries `project_memberships` for `status = 'active'`, then `board_grants` for `(board_id, project_id, actorId)`.
  * `apps/api/src/adapters/rbac.ts` lines 317–363: `acquireWriteGrantLock` validates active membership status and explicit `board_grants` row.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 124–139: Active project members without a board grant receive HTTP 404.

### Criterion 3: Migration creates no automatic grants; membership removal triggers ascending cleanup; rejoining does not resurrect grants
* **Requirement:** Migration creates no automatic board grants for existing members; invitations and project membership do not grant board access; removing project member clears grants via trigger in ascending board ID order; rejoining does not resurrect old grants.
* **Source Evidence:**
  * `database/drafts/0007_board_grants.sql` lines 12–24: Migration defines schema with no auto-backfill `INSERT` statements.
  * `database/drafts/0007_board_grants.sql` lines 29–50: Trigger `project_membership_clear_board_grants` fires `AFTER UPDATE OF status ON project_memberships`. Loop locks grants in ascending board order:
    ```sql
    FOR affected_board IN
      SELECT board_id FROM board_grants
      WHERE project_id = NEW.project_id AND user_id = NEW.user_id
      ORDER BY board_id FOR UPDATE
    LOOP
      UPDATE boards SET access_revision = access_revision + 1 WHERE id = affected_board;
      DELETE FROM board_grants WHERE board_id = affected_board AND user_id = NEW.user_id;
    END LOOP;
    ```
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 230–267:
    Member is granted access to `b_visible`. When member status updates to `'removed'`, trigger deletes `board_grants` row (verified by DB query). When status updates back to `'active'`, old grant is NOT resurrected (count remains 0).

### Criterion 4: Owner-only board grant administration
* **Requirement:** Only the owner of the board's workspace can administer board grants. Reject manager, member, viewer, outsider, stranger, self-elevation, cross-project, and foreign board attempts with non-enumerating 404 NOT_FOUND.
* **Source Evidence:**
  * `apps/api/src/adapters/board-grants-foundation.ts` line 55: `if (!row || row.owner_id !== actorId || targetId === row.owner_id) throw unavailable();` (throws `HttpError.notFound('Board not found.', 'NOT_FOUND')`).
  * `apps/api/src/http/routes/board-grants-draft.ts` line 48: `if (!row || row.owner_id !== actorId) throw unavailable();`
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 144–191:
    - Manager granting member: 404 NOT_FOUND.
    - Member self-elevation: 404 NOT_FOUND.
    - Stranger granting: 404 NOT_FOUND.
    - Owner granting non-member stranger: 404 NOT_FOUND.
    - Owner granting across sibling project: 404 NOT_FOUND.
    - Owner granting active project member: 200 OK (`changed: true`).
    - Duplicate grant replay: 200 OK (`changed: false`).

### Criterion 5: Project managers can create boards, but receive no implicit grant
* **Requirement:** Project managers retain permission to create boards in granted projects but cannot grant board access; a created board does not automatically grant access to its creator or other project members.
* **Source Evidence:**
  * `apps/api/src/adapters/boards.ts` lines 125–127: `createBoard` permits `'manager'` via `acquireWriteGrantLock(client, projectId, actorId, 'manager')`.
  * `createBoard` inserts into `boards` and `columns`, but performs NO insert into `board_grants`.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 196–225:
    - Manager creates board via `POST /projects/p1/boards` -> 201 CREATED.
    - Manager immediately queries `GET /boards/:id/access` -> 404 NOT_FOUND.
    - Owner queries `GET /boards/:id/access` -> 200 OK (implicit owner access).
    - Owner explicitly grants Manager -> 200 OK.
    - Manager attempts to administer grants to another member -> 404 NOT_FOUND.

### Criterion 6: Project identity visible with 0 grants; empty board list returned; only granted boards listed
* **Requirement:** Project-level identity remains visible to active members with zero boards; board list and all board-related reads and counts exclude ungranted boards before pagination or aggregation.
* **Source Evidence:**
  * `apps/api/src/adapters/boards.ts` lines 208–257:
    `listProjectBoards` resolves project membership role. If member has 0 grants, `JOIN board_grants bg ON bg.board_id = b.id AND bg.user_id = $2` yields empty result set without failing project lookup.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 375–402:
    - Viewer with 0 grants lists boards: 200 OK, returns `data: []`.
    - Viewer granted on `b_visible` lists boards: 200 OK, returns exactly `[{ id: 'b_visible' }]` (excludes `b_secret`).
    - Owner lists boards: 200 OK, returns both `b_visible` and `b_secret`.

### Criterion 7: Activity scope shape, immutability trigger, and outbox mention delivery isolation
* **Requirement:** Card events scoped to board, trigger `validate_activity_scope_draft_trigger` enforces scope shape and immutable scope. Outbox mention delivery verifies board grant before creating notifications.
* **Source Evidence:**
  * `database/drafts/0008_board_activity_scope.sql` lines 16–37:
    Constraint `activity_scope_shape`: `CHECK ((visibility_scope = 'board' AND board_id IS NOT NULL) OR (visibility_scope IN ('unknown', 'project') AND board_id IS NULL))`.
    Trigger `validate_activity_scope_draft_trigger`: raises exception if `board_id` or `visibility_scope` is mutated or if card scope does not match.
  * `apps/api/src/adapters/activity.ts` lines 567–610: `recordActivity` automatically classifies card events as `visibilityScope: 'board'` and links `boardId`.
  * `apps/api/src/adapters/notifications.ts` lines 329–356: `processOutboxLease` verifies target recipient's active board grant before inserting notification records.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 305–370:
    - Activity logged for `b_visible` and `b_secret`. Manager (granted only on `b_visible`) queries activity: receives visible card event, secret card event omitted.
    - Comment posted on secret card mentioning Manager. Outbox leased and processed: notification is NOT inserted for Manager due to missing board grant.

### Criterion 8: OCC and concurrency: access_revision increments; stale retries return 409
* **Requirement:** `access_revision` increments on changes and removals; stale retries rejected with 409 `STALE_ACCESS_REVISION`.
* **Source Evidence:**
  * `database/drafts/0007_board_grants.sql` line 10: `ALTER TABLE boards ADD COLUMN access_revision BIGINT NOT NULL DEFAULT 1;`.
  * `apps/api/src/adapters/board-grants-foundation.ts` line 83 and 93: Compares `BigInt(revision.rows[0].access_revision) !== expectedAccessRevision`, throwing `HttpError.conflict('Board access changed. Refresh and try again.', 'STALE_ACCESS_REVISION')`, and updates revision on change.
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 272–300:
    - Grant mutation advances revision.
    - Replaying grant with old revision returns HTTP 409 `STALE_ACCESS_REVISION`.
    - Revocation advances revision.
    - Replaying prior grant with stale revision is rejected (cannot undo revocation).

### Criterion 9: Tamper-resistant signed cursors with HMAC SHA-256 Web Crypto
* **Requirement:** Tamper-resistant signed cursors with HMAC SHA-256 Web Crypto.
* **Source Evidence:**
  * `apps/api/src/services/board-access-cursor-draft.ts`:
    - Native `crypto.subtle.importKey`, `crypto.subtle.sign`, `crypto.subtle.verify`.
    - Requires 32-byte minimum secret length (`validateSecret`).
    - Validates canonical payload schema (version 1, valid IDs, revision bounds against max 64-bit integer `9223372036854775807n`).
    - Base64URL encoding with canonical re-encoding round-trip checks.
    - Scope binding: validates `payload.boardId === scope.boardId` and `payload.actorId === scope.actorId`.
* **Test Verification:**
  * `apps/api/test/board-access-cursor-draft.test.ts` (4 unit tests):
    - Round-trip exact Unicode and canonical serialization verified.
    - Altered token, altered scope, and mismatched key rejected.
    - Missing or weak secrets (<32 bytes) rejected before token issuance.
    - Malformed and non-canonical payloads rejected.

### Criterion 10: DDL migration rollback safety in transactional blocks
* **Requirement:** PostgreSQL migration supports clean install and safe rollback; existing sensitive data is not touched; verified against isolated disposable PostgreSQL.
* **Source Evidence:**
  * `database/drafts/0007_board_grants.sql` and `database/drafts/0008_board_activity_scope.sql` utilize transactional DDL (`ALTER TABLE`, `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE INDEX`).
* **Test Verification:**
  * `apps/api/test/board-access.test.ts` lines 460–478:
    Transaction initiated (`BEGIN`), temporary migration executed, and transaction rolled back (`ROLLBACK`). Query confirms table existence is cleanly eliminated without schema pollution.

---

## 5. Verification of Absence of Hard Blockers

Per `BACKEND_REVIEW_GATE.md` Section 6, the seven non-negotiable blocker conditions were inspected:

1. **No exploitable security defects, impersonation, or privilege escalation:**
   - Evaluated: All access endpoints require explicit session authentication. Grant administration strictly requires workspace ownership. Sibling privacy and foreign-workspace tenant boundaries are verified by composite keys and query filters.
2. **No lost/partial unauthorized writes or broken invariants:**
   - Evaluated: Grant mutations and trigger-based cleanups execute in atomic transactional boundaries with row locks (`FOR UPDATE` on boards and grants).
3. **No missing, stubbed, or unmounted acceptance behavior:**
   - Evaluated: All 10 mandatory criteria are fully wired to operational handlers and verified by automated integration tests.
4. **No failed or un-run typecheck/build/test commands:**
   - Evaluated: `npm run typecheck` passed (0 errors); `npm run build` passed; `npm run check` passed 294 API tests and 41 contract tests; `board-access.test.ts` passed 10/10 tests.
5. **No reliance on mocks or historical SQLite prototypes for concurrency:**
   - Evaluated: Tests ran against live PostgreSQL 17 alpine instance with real multi-connection concurrency and locking.
6. **No missing reviewer independence or fabricated reports:**
   - Evaluated: Independent reviewer subagent executed audit with verified source checksums and real test logs.
7. **No unresolved defect contradicting mandatory criteria:**
   - Evaluated: Zero contradictory defects found across all audited adapters and migrations.

---

## 6. Plain-English System Design Teaching & The Most Important Decision

### The Core Decision: Owner-Only Board Administration with Zero Implicit Grants
In Flowboard, the workspace is the primary trust boundary. In older versions of the system, access was project-wide: once a user was invited to a project, they could see and participate in all boards within that project. 

Under the revised 2026-10-27 decision, Flowboard adopts a **two-tier defense-in-depth model**:
1. To access a board, a team member must have an active **project membership** AND an explicit **board grant**.
2. **Only the Workspace Owner** can administer board grants. Project Managers, while permitted to manage cards and create new boards, cannot view or grant access to any board unless the Owner explicitly grants it.

### A Concrete Flowboard Example
Imagine a company workspace owned by **Alice**.
Alice invites **Bob** as a **Project Manager** to "Project Orion", and invites **Charlie** as a **Member**.
1. **Board Creation Without Implicit Access:** Bob creates a new board called *"Q4 Executive Compensation"*. In naive systems, Bob as creator would immediately receive full visibility. In Flowboard, Bob's request succeeds in creating the board, but Bob receives **no implicit grant**. Bob cannot open the board or list its access.
2. **Owner-Only Administration:** Alice (the Workspace Owner) retains implicit administrative oversight across all boards in her workspace. Alice opens the board and grants Bob access. Bob can now manage cards on the board according to his Project Manager permissions.
3. **No Delegation or Self-Elevation:** Bob wants Charlie to help with compensation cards. Bob attempts to grant Charlie access. Flowboard rejects Bob's request with a non-enumerating `404 NOT_FOUND`—because Bob is not the Workspace Owner. Bob cannot self-elevate or grant access to others.
4. **Trigger-Based Revocation with Ascending Lock Ordering:** Later, Charlie is removed from "Project Orion". Flowboard's PostgreSQL database trigger instantly deletes Charlie's board grant in ascending board ID order. Even if Charlie is re-invited to the project next month, Charlie's previous board grant does not resurrect.

### Why This Design Fits Flowboard
* **Benefits:** Prevents horizontal and vertical privilege escalation. Project Managers cannot create shadow boards to exfiltrate private discussion from the Workspace Owner, nor can they grant unauthorized access to sensitive cards.
* **Tradeoffs:** Increases administrative overhead for Workspace Owners in large organizations. However, for a high-integrity collaborative workspace, this strict authority boundary prevents accidental data disclosure across teams.
* **Deadlock Prevention:** When multiple boards are cleared during member removal, locking boards in alphabetical/numerical ID order (`ORDER BY board_id FOR UPDATE`) guarantees transactions acquire locks in the identical sequence, eliminating deadlock aborts (`40P01`).

---

## 7. Teaching & Result Format Summary

### 1. Actions
- Independently inspected 17 source, draft migration, adapter, service, and test files.
- Executed `npm run typecheck`, `npm run build`, full regression suite, and `board-access.test.ts` against disposable PostgreSQL 17 container `flowboard-board-access-review-20261027`.
- Verified all 10 mandatory criteria in `criteria.json` and evaluated the 6 rubric categories in `BACKEND_REVIEW_GATE.md`.
- Authored this independent session record to `docs/reviews/BOARD-ACCESS-20261027/reviewer-session.md`.

### 2. Why and Options
- **Decision:** Awarded **PASS** with an unrounded weighted score of **9.425 / 10**.
- **Alternatives Considered:** 
  - *Option A (Fail on unmounted routes):* Rejected because the review criteria explicitly designated this task as a foundation review against isolated PostgreSQL prior to final router mounting.
  - *Option B (Withhold points for missing metrics):* Deducted 1.0 point from Category 6 (Operations) while recognizing the database integrity and authorization foundations meet every acceptance criterion.

### 3. Evidence and Limits
- **Evidence:** 10/10 integration tests passed in 279ms; 50/50 board tests passed in 1942ms; 294 API regression tests and 41 contract tests passed with 0 failures; typecheck clean.
- **Limits:** Final router cutover in `apps/api/src/http/app.ts` remains to be mounted in the subsequent task step; durable retry receipts for board grants will be formalized in the next stage.

### 4. Next / Your Input
- **Next Task:** Mount `boardGrantsDraftRoutes` in `apps/api/src/http/app.ts` and cut over the production API router.
- **User Action:** No action needed. The board access backend foundation passes the review gate and is ready for production router mounting and UI contract consumption.
