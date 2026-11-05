# Prepared production operations — held for independent review

**Not executed against production.** Only syntax and synthetic tests have run. Root owns approval, frozen candidate/CI and actual execution. These are intentionally specific release helpers, not a deployment framework. Production target is fixed in `prod-guards.mjs`; UAT receipt/branch credentials cannot satisfy it.

## Acceptance and guards

- Require `FLOWBOARD_PROD_RELEASE_GATE=reviewed`, a full40-character candidate SHA and clean detached candidate under `/private/tmp/flowboard-*` before any write.
- Compare all27canonical filenames and SHA-256 hashes against `migration-manifest.json`, both filesystem and committed Git bytes; inventory uses the actual normal runner regex and rejects matching symlinks/non-regular files or unexpected non-four-digit migrations.
- Neon CLI children receive a whitelist environment, fixed IPv4-first networking and no inherited DB URLs/test controls; stdout/stderr remain captured privately. Reports never serialize raw child errors, connection strings, secret values or application row data.
- Backup command uses fixed project and production parent, unique `production-backup-2026-11-05-mcp-pre-<random12hex>` name, `--no-secrets --no-compute` and default data-bearing mode (no schema-only flag). Independently read actual parent/name/new creation time/ready state and verify zero compute endpoints. Quota denial records `branch-quota-blocked`; no branch deletion, local production copy, retry or fallback occurs.
- Migration requires a fresh successful same-SHA production data-branch receipt plus a fresh actual parent/ready/timestamp check. Receipt and branch must be <=30minutes old; check again immediately before runner.
- Resolve and verify exact production direct endpoint and `neondb`/`neondb_owner`/PostgreSQL18 identity. Production Hyperdrive's pooled URI is never used. No connection string enters command arguments, logs or reports.
- Hold one outer normal migration advisory lock across ledger preconditions, runner and postconditions. The normal runner re-enters/unlocks the same session-level advisory lock; outer finally unlocks the remaining acquisition. Ledger must initially equal exact0001–0019. Refuse normalized column-name conflicts before any migration.
- Use the existing runner, preserving its per-file transaction/ledger atomicity; require exactly0020–0027 applied and final27-row ledger. Second normal runner invocation must report no pending migrations. Failure writes safe stage/ledger evidence and requires inspection, not an automatic resume. Earlier successful per-file commits remain after a later failure.
- Counts before/after are reported, with explicit concurrency limitations and intended0021/0023/0024/0026 transformations. They are not advertised as data snapshots or row-equality proof. No restore/downmigration/deletion is implemented.

## Root execution shape (not executed here)

Create a canonical existing receipt directory and choose unused receipt names. Run only after independent operations review and actual release gates. Each helper refuses overwriting an existing receipt.

```text
FLOWBOARD_PROD_RELEASE_GATE=reviewed node docs/reviews/PROD-MCP-20261105/operations/backup-prod-branch.mjs --candidate <clean-detached-private-tmp-path> --sha <full-reviewed-SHA> --receipt <absolute-new-backup-receipt.json>

FLOWBOARD_PROD_RELEASE_GATE=reviewed node docs/reviews/PROD-MCP-20261105/operations/migrate-prod.mjs --candidate <same-path> --sha <same-SHA> --backup-receipt <successful-backup-receipt.json> --receipt <absolute-new-migration-receipt.json>
```

If create fails or times out after submission, inspect the generated receipt/requested name and actual branch list before any further action. A branch may have been created even if a response was lost. A failed quota attempt is not a backup. A30-minute-old branch/receipt is deliberately refused; root must arrange a fresh approved backup instead of editing timestamps. No automatic alternative is permitted.

## Verification actually executed

Three Node syntax checks exit0; `node --test .../operations.test.mjs` **15passed,0failed,0skipped**, exit0, [log](unit-tests.log). Fixtures use a fixed timestamp. Tests cover argument/environment/error hygiene, quota classification, wrong production parent, invalid backup parent/state/name/age/deletion, wrong receipt SHA/project/status/data/compute/age, exact ledger names/counts, unexpected migration matching the real regex, symlinks/hash drift, duplicate normalized columns and normal-runner transaction/no-op/failure control flow using a fake client.

The fake-client tests execute the actual normal runner with real migration file bytes but **do not execute PostgreSQL SQL**, create a branch, verify a real restore or prove live migration compatibility. Existing full product/database evidence remains separate. No production connection or mutation was made by these tests. Review must inspect this distinction and the code before root executes.
