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
