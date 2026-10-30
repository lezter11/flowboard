# Production cutover runbook (D-17)

Status: **runbook only. Nothing here has been executed.** Written by the Deployment chat on 2026-10-30 from the repo as it is at `4bb656b` plus the D-16 docs commit. Production stays untouched until the Architect and the user sign the go/no-go checklist in section 12.

Owner key: **needs user** means only the user can do it (their credentials, the Google console, the Neon or Cloudflare dashboard, or their own terminal). **Deployment** and **Backend** name the chat that runs the command or changes the code.

## 0. Facts this runbook is built on (read from the repo)

| Fact | Where it is |
|---|---|
| Production Worker is the **top level** of `apps/api/wrangler.jsonc` (`name` `flowboard-api`). There is **no `env.production` block**, so every production change goes to the top level, not to `env.production`. | `apps/api/wrangler.jsonc` |
| Production has no `r2_buckets` and no `APP_ORIGIN` or `MAIL_FROM_*` vars yet. UAT has them under `env.uat`. | `apps/api/wrangler.jsonc` |
| Production cron `*/5 * * * *`; rate limiter binding `FB_RL_WRITES` namespace `1002`. | `apps/api/wrangler.jsonc` |
| Production Pages project is `flowboard-app`; its Worker service binding is `flowboard-api`. | `apps/web/wrangler.prod.jsonc`, `docs/DEPLOY_SECRETS.md` |
| Production Hyperdrive is `flowboard-hyperdrive` -> Neon `production`. Its current role is `neondb_owner` on the `-pooler` host. | `docs/DEPLOY_SECRETS.md`, `docs/RELEASE_BETA.md` (line ~121) |
| Worker secrets, names only: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CURSOR_SECRET`, `DEV_LOGIN_SECRET` (the admin secret for `/api/v1/system/*`), `BREVO_API_KEY`. Never set `DEV_LOGIN_ENABLED` or `NODE_ENV`. | `docs/DEPLOY_SECRETS.md` |
| Health routes are on the Worker host, not the Pages host: `GET /health/live`, `GET /health/ready`. | `apps/api/src/http/app.ts` (lines 146-147), `docs/MONITORING.md` |
| Uptime probe and availability alerts are **Planned**, not configured. | `docs/MONITORING.md` section 2c |
| **No least-privilege role SQL exists in the repo.** `grep` for `GRANT` and `CREATE ROLE` under `database/` and `apps/api/src` finds nothing. | repo search, 2026-10-30 |
| The rate-limit burst check (`docs/RATE_LIMITING.md` section 7) says **do not run it against production**. | `docs/RATE_LIMITING.md` section 7 |
| Migrations run with `npm run -s db:migrate` in `apps/api` with `ALLOW_REMOTE_DB=true` and `DATABASE_URL` (direct host, no pooler). | `apps/api/src/runtime/migrate.ts`, `docs/UAT_DEPLOY.md` (D-14, D-16) |
| Migrations `0001` to `0017` exist. `0017_audit_round_b14.sql` is the latest. | `database/migrations/` |
| Pages deploy from a staging dir: `NEXT_EXPORT=true npm run build` (no `NEXT_PUBLIC_API_URL`), then `scripts/stage-pages-functions.mjs`, then `wrangler pages deploy`. | `apps/web/package.json`, `scripts/stage-pages-functions.mjs`, `docs/UAT_DEPLOY.md` |
| Security gaps still open: shared database role (S3), no row-level security (D2). | `docs/SECURITY_ROADMAP.md` |

## 1. Least-privilege database roles (S3) — **Backend writes the SQL; needs user runs it**

Why: today the Worker connects as `neondb_owner`, which can create, alter and drop anything. The runtime should only read and write rows. Three roles are needed: the migration owner, the runtime role (DML only), and a read-only reporting role.

Steps:

1. **Backend** writes `database/roles/` SQL (not yet in the repo): create `flowboard_migrator` (owns the schema, used only by `db:migrate`), `flowboard_runtime` (`SELECT, INSERT, UPDATE, DELETE` on application tables, `USAGE` on sequences, no `CREATE`, no `ALTER`, no `DROP`, no `TRUNCATE`), and `flowboard_reporting` (`SELECT` only). **Needs user** to review the SQL before it runs.
2. **Needs user**, Neon console or Neon CLI, on the `production` branch: create the two roles and record their passwords in their password manager. **Never put a password in chat or in a file.**
3. **Needs user**: put the runtime connection string into the Hyperdrive configuration for `flowboard-hyperdrive`, using the direct host and the runtime role. Do not print it.
4. **Verification**, to be run by the Deployment chat with the runtime connection string set in its own shell only, reporting booleans and role names, not the string:
   ```sql
   SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;
   ```
   Expected: `rolsuper`, `rolcreatedb`, `rolcreaterole` all false. Then attempt `CREATE TABLE _probe (id int);` as the runtime role. It must fail with a permission error. Do not run the probe on any table that holds data.
5. Record the sanitized role names and booleans in the cutover addendum. Do not record the connection string.

## 2. Neon backup branch and rollback ids — **needs user** (dashboard or CLI), Deployment records

1. **Needs user** or Deployment with neonctl: create the backup branch of `production` (project `misty-unit-76664549`, branch `production`) named `production-backup-<date>-cutover`. Record its id and state.
2. Record the UTC time just before any migration. Record `schema_migrations` (last version), and the counts of `outbox`, `rate_limit_windows`, `card_image_uploads`, `card_images`, `project_links`, `board_grants`.
3. **Retention:** check the restore window in the Neon console before cutover and write it in the addendum. Do not assume a value.
4. **Rollback ids to record before the first production deploy:**
   - Worker: `npx wrangler deployments list` (no `--env`, production) and note the version at 100%.
   - Pages: the current production deployment id of `flowboard-app` (`npx wrangler pages deployment list --project-name flowboard-app`).

## 3. Production secrets — names only — **needs user** sets each value in their own terminal

Run each command yourself. Do not paste a value into chat. Production has no `--env` flag.

| Name | Where the value comes from | Command (user's own terminal) |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud console, OAuth client for production | `cd apps/api && npx wrangler secret put GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console, same client | `cd apps/api && npx wrangler secret put GOOGLE_CLIENT_SECRET` |
| `CURSOR_SECRET` | Generate a new value; 32+ random characters, unique to production | `cd apps/api && openssl rand -base64 48 \| npx wrangler secret put CURSOR_SECRET` |
| `DEV_LOGIN_SECRET` | Generate a new value; the admin secret for `/api/v1/system/*`, unique to production, never reused from UAT | `cd apps/api && openssl rand -base64 48 \| npx wrangler secret put DEV_LOGIN_SECRET` |
| `BREVO_API_KEY` | Brevo dashboard, production API key | `cd apps/api && npx wrangler secret put BREVO_API_KEY` |

Note: the `openssl ... | wrangler secret put` form keeps the generated value out of the terminal history and out of chat. Keep the `DEV_LOGIN_SECRET` value in the password manager; the admin route needs it.

Verification (names only): `cd apps/api && npx wrangler secret list` (no `--env`) must show all five names.

## 4. Google production redirect URI — **needs user** (Google Cloud console)

1. Add `https://flowboard-app.pages.dev/api/v1/auth/google/callback` as an authorized redirect URI on the **production** OAuth client. This is the production `GOOGLE_REDIRECT_URI` (top-level `vars` in `apps/api/wrangler.jsonc`, the same pattern as UAT). Add it before the first production sign-in.
2. Use a separate OAuth client from UAT (`docs/DEPLOY_SECRETS.md` says prefer one per environment).

## 5. Production R2 bucket and IMAGES binding — **needs user** creates the bucket; Deployment adds the binding

1. **Needs user** (Cloudflare dashboard, or `npx wrangler r2 bucket create flowboard-images-prod`): create the private bucket `flowboard-images-prod`. Keep it private: r2.dev off, no custom domain.
2. **Needs user** (or Backend): add the lifecycle backstop, the same as UAT: `npx wrangler r2 bucket lifecycle add flowboard-images-prod staging-expire staging/ --expire-days 1`. This is the D-14 step.
3. **Backend** adds the binding to the **top level** of `apps/api/wrangler.jsonc` (there is no `env.production` block):
   ```jsonc
   "r2_buckets": [{ "binding": "IMAGES", "bucket_name": "flowboard-images-prod" }]
   ```
   The top level is production; the UAT block stays under `env.uat`. Backend commits; Deployment deploys.
4. Until the binding exists, image routes return `503 CONFIG_ERROR` in production (this is intended; see the comment in `wrangler.jsonc`).

## 6. Production mail vars — **needs user** decides the sender; Backend commits the config

1. **Backend** adds to the **top-level** `vars` of `apps/api/wrangler.jsonc`:
   - `APP_ORIGIN`: `https://flowboard-app.pages.dev`
   - `MAIL_FROM_NAME`: `Flowboard`
   - `MAIL_FROM_EMAIL`: **needs user** to choose a sender that is verified in Brevo for production. The UAT value is the internal beta sender; do not reuse it for production without the user's decision.
2. Confirm the Brevo sender is verified for the production account (Brevo dashboard, **needs user**).
3. Without `BREVO_API_KEY`, `MAIL_FROM_EMAIL` and `APP_ORIGIN`, the mailer stays off and invitation emails wait in the outbox (`docs/DEPLOY_SECRETS.md`). That is safe, but it must be a deliberate choice at go/no-go.

## 7. Production migrations 0001 to 0017 — Deployment runs after section 2 and the go decision

1. Confirm the backup branch from section 2 is `ready` and the pre-migration counts are recorded.
2. Run from the clean worktree at the cutover commit, with the **migration** connection string in the shell only:
   ```bash
   cd apps/api && ALLOW_REMOTE_DB=true DATABASE_URL="<production direct URL, migrator role>" npm run -s db:migrate
   ```
   The runner prints each `+ [NNNN]` line. If any statement errors, **stop, do not deploy the Worker, and report**.
3. Confirm `schema_migrations` is `0001` to `0017` and the counts match the pre-migration record (additive migrations only).
4. The migration runs with the migrator role; the Worker runs with the runtime role from section 1. Never run the runner with the runtime role.

## 8. Worker deploy — Deployment, after section 7

1. Create a clean worktree at the cutover commit (`git worktree add --detach <scratch>/cutover <commit>`), install with `npm ci`.
2. Dry run: `cd apps/api && npx wrangler deploy --dry-run --outdir <scratch>`. Check that `IMAGES`, `HYPERDRIVE`, `FB_RL_WRITES`, `APP_ORIGIN`, `MAIL_FROM_NAME` and `MAIL_FROM_EMAIL` are all listed, and that no secret value is printed.
3. Deploy: `cd apps/api && npx wrangler deploy`. Record the version id and that it is 100%.
4. Rollback target: the Worker version recorded in section 2 (`npx wrangler rollback <version> --message "..."`, reviewed first).

## 9. Pages deploy — Deployment, after the Worker

1. Build in the clean worktree: `cd apps/web && NEXT_EXPORT=true npm run -s build` (no `NEXT_PUBLIC_API_URL`).
2. Stage: create a staging dir with `out/`, the `functions/` staged by `node scripts/stage-pages-functions.mjs apps/web <stage>`, and `apps/web/wrangler.prod.jsonc` copied as `wrangler.jsonc`. The stager fails loudly on any unresolved import; do not work around it.
3. Deploy from the staging dir: `npx wrangler pages deploy out --project-name flowboard-app --branch main`. Record the deployment id.
4. Rollback target: the Pages deployment id from section 2 (promote it back in the Pages dashboard, **needs user**, or redeploy its build).

## 10. Smoke tests — Deployment, signed-out only, no secrets printed

Run against the production hosts only after sections 8 and 9. Do not run the rate-limit burst check here (see section 11).

- `https://flowboard-api.web-app-cloud.workers.dev/health/live` and `/health/ready` return 200.
- `GET https://flowboard-app.pages.dev/api/v1/session` returns 401, with `cache-control: no-store`.
- `https://flowboard-app.pages.dev/email/flowboard-lockup-dark.png` and `/email/invite-board-hero.png` return 200 with `image/png`.
- `https://flowboard-app.pages.dev/signin` returns 200 with a `content-security-policy` header.
- `GET /api/v1/images/<any id>/content` without a session returns 401 (not 200, not 503).
- Secret names: `npx wrangler secret list` (no `--env`) shows the five names in section 3.
- **Not allowed here:** sending an invitation, signing in with a real account, or uploading an image. These are for the user, with synthetic data, after the go decision.

## 11. Rate-limit check — **needs user** approval; not on production by default

- `docs/RATE_LIMITING.md` section 7 says the burst test must **not** run against production. The Deployment chat will not run it there.
- For production the option is a read-only check: after sign-in attempts from the user's own account, count rows in `rate_limit_windows` (the PostgreSQL limiter, migration 0011) with the reporting role. **Needs user** to approve any traffic that is generated on production.
- The Cloudflare binding `FB_RL_WRITES` is soft (fail open) and was observed not to enforce on UAT (`docs/RATE_LIMITING.md`). Do not rely on it as the production control.

## 12. Uptime alert — **needs user** picks the service and the destination

- `docs/MONITORING.md` lists an external uptime probe as **Planned**. Nothing is configured today.
- **Needs user**: choose an uptime service (for example one that is already in the user's accounts) and point it at `https://flowboard-api.web-app-cloud.workers.dev/health/ready` every 5 minutes, which matches the production cron cadence in `docs/MONITORING.md` section 2a.
- The alert destination must reach a human: an email address or phone number that the user checks. A probe that posts to a channel nobody reads is not an alert.
- Do not point the uptime tool at `/api/v1/system/status`: it needs the admin secret and the tool stores request headers (`docs/MONITORING.md` section 1).
- Cron health: check the Cron Trigger metrics for `flowboard-api` after the first production tick (manual today, see `docs/MONITORING.md` 2a).

## 13. Rollback procedure

Decision: roll back the Worker first (fastest, no data change), then Pages, then the database only if a migration statement is proven to be wrong.

1. **Worker:** `cd apps/api && npx wrangler rollback <previous version id> --message "cutover rollback"` (versions from section 2).
2. **Pages:** promote the previous deployment id of `flowboard-app` (section 2).
3. **Database:** migrations are additive, so the usual rollback is to leave the schema and roll back the code. Restoring the database from the backup branch is a last resort and needs the Architect and the user. Record the restore point and the time.
4. After any rollback, re-run the section 10 smoke tests and record the result.
5. Record every rollback in the cutover addendum in `docs/UAT_DEPLOY.md` (or the production log the Architect names).

## 14. Go / no-go checklist (signed by the user)

Each line must be ticked or marked not applicable with a reason. Any unticked line is a no-go.

- [ ] Section 1 roles created, verified with the boolean query, and reviewed. **Needs user.**
- [ ] Section 2 backup branch `ready`; pre-migration counts and retention recorded; Worker and Pages rollback ids recorded.
- [ ] Section 3 all five production secret names present; no value in chat or files. **Needs user.**
- [ ] Section 4 production Google redirect URI added; separate OAuth client. **Needs user.**
- [ ] Section 5 private bucket `flowboard-images-prod` created, lifecycle added, binding in config. **Needs user** (bucket) and Backend (binding).
- [ ] Section 6 production `APP_ORIGIN`, `MAIL_FROM_NAME`, `MAIL_FROM_EMAIL` committed; sender verified in Brevo. **Needs user** (sender).
- [ ] Section 7 migrations 0001 to 0017 applied to production; counts match.
- [ ] Section 8 Worker deployed; version recorded.
- [ ] Section 9 Pages deployed; deployment id recorded.
- [ ] Section 10 smoke tests pass.
- [ ] Section 11 rate-limit approach agreed (no burst test on production unless approved). **Needs user.**
- [ ] Section 12 uptime alert configured with a human destination. **Needs user.**
- [ ] Section 13 rollback steps read and understood by the person on call.
- [ ] Production stays unchanged until this list is signed.

Signed (user): ______________________   Date: __________

Signed (Architect): __________________   Date: __________
