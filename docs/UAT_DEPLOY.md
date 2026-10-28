# UAT deploy runbook

Redeploy UAT from any commit in a few minutes. UAT is the only hosted environment besides production; production is never touched by these steps.

Targets (UAT only):
- Worker: `flowboard-api-uat` (`npx wrangler deploy --env uat`, Hyperdrive `7a1e3a69f51e41b1a8c46e0be263b814`).
- Pages: `flowboard-app-uat` (`https://flowboard-app-uat.pages.dev`), Functions proxy binding `API` -> `flowboard-api-uat`.
- Neon: project `misty-unit-76664549`, branch `uat` (`br-polished-term-a172b6x5`), database `neondb`. Schema-only copy of production at creation; it holds synthetic test data only.

Prerequisites: `node_modules` installed at the repo root and in `apps/web`; logged-in `wrangler` (OAuth) and `neonctl` (`npx neonctl@latest auth`). Never paste secrets into chat or commit them. Secrets for UAT are set once with `npx wrangler secret put <NAME> --env uat`.

## 0. Choose the commit

```sh
cd /Users/shubham/Documents/Flowboard
export UAT_COMMIT=$(git rev-parse HEAD)   # or a specific commit hash
git cat-file -t "$UAT_COMMIT"
```

Build from a clean worktree so other chats' uncommitted edits are never deployed:

```sh
export REPO=/Users/shubham/Documents/Flowboard
export WT=$(mktemp -d)/uat-wt
git -C "$REPO" worktree add --detach "$WT" "$UAT_COMMIT"
ln -s "$REPO/node_modules" "$WT/node_modules"
ln -s "$REPO/apps/web/node_modules" "$WT/apps/web/node_modules"
```

## 1. Migrate the UAT database (additive, idempotent)

Only versions missing from `schema_migrations` are applied; the runner takes an advisory lock. Use the direct host (no `-pooler`).

```sh
cd "$WT/apps/api"
CS=$(npx neonctl@latest connection-string uat --project-id misty-unit-76664549 --database-name neondb --role-name neondb_owner)
ALLOW_REMOTE_DB=true DATABASE_URL="$CS" npm run -s db:migrate
```

Expect "already up to date" or `+ [000N]` lines for new versions. Stop on any error; do not retry blindly.

## 2. Deploy the UAT Worker

```sh
cd "$WT/apps/api"
npx wrangler deploy --env uat
```

Note the printed `Current Version ID` in the notes for this deploy.

## 3. Build the web app (no baked-in API URL)

```sh
cd "$WT/apps/web"
env -u NEXT_PUBLIC_API_URL NEXT_EXPORT=true npx next build
```

## 4. Deploy the UAT Pages project

Pages ignores `--config`, so stage the files with the UAT config:

```sh
export STAGE=$(mktemp -d)
cp -RL "$WT/apps/web/out" "$WT/apps/web/functions" "$STAGE/"
cp "$WT/apps/web/wrangler.uat.jsonc" "$STAGE/wrangler.jsonc"
cd "$STAGE"
"$REPO/node_modules/.bin/wrangler" pages deploy out --project-name flowboard-app-uat --branch main
```

Note the deployment URL printed (`https://<id>.flowboard-app-uat.pages.dev`).

## 5. Smoke checks (curl, no session needed)

```sh
U=https://flowboard-app-uat.pages.dev
curl -s -o /dev/null -w "/ %{http_code}\n" $U/
curl -s -o /dev/null -w "/project?id=x %{http_code}\n" "$U/project?id=x"
curl -s -o /dev/null -w "/board?id=x %{http_code}\n" "$U/board?id=x"
curl -s -o /dev/null -w "/projects/x -> %{redirect_url}\n" $U/projects/x
curl -s -o /dev/null -w "/boards/x -> %{redirect_url}\n" $U/boards/x
curl -s -w " %{http_code}\n" $U/api/v1/session | tail -c 40         # expect 401 JSON
curl -s -o /dev/null -w "system/status no secret %{http_code}\n" $U/api/v1/system/status   # expect 403
curl -s -o /dev/null -w "dev-login %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"email":"a@b.co"}' $U/api/v1/session/dev-login   # expect 404
curl -s -i -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" $U/api/v1/session | grep -ci "access-control-allow-origin: https://evil"   # expect 0
```

Then a browser pass: sign in (Google account chooser needs a human click), create a card, move it with the arrow button, reload, sign out and confirm `/api/v1/session` returns 401.

## 6. Clean up

```sh
git -C "$REPO" worktree remove --force "$WT"
```

## Notes

- Do not deploy UAT from the shared checkout; always use a worktree at a named commit.
- The Worker cron for UAT is `*/15 * * * *`.
- The UAT Google client is the same as production's; both redirect URIs must stay registered.
- The `uat` Neon branch expires 2026-11-27 unless extended.
- Production has its own steps in `docs/RELEASE_BETA.md`; this file never touches production.

## Deployment log

| Date (UTC) | Commit | Worker version (`flowboard-api-uat`) | Pages deployment (`flowboard-app-uat`) | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-28 | `02ab8e1` | `3c70f1dd-0f73-497f-9a64-455c8666c652` | `39f565f3-ee1b-47a9-81c0-02aeaa1dbf69` | 0001-0008 (already up to date) |
| 2026-10-29 00:30 IST | `242ddf5` | `1cad03e8-7604-4b56-95ea-5809c0546283` | `89601ced-1143-4c38-ae73-b8ed63ababac` | 0001-0008 (already up to date) |

Unauthenticated smoke for `242ddf5`: Worker `/health/ready` 200; signed-out `/api/v1/session` 401; `/signin` 200 and renders the gradient "Flowboard" wordmark (pane screenshot, not saved to Git); `/board?id=` 200 shell; foreign-origin preflight has no allow-origin; `/api/v1/system/status` without secret 403; legacy `/projects/<id>` and `/boards/<id>` 302 to query routes. Signed-in checks were not run for this deploy.

Smoke results for this deploy: `/` 200; signed-out `/api/v1/session` 401; `/api/v1/system/status` without secret 403; foreign-origin preflight has no allow-origin; `/projects/<id>` and `/boards/<id>` 302 to query routes; Worker `/health/ready` 200 and `/health/live` 200 (called on the Worker host, see notes).

## Manual judgment this deploy needed (to tighten)

1. Health checks are mounted at the Worker root (`/health/ready`), not under `/api`. The Pages proxy only forwards `/api/*`, so check them on `https://flowboard-api-uat.web-app-cloud.workers.dev/health/ready`. Step 5 above should say so.
2. The `neonctl connection-string` output must be checked for the direct host (`ep-shy-fire-…`, no `-pooler`) before running the migration. This was checked by eye.
3. The migration list must be read before deploying. Step 1 has no command for this. Use the status endpoint with the admin secret read from a local file (never printed).
4. The worktree needs `node_modules` symlinks at both the root and `apps/web`. Without them the Next build fails with `Cannot read properties of undefined (reading 'fileExists')`.
5. Record the Worker version from `wrangler deploy --env uat` output and the Pages deployment id from `wrangler pages deployment list --project-name flowboard-app-uat`. Both are copied into the log above by hand.
6. The deploy uses the committed `wrangler.jsonc` at the commit, not any uncommitted edit in the shared checkout.

## Deploy log addendum: 64b5ba1 with migration 0009

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-28 | `64b5ba1` | `692cfd67-795b-43d5-9b82-ca615613f9e0` | `993cc6d2-8496-4f0e-ba07-c9bac7165d05` | 0001-0009; runner applied `+ [0009] 0009_card_keys_and_key_prefix.sql` |

Migration 0009 review: additive and non-destructive. It creates a sequence and two nullable-then-`NOT NULL` columns, backfills existing rows, and adds a unique index. It has no `DROP`, `DELETE` or `TRUNCATE`. Production notes: the `cards` backfill rewrites every card row, and `CREATE UNIQUE INDEX` takes a write lock on `cards`. Run it in a window, or split the index into `CREATE UNIQUE INDEX CONCURRENTLY` before production.

Backup: a Neon child branch could not be created from `uat` because the branch has an expiry date (Neon rejects children of expiring branches). Instead, every UAT table was exported to a local JSON file (24 tables, synthetic data, kept outside Git). Create a Neon backup branch from `uat` only after the UAT expiry is removed, with Architect approval.

Smoke for `64b5ba1`: Worker `/health/ready` 200; signed-out `/api/v1/session` 401; `/signin` 200 with the wordmark (pane screenshot); `/projects`, `/project?id=`, `/board?id=`, `/activity` all 200; foreign-origin preflight has no allow-origin; `/api/v1/system/status` without secret 403; legacy `/projects/<id>` and `/boards/<id>` 302 to query routes.
