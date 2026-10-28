# Independent acceptance review: discussion and trash

**Execution target:** `/private/tmp/flowboard-stage2-resume-a37x7egs` (its 71 source-file hashes match the live checkout bytes). `source-manifest.json` preserves the supplied snapshot manifest in this review directory.  
**Feature IDs:** COM-01..COM-06, DEL-01..DEL-08  
**Criteria:** `criteria.json` (frozen before scoring and tests)  
**Final review record:** `stage2-resume-round-2.json` (96 hashed files: the 71 frozen source files, preserved manifest, required policy/contracts/configuration, and review evidence). `stage2-resume-round-1.json` is an earlier draft preserved for history and is not closure evidence.  
**Reviewer identity and execution record:** `reviewer-session.md`  
**Test logs:** `typecheck.log`, `discussion-trash-group-escalated.log`; initial sandbox-blocked attempt: `discussion-trash-group.log`

## Result

**Verdict: fail. Weighted score: 5.1 / 10.** Each category is scored independently below. Multiple mandatory requirements are absent or violated; no average can waive those blockers.

The positive evidence is meaningful but narrow: the mounted routes use real PostgreSQL transactions, project role checks, version checks and idempotency receipts; the 32-test group passed on the dedicated synthetic PostgreSQL database; and TypeScript typechecking passed. The suite does not exercise a purge worker or real purge/restore race, and source review found several behaviors that contradict acceptance. A passing test for a route that merely sees a card already marked `purged` does not prove that any code safely purges it.

Plain-English example: if someone loses the response after posting “release is delayed,” Flowboard should replay enough metadata to identify the posted comment, without keeping another copy of “release is delayed” in its retry receipt. This implementation stores the full response in the receipt. Similarly, a deleted card can be restored only if an actual purge has not won; the snapshot has no purge worker or cleanup path to decide that race.

## Category scores

| Category | Weight | Score | Evidence and reason |
|---|---:|---:|---|
| Security and authority boundaries | 30 | 5.0 | Authenticated routes do not reauthorize a user before returning an idempotency receipt; this leaks private response bodies after project access is revoked. Parent independently reproduced 201 with private comment/card content after revocation. Archived-board card PATCH also succeeds. Comment DELETE works after card trashing; mention spans can notify a user for text that is not the selected token; full comment bodies persist in receipts and notification bodies without cleanup. No explicit Origin/CSRF check was found; SameSite=Lax exists, so that remains a coverage gap rather than a confirmed exploit. |
| Functional and API correctness | 25 | 4.5 | Comment cursor is returned but ignored on later requests; mention token/surrogate boundaries are not validated; restore reuses the old position without a surviving anchor; archived boards still accept card edits; COM-06 has no backend surface and is client-only. Purge/cleanup is absent. |
| Data integrity and concurrency | 15 | 4.0 | Comment create/edit/tombstone and delete/restore use transactions, expected versions, activity writes and board snapshot changes. But receipt replay bypasses current grant checks; archived-board writes can commit; no purge implementation or worker fencing exists; the test directly changes `state` to `purged`. Restore does not calculate a destination rank/anchor. Comment post/edit receipts retain body copies. |
| Test quality and independent evidence | 15 | 6.5 | Fresh snapshot hashes matched all 71 supplied files; typecheck passed; PostgreSQL group passed 32/32. Tests are sequential and omit cursor continuation, UTF-16 split boundaries, literal-token mismatch, trashed-card comment deletion, exact equality cutoff, and real concurrent purge/restore plus content/privacy cleanup. |
| Maintainability and portability | 10 | 7.0 | Typed route/adapters and a shared Hono app serve Node and Worker. Comment author display is queried per distinct author; transaction wrappers repeat similar code. The local group does not prove hosted Worker database wiring. |
| Operations, performance and failure recovery | 5 | 4.0 | Request body/deadline bounds and DB transaction cleanup exist. Trash listing is unbounded, no cleanup/purge job or retryable content deletion is implemented, and comment reads are capped but cannot continue to another page. No performance claim was measured. |

Calculation: `(5×30 + 4.5×25 + 4×15 + 6.5×15 + 7×10 + 4×5) / 100 = 5.1`.

## Feature outcomes

| Feature | Outcome | Evidence |
|---|---|---|
| COM-01 | **Fail** | Mounted reader route and project authorization work; chronological order and tombstone redaction exist. `cursor` reaches the adapter but is never used in SQL, so continuation repeats the first page (`routes/comments.ts:36-45`, `adapters/comments.ts:39-44,78-104`). No test requests the second page. |
| COM-02 | **Fail** | Route is mounted and wraps comment, notification, activity, outbox, snapshot update and receipt in one transaction (`routes/comments.ts:69-134`; `adapters/comments.ts:276-375`). Viewer/outsider and retry tests pass. Receipt stores full response (`routes/comments.ts:106-119`; `adapters/idempotency.ts:115-141`); mention notification stores a raw body excerpt (`adapters/comments.ts:318-330`). Receipt replay returns before `postComment` rechecks active project membership (`routes/comments.ts:88-106`); the receipt helper checks actor/key/scope but not current access (`adapters/idempotency.ts:46-85`). Parent independently reproduced a revoked member receiving 201 and the private comment body on replay. API contract says receipts must not contain comment body (`docs/API.md:11-13`). |
| COM-03 | **Fail** | Zod rejects overlap and bounds; adapter checks JS UTF-16 length and active project eligibility (`contracts/discussion.ts:9-38`; `adapters/comments.ts:187-211`). It does not reject a span splitting a surrogate pair or verify that the selected span matches a literal `@name` token. A caller can attach an eligible user ID to unrelated text and trigger a notification. Tests cover overlap, sibling eligibility and self-mention, but not these boundaries (`test/com-del.test.ts:291-367`). |
| COM-04 | **Fail** | Author-only, active-card-state, grant lock, expected version, activity and snapshot updates are wired (`adapters/comments.ts:412-549`); group tests cover non-author denial, stale version and author edit. However, card state is checked but parent board archived state is not, so edit on an archived board remains writable. The edit receipt also returns before current-grant validation (`routes/comments.ts:175-193`). |
| COM-05 | **Fail** | Author or manager/owner grant is checked under transaction, version is checked, tombstone and activity/snapshot update are written; list response replaces body and removes mentions (`adapters/comments.ts:560-655,150-167`). Tests cover member denial, owner moderation and author self-delete. The handler can replay without current grant validation (`routes/comments.ts:271-289`); a new delete also does not reject an archived board or trashed card. |
| COM-06 | **Not implemented in backend; UI evidence absent** | This is a client-only draft/picker behavior; no UI implementation is in this backend snapshot. The group test named COM-06 only proves POST rejects a comment on a trashed card (`test/com-del.test.ts:651-664`). It cannot establish draft retention, picker Enter behavior or Save/refetch isolation. |
| DEL-01 | **Fail** | Mounted route validates request and uses a transaction. Adapter checks card state and expected card/board versions, sets `deleted_at`, exact `restore_until = deleted_at + 24 hours`, updates board versions and records activity (`routes/trash.ts:14-77`; `adapters/trash.ts:144-247`). But delete does not check the board's archived flag, so it can mutate a read-only board; receipt replay also precedes current grant validation (`routes/trash.ts:46-70`). Group test passes the soft-delete, role and stale-version cases, but does not cover those cases. |
| DEL-02 | **Partial behavior observed; not approved** | Project role is resolved and only owner/manager can list; project predicate scopes rows and response includes actor/deadline/serverNow (`adapters/trash.ts:255-374`). Query reads all trash rows and returns `nextCursor: null`, so large trash sets are unbounded. The shared authorization/replay blockers prevent approval of the combined scope. |
| DEL-03 | **Partial behavior observed; not approved** | A fresh restore checks role, read-only project/board, cutoff and versions, then reactivates the same row and records activity (`adapters/trash.ts:389-558`). Test passes same-ID restore. No-op retry uses the route’s idempotency receipt, but the receipt replay path returns before checking current access; no purge implementation exists to verify preserved content. |
| DEL-04 | **Fail** | Same-board explicit destination is enforced and missing original column returns `RESTORE_DESTINATION_REQUIRED` (`adapters/trash.ts:468-500`). The UPDATE only changes state/deletion fields and column; it never recomputes `position` or applies the nearest surviving before/after anchor (`adapters/trash.ts:512-524`). Existing test covers missing column, not rank/anchor behavior. |
| DEL-05 | **Source condition observed; not approved** | Restore denies `serverNow >= restore_until` with 410 and returns serverNow/deadline (`adapters/trash.ts:457-465`); group test verifies already-expired behavior. It does not test equality at the exact instant. |
| DEL-06 | **Fail (hard blocker)** | No purge/cleanup implementation or worker exists under `apps/api/src`, and the only “purge race” test directly sets `cards.state='purged'`, then verifies restore returns 404 (`test/com-del.test.ts:927-952`). Row locking in restore alone cannot prove a race against a nonexistent worker or establish a single fenced winner. |
| DEL-07 | **Fail (hard blocker)** | No content purge, retryable cleanup, receipt redaction, or notification-body cleanup exists in this snapshot. Comment bodies are duplicated into `idempotency_receipts.response_body` and `notifications.body`; migration defines those content-bearing fields (`migrations/0001_initial.sql:163-173,255-269`). No cleanup path removes these copies. |
| DEL-08 | **Fail** | Card GET/PATCH/move and comment GET/post/edit guard trashed/purged state (`adapters/cards.ts:438-467,597-645`; `adapters/comments.ts:61-69,248-260,442-453`). But `deleteComment` selects no card state and does not reject trash (`adapters/comments.ts:577-605`); author/manager can still tombstone a comment on a trashed card. No image upload routes are mounted, so new-upload guard behavior is not evidenced; migration/helper schema is not a reachable upload implementation. |

## Findings

### F-01 — Discussion cursor does not paginate

- **Severity:** P1, mandatory, blocking for COM-01.
- **Evidence:** The handler passes `cursor` to `listCardComments` (`apps/api/src/http/routes/comments.ts:36-45`), but the adapter’s options include the field and its SQL uses only `WHERE card_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2` (`apps/api/src/adapters/comments.ts:39-44,78-104`). `nextCursor` is the last ID, but it is never decoded/applied.
- **Reproduction:** Create more than the requested page size; request page one; repeat GET with its returned `nextCursor`. The same first page is returned, so subsequent comments cannot be reached.
- **Impact:** COM-01’s stable chronological pagination is not functional; repeated fetches can loop forever.
- **Counterevidence:** Ordering is deterministic by timestamp and ID, authorization precedes the query, and the result caps each query at 101 rows.
- **Fix direction:** Implement validated keyset continuation using the last timestamp plus ID, or an opaque signed cursor tied to card/scope; test page two and cursor tampering.

### F-02 — Comment delete bypasses trashed-card guard

- **Severity:** P1, mandatory, blocking for DEL-08 and restore integrity.
- **Evidence:** `deleteComment` joins `cards` but selects only `cd.board_id`, then checks author/moderator and tombstones (`apps/api/src/adapters/comments.ts:577-619`). It never reads/checks `cd.state`. Edit and post do check state (`:248-260,427-453`).
- **Reproduction:** As project member, trash a card as manager; send `DELETE /api/v1/comments/:commentId` with the member’s valid session, idempotency key and current expectedVersion for a comment on that card. The mounted route calls `deleteComment`; it can commit `deleted_at`, activity and board snapshot changes while card is trashed.
- **Impact:** A mutation to comment content succeeds after deletion and changes what a later restore returns, violating the frozen deleted-card interaction guard and “restore content as it existed at deletion” rule.
- **Counterevidence:** The same transaction checks active project grant, expected comment version and moderator/author rights; normal comment GET hides trashed cards.
- **Fix direction:** Lock/check the parent card state inside the same transaction before authorization/update; add route-level test for author and moderator attempts on trashed cards.

### F-03 — Comment body persists in retry receipts and mention notification bodies

- **Severity:** P1, mandatory, blocking for COM-02 and DEL-07 privacy cleanup.
- **Evidence:** POST builds `{data: comment}` and saves it as receipt `response_body` (`apps/api/src/http/routes/comments.ts:106-119`); EDIT does the same (`:193-206`). `saveReceipt` serializes the full response into JSONB (`apps/api/src/adapters/idempotency.ts:115-141`). Mention notifications copy up to 200 characters of the comment into `notifications.body` (`apps/api/src/adapters/comments.ts:318-330`). The API says receipt bodies must exclude comment text (`docs/API.md:11-13`); trash spec requires purged content removed from receipt and notification copies (`docs/FEATURE_SPEC.md:95`). There is no purge/cleanup code in this target.
- **Reproduction:** Post a comment with a unique synthetic marker and query the test DB’s `idempotency_receipts.response_body` for that actor/key. For a mention, query `notifications.body` for the same marker. Both can contain comment text; after card cutoff no cleanup route/worker exists to erase it.
- **Impact:** A deleted card’s text remains in independent persistent copies; idempotent replay also returns the old body even if a comment was edited or tombstoned after the receipt.
- **Counterevidence:** The outbox `comment.created` payload contains IDs and mention IDs, not the text; comment activity stores only the ID and count. The ordinary comment GET tombstones/redacts body and mentions.
- **Fix direction:** Store minimal response metadata (ID/version/status) in receipts and make replay refetch authorized current state; store notification preview only if retention policy permits and redact/delete it as part of fenced purge. Add tests that search all copies after cleanup.

### F-04 — Purge, fencing and cleanup are not implemented

- **Severity:** P1, mandatory, hard blocker for DEL-06 and DEL-07.
- **Evidence:** Search of the 71-file snapshot finds no purge or cleanup function/worker; `cards.state` merely permits `'purged'` in migration (`database/migrations/0001_initial.sql:108`). Restore has `FOR UPDATE` (`adapters/trash.ts:413-425`), but no competing purge path acquires a corresponding lock or conditional state/version update. Test `DEL-06` simulates completion with a direct SQL state edit (`apps/api/test/com-del.test.ts:927-952`).
- **Reproduction:** Not applicable through the application: there is no mounted purge endpoint/job to race. The test’s SQL mutation is only a fixture manipulation and does not exercise a worker or cleanup.
- **Impact:** Expired cards are never actually purged by the feature; content/files and copies persist; no retryable object cleanup or fencing can be verified. The test’s “fenced winner” label overstates what it proves.
- **Counterevidence:** Restore’s own row lock correctly serializes restore requests; strict cutoff logic is present. Neither supplies the missing competing purge implementation.
- **Fix direction:** Add a bounded worker that claims due trashed cards with a lease/fence or conditional state+version transition, performs idempotent content/file cleanup, redacts receipts/notifications, retains minimal audit markers and has real concurrent PostgreSQL tests.

### F-05 — Mention spans are not tied to text token boundaries

- **Severity:** P2, mandatory, blocking for COM-03 acceptance.
- **Evidence:** Contracts validate ranges, overlap and count (`packages/contracts/src/discussion.ts:9-38`); adapter checks `body.length` bounds and project eligibility (`apps/api/src/adapters/comments.ts:187-211`). It does not reject indices inside a surrogate pair or check the span’s text against the selected `@name` token. Notification creation trusts supplied `userId`s (`:313-330`).
- **Reproduction:** Submit body `😀ordinary text` with an eligible project user and span `{start:0,end:1}` or submit unrelated text with a span over a non-mention substring. The current checks accept bounds and eligibility, then create an in-app notification.
- **Impact:** Invalid mention metadata can split a Unicode character or notify someone even though their name does not appear in the comment.
- **Counterevidence:** JS string indexing is measured in UTF-16 units, overlaps are rejected, mentions are capped at 20, and sibling project users are rejected.
- **Fix direction:** Validate well-formed UTF-16 boundaries and ensure each span matches the chosen token grammar/display identity; include emoji boundary and literal `@name` adversarial cases.

### F-06 — Restore does not choose surviving position anchors

- **Severity:** P2, mandatory for DEL-04.
- **Evidence:** Restore checks a valid destination column but sets `column_id` only (`apps/api/src/adapters/trash.ts:468-524`). It never queries remaining active order or updates `position`; the migration stores integer `position` and indexes it, without a unique rank constraint (`database/migrations/0001_initial.sql:98-112,298-304`).
- **Reproduction:** Trash a card at a middle rank; move/reorder neighboring active cards before restoring; restore the card. The adapter reuses the old numeric position rather than resolving a nearest surviving before/after anchor.
- **Impact:** Restored card placement can collide or diverge from the required nearest-surviving-position rule.
- **Counterevidence:** Original column is retained on card and missing columns force explicit same-board destination; simple restore tests pass.
- **Fix direction:** Preserve neighbor IDs or derive nearest valid anchors under board/card locks and assign canonical rank; test both surviving and removed anchors.

### F-07 — Idempotency replay bypasses current project authorization

- **Severity:** Critical, mandatory, blocking for security and response privacy.
- **Evidence:** Comment POST resolves `projectId`, then calls `checkOrReplayReceipt` and returns its saved body before reaching `postComment` and its `acquireWriteGrantLock` (`apps/api/src/http/routes/comments.ts:74-106`). PATCH, DELETE, card delete and restore follow the same replay-before-adapter pattern (`routes/comments.ts:160-193,255-289`; `routes/trash.ts:41-77,141-173`). `checkOrReplayReceipt` filters by actor, scope ID, key and expiry only; it does not resolve current role/status (`apps/api/src/adapters/idempotency.ts:46-85`).
- **Reproduction:** Perform a successful write with an idempotency key, revoke that actor’s project grant, then replay the same method/path/body/key with the still-valid session. The endpoint returns the cached success before current membership checks. Architect independently reproduced both comment and card replay as HTTP 201 with private content while a normal read returned 404; see `/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-RESUME-20261026/parent-probes.log`.
- **Impact:** A removed user can retrieve private response content after revocation, contradicting the explicit rule to recheck project access before replay. Transactional idempotency does not make an unauthorized replay safe.
- **Counterevidence:** Session authentication still runs, and a fresh non-replay write reaches the active grant lock. The flaw is specifically the replay branch bypassing that second, current project authorization check.
- **Fix direction:** Reauthorize the current actor against the target project inside the transaction before reading/returning any receipt, for every replay path; return the same private 404/403 behavior as ordinary reads after revocation. Add revoked-member replay tests for comment, card, delete and restore operations.

### F-08 — Archived boards remain writable through card mutations

- **Severity:** High, mandatory shared read-only guard gap.
- **Evidence:** `updateCard` selects the card without joining/selecting `boards.archived`, then checks only `card.state` and project grant (`apps/api/src/adapters/cards.ts:444-467`). `deleteCard` similarly selects board versions but not `archived` (`apps/api/src/adapters/trash.ts:152-201`). Comment post/edit use card state but do not test board archive (`apps/api/src/adapters/comments.ts:233-267,412-470`). Architect independently observed HTTP 200 for PATCH after setting the board archived; see parent probe log above.
- **Reproduction:** As an authorized project member, set the board to archived, then PATCH the card title with current version and a fresh idempotency key. The handler accepts the request because the card row remains active and membership is valid.
- **Impact:** The API documents archived boards as read-only, but comments/card fields and soft deletion can still change. Users can alter work after a manager/owner deliberately made that board read-only.
- **Counterevidence:** Restore checks project and board archive flags and returns `READ_ONLY_CONTEXT` (`apps/api/src/adapters/trash.ts:443-455`). This correct guard is not shared by other write routes.
- **Fix direction:** Include board/project active-state checks under the mutation’s transaction/lock protocol on every card/comment write, including idempotent replay paths, and test all mutation types against archived contexts.

## Coverage and evidence limits

- Full source/test/migration manifest: `resume-source-manifest.json` in the immutable snapshot; 71/71 file digests matched at audit start. The manifest’s own SHA-256 is recorded in `reviewer-session.md`.
- Typecheck: exit 0.
- Isolated PostgreSQL test: exit 0, 32 passed, 0 failed. One initial sandbox attempt failed with loopback `EPERM` before DB connection; the same command then ran successfully after loopback escalation against port 55438 only.
- Machine record validation: `python3 scripts/check_backend_review.py docs/reviews/STAGE2-RESUME-DISCUSSION-TRASH/stage2-resume-round-2.json --feature COM-01` exited 1 with `REVIEW REQUIRED: review verdict is not pass`. It reported no missing-path or source/evidence digest errors; rejection is expected for this fail record.
- The suite is sequential. It does not provide concurrency evidence for purge vs restore, or for same-key concurrent comment/delete operations.
- Architect separately reproduced cursor repetition, comment deletion on trash, and unauthorized receipt replays on a separate dedicated synthetic PostgreSQL instance; these probes corroborate findings F-01, F-02 and F-07. The parent probe file is supporting cross-review evidence and is not part of this reviewer’s immutable target manifest.
- COM-06 requires a UI/browser review and is intentionally outside backend completion.
- Image upload routes are absent. The schema’s image tables do not prove an upload endpoint or trashed-card upload guard.
- No hosted Worker/Hyperdrive test, production check, load/performance benchmark, or dependency advisory lookup was performed.
- This combined record deliberately reviews all 14 requested features against the one exact snapshot. It does not modify prior narrow records, handoffs, checklists, code, tests, contracts, or migrations.

## Next action

The backend remains open. Fix the blocking cursor, authorization-before-replay, archived-board writes, trashed-comment DELETE, receipt/notification copies and absent purge/cleanup; add the missing mention and restore-placement validation; run new PostgreSQL adversarial/concurrency tests on a new immutable target; then obtain another fresh independent review. COM-06 still needs separate UI evidence.
