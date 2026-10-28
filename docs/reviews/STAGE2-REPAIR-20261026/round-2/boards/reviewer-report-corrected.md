# BRD-01..BRD-07 — Stage 2 round-2 acceptance review (corrected run)

**Verdict: FAIL.** This corrected report supersedes the test-evidence conclusions in `reviewer-report.md` while preserving that report and all prior logs. The initial `/stage2_boards` URL was a setup mistake because the test guard requires `/flowboard_harness`. The corrected URL was then blocked by the sandbox with `EPERM`; the exact user-authorized rerun with local network permission passed.

The target manifest was verified before the corrected run: all 164 files matched digest `b8f1cd4def58d26b4d688888ced46ab88e12a1cee930ff94277709caff24e0cd`. After the successful run and report generation, all 164 manifest entries were checked again: zero missing files and zero hash mismatches; the manifest digest remained unchanged.

## Findings

1. **Blocking — BRD-07 stale cursor is not bound to its request context.** `encodeCardCursor` stores only `{position,id}` and the decoder checks only those fields. `listBoardCards` accepts that seek tuple without checking board ID, normalized filters, or a snapshot/order revision ([boards.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/boards.ts:36), [boards.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/boards.ts:1239)). If a card moves ahead of an old cursor, the next page can silently omit it instead of returning `409 STALE_CURSOR`. The successful suite confirms ordinary cursor resumption and filter behavior, but does not change the source-level absence of cursor binding or test stale-after-reorder behavior.

2. **Blocking — required receipt and broader frozen evidence remains incomplete.** Root `npm run typecheck` passed and the corrected mounted PostgreSQL suite passed all 16 tests. The BRD suite includes active create replay and changed-body `IDEMPOTENCY_CONFLICT`; it does not cover replay after grant removal/demotion, same-key concurrency, or receipt `response_body` inspection. The frozen round-2 JSON additionally requires full check, Worker, API/contract, CRD, and COM/DEL checks, which were not run in this BRD-focused review.

3. **Blocking gate limitation — reviewer identity is not fully attestable.** This was a fresh delegated agent context and I did not implement the target. The tool did not expose stable actor and session IDs, so I cannot establish the distinct identity fields required by the review-record policy. The report does not claim those identities.

## Positive counterevidence

Board mutation handlers use the shared replay helper; it takes current project grant and writable-context locks before receipt lookup ([idempotency.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/idempotency.ts:53)). Receipt persistence sanitizes response bodies to identifiers and version/status markers ([idempotency.ts](/Users/shubham/Documents/Flowboard/apps/api/src/adapters/idempotency.ts:17)). Root typecheck passed. The successful test run exercised 16 mounted PostgreSQL cases across BRD-01..BRD-07, including role checks, active receipt replay/collision, column operations, snapshots, and ordinary pagination.

## Scores

| Category | Weight | Score | Minimum |
|---|---:|---:|---:|
| Security and authority boundaries | 30 | 8.8 | 9.0 |
| Functional and API correctness | 25 | 6.5 | 8.5 |
| Data integrity and concurrency | 15 | 8.0 | 8.5 |
| Test quality and independent evidence | 15 | 7.8 | 8.5 |
| Maintainability and portability | 10 | 8.0 | 7.5 |
| Operations and failure recovery | 5 | 7.5 | 7.0 |
| **Weighted total** | **100** | **7.81** | **strictly above 8.5** |

The review still fails the required category minimums and strict weighted threshold, as well as the blocking cursor finding and incomplete frozen evidence.

## Commands and preserved attempts

- `npm run typecheck` — exit 0; [typecheck.log](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/typecheck.log)
- Corrected command, from `apps/api`: `DATABASE_URL=postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55440/flowboard_harness node --test --test-concurrency=1 test/brd01-brd07.test.ts` — **16 passed, 0 failed**, exit 0; [successful run log](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/boards-postgres-port-55440-escalated.log)
- The initial wrong-database-name attempt and sandbox-denied corrected attempt remain preserved as [first attempt](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/boards-postgres.log) and [sandbox attempt](/Users/shubham/Documents/Flowboard/docs/reviews/STAGE2-REPAIR-20261026/round-2/boards/boards-postgres-port-55440.log). Neither is counted as the final suite result.

Reviewer model label: **gpt-6-luna**, as specified by the user-authorized Luna delegation. Runtime model metadata was not exposed for independent confirmation. No hosted or production behavior is claimed.
