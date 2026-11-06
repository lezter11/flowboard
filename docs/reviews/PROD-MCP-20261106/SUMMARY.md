# Production release — 6 November 2026

**Flowboard is live at [flowboard-app.pages.dev](https://flowboard-app.pages.dev).** The hosted Claude connector, sample card prompt and CPU repair are deployed. The requested “Update in progress” banner was shown during rollout verification and is now off. A real anonymous browser verified that it disappeared in the same open page without a reload.

## Actions

The release uses application commit `d6e36744da584579dbd99203eb4607dafe60e22b`. The live Worker is `cc432b3b-ecd0-4e4c-8939-3c1504a49623` at 100%; fetched bytes match SHA-256 `9bc6986e15691ad32aaf67b8490bf4dadcba01c769add4a0c42281beb4f1204d`. Final Pages deployment is `d0506410-b1d7-46f3-8b75-f5a69d9db4f4`, with the exact release source, clean-source metadata and production API binding. The final status file is inactive, uncached and byte-identical to the prepared configuration.

Only the approved old Oct29 UAT backup and its own compute were deleted; every other branch and endpoint was preserved. Fresh production backup `br-misty-band-a141u8yh` was created at 06:46:08 UTC on Nov6, ready and data-bearing, with no compute. Its Nov5 name prefix is a legacy campaign label. Both previous production backups remain. Read-only pre/post checks confirm the same 27 migration versions and names. No migration, downmigration or database restore was run.

## Why and options

The banner follows a tiny public status file rather than querying the database. It can disappear without refreshing a teammate’s draft. On/off deployment variants differ only in that file. Network failures retain the last known state; explicit 404/410 clears it after a legacy rollback. Existing old-version tabs need one full page load to acquire the new component. This is a notice, not a maintenance or access-control lock.

## Evidence and limits

- Scoped review: **9.04**. Composed local review: **8.945**, with all category floors met. Current checklist: **98 backend / 74 UI / 98 local integration**. All 1,570 references and 270 role bindings were checked; historical handoffs and execution metadata were preserved.
- [One exact-candidate CI run](https://github.com/lezter11/flowboard/actions/runs/42173052691): **22 steps passed**. API: **1,966**; web: **350**; contracts: **137**; MCP: **22**, plus one installed-artifact test; native MCP: **22 groups**; hosted browser: **24 cases**. Legacy browser checks include 14 passing assertions and two observations. Coverage overlaps; these are not added into an invented total. Sanitized npm advisory check: zero reported vulnerabilities.
- Production observation: **900.001 seconds**, 15 observed invocations, two scheduled successes, **zero CPU terminations, exceptions or observed HTTP 5xx responses**. One preexisting idle-PostgreSQL connection error remains unresolved. The strict report remains **needs-inspection**; the Architect’s scoped disposition accepts that known label without claiming it harmless, fixed or unchanged in frequency. Tail delivery completeness and native CPU units are unverified; 236 stderr bytes were counted without retaining or classifying their contents. This small anonymous/scheduled sample is not a load test or exhaustive provider acceptance.
- Production browser: 31 requests, active-to-inactive in the same document, no status cookies/Authorization/Referer, no runtime errors and successful cleanup. Production anonymous smoke: **18/18**. UAT’s first timed clearing attempt failed and remains preserved; its diagnosed rerun passed. The public ledger totals 51 production and 83 UAT reads, including assets and failed attempts. Probes made no authenticated request or application record write.
- Separate read-only aggregate counts do not prove row/content equality. No restore drill was performed. Scheduled success does not prove every external email or storage effect. Owner-reported UAT success is recorded separately. Real production Google/Claude testing remains deferred, not verified; the 98-feature counts are local acceptance, not blanket hosted acceptance.

## Next / owner input

No further input is required for this rollout. Test production whenever ready using the [short production guide](../../../HOSTED_MCP_PRODUCTION.md). Connector URL: `https://flowboard-app.pages.dev/api/v1/mcp`. Settings → Connections includes **Copy sample prompt** with required destination/title and optional priority, date and description. Assignment remains manual; existing-card MCP edits and company client credentials remain future scope.

Git promotion is recorded after the final documentation commit; the tested application source remains the commit above. Docker, observation and test browsers are stopped. The final chat reply confirms the Git push before declaring laptop closure safe. The [final independent audit](composed-review/FINAL-RELEASE-AUDIT.md) and JSON receipts retain the exact source, backup, provider, runtime and acceptance boundaries.
