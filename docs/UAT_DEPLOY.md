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

Pages ignores `--config`, so stage the files with the UAT config. The stager (`scripts/stage-pages-functions.mjs`) copies `functions/` and every local module those functions import, at the same relative paths, and exits non-zero with the list of problems if any import cannot be resolved or points outside `apps/web`. It stages nothing when it fails. The stager must be part of the deployed commit, which the worktree in step 0 provides.

```sh
export STAGE=$(mktemp -d)
cp -RL "$WT/apps/web/out" "$STAGE/"
node "$WT/scripts/stage-pages-functions.mjs" "$WT/apps/web" "$STAGE"
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

## Deploy log addendum: f589530 (no new migration)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-28 | `f589530` | `e3df21a8-27e9-4e37-bc31-cfbb5062e5bd` | `7d2a8bec-4fd3-4146-a5fc-6abb3f1ca85d` | 0001-0009, already up to date |

Neon: expiry removed from the `uat` branch (`br-polished-term-a172b6x5`), so it is permanent. Backup branch `uat-backup-2026-10-28` (`br-lingering-field-a1hfhs5o`) was created from `uat` with data and no expiry.

Smoke for `f589530` (unauthenticated): Worker `/health/ready` 200; signed-out `/api/v1/session` 401; `/signin`, `/board?id=`, `/projects`, `/activity`, `/inbox`, `/trash`, `/people`, `/my-tasks`, `/settings` all 200 (shells only, not rendered in a browser for this commit); foreign-origin preflight has no allow-origin; `/api/v1/system/status` without secret 403; legacy `/projects/<id>` and `/boards/<id>` 302 to query routes.

Proposal to keep `uat` exempt from the TTL policy in `neon.ts`: the branch policy only applies to branches created by `neon checkout`, so the existing `uat` branch is unaffected. If `uat` is ever recreated, add `if (branch.name === 'uat') return {};` as the first line of the policy function. Not applied yet; Architect to approve.

## Deploy log addendum: 0da9248 (migration 0010)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-28 | `0da9248` | `15554f80-6aae-4fcd-8b07-8291e27f790a` | `790701b7-0a71-4b07-934e-aaed3e898183` | 0001-0010; runner applied `+ [0010] 0010_column_tone.sql` (nullable column, CHECK on values, additive) |

Neon state before this deploy: `uat` expiry already removed (`never`), backup branch `uat-backup-2026-10-28` already exists (`br-lingering-field-a1hfhs5o`, `never`). No new Neon change was needed.

Smoke for `0da9248` (unauthenticated, HTTP status only): Worker `/health/ready` 200; signed-out `/api/v1/session` 401; 200 for `/signin`, `/board?id=`, `/project?id=`, `/projects`, `/activity`, `/inbox`, `/trash`, `/people`, `/my-tasks`, `/settings`, `/import`, `/add-card`, `/all-work`, `/invitation`; `/invitations/accept?token=` 200 (the route is `/invitations/accept`, not `/accept-invitation`, which 404s and is not in the source); foreign-origin preflight no allow-origin; `/api/v1/system/status` without secret 403; legacy `/projects/<id>` and `/boards/<id>` 302 to query routes.

## Deploy log addendum: 9a9d9fa (security headers, rate-limit plan, CI fix)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-29 | `9a9d9fa` | `52be6f0d-3bfd-4340-8f10-00c43c6d9b09` | `b6eca4bf-4791-44bd-aad9-aacca399f850` | 0001-0010, already up to date |

Contents: `apps/web/public/_headers` (CSP enforced, nosniff, frame deny, referrer and permissions policy, immutable `/_next/static/*`). HEAD also includes `a160ef2` (Backend: zod 3.24.2 to 4.6.7 in `packages/contracts`), so the Worker and the web bundle were both rebuilt from HEAD, not only Pages. Worker and web are on the same contracts version.

CSP trade-off: `script-src` and `style-src` allow `'unsafe-inline'`. Next static export emits about 12 inline RSC scripts per page with page-specific content, so hashes are impractical. Verified locally that a hash-only policy is violated by those scripts. Only the theme script hash would match. Fonts, API and images stay same-origin.

Smoke for `9a9d9fa` (unauthenticated): `/signin` and all app shells 200; `/api/v1/session` 401; `/api/v1/system/status` without secret 403; `/api/v1/session/dev-login` 404; foreign-origin preflight no allow-origin; Worker `/health/ready` 200; legacy `/projects/x` and `/boards/x` 302 to query routes; `_next/static` chunk `immutable`; `/signin` header check shows the CSP and no-store on API. Browser console read on UAT `/signin` returned no entries (weak evidence; the local run showed the console does record CSP messages). Signed-in checks (sign-in, board drag, image view, theme toggle) were not run; they need a signed-in user.

## Deploy log addendum: 8b41fe6 (Worker-side rate limiter, UAT)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-29 | `8b41fe6` (includes `cc7963a`) | `0635b142-f4f4-4ce4-8cdc-d808a5edd387` | `2e487aca-b4be-45f2-b38d-ab9d081be637` | 0001-0010, already up to date |

Rollback ids: Worker `52be6f0d-3bfd-4340-8f10-00c43c6d9b09` (deployed at `9a9d9fa`, no limiter); Pages `b6eca4bf-4791-44bd-aad9-aacca399f850` (deployed at `9a9d9fa`). Worker rollback is `npx wrangler rollback 52be6f0d-3bfd-4340-8f10-00c43c6d9b09 --name flowboard-api-uat`.

Bindings confirmed on the deployed version (`wrangler versions view`): `FB_RL_AUTH` 10/60s, `FB_RL_WRITES` 60/60s, `FB_RL_INVITE` 10/60s, `FB_RL_IMPORT` 5/60s, `FB_RL_UPLOAD` 10/60s, namespace ids 2001-2005 (UAT range; production uses 1001-1005).

**Limiter not observed to enforce on UAT.** Unauthenticated tests from one client IP: 42 `GET /api/v1/auth/google` in a burst through `flowboard-api-uat.web-app-cloud.workers.dev` returned 302 every time (no 429, no `Retry-After`); 65 `POST /api/v1/workspaces` returned 401 every time (writes limit 60/min not hit). The bundle contains the rules and `limit({ key })` calls. The cause is not yet known (see Architect report). Until it is fixed, treat the rate limit as **not in effect** on UAT.

Smoke for `8b41fe6` (unauthenticated, through `https://flowboard-app-uat.pages.dev`): all app shells 200 (including `/signin`, `/board?id=x`, `/invitations/accept?token=x`); `/api/v1/session` 401; `/api/v1/system/status` without secret 403; `/api/v1/session/dev-login` 404; foreign-origin preflight no allow-origin; Worker `/health/ready` 200 (15 requests, none limited); legacy `/projects/x` and `/boards/x` 302 to query routes. Security headers present on `/signin` (CSP enforced, nosniff, frame deny, referrer and permissions policy). Browser console read on `/signin` returned no entries (weak evidence; not a clean CSP result).

Not verified in this deploy: client-IP keying through the Pages proxy (`cf-connecting-ip` forwarding over the service binding) and any signed-in flow.

## Deploy log addendum: e57b4de (rate limiter fails open; diagnostics)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-29 | `e57b4de` (includes `a401adc`) | `77edff23-da70-48f3-9399-202a9b5c049a` | `9e0ba995-ee35-405e-8eb9-3a7d869645b6` | 0001-0010, already up to date |

Rollback ids: Worker `0635b142-f4f4-4ce4-8cdc-d808a5edd387` (limiter, `8b41fe6`); Worker `52be6f0d-3bfd-4340-8f10-00c43c6d9b09` (`9a9d9fa`, no limiter). Pages `2e487aca-b4be-45f2-b38d-ab9d081be637` (`8b41fe6`); Pages `b6eca4bf-4791-44bd-aad9-aacca399f850` (`9a9d9fa`).

Evidence (unauthenticated, no secret printed):
- Burst of 42 `GET /api/v1/auth/google` on `flowboard-api-uat.web-app-cloud.workers.dev`: 41 returned 302; one request (18) returned no HTTP status (not retried). Distinct `cf-ray` locations: 11 (WAW 12 requests, ARN 11, LHR 8, MRS 5, ORD 2, and NRT, LAX, BOS 1 each). WAW's 11th and 12th requests and ARN's 11th returned 302. A per-location limit of 10 would have refused them, so the per-location explanation alone does not account for the observed behaviour.
- `wrangler tail flowboard-api-uat` during a 42-request burst through `https://flowboard-app-uat.pages.dev`: 42 events, all `outcome: ok`, all 302. No `rate_limit_binding_absent`, `rate_limit_client_ip_missing` or `rate_limit_refused` lines. The Worker's request headers carried a real `cf-connecting-ip` through the Pages service-binding hop.
- Smoke: all app shells 200; `/api/v1/session` 401; `/api/v1/system/status` 403 without secret (on both hosts); dev-login 404; foreign-origin preflight no allow-origin; `/health/ready` 200; legacy redirects 302; CSP, nosniff and frame-deny headers present. Browser console on `/signin` showed only 401 resource errors from the unauthenticated session checks; no CSP violation messages.

Status: the limiter is still not observed to refuse any request on UAT. Fail-open behaviour is in effect as designed in `e57b4de`, but the observed behaviour is more than approximate counting.

## Deploy log addendum: 0d2b527 (PostgreSQL rate limiter, migration 0011)

| Date (UTC) | Commit | Worker version | Pages deployment | Migrations on UAT |
|---|---|---|---|---|
| 2026-10-29 | `0d2b527` | `ed08da94-2d48-4b98-99fd-daaf538a0357` | `12359b3d-b66b-4989-b63a-fc8dcd264742` | 0001-0011; runner applied `+ [0011] 0011_rate_limit_windows.sql` (UNLOGGED table, additive) |

Rollback ids: Worker `77edff23-da70-48f3-9399-202a9b5c049a` (`e57b4de`); Pages `9e0ba995-ee35-405e-8eb9-3a7d869645b6` (`e57b4de`). Rolling the Worker back to `77edff23` leaves table `rate_limit_windows` in place, harmless to older code.

Proof, unauthenticated, through each host:
- `flowboard-api-uat.web-app-cloud.workers.dev`, burst of 42 `GET /api/v1/auth/google`: 10 × 302, then 429 from request 11 with `Retry-After` and the `TOO_MANY_REQUESTS` envelope. Locations (cf-ray suffix): SIN 29, HKG 10, MRS 2, BOS 1. The refusals span several locations, so the limit is now exact across them.
- `flowboard-app-uat.pages.dev`, burst of 42 in a fresh window: 10 × 302 then 429 from request 10, `Retry-After` 48–56 s (database clock). All edge locations BOM.
- Recovery: a new window opened and requests returned 302 again (checked on the Worker host after the Pages burst, and on Pages at the start of the second burst).
- `/health/ready`: 15 requests returned 200 and did not count against the auth bucket (9 further 302s were then allowed in the same window, as expected for one earlier 302).
- Smoke: all shells 200; `/api/v1/session` 401; `/api/v1/system/status` 403 without secret on both hosts; dev-login 404; preflight evil 0; `/health/ready` 200; legacy `/projects/x` 302; CSP, nosniff, frame-deny, referrer and permissions headers present. Browser console on `/signin`: no entries.

Table (read-only summary, no client keys printed): 4 rows, 1 bucket (`auth`), 2 distinct clients, 3 windows already ended and not yet purged, max count 83 in one window, total 148 counted requests. Refused requests are counted (the count goes above the limit), so each refusal is one database write. The purge runs on the UAT cron (`*/15`); the ended windows were still present at the time of the check, and the next cron run should remove them.

Cost note for the flood runbook: a flood of refusals on the four route families is one UNLOGGED upsert per request.

## Deploy log addendum: 9f241d6 (last location, migration 0012, UI entry routing)

Deployed by the Deployment chat as task D-1, on the Architect's instruction and the user's UAT approval. UAT only; nothing pushed; production untouched.

Rollback anchors recorded before the deploy:
- Worker `flowboard-api-uat`: `ed08da94-2d48-4b98-99fd-daaf538a0357` (100% before this deploy).
- Pages `flowboard-app-uat`: `12359b3d-b66b-4989-b63a-fc8dcd264742` (latest before this deploy).

Versions after this deploy:
- Worker: `8f5c511c-f27d-4c94-be66-7d0c2edeacf0`.
- Pages: `e653f554-2fae-4139-ad59-9eae9571111a` (`https://e653f554.flowboard-app-uat.pages.dev`).

Local checks at 9f241d6 (clean worktree, disposable Postgres 17.11 on `127.0.0.1:55610`, user `flowboard_harness`, databases `flowboard_harness` and `flowboard_access_test`; container removed afterwards):
- `npm run typecheck`: exit 0. `npm run typecheck:web`: exit 0.
- Contracts: 43 pass, 0 fail, 0 skipped.
- API: 465 pass, 0 fail, 0 cancelled, 0 skipped.
- Static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`): build exit 0.

Migration (Neon `uat` branch, direct host): before, versions 0001 to 0011 applied. The runner printed `+ [0012] 0012_user_last_location.sql`. After, 0001 to 0012 applied. `users.last_project_id` and `users.last_board_id` are nullable.

Pages staging gap (fixed in the deploy, runbook step 4 still needs it): the first Pages deploy failed at build with `Could not resolve "../src/lib/return-path"`. `functions/_middleware.ts` imports `apps/web/src/lib/return-path.ts`, which the staged folder (`out`, `functions`, `wrangler.jsonc`) did not contain. Nothing was deployed by the failed attempt. The retry copied that one file to `src/lib/` in the staging folder. `functions/` has no other imports from outside itself.

Smoke, signed out (curl; Google was never followed and no credentials were entered):

| Request | Status | Location | Cache-Control |
|---|---|---|---|
| `/` | 302 | `/signin` | no-store |
| `/sign` | 302 | `/signin` | no-store |
| `/projects` | 302 | `/signin?next=%2Fprojects` | no-store |
| `/board?id=x` | 302 | `/signin?next=%2Fboard%3Fid%3Dx` | no-store |
| `/board?id=y` | 302 | `/signin?next=%2Fboard%3Fid%3Dy` | no-store |
| `/board?id=x&secret=1` | 302 | `/signin?next=%2Fboard%3Fid%3Dx` (extra param dropped) | no-store |
| `/projects/x` and `/projects/y` | 302 | `/signin` (no `next`) | no-store |
| `/boards/x` | 302 | `/signin` | no-store |
| `/nope-zzz` | 302 | `/signin` | no-store |
| `/projects?next=//evil.test` | 302 | `/signin?next=%2Fprojects` (hostile query ignored) | no-store |
| `/signin` | 200 | - | `public, max-age=0, must-revalidate` |
| `/invitation` | 200 (not redirected) | - | `public, max-age=0, must-revalidate` |
| `/_next/static/chunks/webpack-24dbafc41ba0fb47.js` | 200 | - | `public, max-age=31536000, immutable` |

- Bogus cookie `flowboard_session=bad` on `/projects`: 302 to `/signin?next=%2Fprojects`. Following with `-L` ends at 200 after one redirect, so there is no loop. The API returns 401 for it, and the middleware turns that into the redirect.
- Headers on `/signin`: the CSP from `_headers` (unchanged), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- `/api/v1/session` with no cookie: 401. `/api/v1/system/status` without secret: 403. `/api/v1/session/dev-login`: 404. Foreign-origin preflight: no `access-control-allow-origin`.
- `/api/v1/health`: 404 on both Pages and the Worker. There is no such route. The health routes are `/health/live` and `/health/ready` on the Worker host (`flowboard-api-uat.web-app-cloud.workers.dev`): 200 for `/health/live` and 15 of 15 for `/health/ready`.
- Google start, not followed (`GET /api/v1/auth/google?next=…`): every case returns 302 to `accounts.google.com` with the UAT callback as `redirect_uri`. Hostile `next=//evil.test` and `next=https://evil.test` set `flowboard_oauth_state` with a 48-character value. `next=/board?id=abc` sets one with 67 characters. The cookie is opaque and was not decoded, so the length difference is evidence only, not proof.

Rate limiter (unauthenticated `GET /api/v1/auth/google`, one 42-request burst per run):
- Run 1 (not pinned to IPv4): requests 1 to 10 returned 302, 11 to 15 returned 429 with `Retry-After` 7 to 1, and the window then rolled. Requests 16 to 25 and 26 returned 302, then 27 onward returned 429. The table shows the cause: one request (26) came from a different client address family (curl used IPv4 for that one) and was counted under its own key, which had count 1. The IPv6 client key counted 27 in that window. This is curl's dual-stack behaviour, not a limiter fault, but it makes run 1 not a clean proof.
- Run 2 (`curl -4`, started at a window boundary): requests 1 to 10 returned 302, then 11 onward returned 429 with `Retry-After` 46 counting down to 15. Request 39 returned no HTTP status (curl error, `000`); it was not retried. The `TOO_MANY_REQUESTS` envelope was seen in run 1 (`cache-control: no-store`).
- Recovery: the first request in the next window returned 302 to Google.

Rate-limit table (read-only, counts and timestamps only, no client keys printed): the auth bucket shows three windows still present after the burst, including the two that ended during the test. The purge on the `*/15` UAT cron has not been confirmed. Recheck on a later run.

Cost note: each refused request is one UNLOGGED upsert. Run 2 had 32 refusals (429) from 42 requests, so a flood of refusals adds one write per request to the database.

Could not verify here:
- Real sign-in and every signed-in screen. These are for the user to check (see the checklist in the chat report).
- Whether the purge runs on the UAT cron.
- Whether `/health/ready` skips the limiter: the 15 probes returned 200 and none returned 429, but the rate-limit table was not read for those windows, so it is not proven here.
- The `000` on request 39 of run 2 has no cause recorded.

## Deploy log addendum: 8fcefe8 (five default columns, five-column sign-in sample)

Deployed by the Deployment chat as task D-2 on the Architect's instruction. UAT only; nothing pushed; production untouched. No migration in this commit.

Rollback anchors (the D-1 versions, which were live before this deploy):
- Worker `flowboard-api-uat`: `8f5c511c-f27d-4c94-be66-7d0c2edeacf0` (100% before this deploy).
- Pages `flowboard-app-uat`: `e653f554-2fae-4139-ad59-9eae9571111a`.

Versions after this deploy:
- Worker: `212ea7b0-5751-4463-afe5-29f9b3dc026e`.
- Pages: `b2420c70-e59a-464f-9152-57415e4a2e73` (`https://b2420c70.flowboard-app-uat.pages.dev`).

Local checks at 8fcefe8 (disposable Postgres 17.11 on `127.0.0.1:55611`, container stopped afterwards):
- `npm run typecheck`: exit 0. `npm run typecheck:web`: exit 0.
- Contracts: 43 pass, 0 fail, 0 skipped.
- API: 467 pass, 0 fail, 0 cancelled, 0 skipped.
- Static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree: exit 0.

Pages staging: `scripts/stage-pages-functions.mjs` staged `functions/` and the five-file import closure, including `src/lib/return-path.ts`. No manual copy of `functions/` was used.

Smoke, signed out (curl; Google was not followed; no credentials used):
- `/signin`: 200, with the CSP from `_headers`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- The D-1 redirect set is unchanged: `/` and `/boards/x` and an unknown path go to `/signin`; `/projects` goes to `/signin?next=%2Fprojects`; `/board?id=x` goes to `/signin?next=%2Fboard%3Fid%3Dx`; all with `Cache-Control: no-store`.
- Bogus cookie `flowboard_session=bad` on `/projects`: 302 to `/signin?next=%2Fprojects`.
- `/invitation`: 200, not redirected.
- `/api/v1/session` without a cookie: 401. `/api/v1/system/status` without secret: 403.
- Worker `/health/ready`: 200.
- No limiter burst: the limiter did not change in this commit.

Not verified here: the five-column sample and brand mark on `/signin` (the sample is rendered client-side, so curl does not show it), and any signed-in behaviour. The user checks those on UAT.

Rate-limit purge, two UAT cron cycles after D-1 (read-only, counts only):
- 13:30:18 UTC `*/15` run: outcome `ok`, no exceptions. Snapshot at 13:31:45 UTC: 0 rows in `rate_limit_windows`.
- 13:45:11 UTC `*/15` run: outcome `ok`, no exceptions. Snapshot at 13:46:46 UTC: 0 rows.
- The three ended windows seen earlier (before the first cron run) are gone. The bounded purge in `purgeEndedWindows` is working on UAT. No rows were deleted by hand.

## Deploy log addendum: 5dd9ad7 (logo mark, favicon, sign-in sample)

Deployed by the Deployment chat as task D-3 on the Architect's instruction. UAT only; nothing pushed; production untouched. Web-only: `git diff 8fcefe8..5dd9ad7 -- apps/api database packages` is empty, so the Worker was not redeployed (`212ea7b0-5751-4463-afe5-29f9b3dc026e` still serves). No migration.

Rollback anchor (the D-2 Pages deployment, live before this deploy): Pages `flowboard-app-uat` `b2420c70-e59a-464f-9152-57415e4a2e73`.

Pages deployment after this deploy: `54899ff8-8613-4ffc-a3c6-9d5ea6a8d7f3` (`https://54899ff8.flowboard-app-uat.pages.dev`). The rollback id above is the D-2 deployment.

Local checks at 5dd9ad7: `npm run typecheck` exit 0; `npm run typecheck:web` exit 0; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The build emits `favicon.svg` and `apple-touch-icon.png`, and `index.html` links both.

Pages staging: `scripts/stage-pages-functions.mjs` staged `functions/` and the five-file import closure, including `src/lib/return-path.ts`.

Smoke, signed out (curl; Google not followed; no credentials used):
- `/signin`: 200, with the CSP from `_headers`, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy and Permissions-Policy as in D-1/D-2.
- Redirects unchanged from D-1: `/` and `/boards/x` and `/nope-zzz` go to `/signin`; `/projects` to `/signin?next=%2Fprojects`; `/board?id=x` to `/signin?next=%2Fboard%3Fid%3Dx`; all `no-store`. `/invitation` 200.
- Bogus cookie `flowboard_session=bad` on `/projects`: 302 to `/signin?next=%2Fprojects`.
- `/favicon.svg`: 200, `image/svg+xml`, 501 bytes, `cache-control: public, max-age=0, must-revalidate`.
- `/apple-touch-icon.png`: 200, `image/png`, 4639 bytes, same cache header.
- Both icons are same-origin images, which `img-src 'self' data: blob:` allows. The CSP header sent with the icon responses does not block them.
- `/api/v1/session` without a cookie: 401. `/api/v1/system/status` without secret: 403. Worker `/health/ready`: 200.

Not verified here: the new wordmark, the dark pill and the one-to-two-card sample (visual; client-rendered). The user checks those on UAT.

## Deploy log addendum: d9b7605 (outlined wordmark, dark logo, favicon and apple-touch icon)

Deployed by the Deployment chat as task D-4 on the Architect's instruction. UAT Pages only; nothing pushed; production untouched. Web-only: `git diff 5dd9ad7..d9b7605 -- apps/api database packages` is empty, so the Worker (`212ea7b0-5751-4463-afe5-29f9b3dc026e`) was not redeployed. No migration.

Rollback anchor (the D-3 Pages deployment, live before this deploy): `54899ff8-8613-4ffc-a3c6-9d5ea6a8d7f3`.

Pages deployment after this deploy: `49961a76-a334-4e5d-839f-c9860ff4702d` (`https://49961a76.flowboard-app-uat.pages.dev`).

Local checks at d9b7605: `npm run typecheck` exit 0; `npm run typecheck:web` exit 0; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The build emits `favicon.svg` and `apple-touch-icon.png`, and `index.html` links both.

Pages staging: `scripts/stage-pages-functions.mjs` staged `functions/` and the five-file import closure, including `src/lib/return-path.ts`.

Smoke, signed out (curl; Google not followed; no credentials used):
- `/signin`: 200, with the CSP from `_headers`, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy and Permissions-Policy as before.
- Redirects unchanged: `/`, `/boards/x` and `/nope-zzz` go to `/signin`; `/projects` to `/signin?next=%2Fprojects`; `/board?id=x` to `/signin?next=%2Fboard%3Fid%3Dx`; all `no-store`. `/invitation` 200.
- Bogus cookie `flowboard_session=bad` on `/projects`: 302 to `/signin?next=%2Fprojects`.
- `/favicon.svg`: 200, `image/svg+xml`, 370 bytes, `cache-control: public, max-age=0, must-revalidate`.
- `/apple-touch-icon.png`: 200, `image/png`, 4269 bytes, same cache header.
- Both icons are same-origin images, which `img-src 'self' data: blob:` allows.
- `/api/v1/session` without a cookie: 401. `/api/v1/system/status` without secret: 403. Worker `/health/ready`: 200.

Not verified here: the outlined wordmark, the dark logo variant and how they look on light and dark surfaces. Those are visual, so the user checks them on UAT.

## Deploy log addendum: 9c29f75 (plum circle logo mark, sign-in dark by default, apple-touch icon)

Deployed by the Deployment chat as task D-5 on the Architect's instruction. UAT Pages only; production untouched. Web-only: `git diff 5dd9ad7..9c29f75 -- apps/api database packages` is empty, so the Worker (`212ea7b0-5751-4463-afe5-29f9b3dc026e`) was not redeployed. No migration.

Rollback anchor (the D-4 Pages deployment, live before this deploy): `49961a76-a334-4e5d-839f-c9860ff4702d`.

Pages deployment after this deploy: `10609693-0176-4328-af69-5896ae13a708` (`https://10609693.flowboard-app-uat.pages.dev`).

Local checks at 9c29f75: `npm run typecheck` exit 0; `npm run typecheck:web` exit 0; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The export contains `favicon.svg` and `apple-touch-icon.png`.

Pages staging: `scripts/stage-pages-functions.mjs` staged `functions/` and the five-file import closure, including `src/lib/return-path.ts`.

Smoke, signed out (curl; Google not followed; no credentials used):
- `/signin`: 200, with the CSP from `_headers`, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy and Permissions-Policy as before.
- Redirects unchanged: `/` and `/boards/x` go to `/signin`; `/projects` to `/signin?next=%2Fprojects`; `/board?id=x` to `/signin?next=%2Fboard%3Fid%3Dx`; all `no-store`. `/invitation` 200.
- Bogus cookie `flowboard_session=bad` on `/projects`: 302 to `/signin?next=%2Fprojects`.
- `/favicon.svg`: 200, `image/svg+xml`, `cache-control: public, max-age=0, must-revalidate`.
- `/apple-touch-icon.png`: 200, `image/png`, same cache header.
- Both icons are same-origin images, which `img-src 'self' data: blob:` allows.
- `/api/v1/session` without a cookie: 401. `/api/v1/system/status` without secret: 403. Worker `/health/ready`: 200.

Not verified here: the plum circle mark and the dark-by-default sign-in page. Both are client-rendered, so the user checks them on UAT.

## Deploy log addendum: 54dac49 (migration 0013, Worker and Pages)

Deployed by the Deployment chat as task D-6 on the Architect's instruction. UAT only; production untouched; the deploy used a clean worktree at 54dac49, not the shared working tree.

Postgres version: UAT Neon branch `uat` runs PostgreSQL 18.6 (`server_version_num` 180006). That is above the 15+ needed for the column-list `ON DELETE SET NULL (default_board_id)` foreign key.

Rollback anchors (live before this deploy):
- Worker: `212ea7b0-5751-4463-afe5-29f9b3dc026e`.
- Pages: `10609693-0176-4328-af69-5896ae13a708`.

Neon backup: branch `uat-backup-2026-10-29-d6` (`br-damp-poetry-a1gfbcvn`), created from `uat` before the migration and ready.

Migration: `0013_board_description_default_board.sql` applied to UAT only, with `ALLOW_REMOTE_DB=true` and the direct host. The runner reported `+ [0013]`. Afterwards `schema_migrations` holds 13 versions (0001 to 0013). The columns `boards.description` and `projects.default_board_id` exist. The constraint `projects_default_board_fk` is `FOREIGN KEY (default_board_id, id) REFERENCES boards(id, project_id) ON DELETE SET NULL (default_board_id)`.

Worker: `flowboard-api-uat` deployed from 54dac49. Version after this deploy: `e3fcad14-258a-45c9-9fc4-fa8f1b99e927`. Bindings and cron `*/15` unchanged.

Pages: `flowboard-app-uat` deployed from 54dac49 via `scripts/stage-pages-functions.mjs` (five files staged, including `src/lib/return-path.ts`). Deployment after this deploy: `609bfd54-d83a-4bb5-af1e-a58afb063d74` (`https://609bfd54.flowboard-app-uat.pages.dev`).

Local checks at 54dac49: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200 and `/health/live` 200.
- Pages `/` and `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `/signin` 200 with the CSP header.
- `/favicon.svg` 200 `image/svg+xml` and `/apple-touch-icon.png` 200 `image/png`, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `PATCH /api/v1/boards/x` and `PATCH /api/v1/projects/x` return 401 on both the Pages host and the Worker host.

Not verified here: the board rail, New board, Edit board and default-board setting (signed-in, the user checks on UAT).

Note: after 54dac49 the branch gained `1d52be9` (feat(api): project overview counts, project brief and links, migration 0014). It was not part of this deploy and is not on UAT.

## Deploy log addendum: 7e9e71a (migration 0014, project brief and links, overview)

Deployed by the Deployment chat as task D-7 on the Architect's instruction. UAT only; production untouched; the deploy used a clean worktree at 7e9e71a, not the shared working tree. Covers B-4 `1d52be9` (migration 0014, `GET /projects/:pid/overview`, `PATCH` brief and links) and S-8 `7e9e71a` (overview page, brief card, motion polish). Backend files are unchanged between `1d52be9` and `7e9e71a`.

Postgres version: PostgreSQL 18.6 on the UAT branch, as recorded in the D-6 addendum.

Rollback anchors (live before this deploy):
- Worker: `e3fcad14-258a-45c9-9fc4-fa8f1b99e927`.
- Pages: `609bfd54-d83a-4bb5-af1e-a58afb063d74`.

Neon backup: branch `uat-backup-2026-10-29-d7` (`br-bold-wildflower-a1uixauu`), created from `uat` before the migration and ready.

Migration: `0014_project_brief_links.sql` applied to UAT only, with `ALLOW_REMOTE_DB=true` and the direct host. The runner reported `+ [0014]`. Afterwards `schema_migrations` holds 14 versions (0001 to 0014). `projects.brief` (text) and the `project_links` table exist.

Worker: `flowboard-api-uat` deployed from 7e9e71a. Version after this deploy: `1fc9af14-4257-45d7-92f3-d29316054393`. Bindings and cron `*/15` unchanged.

Pages: `flowboard-app-uat` deployed from 7e9e71a via `scripts/stage-pages-functions.mjs` (five files staged, including `src/lib/return-path.ts`). Deployment after this deploy: `965b9962-cac7-45ce-9b34-29a98ca7743a` (`https://965b9962.flowboard-app-uat.pages.dev`).

Local checks at 7e9e71a: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200.
- Pages `/`, `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `/signin` 200 with the CSP header.
- `/favicon.svg` 200 `image/svg+xml` and `/apple-touch-icon.png` 200 `image/png`, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `GET /api/v1/projects/x/overview` and `PATCH /api/v1/projects/x` return 401 on both the Pages host and the Worker host.

Not verified here: the overview page, brief card, pinned links and motion polish (signed-in, the user checks on UAT).

## Deploy log addendum: bb5737e (Overview layout rework, Pages only)

Deployed by the Deployment chat as task D-8 on the Architect's instruction. UAT Pages only; production untouched; no Worker, migration or database change. The deploy used a clean worktree at bb5737e, not the shared working tree. Web-only: `git diff 7e9e71a..bb5737e -- apps/api database packages` is empty, so the Worker (`1fc9af14-4257-45d7-92f3-d29316054393`) and migrations (through 0014) were not touched.

Rollback anchor (the D-7 Pages deployment, live before this deploy): `965b9962-cac7-45ce-9b34-29a98ca7743a`.

Pages deployment after this deploy: `af566b60-4dc0-4e88-922a-27a992a46651` (`https://af566b60.flowboard-app-uat.pages.dev`).

Local checks at bb5737e: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The stager (`scripts/stage-pages-functions.mjs`) staged five files, including `src/lib/return-path.ts`.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200.
- Pages `/`, `/projects/x` and `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `/signin` 200 with the CSP header, `x-content-type-options: nosniff` and `x-frame-options: DENY`.
- `/favicon.svg` 200 `image/svg+xml` and `/apple-touch-icon.png` 200 `image/png`, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `PATCH /api/v1/projects/x` returns 401.

Not verified here: the Overview layout (one grid, tiles in one row, progress bar in place of the glance ring). It is client-rendered, so the user checks it on UAT.

## Deploy log addendum: 200729a (Overview section reorder, Pages only)

Deployed by the Deployment chat as task D-9 on the Architect's instruction. UAT Pages only; production untouched; no Worker, migration or database change. The deploy used a clean worktree at 200729a, not the shared working tree. Web-only: `git diff bb5737e..200729a -- apps/api database packages` is empty, so the Worker (`1fc9af14-4257-45d7-92f3-d29316054393`) and migrations (through 0014) were not touched.

Rollback anchor (the D-8 Pages deployment, live before this deploy): `af566b60-4dc0-4e88-922a-27a992a46651`.

Pages deployment after this deploy: `60c2722b-f08d-4447-80d5-94c446867fb3` (`https://60c2722b.flowboard-app-uat.pages.dev`).

Local checks at 200729a: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The stager (`scripts/stage-pages-functions.mjs`) staged five files, including `src/lib/return-path.ts`.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200.
- Pages `/`, `/projects/x` and `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- The first `/boards/x` request right after the deploy returned 404 with an empty body. Three retries over about 10 seconds, and `/boards/abc`, all returned the expected 302 to `/signin`. The 404 was not reproduced, so it is recorded as a first-request effect right after the upload, not a routing change. The commit range touches only `apps/web/src` and public images (`git diff --name-only bb5737e..200729a -- apps/web/functions apps/web/src/lib apps/web/public` is empty for the routing files).
- `/signin` 200 with the CSP header, `x-content-type-options: nosniff` and `x-frame-options: DENY`.
- `/favicon.svg` 200 `image/svg+xml` and `/apple-touch-icon.png` 200 `image/png`, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `PATCH /api/v1/projects/x` returns 401.

Not verified here: the Overview section order (brief and boards above people and activity). It is client-rendered, so the user checks it on UAT.

## Deploy log addendum: 01d594e (rail logo lockup, board toolbar menu, column editor, invitation flow UI, Pages only)

Deployed by the Deployment chat as task D-10 on the Architect's instruction. UAT Pages only; production untouched; no Worker, migration or database change. The deploy used a clean worktree at 01d594e, not the shared working tree. Verified with `git diff --name-only 200729a..01d594e -- apps/api database packages`, which is empty, so the Worker (`1fc9af14-4257-45d7-92f3-d29316054393`) and migrations (through 0014) were not touched.

Rollback anchor (the D-9 Pages deployment, live before this deploy): `60c2722b-f08d-4447-80d5-94c446867fb3`.

Pages deployment after this deploy: `359bc74a-d208-4a3a-9de8-b001f4d7fc0b` (`https://359bc74a.flowboard-app-uat.pages.dev`).

Local checks at 01d594e: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0. The stager (`scripts/stage-pages-functions.mjs`) staged five files, including `src/lib/return-path.ts`.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200.
- Pages `/`, `/projects/x` and `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `/invitation?token=x` returns 200 signed out. The test token does not appear in the response body or headers. The response has the CSP, `nosniff`, `X-Frame-Options: DENY` and `cache-control: public, max-age=0, must-revalidate`. Pages request logs were not read in this pass, so "no token in logs" is not verified here.
- `/signin` 200 with the CSP header.
- `/favicon.svg` 200 `image/svg+xml` and `/apple-touch-icon.png` 200 `image/png`, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `PATCH /api/v1/projects/x` returns 401.

Not verified here: the rail logo lockup, board toolbar overflow menu, column editor and invitation dialog. They are client-rendered and signed-in, so the user checks them on UAT.

## Deploy log addendum: ecc5bcd (activity recording, overview project-scope rows, role badge, activity sentences; Worker and Pages)

Deployed by the Deployment chat as task D-11 on the Architect's instruction. UAT only; production untouched. The deploy used a clean worktree at ecc5bcd, not the shared working tree. Includes B-5 `c3e6dbf` and B-6 (activity recording for columns, boards, invitations, members and brief; overview project-scope rows for Owner and Manager), UI S-12 `64f0767` (role badge) and S-13 `9793a87` (activity sentences).

Migration check: `git diff --name-only b655d93..ecc5bcd -- database` is empty. No migration was applied; the database is still at 0014.

Rollback anchors (live before this deploy):
- Worker: `1fc9af14-4257-45d7-92f3-d29316054393`. The D-11 brief listed `e3fcad14-258a-45c9-9fc4-fa8f1b99e927`, which was the Worker before D-7. D-7 replaced it with `1fc9af14`, so `1fc9af14` is the live rollback.
- Pages: `359bc74a-d208-4a3a-9de8-b001f4d7fc0b`.

Worker: `flowboard-api-uat` deployed from ecc5bcd. Version after this deploy: `3efbf146-ef74-4ea1-8a9b-61663d073ebe`. Bindings and cron `*/15` unchanged. The API test suite and contracts tests were not run in this pass (the Worker deploy used typecheck only), so this deploy is verified by typecheck and signed-out smoke only.

Pages: `flowboard-app-uat` deployed from ecc5bcd via `scripts/stage-pages-functions.mjs` (five files staged, including `src/lib/return-path.ts`). Deployment after this deploy: `6ed70912-0911-4c17-b2d9-6d58b9536703` (`https://6ed70912.flowboard-app-uat.pages.dev`).

Local checks at ecc5bcd: `npm run typecheck` and `npm run typecheck:web` passed; static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0.

Smoke, signed out (curl; no credentials, no secrets printed):
- Worker `/health/ready` 200 and `/health/live` 200.
- Pages `/`, `/projects/x` and `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `/signin` 200 with the CSP header and `x-frame-options: DENY`.
- `/favicon.svg` and `/apple-touch-icon.png` return 200, both `cache-control: public, max-age=0, must-revalidate`.
- Unauthenticated `GET /api/v1/projects/x/activity` and `GET /api/v1/projects/x/overview` return 401 on both the Pages host and the Worker host.
- Unauthenticated `PATCH /api/v1/projects/x` returns 401.

Not verified here: the role badge and activity sentences, and the new activity rows for columns, boards, invitations, members and brief. They need a signed-in check on UAT.

## D-12: Codex audit follow-ups (read-only and prep; no deploy, no Cloudflare resource created, nothing pushed)

Scope from the Architect (`docs/reviews/CODEX-AUDIT-20261030/needs-owner.md`). Head at start: `5ff0ead`. Nothing was deployed. No production change, no secret value printed, no Cloudflare resource created, `wrangler.jsonc` not edited.

### 1. S3: runtime database role (UAT)

The UAT Worker reaches Neon through Hyperdrive `flowboard-hyperdrive-uat` (`7a1e3a69f51e41b1a8c46e0be263b814`). Its non-secret origin config names host `ep-shy-fire-a1we7145.ap-southeast-1.aws.neon.tech`, database `neondb` and user `neondb_owner`. So the Worker's runtime role is the same role the migrations run as. The password was not read or printed; the probe used the same role through the Neon connection-string command, on the direct host.

Probe result (sanitized):

| Check | Result |
| --- | --- |
| `current_user` | `neondb_owner` |
| `rolsuper` | false |
| `rolcreatedb` | true |
| `rolcreaterole` | true |
| `CREATE TABLE` in `public`, inside a transaction that was rolled back | **allowed** |
| owner of schema `public` | `neondb_owner` |
| owner of table `boards` | `neondb_owner` |

Verdict: **fails** the S3 requirement. The runtime role can create, alter and drop application tables, and owns them. The probe table was rolled back; a check afterwards found no `zz_probe_d12` table.

Needed before production (Deployment proposes, Architect and Backend approve): a separate migration role that owns the schema, and a runtime role with `SELECT, INSERT, UPDATE, DELETE` (and sequence use) only, no `CREATE`, no ownership, no `rolcreaterole`/`rolcreatedb`. Change the Hyperdrive origin user only after both roles exist and the migrations and smoke tests pass on UAT. No Hyperdrive or role change was made here.

### 2. FB-AUD-04: npm audit and upgrade candidates

Baseline `npm audit` at `5ff0ead` (npm 11.12.1):
- `--omit=dev`: 2 findings. `next` (moderate, range `9.3.4-canary.0 - 16.3.0-preview.10`) and `postcss` (high, `<=8.5.22`).
- All dependencies: 5 findings. Adds `wrangler` (moderate, `4.36.0 - 4.152.0`), `miniflare` (moderate, `4.20250906.1 - 5.20261019.2-beta`) and `undici` (high, `7.0.0 - 7.30.0`).

Worktrees used for testing (none merged, nothing on `main`). Each test used a fresh `npm ci`, with the disposable Postgres 17.11 image (digest-pinned, same as CI) on `127.0.0.1:55612`, removed after the run.

| Group | Audit after | Typecheck (+web) | Contracts | API tests | Web build | API Worker build | Wrangler dry-run deploy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline `5ff0ead` | 5 | pass | 54/54 | 533/533 | pass | pass | not run |
| Candidate 1: `wrangler` 4.152.0 to 4.156.0 | 2 (`next`, `postcss`) | pass | 54/54 | 533/533 | pass | pass | pass (upload 1705 KiB, 294 KiB gzip) |
| Candidate 2: candidate 1 plus `next` 15.5.28 to 16.4.3 | **0** | pass | 54/54 | 533/533 | pass, no warnings in the log | pass | pass |

Findings:
- `wrangler` 4.156.0 clears the `wrangler`, `miniflare` and `undici` findings. It is a minor bump within 4.x. The `miniflare` version pulled in is `5.20261023.3-beta`, which is a beta; check that before relying on it.
- The `postcss` advisory cannot be fixed by an override in this setup. An npm `overrides` entry for `postcss` (flat and nested under `next`) did not change the lock, and `next` 15.5.28 bundles its own `postcss` 8.4.31. The only fix is to move `next`.
- `next` 16.4.3 is a major upgrade (15 to 16). It clears `next` and `postcss`. Nothing broke in the checks above. Not tested: browser behaviour of the app on Next 16 (no end-to-end run), the Pages `_middleware` build under Next 16, and whether the static export output changed. The web package has no `test` script (`npm run test --workspace @flowboard/web` exits 1 at baseline too).

Recommendation (for the Architect to decide; not applied to `main`): take candidate 2 as one group (`next` 16.4.3 plus `wrangler` 4.156.0) on its own branch, with a browser pass over sign-in, board, overview and invitation before merge. The patch is saved at `/private/tmp/claude-501/-Users-shubham-Documents-Flowboard/31121644-8367-4698-960e-be8a5dd77b07/scratchpad/d12-cand2-full.patch` (lockfile included).

Cleanup: the candidate worktree at `/var/folders/jr/scqd6q3j7nggl004yfg9_vsh0000gn/T/tmp.0yXWscKNEe/cand1` still exists, because it has uncommitted candidate edits and a plain `git worktree remove` refuses to delete it. Remove it with `git worktree remove --force` after checking the patch above.

### 3. R2 prep for image storage (no bucket created, `wrangler.jsonc` not edited)

Backend code: `apps/api/src/adapters/storage.ts` has `R2StorageDriver` over a binding named `IMAGES`, and `apps/api/src/runtime/worker.ts` returns `503 CONFIG_ERROR` when the binding is absent. So the Worker can deploy before the bucket exists.

Steps (for the Architect to approve; the user runs or approves each Cloudflare resource creation):
1. Create the UAT bucket: `npx wrangler r2 bucket create flowboard-images-uat`.
2. Confirm it is private in the dashboard (R2 > bucket > Settings): the `r2.dev` public URL is disabled, and no custom domain is attached.
3. Create the production bucket the same way, `flowboard-images-prod`, and check the same settings. Do this only after the production approval for the image release.
4. Add the binding to `apps/api/wrangler.jsonc`. Non-inherited per environment, so the UAT and production blocks each need their own entry:
   - top level (production): `"r2_buckets": [{ "binding": "IMAGES", "bucket_name": "flowboard-images-prod" }]`
   - `env.uat`: `"r2_buckets": [{ "binding": "IMAGES", "bucket_name": "flowboard-images-uat" }]`
   The schema was checked in `node_modules/wrangler/config-schema.json` (`r2_buckets`, items with `binding` and `bucket_name`). Wrangler 4.156.0 is the candidate version above.
5. No Worker secret or API token is needed; the binding is a Worker binding.
6. Deploy order: buckets, then config, then `wrangler deploy --env uat`. Then the synthetic upload, cross-isolate read, revoke and cleanup checks from the Codex list (item 2).

Cost and free tier (Cloudflare R2 pricing page, last updated 26 Oct 2026, fetched 30 Oct 2026; figures from the docs, not from this account's billing):
- Standard storage $0.015 per GB-month; Class A operations $4.50 per million; Class B operations $0.36 per million; egress free.
- Free each month: 10 GB-month storage, 1 million Class A and 10 million Class B operations.
- Deletes are free. Failed requests that fail authentication are not billed.
- Estimate: 1,000 images of 1 MB is about 1 GB, inside the free storage tier. UAT with synthetic data is expected to stay inside the free tier. Not verified: this account's plan and billing, and any lifecycle rule for abandoned uploads (the Architect should confirm the cleanup design, which Backend owns).

### 4. Secret scan (gitleaks, redacted)

Tool: gitleaks 8.30.1, installed with `brew install gitleaks` (Homebrew, the approved route on this Mac). Commands: `gitleaks git` (full history) and `gitleaks dir` (working tree), both with `--redact`. The JSON reports are in the scratchpad (`gl-history.json`, `gl-tree.json`); values are redacted there, and no values are copied here.

Counts:
- Full history: 249 findings in 97 files, all rule `generic-api-key`.
- Working tree: 253 findings in 99 files. 97 are tracked and 2 are untracked build output under `apps/web/.next/` (`cache/.previewinfo` and `prerender-manifest.json`).
- Where they sit: 248 of 249 history findings and 252 of 253 working-tree findings are in test fixtures (for example `apps/api/test/*.test.ts`), review manifests and reports under `docs/reviews/`, `design/flowboard-ui/reviews/`, or build cache.
- The one finding outside those locations is `docs/research/product-research.md`, which is a UUID in an `Idempotency-Key` example, not a credential.
- Provider-specific patterns (private keys, AWS, GitHub, Google, Slack, Stripe live, Resend, Cloudflare token prefixes) matched no tracked file.

Limits: the generic-rule findings were not validated one by one, so this is "no provider-specific secrets found and generic hits are fixture or reference values by location", not a full manual review. A reviewed allowlist would reduce the noise; none was added in this pass.

### 5. CI check

- Run `41040078686` on head `5ff0ead` (`CI`): **success**. Job `Verify (Typecheck, Tests, Build)` ran on `ubuntu-24.04`, which is what `ubuntu-latest` resolves to.
- Recent runs on the branch: `639975f` success; `b655d93` success; `ecc5bcd` cancelled (superseded by a newer push, from the `concurrency` group); `01d594e` cancelled (same reason).
- Node warning: `actions/checkout` and `actions/setup-node`, both pinned to `v4.4.0`, target Node 20, which GitHub now runs on Node 24. Upgrade the pins to versions that target Node 24 (check the tags first).
- Other warnings from the run: `DEP0040` (punycode, from Node or setup-node internals) and `DEP0169` (`url.parse()`, from Node). Neither fails the job.
- A real code warning in the API tests: `pg` reports "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9". A test calls `client.query` while another query on the same client is still running. Fix the test so each query awaits the previous one.
- `.node-version` is `24.15.0`, so the job already uses Node 24 for the project itself.

### Summary for the Architect

- S3 fails: the UAT runtime role is the owner role and can create, alter and drop tables.
- FB-AUD-04: candidate 2 (`next` 16.4.3 plus `wrangler` 4.156.0) clears audit with the tests green; not merged; needs a browser pass before merge.
- R2: steps and config prepared; no bucket created, `wrangler.jsonc` not edited; approval needed.
- Secret scan: no provider-specific secrets; generic hits are fixture or reference values by location.
- CI: green at head; Node 20 action pins and a `pg` test-code warning to fix.

## D-13: UAT image bucket (R2) prep, and the deploy plan (not deployed)

Scope from the Architect: create the private UAT bucket, add the UAT `IMAGES` binding only, dry-run, and prepare (but do not run) the deploy plan. No deploy, no production bucket, no push.

### 1. Bucket: blocked, R2 is not enabled on this account

`npx wrangler r2 bucket list` (account `6592b59b…`) returns error code 10042: "Please enable R2 through the Cloudflare Dashboard". No bucket was created. Enabling R2 is an account setting that may need a billing step, so it is for the user to do in the dashboard. After it is enabled, create the bucket with `npx wrangler r2 bucket create flowboard-images-uat`, then check that it is private: no `r2.dev` public URL and no custom domain (`npx wrangler r2 bucket dev-url get flowboard-images-uat` should report disabled, and `npx wrangler r2 bucket domain list flowboard-images-uat` should be empty; confirm both in the dashboard as well).

### 2. Config: `IMAGES` binding for `env.uat` only

`apps/api/wrangler.jsonc`, inside `env.uat`:

```jsonc
"r2_buckets": [{ "binding": "IMAGES", "bucket_name": "flowboard-images-uat" }]
```

Top level (production) has no `r2_buckets`. Production image routes stay at 503 `CONFIG_ERROR` until the production bucket is created and approved.

Checks at `9838e0c` plus this change:
- `npm run typecheck` exit 0.
- `wrangler deploy --env uat --dry-run` exit 0. Bindings list shows `env.IMAGES (flowboard-images-uat)` as an R2 Bucket.
- `wrangler deploy --dry-run` (production, no env) exit 0. `IMAGES` does not appear.
- `npm test --workspace @flowboard/api` against a disposable Postgres 17.11 on `127.0.0.1:55613` (removed afterwards): 581/581 pass. This includes `B-7 images: the Worker without an IMAGES binding answers 503 CONFIG_ERROR on image routes`.

### 3. R2 figures

Source: Cloudflare R2 pricing page (`developers.cloudflare.com/r2/pricing/`, "Last updated Oct 26, 2026"), fetched 30 Oct 2026. Checked against the docs only. The dashboard figures are **not verified** here, because the bucket cannot be created until R2 is enabled.

| Item | Free each month | Price after free tier |
| --- | --- | --- |
| Storage (Standard) | 10 GB-month | $0.015 per GB-month |
| Class A operations (writes, list, copy) | 1 million | $4.50 per million |
| Class B operations (reads, head) | 10 million | $0.36 per million |
| Egress to the Internet | free | free |
| Deletes | free | free |

Notes from the same page: storage is the daily peak averaged over 30 days; requests that fail authentication or authorization are not billed. Standard storage has no minimum duration. Infrequent Access is not used.

Estimate for UAT: synthetic images only, a few GB at most, so UAT should stay inside the free tier. Not verified: the account's plan, billing and any alerts.

### 4. Deploy plan (prepared, not run)

Pre-conditions: R2 enabled and `flowboard-images-uat` created as in section 1. The Architect says when to deploy, after Backend B-8/B-9 and UI S-14/S-15 are reviewed.

1. Neon backup branch of `uat` before migrating: `npx neonctl branches create --project-id misty-unit-76664549 --parent uat --name uat-backup-<date>-d14`, and confirm it is `ready`.
2. Migration 0015 (and any later ones the Architect sends) on the UAT branch only, with `ALLOW_REMOTE_DB=true`, the direct host (no `-pooler`), and the runner from the worktree at the deploy commit. Verify `schema_migrations` and the new objects.
3. Worker: `npx wrangler deploy --env uat` from a clean worktree at the deploy commit. Record the version id as the new rollback anchor.
4. Pages: `env -u NEXT_PUBLIC_API_URL NEXT_EXPORT=true npx next build` in `apps/web`, then `node scripts/stage-pages-functions.mjs` into the staging folder, then `wrangler pages deploy out --project-name flowboard-app-uat --branch main`. Record the deployment id.
5. Signed-out smoke tests (no credentials): Worker `/health/ready` 200; Pages `/`, `/projects/x`, `/boards/x` redirect to `/signin`; `/projects` and `/board?id=x` redirect to `/signin?next=...`; `/signin` 200 with CSP; `/favicon.svg` and `/apple-touch-icon.png` 200; unauthenticated `PATCH /api/v1/projects/x` 401; unauthenticated image routes 401.
6. Image smoke plan (the user does the signed-in step):
   - The user signs in on UAT and uploads one synthetic image to a card. Check: an object appears in `flowboard-images-uat` (list with `npx wrangler r2 object list flowboard-images-uat`, which shows keys and sizes only, not bytes).
   - Delete the card or the image as the user. Check: the object is removed after the delete commits (B-8 behaviour), by listing the bucket again.
   - Anonymous check: `curl -s -o /dev/null -w "%{http_code}"` on the image URL with no cookie must return 401 or 403, not the bytes. Also try the bucket's public URL, which should not exist.
   - Record counts and status codes only. Do not record image bytes, keys with user data, or session values.

Rollback anchors: the current UAT Worker version and the current Pages deployment (`6ed70912-...` for the earlier UAT Pages, the live id at deploy time to be recorded).

Not verified: the signed-in upload path, the B-8 delete-then-cleanup behaviour on UAT, and the dashboard checks for the bucket.

## D-13 continued: bucket created, privacy checked, cost limits and a cleanup gap (not deployed)

### 1. Bucket `flowboard-images-uat` (created, private)

- Created with `npx wrangler r2 bucket create flowboard-images-uat` after R2 was enabled on the account. Account `6592b59b…`, same account as the Workers.
- `wrangler r2 bucket dev-url get flowboard-images-uat`: "Public access via the r2.dev URL is disabled."
- `wrangler r2 bucket domain list flowboard-images-uat`: no custom domains connected.
- Production bucket: **not created** (approval given for UAT only). The production `IMAGES` binding is also not present.

### 2. Privacy check (status codes only)

A synthetic probe object (`zz-d13-probe.txt`, 20 bytes of test text, no user data) was written with `wrangler r2 object put --remote`, then read anonymously, then deleted with `wrangler r2 object delete --remote`.

| Request (no credentials) | Object state | Status | Probe bytes in body |
| --- | --- | --- | --- |
| S3 endpoint, path-style | present | 400 | no |
| S3 endpoint, virtual-hosted | present | 400 | no |
| same two requests | deleted | 400 | n/a |

Result: anonymous reads are refused and return no object bytes. The status is 400, not the 401 or 403 the docs suggest for an unsigned request, so the refusal comes from the endpoint rather than from an object policy. Not verified: a signed request with a revoked key, and the Worker-side read path, which the B-7/B-8 tests cover in code.

The `pub-…r2.dev` public URL was not tested, because no public URL exists while `dev-url` reports disabled. A guessed host name gave a 401 and was not a real r2.dev URL, so it is not counted.

Both probe requests used the local wrangler OAuth login (write and delete), and the anonymous reads used no credentials. No token was printed. The probe object was deleted.

### 3. Billing: read-only check and overage rates

- A read-only billing lookup with the local wrangler OAuth token (`/accounts/<id>/subscriptions`) returned 403, error 10000 "Authentication error". The token has no billing scope. **Plan and billing state are not verified.** The Billing page in the dashboard is the place to confirm the plan and whether a payment method and alerts are set.
- Overage (beyond the free tier), from the R2 pricing page (updated Oct 26, 2026; fetched 30 Oct 2026; docs only, not verified in this account's invoice):
  - Storage (Standard): $0.015 per GB-month above 10 GB-month free.
  - Class A operations (writes, list, copy): $4.50 per million above 1 million free.
  - Class B operations (reads, head): $0.36 per million above 10 million free.
  - Egress to the Internet: free. Deletes: free. Failed authentication: not billed.
- What can be charged at all: only storage and operations above the free allowance. With UAT data (synthetic), charges should not occur. The risk is the cleanup gap in section 4, not the unit prices.

### 4. What in our code limits cost

| Limit | Where | Value | Notes |
| --- | --- | --- | --- |
| Images per card | `apps/api/src/adapters/images.ts` (`MAX_CARD_IMAGES`) | 10 | Counts finalized `card_images` only (see gaps) |
| Image bytes | `apps/api/src/services/image-validator.ts` | 10 MiB (10,485,760) | Rejected before the staging `put` |
| Dimensions and pixels | `image-validator.ts` | 8192 px per side, 20 MP | |
| Request body cap | `apps/api/src/http/middleware/limits.ts` | 10 MiB plus multipart allowance on `PUT /api/v1/image-uploads/:id/content` | Applied per route |
| Stage, upload and finalize rate | PostgreSQL window limiter (migration 0011) | 10 per minute per client IP | Fixed window, fail closed |
| Staged upload expiry | `images.ts` (`expires_at = NOW() + 1 hour`) | 1 hour | Expired uploads are refused at finalize |
| Client compression | `apps/web/src/lib/image-prepare.ts` | resize and re-encode before upload (PNG, JPEG, WebP) | Advisory only: the server does not require it, so a client that skips it can send up to 10 MiB |
| Card deletion | `apps/api/src/services/trash-purge.ts` | purge after the 24-hour window, with R2 deletes via `pending_storage_deletions` | Runs on the scheduled handler |

### 5. Gaps (ranked by cost risk)

1. **Staged uploads are never cleaned up in production or UAT.** `cleanupOrphanUploads` in `apps/api/src/adapters/images.ts` deletes `staging/<id>/<file>` objects and marks expired rows. Its only caller is a test (`apps/api/test/att01-att07.test.ts`). The scheduled handler in `apps/api/src/runtime/worker.ts` does not call it: it runs `purgeExpiredTrash`, `processOutboxLease` and `purgeEndedWindows` only. So an upload that is staged, has its bytes written and is never finalized keeps its staging object indefinitely. **Note for Backend:** add a call to `cleanupOrphanUploads` to the scheduled handler (after the trash purge, with its own error handling). No code was changed in this pass.
2. **The count cap ignores staged uploads.** `createImageUpload` checks `card_images` only, so a writer can stage many uploads on one card without finalizing any. Each `PUT` can store up to 10 MiB. The rate limit (10 per minute per IP) allows about 600 stages per hour per IP, which is up to about 6 GB per hour if nothing is cleaned up (gap 1). Recommend counting in-flight uploads toward the cap, and adding a per-project storage quota.
3. **Cap check is not atomic.** The count is read and the upload row inserted in separate statements, so two concurrent stages can both pass a count of 9. Recommend a row lock on the card, or a unique constraint on a slot.
4. **No per-user or per-project byte quota.** Ten images per card, times cards per project, times projects per workspace, is the only bound. Recommend a per-project byte quota before production.
5. **Client compression is not enforced.** The server accepts any valid image up to 10 MiB and 20 MP. This is a cost and bandwidth issue, not a security one.

### 6. R2 lifecycle rule (recommended, not created)

For the staging prefix only, so finalized images are never expired by it. Wrangler 4.152.0 provides `wrangler r2 bucket lifecycle add`, with `--expire-days` and a prefix argument. Suggested, after the Architect approves:

```bash
npx wrangler r2 bucket lifecycle add flowboard-images-uat staging-expire staging/ --expire-days 1
```

The rule is a backstop only: it deletes `staging/` objects after 1 day regardless of the database state. The database cleanup in gap 1 is still needed so rows are marked expired. Not verified: whether the prefix rule removes objects that are still referenced by a staging row (it would, which is the intent after 1 day, because the upload expires after 1 hour). Check the rule with `wrangler r2 bucket lifecycle list flowboard-images-uat` after adding it.

### 7. Status

- Bucket created and private (UAT only).
- Config from section D-13 (binding `IMAGES` for `env.uat`) unchanged.
- Nothing deployed. Production bucket and production binding not created.
- Not verified: billing plan and alerts (dashboard), the signed-in upload path, the cleanup behaviour on UAT (no cron call exists).

## D-14: UAT deploy of 36dfb3a (migrations 0015 and 0016, IMAGES R2 binding, mail vars, Pages)

Deployed by the Deployment chat on the Architect's instruction, with the user's approval for UAT. UAT only; production untouched; nothing pushed (the Architect pushes).

### Rollback targets (recorded before the deploy)

- Worker: `3efbf146-ef74-4ea1-8a9b-61663d073ebe` (100% of traffic before this deploy, from D-11).
- Pages: `6ed70912-0911-4c17-b2d9-6d58b9536703` (live before this deploy, from D-11). The D-11 addendum called `359bc74a` the rollback, which was the Pages deployment before D-11.

### Neon backup and migrations

- Backup branch `uat-backup-2026-10-30-d14` (`br-delicate-paper-a1s53vzg`), created from `uat` before any migration, state `ready`.
- Migration state before: 14 versions, last `0014`. PostgreSQL 18.6.
- Applied with the runner at the deploy commit, direct host, `ALLOW_REMOTE_DB=true`: `+ [0015] 0015_project_links_workspace_fk.sql` and `+ [0016] 0016_staged_upload_cleanup.sql`.
- Migration state after: 16 versions, last `0016`. `card_image_uploads.staging_cleaned` present. `project_links` has the composite foreign key `project_links_project_workspace_fk`.

### R2 bucket and lifecycle backstop

- Bucket `flowboard-images-uat` (created 30 Oct 2026, APAC). Private: r2.dev disabled, no custom domain (D-13).
- Lifecycle rule `staging-expire` on prefix `staging/`, expire objects after 1 day, added with `npx wrangler r2 bucket lifecycle add flowboard-images-uat staging-expire staging/ --expire-days 1`. The existing rule "Default Multipart Abort Rule" (abort incomplete multipart uploads after 7 days) is also listed and was not changed.
- Bucket state after the deploy: `object_count` 0, `bucket_size` 0 B (`npx wrangler r2 bucket info flowboard-images-uat`).

### Worker

- `flowboard-api-uat` deployed from 36dfb3a with `wrangler deploy --env uat --var APP_ORIGIN:https://flowboard-app-uat.pages.dev --var MAIL_FROM_NAME:Flowboard`.
- Version after this deploy: `0302aa54-dab8-4cc1-93ef-1dae21d5b8cf`.
- Dry-run before the deploy listed `env.IMAGES (flowboard-images-uat)` as an R2 Bucket, and the two mail vars.
- Not set, as the Architect asked: `MAIL_FROM_EMAIL` and `BREVO_API_KEY`. Mail stays disabled until they are set. A disabled mailer leaves outbox rows pending.
- **Persistence note:** `--var` values are part of that deploy. A later plain `wrangler deploy --env uat` (no `--var`) would drop `APP_ORIGIN` and `MAIL_FROM_NAME`, because `env.uat` in `wrangler.jsonc` does not define them. Either pass the two `--var` flags on every UAT deploy, or add them to `env.uat` `vars` in `apps/api/wrangler.jsonc` (a config change; Backend or the Architect to commit).
- Cron: `*/15 * * * *` present on `flowboard-api-uat` (Workers API schedules read: `created_on` 2026-10-28, unchanged). The scheduled handler calls `cleanupOrphanUploads` (`apps/api/src/runtime/worker.ts`, B-11).

### Pages

- `flowboard-app-uat` deployed from 36dfb3a via `scripts/stage-pages-functions.mjs` (five files staged, including `src/lib/return-path.ts`).
- Deployment after this deploy: `7b2cc29a-5405-46aa-a79f-67c1b76fd83d` (`https://7b2cc29a.flowboard-app-uat.pages.dev`).

### Local checks at 36dfb3a

- `npm run typecheck` and `npm run typecheck:web` passed.
- Static export (`NEXT_EXPORT=true`, no `NEXT_PUBLIC_API_URL`) built in a clean worktree, exit 0.
- CI run `41057010428` on `36dfb3a`: success, job `Verify (Typecheck, Tests, Build)`.

### Signed-out smoke tests (curl; no credentials; no secrets printed)

- Worker `/health/ready` 200 and `/health/live` 200.
- Pages `/`, `/projects/x` and `/boards/x` redirect to `/signin`. `/projects` and `/board?id=x` redirect to `/signin?next=...`.
- `GET /api/v1/session` 401. `GET /api/v1/system/status` without the secret 403.
- Foreign-origin write with a cookie present (`Origin: https://evil.example`, `Sec-Fetch-Site: cross-site`, bogus `flowboard_session`): `PATCH /api/v1/projects/x` 403 and `POST /api/v1/cards/x/image-uploads` 403, on both the Pages host and the Worker host.
- Same foreign-origin writes without a cookie return 401, not 403 (authentication is checked first when there is no cookie). The earlier 404 for `POST /api/v1/projects` and `/api/v1/boards` was a wrong route name in this check, not a finding.
- Image routes, anonymous: `GET /api/v1/images/:id/content` 401, `GET /api/v1/cards/:id/images` 401, `GET /api/v1/image-uploads/:id` 401, on both hosts.
- `PATCH /api/v1/projects/x` 401 and `GET /api/v1/projects/x/overview` 401 (unauthenticated).
- `/signin` 200 with CSP, `permissions-policy`, `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff`, `x-frame-options: DENY`.
- `/favicon.svg` 200 `image/svg+xml`, `/apple-touch-icon.png` 200 `image/png`.

### Not verified here

- Signed-in flows, including the image upload, the R2 object count after upload and removal, the sign-out menu and the invitation flow. The user checks these (script below).
- Whether the mailer sends (disabled until the sender and key are set).

### Manual test script (for the user, on https://7b2cc29a.flowboard-app-uat.pages.dev)

1. Sign in with a test Google account. Check the top-bar role badge.
2. Open a project and a board. Create a card.
3. Count R2 objects before: `npx wrangler r2 bucket info flowboard-images-uat` and note `object_count` (expected 0 now).
4. Upload one small synthetic image (PNG or JPEG under 10 MiB) to the card. Finalize it.
5. Count R2 objects again: `object_count` should be 1 (`bucket_size` shows the size).
6. Remove the image from the card. Recount: `object_count` should return to 0 after the delete commits (the B-8 behaviour). If the count stays at 1, note the time and tell the Deployment chat.
7. Sign out with the new account menu, then reload a project URL: it should redirect to `/signin`.
8. Invitation flow: create an invitation to a synthetic address, confirm it appears in the pending list, then revoke it. Mail is disabled, so no email should arrive; the outbox row stays pending, which is expected.

Do not paste session cookies, tokens or any image bytes into chat.

### Mail: what the user must set (not done here)

- Sender: the verified sender address in Brevo, held in the Worker variable `MAIL_FROM_EMAIL` (a plain var, not a secret). It must be set together with `MAIL_FROM_NAME=Flowboard` and `APP_ORIGIN` (already set). Set it with a plain deploy flag or in `env.uat` `vars` (see the persistence note above).
- Key: run in the user's own terminal, never in chat: `npx wrangler secret put BREVO_API_KEY --env uat`. Paste the key at the prompt only.
- Until both are set the mailer is disabled and outbox rows stay pending. That is expected.

### Status

- Deployed to UAT: migrations 0015 and 0016, Worker `0302aa54-dab8-4cc1-93ef-1dae21d5b8cf`, Pages `7b2cc29a-5405-46aa-a79f-67c1b76fd83d`, the IMAGES binding, the lifecycle backstop, and the two non-secret mail vars.
- Not deployed: production, production bucket, production binding, mail sender and key.

## D-15: image counted in the UAT card but bucket info shows 0 objects (investigation)

Question: the user uploaded one image to a card on UAT (the card shows `Images 1/10`, and it survives refresh), but `wrangler r2 bucket info flowboard-images-uat` reported `object_count` 0 and `bucket_size` 0 B. Are the bytes in R2, or not?

Answer: **A. The bytes are in the real remote bucket. Only the bucket stats are stale.**

### Evidence (no image bytes, key, or user content printed; the scratch copy was removed)

1. **Postgres (UAT, read-only query):** one `card_images` row, `byte_length` 113138, `content_type` `image/webp`, `created_at` 2026-10-30 12:46:51 UTC. Its `card_image_uploads` row is `state` `finalized`, `byte_length` 113138, `received_bytes` 113138, created 12:46:41 UTC, updated 12:46:51 UTC. `pending_storage_deletions` has 0 rows, so nothing is queued for deletion. The storage key has the shape `images/prj_<id>/crd_<id>/img_<id>/<filename>`, which the R2 driver writes.
2. **Remote read, same bucket:** `npx wrangler r2 object get flowboard-images-uat/<key> --remote --file <scratch>` succeeded and wrote 113138 bytes. The downloaded file's size equals the database `byte_length`, and its SHA-256 equals the database `sha256`. The scratch file was deleted after the check.
3. **Local emulator is not the source:** the same get without `--remote` returns `The specified key does not exist.`, so the object is in the remote bucket, not a local emulator.
4. **Worker binding:** version `0302aa54-dab8-4cc1-93ef-1dae21d5b8cf` is 100% of traffic (`wrangler deployments status`) and lists `env.IMAGES (flowboard-images-uat)` as an R2 Bucket.
5. **Code path:** `apps/api/src/runtime/worker.ts` builds `R2StorageDriver` from `env.IMAGES` for every image request. `getStorageDriver()` (`apps/api/src/adapters/storage.ts`) throws `CONFIG_ERROR` when no driver is set, so there is no silent in-memory fallback in the deployed Worker. The `MemoryStorageDriver` is set only by tests (`apps/api/src/http/app.ts`, `setStorageDriver`).
6. **Bucket stats, rechecked:** `object_count` 0 and `bucket_size` 0 B at 13:02 UTC and again at 13:03 UTC on 30 Oct 2026, about 15 minutes after the upload. The stats did not reflect an object that the remote read returns. The lag could be longer than that; the cause is not established here.

### What this means

- No release blocker for storage: the image is stored in the right bucket, under the right key, with the right size and digest.
- Do not use `wrangler r2 bucket info` as a count check for UAT. Verify by key with `wrangler r2 object get <key> --remote` (no `--remote` reads the local emulator, which is empty and will say "does not exist").
- Wrangler 4.152.0 has no object-list command, so a count of objects needs another route: a per-key check, or an S3-compatible listing with an R2 API token, which is not set up here.

### Notes

- The object key contains the user's file name, which was printed once in this session's tool output (the wrangler download line). No image bytes were printed. The Architect can decide whether that matters; no action was taken on the user's data.
- The user's image was not deleted or changed.
- Not verified: the cause of the stats lag, and whether the stats catch up within the hour.
