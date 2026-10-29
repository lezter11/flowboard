# FND-01 local backend harness

Local infrastructure only. Product API v0.3 remains specified in `../../docs/API.md`; no session, project, card or permission implementation exists here yet.

Use Node **24.15.0**, npm **11.12.1** and a running Docker engine with Compose. From the repository root:

```sh
npm ci
npm run db:up
npm run check
```

`check` type-checks strict TypeScript, compiles Node output, bundles the Worker with `--dry-run` (no deployment) and runs five tests against actual PostgreSQL, including local workerd execution. No database tests are skipped when PostgreSQL is missing: the check fails. No Cloudflare account is required.

Run either local entry point in its own terminal:

```sh
npm run dev:api
```

```sh
DATABASE_URL='<local PostgreSQL URL from database/compose.local.yaml>' npm run dev:worker
```

`dev:worker` refuses to start without `DATABASE_URL`. It passes that URL to wrangler as `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, which wrangler requires for the Hyperdrive binding in local mode. The URL is not written to any file. Use only a local database here.

Node listens only on `127.0.0.1:3000`; Worker development listens on `127.0.0.1:8787`. Request examples:

```sh
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:8787/health/ready
```

`/health/live` returns `200 {"data":{"status":"ok"}}` without querying PostgreSQL. `/health/ready` runs a parameterized `SELECT 1`, returning `200 {"data":{"status":"ready"}}` or a safe 503 error with a request ID. Unknown routes, including unimplemented `/api/v1/*`, return JSON 404. These local health routes contain no private application data and have no authentication; do not treat them as an implemented product API.

PostgreSQL **17.11** is pinned by image digest in `../../database/compose.local.yaml`. It uses port `127.0.0.1:55432`, its own Compose project and disposable memory-backed data. The public `flowboard_local_only` password is a synthetic local fixture, never a cloud credential. No product migrations or persistent data are created. Stop it after working:

```sh
npm run db:down
```

Node uses a bounded pool (four connections); Worker readiness uses one request-scoped connection and closes it. Tests insert only into a session-local temporary table, force a rollback, verify zero rows and commit a positive control. The test-only Worker entry point under `test/` is absent from normal build output.

`wrangler.jsonc` holds the **production** Hyperdrive id, not a placeholder. Local development never reads it for a connection: `dev:worker` supplies the local string through the environment variable above. The test-only config under `test/` has no Hyperdrive id string; the worker test sets the variable from `DATABASE_URL` itself. Local mode connects directly to PostgreSQL; it does **not** exercise hosted Hyperdrive pooling, query caching or Neon. The compatibility date is pinned to `2026-10-19`, supported by the installed workerd. Change it deliberately with compatibility verification. Do not deploy this local configuration.

Full results, source references, limitations and the backend handoff are in `../../docs/evidence/FND-01-local.md` and `../../docs/handoffs/backend/FND-01.json`.
