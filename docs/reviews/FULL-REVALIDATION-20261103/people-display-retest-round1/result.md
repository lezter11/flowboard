# PB-01 focused independent repair validation

Result: the previously reproduced People display bypass is no longer reproducible on these held People bytes. This is focused repair validation only, not a whole-domain backend pass, score, UI approval, global round2 acceptance or release approval. Prior round1 failure remains preserved.

## What was executed independently

1. Exact unchanged original failed probes: formal-projects-boards-round1/unscoped-people-probe.test.ts and display-scope-probe.test.ts. All three original assertions now pass: zero-board-grant Member default roster returns403; Member and Viewer explicit board-scoped display return403. Their permitted mention picker still returns200 and excludes the teammate lacking that board grant.
2. Current people-directory-policy.test.ts, nine tests: full email-directory authority; Member/Viewer board pickers;24 default/display alias combinations across granted and zero-grant states; outsider/removed privacy; Owner/Manager search, paging and archived/no-board access; direct adapter authentication/authority; both Manager demotion orderings for display and email-directory reads. Combined with original probes:12 tests pass,0 fail,0 skipped, exit0. See exact-probes-and-policy.log.
3. Three new reviewer controls: direct Pool adapter denial when demotion wins; direct Pool adapter holding authority through roster assembly when display wins (distinct PostgreSQL connection observed blocked); invalid/missing-board+query/cursor display denial before optional board lookup, plus permitted Member/Viewer assignee/mention filters and grantless Manager directory access.3 pass,0 fail,0 skipped, exit0. See direct-pool-controls.test.ts/log.

Total independently executed in this focused retest:15 passing tests, zero failures/skips. Tests used only authorized PostgreSQL17.11 loopback55931, owned flowboard_harness synthetic identity/import databases and per-test random schemas, removed afterward. No hosted calls or real users.

## Source explanation

The route now checks default/display Owner/Manager authority before optional board lookup. The shared display adapter independently requires an authenticated actor, locks workspace ownership/current project membership through roster assembly, and establishes/releases its own transaction for direct Pool callers. Thus a board ID or a harmless-looking name-only response cannot bypass the directory rule. For example, a Viewer can select an eligible person in a board's mention picker but cannot turn the same endpoint into the full project roster.

The Owner/Manager route and direct Pool authorization remain current during concurrent demotion: whichever obtains the membership lock first completes in that order. This prevents checking Manager once and then returning the directory after demotion commits. It adds a short lock lifetime; avoiding that lock would require another equally strong consistency protocol.

The production callers of the repaired rbac adapter were traced: mounted projects route passes actorId, and assignee/mention helpers retain their existing purpose. The separately named legacy projects adapter delegates to the already restricted getProjectMembers.

## Held bytes and limits

All five parent-held files matched before and after execution: rbac.ts, routes/projects.ts, people-directory-policy.test.ts, rbac-advanced.test.ts and docs/API.md. See held-before.json and held-after.json for exact SHA256. Only the People repair was frozen; unrelated import/XML and other global changes were outside this check. Existing broader RBAC suite was read for compatibility but not rerun here. No full14-command independent gate or browser/hosted verification is claimed. PB-01 can be treated as repaired for these bytes, subject to the forthcoming immutable global review; earlier formal fail records remain historical evidence.
