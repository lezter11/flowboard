# Hosted MCP UAT release preparation

**Status: read-only preparation. No release approval or cloud writes performed.** Current UAT remains d1c81f4. [Live metadata](preflight.json) and [fresh read-only ledger](uat-ledger.json) confirm the known UAT resources. GitHub write access and Wrangler OAuth account-match were reverified with raw authentication output filtered.

## Gates before promotion

- The backend API-only review is an upstream handoff, not whole-feature approval. Complete consent/Connections UI and re-review final safe-next/Google callback changes.
- Run all required existing CI steps plus new hosted browser/static Pages proxy tests and fresh whole-feature independent review against one held source manifest. Preserve failed rounds. Validate the review record; never rebind old scores mechanically.
- Commit reviewed source/evidence to a named candidate, push through authorized UAT source workflow and wait for green Linux CI. Existing product acceptance remains tied to its original source until legitimately revalidated.
- Announce UAT promotion. Recheck live IDs and ledger immediately before writes; abort on unexpected changes. No bare Worker deploy: top-level config targets actual production.

## Exact artifact preparation

Create a clean detached candidate worktree outside the shared checkout under `/private/tmp/flowboard-hosted-release-<shortSHA>`. Install with the committed lockfile, or document byte-matching dependency reuse. The helper below accepts a full SHA and refuses a dirty/attached/unexpected candidate or an existing stage:

```sh
node docs/reviews/HOSTED-MCP-20261104/release-preparation/prepare-artifacts.mjs /private/tmp/flowboard-hosted-release-<shortSHA> <fullSHA> /private/tmp/flowboard-hosted-pages-<shortSHA>
```

This helper is **syntax checked only**, not yet executed. Its current revision whitelists the build environment and explicitly uses NODE_ENV=production with standard .next output; test-built Worker bundles must never be deployed. See ARCHITECT-RELEASE-SCRIPT-REVIEW-v2.json; the earlier preparation manifest is historical for this changed helper. It builds MCP/API, performs a UAT Worker dry-run, exports Next with no `NEXT_PUBLIC_API_URL`, recursively stages every Pages Function dependency and copies UAT configuration as `wrangler.jsonc`. It records artifact SHA-256 maps. Static `out/` alone is insufficient: Functions supply API proxy, discovery and routing. Audit the helper before use and preserve actual build command exits/logs.

## Backup and migration, after the gates

1. Re-run `read-uat-ledger.mjs` with network access. It only queries identity/schema metadata in `BEGIN READ ONLY`; known UAT project `misty-unit-76664549`, branch `br-polished-term-a172b6x5`, direct endpoint `ep-shy-fire-a1we7145.ap-southeast-1.aws.neon.tech`, database `neondb`, user `neondb_owner`. At preparation, ledger1–26 exists and only `0027_hosted_mcp_oauth.sql` is pending. Ledger history has no SQL checksums.
2. Refresh the already-user-approved encrypted local UAT backup immediately before migration. Adapt `/private/tmp/flowboard-uat-encrypted-backup-d1c81f4-release.mjs`; **do not execute it unchanged**. Replace old evidence/private directories with unique candidate-specific paths; use create-exclusive writes and preserve prior backups. Keep credentials solely in memory/child environment, never argv/output. Retain AES256GCM random key/IV, private directory0700/files0600, full authenticated decrypt equality and `pg_restore --list`; state honestly that archive verification is not an actual restore.
3. Improve the old helper’s failure handling before use: it can persist child `error.message`/stderr to a private log. For this release retain only error class, safe code, stage and exit; never persist raw provider diagnostics, connection URI, dump or key in Git or public logs.
4. Adapt `/private/tmp/flowboard-uat-migrate-reviewed.mjs` only after the clean candidate/review/backup exists. It hardcodes the old c1 source and19→26 ledger and must not run unchanged. Require exact clean candidate SHA, reviewed27file hashes, ledger exactly1–26, verified fresh backup ciphertext+private permissions+branch identity, and only additive migration27. Use the candidate’s `runMigrations`; verify ledger1–27, appliedexactly27 and exit0. Record only schema metadata, not rows/URI. Never run destructive test suites against UAT.

The adapted guarded replacements are now prepared here: `backup-uat.mjs`, `migrate-uat.mjs` and shared `uat-release-guards.mjs`. Their migration27 checksum is frozen to `067ee87e4e41d837e74a15424ba0e0db254989c3f3f05713b3019c539a3a0afd`; a changed migration requires fresh preparation/review. They enforce the exact UAT branch/direct host/database, a clean detached candidate fullSHA, exact migrations1–27, ledger1–26 and exclusive new receipts. Migration verifies a≤30minute-old matching backup by authenticating/decrypting its private archive, verifying its plaintext digest and running `pg_restore --list` before DB writes. It holds the same migration advisory lock over precondition/runner/postcondition. Error output is restricted to stage/class/safe code/exit. Root must inspect and approve the scripts against the final reviewed source before setting the explicit `FLOWBOARD_UAT_RELEASE_GATE=reviewed` invocation flag; the flag itself is an operational check, not independent approval proof.

No backup or migration script was executed in this preparation. Only syntax checks ran for these helpers. Only the read-only ledger helper queried UAT (network-denied exit1 retained in preflight, escalated read exit0).

After actual root gate clearance, substitute exact immutable values and use unique new receipt/private paths:

```sh
FLOWBOARD_UAT_RELEASE_GATE=reviewed node docs/reviews/HOSTED-MCP-20261104/release-preparation/backup-uat.mjs --candidate /private/tmp/flowboard-hosted-release-<shortSHA> --sha <fullSHA> --migration-sha 067ee87e4e41d837e74a15424ba0e0db254989c3f3f05713b3019c539a3a0afd --private-dir /Users/shubham/.codex/flowboard-uat-backups/hosted-mcp-<shortSHA>-<uniqueTimestamp> --receipt /absolute/new/backup-receipt.json
FLOWBOARD_UAT_RELEASE_GATE=reviewed node docs/reviews/HOSTED-MCP-20261104/release-preparation/migrate-uat.mjs --candidate /private/tmp/flowboard-hosted-release-<shortSHA> --sha <fullSHA> --migration-sha 067ee87e4e41d837e74a15424ba0e0db254989c3f3f05713b3019c539a3a0afd --backup-receipt /absolute/new/backup-receipt.json --receipt /absolute/new/migration-receipt.json
```

The backup streams no rows to terminal or plaintext disk: pg_dump returns its custom archive in memory, then AES256GCM ciphertext/key/private manifest are created exclusively with0700/0600 permissions outside Git. Full decrypt equality and archive listing are checked. **Actual database restore remains false.** No helper logs childstderr/providererrors/URI. On failure, stop, preserve the safe failure receipt and inspect live ledger before considering another invocation.

## GitHub automation and clean source commands

At preparation this repository has one workflow, `.github/workflows/ci.yml`. Pushes to `main`, `chore/**`, `feat/**`, `codex/**` and `uat` run verification with read-only repository permissions. The only Worker deployment-looking step is `wrangler deploy --dry-run`; there is **no hosted deployment Action**. A push/green CI will not itself update UAT. Worker and Pages uploads above remain explicit after CI/review.

The clean worktree route below reuses the local Git object store; it does not merge shared uncommitted changes. Replace placeholders only after the exact reviewed commit exists:

```sh
git push origin <fullSHA>:refs/heads/codex/hosted-mcp-browser-signin
git worktree add --detach /private/tmp/flowboard-hosted-release-<shortSHA> <fullSHA>
```

Then run `npm ci` in that clean candidate and the artifact helper above. A remote clone alternative is `git clone --no-checkout https://github.com/lezter11/flowboard.git /private/tmp/flowboard-hosted-release-<shortSHA>` followed by `git -C <candidate> checkout --detach <fullSHA>` and `npm ci`; it requires the commit already pushed. Do not interpret either source operation as deployment. Preserve passing Linux run URL/exactSHA before the backup/migration/upload steps.

## Deploy exact reviewed artifacts

From the clean candidate’s `apps/api`:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false node ../../node_modules/wrangler/bin/wrangler.js deploy --env uat
```

Reverify Worker artifact matches the prepared byte map and public origin remains `https://flowboard-app-uat.pages.dev`. Current config already provides APP_ORIGIN, CORS_ORIGIN, FRONTEND_URL, exact Google callback, UAT Hyperdrive, image bucket, image verifier and cron. Hosted OAuth introduces no new secret or enabling flag. Keep existing secrets without printing/replacing them.

From the prepared Pages stage (use absolute reviewed candidate Wrangler path):

```sh
NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false node /private/tmp/flowboard-hosted-release-<shortSHA>/node_modules/wrangler/bin/wrangler.js pages deploy out --project-name flowboard-app-uat --branch main --commit-hash <fullSHA> --commit-dirty=false
```

Pages must bind `API → flowboard-api-uat`, preserving the original public Pages request URL. An `API_ORIGIN` HTTP fallback rewrites the host and intentionally fails the hosted OAuth canonical-origin check. Never spoof Host/forwarded identity to compensate. Exact root metadata aliases must reach the API before sign-in routing and stay public/no-store. Test against the staged static export and actual Functions, not only Next dev.

After any upload failure, read live state before retrying; do not repeat migrations blindly. Record Worker version/deployment, Pages deployment/source/clean flag, actual binding references and candidate/artifact checksums. Provider upload success is not signed-in acceptance.

## Rollback and hosted checks

Before this release, Worker version `21d3c2d8-2955-4aab-9765-5db6ad568d2e` has100% traffic and Pages deployment `4dbcd83f-b562-4fc5-bbac-2e6f40bee529` is canonical. Capture them again before replacement. Roll back application artifacts to these known IDs if needed; retain additive schema27 and safe R2 lifecycle. No database down-migration or unsafe staging deletion restoration is authorized.

Use a small bounded anonymous smoke batch (record total, ≤60): health/live+ready; exact protected-resource and authorization-server metadata; unauthenticated MCP401 with correct discovery; unsupported methods/origin rejection; protected browser API401; consent and Connections routing through Pages. Never log callback queries or credentials. Then [colleague guide](COLLEAGUE-GUIDE.md) actual Google/Claude approval/create/search/disconnect/refresh tests. Distinguish synthetic browser evidence from real provider/Claude acceptance. Production remains excluded.

## Teaching

A service binding is Cloudflare’s private link between Pages and the API. It lets the API see the public Flowboard address while keeping ordinary board permissions in the API. A plain HTTP fallback is more portable but changes the request destination; using it here without careful design would break the exact address checks that protect OAuth. The chosen binding keeps the current Cloudflare deployment simple, while the underlying Hono/SQL business code remains portable.
