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
