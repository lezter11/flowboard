# COM-03 and AUD-03/AUD-04 bounded repair result — 2026-11-03

## Actions

Implemented the frozen [criteria](criteria/discussion-activity-repair.json). Mentions now validate complete selected tokens, UTF-16 boundaries and canonical trim offsets. Activity feeds validate dates/ranges and bounded paging before PostgreSQL. Shared query exports are coordinated with root-owned OpenAPI bindings. Source manifests, exact commands and raw-log hashes are in [the JSON record](discussion-activity-result.json).

Changed source: `packages/contracts/src/discussion.ts` (normalization/span checks and three query schemas), `apps/api/src/adapters/comments.ts` (selected current identity and proven historical tokens on edit), `apps/api/src/http/routes/activity.ts` (shared query parsing). Added two focused test files and corrected old b9/com-del mention fixtures to displayed full names. Preserved lifecycle owner's retention hunks in comments.ts.

## Why and options

For a Flowboard comment `  😀 @Ada 🚀  `, JavaScript indices count an emoji as two UTF-16 units. Trimming the body without shifting its span moved the selection to the wrong text. The shared parser now moves both together, refuses split characters, and checks the selected token against the current board-scoped person. Trusting arbitrary spans allowed the ordinary word `hello` to notify someone. Removing trim would preserve indices but change existing stored-body behavior. An edit can keep a proven stored old name after rename, while a newly posted invented former name cannot notify.

A date string reaching PostgreSQL without validation produced an internal500. The shared route schema now returns422 for invalid dates, reversed ranges and malformed limits. Existing inclusive UTC-midnight semantics for date-only bounds remain; `toDate=2026-11-03` does not silently expand to the end of that day. The same filters remain ahead of the SQL page limit.

## Evidence and limits

- New targeted suite: **8/8**, no skipped tests, exit0 (six mounted PostgreSQL cases plus two contract cases), `raw/discussion-activity-targeted-final.log`.
- Nearest six legacy discussion/activity suites: **89/89**, no skips, exit0, `raw/discussion-activity-legacy-final.log`. Authorization, revoked-reader notification privacy, edit no-renotify, minimal replay, concurrent move and retained-content behavior remain asserted.
- Root typecheck exit0; contracts **125/125**, no skips, exit0 after root regenerated OpenAPI; owned-path diff check exit0.
- Initial failing logs retained: arbitrary span201+notification, trim400 and invalid-date500. The original five-case red log also contains two corrected test-fixture errors, not product defects (per-request requestId comparison and missing activity visibility scope).
- First legacy run73pass/11fail included parent/cascade counts from obsolete arbitrary/short-name fixtures. They were fixed to complete selected tokens without weakening assertions; final run reaches five additional notification subtests.
- Temporary stale OpenAPI golden/check failures are retained; root regenerated before final contract pass. JSON Schema cannot encode all trim/UTF16/database-eligibility/range semantics, so mounted/shared semantic tests remain required.

No full API/build/browser/hosted verification, performance claim, score, approval or feature closure is implied. Synthetic primary/access reservations are released. Fresh independent review on the complete final source and hosted UAT remain pending.

## Next / your input

Root owns final artifact freeze, complete gates, independent reviews and direct UAT after local gates. No action needed from the user for this bounded handoff. Next assigned slice is validation-only Node/Worker protocol/performance-boundary evidence, with criteria frozen before probes and no runtime fixes without coordination.
