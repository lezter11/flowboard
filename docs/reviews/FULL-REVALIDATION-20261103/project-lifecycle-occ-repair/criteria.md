# Project lifecycle concurrency repair — acceptance before implementation

PB-02 was independently reproduced by Architect with the unchanged reviewer probe: archive version1, reopen version2, then delayed archive expectedVersion1 returns200 and overwrites the newer state to archived/version4. `raw/root-project-lifecycle-occ-red.log` records1failure/no skips/exit1 on disposable PostgreSQL17.11-alpine loopback55931. Shared `projectLifecycleInputSchema`, current UI and API table already require expectedVersion; stale documentation cannot waive the requirement.

- Archive and reopen remain Owner-only; active non-Owners403, unknown/foreign/removed404. Validate the actual shared request schema, including missing/invalid version, after authority checks.
- Lock the project row and compare the submitted version against its current version before lifecycle or quota effects. A stale command returns409 STALE_VERSION and changes no project/receipt/history/quota state.
- Include the normalized request body in receipt identity. Exact same key/body replays safely after subsequent state transitions; changed expectedVersion under that key conflicts instead of being silently treated as the same command.
- Separate real PostgreSQL connections submitting opposite commands with the same observed version permit at most one logical transition/version increment/receipt. No raw deadlock/serialization error or leaked resource.
- Preserve existing owner quota serialization and archived read-only behavior. Do not query a fresh version inside application execution to overwrite client intent. Legacy test convenience helpers may supply an observed fixture version only when a test omitted it; stale-version regressions always pass explicit fixed values.
- Both Node/Worker builds, focused existing lifecycle/quota/permission tests and full frozen required gates must pass. Keep prior failed reviews; next review is independent and cannot self-score or declare hosted acceptance.
