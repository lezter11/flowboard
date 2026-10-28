# Independent Stage 2 round-2 review: comments and trash

**Verdict: fail.** Weighted score: **6.775/10**. The corrected mounted-route PostgreSQL suite passed 36/36, and typecheck passed. Mandatory acceptance gaps remain in purge/cleanup, retained private copies, trash bounds, and restore placement. Several category scores are below their gate minimums.

## Target and checks

- Exact source manifest: `docs/reviews/STAGE2-REPAIR-20261026/source-manifest-round-2.json`
- Manifest digest: `b8f1cd4def58d26b4d688888ced46ab88e12a1cee930ff94277709caff24e0cd` (164 files)
- Every file hash and the digest matched before and after; see `manifest-verification.txt`.
- `npm run typecheck`: **exit 0**, see `typecheck.log`.
- The initially supplied URL ending in `/stage2_discussion` was rejected by `localDatabaseUrl` before DB access. This attempt remains in `com-del.test.log`.
- Corrected focused command: `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55442/flowboard_harness node --test --test-concurrency=1 test/com-del.test.ts`: **exit 0, 36 passed, 0 failed**, using the parent-provided dedicated disposable PostgreSQL container. See `com-del-corrected.test.log`.

## Round-two behavior supported by source and PostgreSQL tests

- Comment post/edit/delete and card delete/restore call `checkOrReplayProjectWriteReceipt`; it obtains the current grant and project/board archive locks before receipt lookup (`apps/api/src/adapters/idempotency.ts:53-74`). Comment-delete replay uses `member` for the author and `manager` for a moderator (`apps/api/src/http/routes/comments.ts:276-312`).
- Comment post/edit/delete resolve the parent card and reject trashed/purged state before replay (`apps/api/src/http/routes/comments.ts:74-105,170-201,276-312`). The focused PostgreSQL suite verifies role demotion replay and post/edit/delete retry after trash (`apps/api/test/com-del.test.ts:1087-1149`).
- Comment pagination uses a card-bound cursor and ascending `(created_at,id)` keyset (`apps/api/src/adapters/comments.ts:33-61,113-140`). Tests cover insert-between-pages, malformed cursors, and wrong-card cursors (`apps/api/test/com-del.test.ts:436-490`).
- The focused suite verifies archive rejection for card create/update/move, comment post/edit/delete, and card delete (`apps/api/test/com-del.test.ts:1014-1085`).

## Blocking and material findings

1. **Purge and cleanup are absent.** No reachable purge job or worker exists in `apps/api/src` or the migrations. `DEL-06` in `apps/api/test/com-del.test.ts:1152-1176` simulates purge with a direct `UPDATE cards SET state='purged'`; it does not exercise a worker, fencing, or a race with restore. `restoreCard` uses a card `FOR UPDATE` lock (`apps/api/src/adapters/trash.ts:399-425`), but no competing worker exists to prove fencing or cleanup/retry behavior. This contradicts `FEATURE_SPEC.md:93-95` and `API.md:121`.
2. **Private content copies are not removed.** Mention notifications copy up to 200 characters of comment body (`apps/api/src/adapters/comments.ts:356-368`); card-trash activity stores the card title (`apps/api/src/adapters/trash.ts:226-240`); comment tombstoning sets `deleted_at` but leaves `comments.body` (`apps/api/src/adapters/comments.ts:663-688`). There is no purge cleanup. Minimal receipt payloads and ID/count-only comment-created activity/outbox are counterevidence for those specific copies, but do not address these rows. This conflicts with `FEATURE_SPEC.md:75,95` and `API.md:101,121`.
3. **Trash listing is unbounded.** `listProjectTrash` selects every trashed card and returns `nextCursor: null` (`apps/api/src/adapters/trash.ts:276-319,372-376`). This does not meet the bounded list contract in `API.md:7,143`; response size and work grow with all retained trash.
4. **Restore placement does not re-anchor.** Delete stores no adjacent card anchors (`apps/api/src/adapters/trash.ts:153-171,200-224`). Restore keeps the original position and selects either the original column or explicit `toColumnId`, but does not resolve nearest surviving anchors or compute a destination rank (`apps/api/src/adapters/trash.ts:470-525`). The explicit destination fallback is tested (`apps/api/test/com-del.test.ts:876-946`), but that does not verify re-anchoring required by `FEATURE_SPEC.md:91` / `API.md:121`.
5. **Purge fencing and broader concurrency remain unproved.** The focused PostgreSQL suite passes, but the DEL-06 test is a sequential direct state update and restore request, not two concurrent connections or a fenced job (`apps/api/test/com-del.test.ts:1152-1176`). No actual purge worker or same-key concurrency test in this suite establishes those race properties.
6. **Broader required checks were not run in this delegated scope.** The corrected COM/DEL route suite and typecheck passed, but the full-check, Worker dry-run, and BRD/CRD suites listed in `criteria-round-2.json` were not run. The JSON record marks these criteria incomplete rather than claiming a pass.

The fixed category scores and evidence are in `stage2-discussion-trash-round-2.json`: security **7.5** (min 9.0), correctness **6.5** (min 8.5), integrity **5.5** (min 8.5), tests **7.5** (min 8.5), maintainability **7.5** (min 7.5), and operations **4.0** (min 7.0). The source code indicates round-two archive, role-replay and comment-lifecycle repairs are wired correctly, and the focused PostgreSQL suite passes; those positives do not resolve the blockers or minimum failures.

## Limitations

This is a local review, not hosted evidence. The full all-32-feature criteria and Worker/runtime deployment behavior were not covered by this delegated COM/DEL behavior review. Platform actor/session identifiers were unavailable in the delegated-agent context, so the JSON report does not claim to satisfy the repository's machine-checkable independent-review identity fields. The exact source hashes were verified on both sides of the audit.
