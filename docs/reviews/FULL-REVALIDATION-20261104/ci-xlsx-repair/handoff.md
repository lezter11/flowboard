# Builder handoff: CI legal XLSX parse-boundary repair

Source held 2026-11-04 05:06:05 UTC. Builder `/root/urgent_ci_xlsx_fix`; no self score or acceptance approval. Parent owns publication, complete Linux CI and independent review. Baseline bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a. Exact changed-file hashes and broader API/contracts/database/tooling dependency files are in `held-source.json`; digest `89a1b9f830a3bb19390f7f931c2c210642ebdafc2db3b7cd25170e8d154440be`.

## Actions

- Added a bounded fast path in `apps/api/src/services/import-xml.ts`: text without references returns directly; original text containing only `&amp;` references uses native replacement. Mixed/numeric/unknown/malformed references retain the original strict decoder.
- Corrected the broad Worker test name and strengthened its unchanged maximum workbook assertion to compare the complete original description and External ID for all 200 rows.
- Added three decoder regressions for repeated ampersands, exactly-once decoding, mixed numeric/builtin references, and malformed references following a long legal prefix.
- No budgets, XML grammar/validation, ZIP integrity, domain-write paths, contracts, migrations, dependencies or runtime configuration changed.

## Why and options

A Flowboard description containing 20,000 ampersands becomes 100,000 XML characters because each ampersand is stored as `&amp;`. The existing 200-row fixture therefore requires four million entity callbacks. Measured actual local workerd phases identified entity/tree conversion as the largest stage. Native replacement removes the callbacks for this common case while a check of the original input preserves exactly-once decoding. For example, original `&amp;#65;` must become literal `&#65;`, and must never turn into `A`.

Raising the one-second budget or weakening the workbook would change acceptance. Replacing the XML parser or skipping validation would broaden risk. This repair leaves those mechanisms intact. Numeric/mixed references still use the existing strict callback path, so this is not a claim of faster processing for every supported workbook.

## Evidence and limits

- Failing-before GitHub Linux run 41685962254: 1,768 tests, 1,767 pass, one fail, zero skipped; original maximum-description preview returns `422 PARSE_BUDGET_EXCEEDED` instead of 201. Full retrieved failed-job log preserved as `github-failing-before.log`.
- Local original parser passed in actual workerd, so the historical Linux failure was not reproduced locally. Baseline worksheet stage profile: decode/scalars 80 ms, preflight 23 ms, validator 193 ms, ordered parse 104 ms, entity/tree conversion 255 ms; decompression 5 ms. See `baseline-profile-2.log` and baseline instrumented snapshot.
- Patched corresponding profile: entity/tree conversion 144 ms; instrumented total 551 ms versus baseline 661 ms. Production full-parser warm measurements were approximately 613 ms versus baseline 664 ms. These are local macOS workerd wall-clock observations, not Linux, hosted CPU, memory, load or quota benchmarks.
- Parser focused tests: 122/122 pass, zero fail/skipped, exit 0. Combined nearest mounted/parser/import/actual-workerd suite: 156/156 pass, zero fail/skipped, exit 0. Typecheck and API build/Worker dry-run exit 0. Exact commands/counts/exits in `commands.json`.
- Original mounted Worker test verifies blank-template bytes and empty preview, 200-row parsing plus atomic commit, hostile XML rejection followed by usable isolate, full literal text, and the unchanged maximum description workbook with exact text in every row. Its maximum HTTP preview took 996.99 ms including database and response work. Hostile forest/text/depth rejection took 64.09/56.65/11.52 ms locally.
- Mounted tests also cover invalid uploads leaving no import/domain writes, rich text/CDATA/UTF16/namespace/package integrity, duplicate mapping, concurrent commit/revocation, receipt privacy and transaction rollback. Tests create/drop their own randomized schemas only.
- Initial sandbox profiler failure and absent optional import-database setup failure are recorded in `commands.json`; the latter full failure log is retained. `repair-profile.log` used baseline instrumentation for its `/profile` route; use `repair-profile-final.log` for the patched stage comparison. `/original` always means the production parser route loaded for that run, not an assertion that the source is baseline.
- Fixture SHA-256, compressed size 51,109 bytes and expanded per-part sizes are in `fixture-integrity.json`. All original upload/expanded/row/cell/entry/XML/time caps remain unchanged. Changed source hashes were rechecked after verification.

## Next / your input

Parent may publish the held source for complete Linux CI; no deployment is implied. Fresh independent reviewer `/root/urgent_independent_import_review` has the manifest and is assessing the exact target. No task closure or evidence rebinding until those gates pass. The authorized disposable `flowboard-full-revalidation-20261103` container is running, idle and released to parent/reviewer on loopback 55931; database `flowboard_harness`. No credentials were printed or saved. No user action needed for builder work.
