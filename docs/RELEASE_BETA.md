# Beta production release runbook

Status: DRAFT, not executed. Nothing here has run against production. Execute only after the Architect's explicit go, one phase at a time. Names only; never write secret values anywhere.

Targets: Worker `flowboard-api`, Pages `flowboard-app` (`https://flowboard-app.pages.dev`), Neon project `misty-unit-76664549` branch `production` (`br-orange-union-a1kqetvn`), database `neondb`, Hyperdrive `flowboard-hyperdrive` (`18f56141…`).

Evidence base: the proxy path was exercised on UAT (Pages Function proxy -> Worker -> Hyperdrive -> Neon, migrations 0001-0008); UAT Google sign-in is not yet verified. The user reports Google sign-in works on CURRENT production (old build, cross-site cookies), so the production Google client exists. Beta risks accepted: docs/decisions/2026-10-28-beta-risk-acceptance.md.

## 0. Gates (all must be true)

- [ ] UAT Google login round trip passed (cookie set, session works through the proxy), or the Architect explicitly accepts releasing without it.
- [ ] Backend review gate passed for the commit being released; release from a clean tagged commit on the release branch.
- [ ] `npm test` / typecheck / build green for that commit (record the commit hash).
- [ ] Architect approved each production phase below.

## 1. Record current state (read-only, rollback anchors)

Recorded 2026-10-28 (read-only, re-check immediately before release):

- Worker `flowboard-api`: active version `acefdb67-a336-492a-91c2-9069e2f62cdb` (deployed 2026-10-28T14:34Z); previous `a2bed487-4d42-4053-906e-b89c05ca53fa`.
- Pages `flowboard-app` live Production deployment: `af89478d-f241-491e-9289-6f0f20e955a1` (identified by matching its HTML build id to the live site); other recent: `bf88fa29-cd64-4e34-bcda-0b33d10a0738`.
- Current production sign-in sends Google `redirect_uri=https://flowboard-api.web-app-cloud.workers.dev/api/v1/auth/google/callback` (observed from the `Location` header of a GET to the start route; no sign-in performed). So the Google client has the workers.dev callback today and does NOT yet have the pages.dev one.

```sh
cd apps/api
npx wrangler deployments list --name flowboard-api      # note the CURRENT version id (last seen: acefdb67-a336-492a-91c2-9069e2f62cdb, 2026-10-28T14:34Z)
npx wrangler pages deployment list --project-name flowboard-app   # note the newest Production deployment id
npx neonctl branches list --project-id misty-unit-76664549
```

Do not call `/api/v1/system/*` on the live Worker: the currently deployed (old) build falls back to a public default admin secret.

## 2. Database backup and migration (Neon `production`)

1. Backup branch with data (copy-on-write, instant): `npx neonctl branches create --project-id misty-unit-76664549 --name backup-pre-beta-YYYYMMDD --parent production`. Do not set `--schema-only`. Keep it until the beta is accepted; also note the restore window (Neon history retention) in the evidence log.
2. Migration review (done in this draft, re-check at release): `database/migrations/0001..0008` contain no `DROP`, `TRUNCATE`, `RENAME` or `ALTER ... DROP`. The only `DELETE` is inside the 0007 trigger body (removes a user's board grants when a membership is removed), not a data-destructive statement.
3. Apply with the app runner (idempotent: applies only versions missing from `schema_migrations`, serialized by an advisory lock). Use the DIRECT endpoint (no `-pooler`), because advisory locks and DDL do not belong behind a transaction pooler:

```sh
cd apps/api
CS=$(npx neonctl connection-string production --project-id misty-unit-76664549 --database-name neondb --role-name neondb_owner)
ALLOW_REMOTE_DB=true DATABASE_URL="$CS" npm run -s db:migrate
```

   Expected output: either "already up to date" or `+ [000N]` lines for pending versions only. If a migration errors, STOP: do not retry blindly; restore decision goes to the Architect (see Rollback).
4. Confirm: `schema_migrations` lists 0001-0008 (via the runner output or, after step 5, `/api/v1/system/status`).

Schema is additive, so the currently running old Worker keeps working between steps 2 and 5 (expand first, deploy code second, per docs/DELIVERY.md).

## 3. Production secrets, vars and Google console (all BEFORE any deploy, R3-07)

Set with `npx wrangler secret put NAME` (no `--env`), run by the operator in their own terminal:

| Secret | Action |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Already set. Replace only if moving to a new Google client. |
| `CURSOR_SECRET` | NEW. 32+ random characters (`openssl rand -base64 48`). |
| `DEV_LOGIN_SECRET` | NEW. 32+ random characters. Admin secret for `/api/v1/system/*`. Different from UAT. |

Vars are committed in `apps/api/wrangler.jsonc` (top level): `FRONTEND_URL`, `CORS_ORIGIN`, `GOOGLE_REDIRECT_URI` (all `flowboard-app.pages.dev`). Do NOT set `DEV_LOGIN_ENABLED` or `NODE_ENV` on the Worker.

Setting a secret on a Worker creates a new version that is deployed immediately, so set `CURSOR_SECRET` and `DEV_LOGIN_SECRET` first and confirm the site still works (the old code ignores unknown secrets; it uses `DEV_LOGIN_SECRET` for the admin routes, which also closes the public default fallback). Check `wrangler deployments list` afterwards and update the rollback anchor to the new version id.

Google console (existing production client): ADD authorized redirect URI `https://flowboard-app.pages.dev/api/v1/auth/google/callback`. KEEP the existing workers.dev callback until after smoke tests, because the old build and a rollback still use it; remove it only after the beta is accepted. No JavaScript origin is needed (server-side redirect flow). Adding a URI does not affect current sign-in, so this can be done any time before the cutover.

## 4. Cutover: Worker and Pages together

Why together: the new Worker uses `SameSite=Lax` cookies and an exact CORS origin, so the OLD Pages build (calls workers.dev cross-site) stops signing in the moment the new Worker is live; the NEW Pages build on the old Worker was not tested. Run the steps below back-to-back from one terminal; the intended window is about two minutes. Existing signed-in users will be signed out (cookie name/attributes change), which is acceptable for the beta.

Prepare first (no production effect): build the web app and the staging dir, verify the Worker bundle.

```sh
cd apps/web
env -u NEXT_PUBLIC_API_URL NEXT_EXPORT=true npx next build
export ST=$(mktemp -d) && cp -R out functions "$ST"/ && cp wrangler.prod.jsonc "$ST"/wrangler.jsonc
cd ../api && npx wrangler deploy --dry-run --outdir /tmp/flowboard-api-dry
```

Then, with the Architect's go:

1. `cd apps/api && npx wrangler deploy` (top level == production). Note the new version id.
2. Direct Worker check: `GET https://flowboard-api.web-app-cloud.workers.dev/api/v1/session` is 401 JSON; `/api/v1/system/status` without secret is 403.
3. `cd "$ST" && <repo>/node_modules/.bin/wrangler pages deploy out --project-name flowboard-app --branch main`. This makes `wrangler.prod.jsonc` the source of truth for the `API` service binding to `flowboard-api`.
4. Run section 5. If any of items 1-8 fails, roll back immediately (section 7, both at once).
5. After acceptance: remove the old workers.dev redirect URI from Google; decide on `workers_dev = false` for the Worker (separate approved deploy).

## 5. Smoke tests (record status codes, never tokens)

Host `P=https://flowboard-app.pages.dev`.

1. `GET $P/` is 200 and the page loads with no console errors.
2. `GET $P/api/v1/session` without a cookie is 401 JSON with `Cache-Control: no-store`.
3. Admin routes without secret fail: `GET $P/api/v1/system/status` is 403; `POST $P/api/v1/system/migrate` is 403.
4. Dev login closed: `POST $P/api/v1/session/dev-login` is 404.
5. CORS with a foreign origin must fail: `curl -si -X OPTIONS -H "Origin: https://evil.pages.dev" -H "Access-Control-Request-Method: POST" $P/api/v1/session` returns no `access-control-allow-origin` for that origin. Repeat against the direct workers.dev URL.
6. Admin with the real secret returns migrations 0001-0008 (operator supplies the secret locally; do not paste it).
7. Login round trip in a real browser: Sign in with Google, return to `$P`, reload, session persists. Check the cookie in DevTools: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only on `flowboard-app.pages.dev` (no Domain attribute).
8. Product flow: create a project, a board and a card; reload and confirm they persist; logout and confirm `/api/v1/session` is 401.
9. Logs: watch `npx wrangler tail flowboard-api --format pretty` during 7-8; expect no 5xx, no Hyperdrive/Neon connection errors.

## 6. What stays disabled or limited

- Dev login (`DEV_LOGIN_ENABLED`, `NODE_ENV=development`): never set in production; route additionally returns 404 on any Worker with a Hyperdrive binding.
- Admin routes: only with `DEV_LOGIN_SECRET`; no default fallback in the new build.
- Cron: `*/5 * * * *` (was every minute) for trash purge and outbox. Raise or lower after observing load. UAT/dev use `*/15`.
- Wildcard `*.pages.dev` / `*.workers.dev` CORS trust: removed in the new build (exact `CORS_ORIGIN` only).
- Hyperdrive caching: stays disabled.

## 7. Rollback

Decision order: stop, assess, then the least destructive option.

0. Fast full rollback (both, about one minute): `npx wrangler rollback acefdb67-a336-492a-91c2-9069e2f62cdb --name flowboard-api` (use the id recorded after step 3 of section 3 if the secrets created a newer version), then in the dashboard roll Pages back to deployment `af89478d-f241-491e-9289-6f0f20e955a1`. The old Google callback is still registered, so the old build signs in again.
1. Worker only: `npx wrangler rollback <previous-version-id> --name flowboard-api` (id from section 1). Instant. This does NOT undo database changes.
2. Pages only: in the Cloudflare dashboard, Workers & Pages -> flowboard-app -> Deployments -> choose the previous Production deployment -> Rollback (id from section 1). The old build calls the Worker at workers.dev directly and needs the old Worker's `SameSite=None` cookies and wildcard CORS, so a Pages rollback requires the Worker rollback too, or sign-in will fail.
3. Database: migrations are additive, so the old Worker runs on the new schema; prefer NOT to touch data. If data or schema is damaged, use Neon restore from `backup-pre-beta-YYYYMMDD` (or point-in-time restore) into a NEW branch first, verify, then repoint Hyperdrive (`wrangler hyperdrive update`) after Architect approval. Writes made after the backup are lost on restore; define the write freeze before restoring.
4. Secrets: re-run `wrangler secret put` with the previous value only if rotation caused the failure; never print values.

## 8. Known risks to review before go

- Hyperdrive `flowboard-hyperdrive` currently targets the Neon `-pooler` host with role `neondb_owner`. Architecture says Hyperdrive should use the direct endpoint to avoid stacked poolers, and a least-privilege role is preferred. Not changed here; repointing is a separate approved change (`wrangler hyperdrive update`) to test on UAT first.
- Free-tier limits: Pages Function invocations and Worker requests share the 100k/day free allowance; every `/api` call is two invocations.
- Neon free plan scale-to-zero adds cold-start latency on the first request after idle.
- Old Pages build and old Worker coexist until section 4 completes; do not leave the system in that state overnight.
- This runbook does not authorize anything; each phase needs the Architect's go.
