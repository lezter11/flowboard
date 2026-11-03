# Images and trash — fresh local backend review

**Verdict: PASS for the frozen local backend gate covering ATT-01–07 and DEL-01–08. Weighted score9.01/10, unrounded; every category floor passes, no mandatory blocker.** This is not a hosted approval or a claim that all downstream UI/integration handoffs are closed. Those role-owned records must bind this exact review file and their actual evidence. Real providers and hosted acceptance remain UAT pending under the unchanged user-approved sequence.

## Actions and exact target

Fresh read-only reviewer: `collaboration:/root/resume_images_trash_review`; implementer/coordinator: `collaboration:/root`. Provider UUID/model IDs were unavailable, so they are not invented. Reviewer did not implement evaluated product/test repairs, did not run Chrome/Next/cloud commands, and wrote only this evidence directory. See `reviewer-independence.md`.

The final independent executor is `collaboration:/root/round4_foundation_executor`. Its639-file source manifest before/after digest is `c1f1364e7072c1b8989ae227e5ef9721fa19226bb1d38494ff446abe008249bb`, baseline `e13b15fc8ab4279d6a59977c94d6cb05d7dcd711`. All639current hashes equal both snapshots. The review's complete SHA256manifest additionally includes the pinned offline JPEG reference and every consumed criterion/log/probe/report/independence/browser artifact. Its digest differs from the source-only digest because evidence is included.

The preceding full attempt is preserved:9commands passed, mandatory API exit1 with1766/1768 because two old smoke checks expected404 on a now-protected board route, and four commands unrun. Root corrected only `node.test.ts` and `worker.test.ts`, preserving genuine unmounted404 and adding separate protected-board401 assertions. `test-only-refreeze-binding.json` independently establishes exactly those2changes and no added/removed files. No criterion, minimum, threshold or failed log was changed, and no failed command was waived. No formal score was issued for that incomplete attempt.

## Evidence and per-ID disposition

The separate executor's fresh **all14commands exit0**: typecheck, web typecheck, API, contracts, web, MCP, Worker build, web build, MCP build/artifact, OpenAPI parity, embedded migration parity, real browser integration and MCP integration. API **1768/1768**, contracts **128/128**, web **332/332**, MCP **17/17**, artifact **1/1**, all zero skips. Browser:16observations comprising14passes and2explicit observations; MCP integration22/22groups. These global commands were **not executed by this reviewer**; their actual actor, exact commands, timestamps, environment and exit codes are preserved in the executor's `commands.json` and individual logs.

Own exact old-source focused execution: **48/48 PostgreSQL**, **51/51 UI helpers**, **53/53 selected codec tests**, exit0/zero skips. The two later smoke-only changes do not alter any image/trash application, feature-test, fixture, contract or focused-input byte. Own logs retain their actual old source digest; they are supporting evidence, never substituted for a required fresh global command. Own48includes5prior independent mounted probes freshly executed,2new reviewer-authored finalized-PNG race probes,8storage atomicity cases,19restore placement cases and14retention cases. See `focused-result.json`, `extra-focused-execution.json` and `test-only-refreeze-binding.json`.

All15IDs have local substantive acceptance coverage; exact source locations are in `source-coverage.tsv` and expanded counterexamples in `coverage.md`:

| IDs | Local result |
|---|---|
| ATT-01 | Current actor/uploader/project/board authority, parallel10cap, bounded body/admission/progress/cancel, retained upload/finalize commands. |
| ATT-02 | Bounded complete container/entropy/PNG-stream/native verification, direct RGB/grayscale/progressive JPEG/PNG/WebP and actualworkerd20MP positive; malformed/spoofed/markup/unsupported CMYK422; shared8s deadline and retained real work lifetime. |
| ATT-03 | Finalized-only gallery contract and actual browser filename/preview/lightbox behavior; pending upload never counted saved. |
| ATT-04 | Authenticated exact private bytes with no-store/nosniff; missing/expired session401, outsider/sibling/revoked404; post-storage authorization; browser cached image/lightbox clears on learned refusal. |
| ATT-05 | Uploader/admin versioned removal, confirmation/history, committed durable cleanup intent and storage failure retry. |
| ATT-06 | COMMIT rollback keeps one known immutable object and original command retry; finalized expiry/replay survives; legacy staging cleanup/migration26 healing; fresh statement snapshot race protects live image. |
| ATT-07 | Real PNG finalized via mounted routes before trash; true separate-connection restore/purge orders preserve exact image when restore wins and remove it only when purge wins. |
| DEL-01 | Owner/manager delete; member/viewer403 and outsider404; exactly86400000ms server window and active count/query exclusion; actual UI confirmation. |
| DEL-02 | Admin-only board/project-scoped keyset list, actor/deadline and server-clock UI. |
| DEL-03 | SameID/content/comment/PNG restoration, exact-key replay, no window extension; rollback of compaction/state/versions/receipt/activity. |
| DEL-04 | Normal mounted moves produce dense1000/1001gap; logical insertion index survives compaction. Both/one/no anchor and head/tail/empty controls pass. Owner/Manager actual picker excludes retired column and restores explicitly into active same-board column. |
| DEL-05 | Deadline-1ms succeeds200, exactly deadline gives authorized410; late cleanup never grants a longer window. |
| DEL-06 | Live three-PID wait graph, one winner/event and no losing effect; restore-first preserves source/bytes; purge-first safe503 then original-command/key404; repeat purge no-op. |
| DEL-07 | Recoverable card/comment/notification/activity/import copies scrubbed; minimal receipts/import tombstones remain; object cleanup keys survive storage refusal and retry. |
| DEL-08 | Trashed edit/move/comment/new upload/content refusal with no title/object effects; canonical refused data hidden while actor-owned safe unsent drafts persist. |

Actual image/CMYK/cache browser evidence is attributed to root product-resume03, not this reviewer. All its image/UI input hashes still match; only the later import adapter changed. Therefore it is not represented as a complete final-target browser rerun. Fresh required browser integration runs on the final complete source. Picker evidence is attributed to builder logs02/03, with all5held source hashes matching; this reviewer visually inspected the settled Manager picker screenshot. No screenshot alone proves database behavior.

## Why and options

Finalization now saves a database reference to the already-known private image key. A failed database commit can then leave the upload retryable without losing its bytes or creating an unknown orphan. Copying/deleting objects before commit is simpler to picture but cannot be undone by PostgreSQL rollback. The tradeoff is that bucket expiry rules must respect the database lifecycle.

Similarly, a card's rank is a sorting number, and repeated moves can consume the gap between neighboring numbers. Restoring by a saved logical gap, then spreading ranks and recalculating within that gap, preserves the card's intended place. Appending after compaction lost that place. The set-based update avoids a separate query for every card.

## Fixed category scores

| Category | Weight | Score | Minimum | Evidence and deductions |
|---|---:|---:|---:|---|
| Security/authority |30|9.2|9.0|Mounted role/session/grant/ancestry negatives; actual runtime admission, bounded codec and retained work checks; private post-storage reauthorization. Custom parser/native-service boundary prevents a perfect score. |
| Functional/API |25|9.1|8.5|All15local behaviors plus actual browser/realworkerd and typed contracts; historical picker/rank defects resolved. Manual contention retry remains less complete UX. |
| Integrity/concurrency |15|9.2|8.5|Real separate connections, live wait graph, rollback/same-key/compaction/snapshot-race and actual finalized bytes. Safe deadlock recovery is less desirable than common lock ordering. |
| Tests/independent evidence |15|9.1|8.5|Fresh14commands, own48PG/51UI/53codec, retained failed attempts and explicit executor attribution. Finite corpus and inherited targeted probes are not universal codec proof. |
| Maintainability/portability |10|8.4|7.5|Runtime-specific verifiers, shared contracts and SQL migrations; readable logical-gap repair. Custom entropy parser and native warning mutex add complexity; purge comment overstates absence of deadlocks. |
| Operations/recovery |5|7.8|7.0|Bounded work/body/queues, safe errors and durable cleanup. Known restore/purge deadlock503 and lack of retained-command Trash UI retry warrant deductions. Hosted plan/CPU/R2/cron is separately pending. |

Exact weighted total `(9.2*30+9.1*25+9.2*15+9.1*15+8.4*10+7.8*5)/100 = 9.01`, strictly above8.5. No average overrides a blocker; none remains in the local gate.

## Findings, recovery limit and counterevidence

Historical mandatory disabled-picker and dense-gap defects are resolved by current mounted tests and attributed actual UI evidence. Prior image finalization rollback/expiry/snapshot deletion defects are likewise independently retested on the held image source. Their old failed artifacts remain preserved.

The purge-first card/context/activity foreign-key deadlock is real. Own probe logs purgerPID17171 waiting on restorePID17173 and that restore waiting on the purger. PostgreSQL aborts losing restore, response503/Retry-After1, with0surviving restore receipt/event. Original body/key retry404 after committed purge does not resurrect private content. Restore-first preserves the exact PNG and comment and creates one restore event. This satisfies fixed DEL-06's one-winner/no-purge-after-restore requirement; it is **not** a promise that no deadlocks occur.

Trash UI does not retain the restore key or supply a toast retry callback; manual reinvocation uses a new key. This is an open **nonmandatory, nonblocking operational/UX improvement**, explicitly deducted above. The fixed DEL criteria require cleanup retry and safe backend receipt/winner boundaries; they do not require automatic/retained-key Trash UI replay. Comment/import/finalize original-command requirements remain enforced separately. No mandatory requirement was relabeled deferred. Safe refusal after committed purge cannot be turned into recovery by changing keys. A future failure with surviving losing effects or purge of a restore winner would immediately block.

Other rejected candidates: the unlocked adapter card read is protected by mounted receipt/context locks; PNG palette recovery follows the recorded native policy rather than universal original-file conformance; malformed JPEG browser fallback does not demonstrate acceptance of an incompatible original because server validation remains mandatory. No new exploit/disclosure is demonstrated.

## Next / limits

Root may consume the local backend review for role-owned downstream evidence and exact-candidate local gate aggregation. Do not claim final feature/UI/integration closure until prerequisite and exact backend/UI evidence bindings genuinely pass. No user action is required by this review itself.

Before new UAT traffic, remove and live-verify **only** the enabled `staging/`24h expiry rule while preserving multipart abort. Saved images retain that key; leaving the rule could destroy saved files. This reviewer made no cloud mutation. Actual Images binding/account plan/CPU/quota, private R2durability/policy, scheduler, OAuth/mail and signed-in hosted acceptance remain UAT pending under local→deploy→hosted. Local memory/R2emulation, finite codec corpora and timing do not establish those hosted properties or production approval.
