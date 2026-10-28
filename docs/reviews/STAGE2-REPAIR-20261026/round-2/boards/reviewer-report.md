# BRD-01..BRD-07 — Stage 2 round-2 acceptance review

**Verdict: FAIL.** Target manifest verified before and after review: 164 files, digest `b8f1cd4def58d26b4d688888ced46ab88e12a1cee930ff94277709caff24e0cd`, with zero missing or changed hashes. This is a read-only review of the supplied target. The only new files are this report, its JSON record, and the two check logs in this directory.

## Findings

1. **Blocking — BRD-07 stale cursor is not bound to its request context.** `encodeCardCursor` stores only `{position,id}` and the decoder checks only those fields. `listBoardCards` accepts that seek tuple without checking board ID, normalized filters, or a snapshot/order revision ([boards.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/boards.ts:36), [boards.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/boards.ts:1239)). If a card moves ahead of an old cursor, the next page can silently omit it instead of returning `409 STALE_CURSOR`. The SQL still scopes results to the requested board and sorts deterministically; those are useful protections but do not meet stale-cursor behavior.

2. **Blocking — PostgreSQL and required receipt regression evidence is missing.** Root `npm run typecheck` passed. The requested PostgreSQL suite exited 1 before its tests began because [local-config.ts](/Users/shubham/Documents/Flowboard/apps/api/src/runtime/local-config.ts:4) only accepts the `/flowboard_harness` database name and rejects the requested isolated `/stage2_boards` database. I did not redirect the destructive suite to another DB. The suite source has an active create replay and key-collision case, but no replay-after-revocation/demotion, same-key concurrency, or stored-receipt body inspection coverage. The frozen round-2 JSON also names the full check, Worker, API/contract, CRD, and COM/DEL checks; those remain unrun here.

3. **Blocking gate limitation — reviewer identity is not fully attestable.** This was a fresh delegated agent context and I did not implement the target. The tool did not expose stable actor and session IDs, so I cannot establish the distinct identity fields required by the review-record policy. The report does not claim those identities.

## Positive counterevidence

Board mutation handlers now call the shared replay helper before returning cached outcomes; that helper takes current project grant and writable-context locks before looking up a receipt ([idempotency.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/idempotency.ts:53)). Receipt persistence sanitizes response bodies to a small set of identifiers and version/status markers ([idempotency.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/idempotency.ts:17)). The board test source includes an allowed replay and different-body `IDEMPOTENCY_CONFLICT` case, but the suite could not execute in this run.

## Scores

| Category | Weight | Score | Minimum |
|---|---:|---:|---:|
| Security and authority boundaries | 30 | 8.8 | 9.0 |
| Functional and API correctness | 25 | 6.5 | 8.5 |
| Data integrity and concurrency | 15 | 7.5 | 8.5 |
| Test quality and independent evidence | 15 | 5.0 | 8.5 |
| Maintainability and portability | 10 | 8.0 | 7.5 |
| Operations and failure recovery | 5 | 7.5 | 7.0 |
| **Weighted total** | **100** | **7.315** | **strictly above 8.5** |

The result fails the category minimums and the strict weighted threshold, in addition to the blocking finding and required-evidence gaps.

## Commands and evidence

- `npm run typecheck` — exit 0; [typecheck.log](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/typecheck.log)
- `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55439/stage2_boards node --test --test-concurrency=1 test/brd01-brd07.test.ts` from `apps/api` — exit 1 before cases ran; [boards-postgres.log](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/boards-postgres.log)

Reviewer model label: **gpt-6-luna**, as specified by the user-authorized Luna delegation. Runtime model metadata was not exposed for independent confirmation. No hosted or production behavior is claimed.
