# Flowboard: risks and handoffs for an outside agent (2026-10-28)

Self-contained and short. Repo: `/Users/shubham/Documents/Flowboard`, branch `chore/baseline-2026-10-28` (nothing pushed). Stack: Hono API on a Cloudflare Worker (`apps/api`), Next.js static export on Cloudflare Pages (`apps/web`), PostgreSQL on Neon via Hyperdrive, shared Zod contracts (`packages/contracts`). Owners: Backend = `apps/api` + `database/`; UI = `apps/web`; Deployment = Cloudflare/Neon config; Architect = shared docs and contracts.

## Hard rules for any agent

- No production deploy, production data change, `git push`, force push or paid resource without the user's explicit yes.
- Never print, paste or commit secrets. Secrets are set by the user in their own terminal with `wrangler secret put NAME --env <uat|prod>`.
- Do not edit review records or `scripts/check_backend_review.py`. Do not edit another owner's folder.
- Tests need a disposable Postgres on a free port, not 55432 or 55479 (in use). Do not write to the production Neon branch.

## State

- Typecheck passes. API suite: 308 pass, 0 fail, 13 skipped (321). Contracts: 41 pass.
- Live today (old build): web `https://flowboard-app.pages.dev`, API `flowboard-api.web-app-cloud.workers.dev`. Google sign-in works on it (cross-site cookies, `SameSite=None`).
- New build (not deployed to production): same-origin Pages Function proxy `/api/*` to the Worker, `SameSite=Lax` cookies, Origin check, no wildcard CORS, no default admin secret.
- UAT exists: `https://flowboard-app-uat.pages.dev`, Worker `flowboard-api-uat`, Neon branch `uat`, migrations 0001 to 0008 applied. **UAT Google login is untested**: it needs the UAT redirect URI and two Worker secrets from the user.
- Review gate: board-access delta review failed 3 rounds at 8.175. User accepted a beta risk: `docs/decisions/2026-10-28-beta-risk-acceptance.md`. Checklist correctly says 0 backend features verified.

## Risks (highest first)

1. **Untested new login path.** Lax cookies through the proxy have never been exercised with real Google sign-in. If it breaks, users cannot sign in. Mitigation: test on UAT first; keep rollback IDs.
2. **Cutover can break working sign-in.** Old build works today. Record current Worker version id and Pages deployment id before deploying; deploy Worker and Pages together; roll back fast.
3. **Missing production secrets.** `CURSOR_SECRET` (R3-07) and the admin secret (32+ random chars) must be set in production before the new API goes out, or board access list returns 503 and `/system/*` is locked.
4. **Google client redirect.** Add `https://flowboard-app.pages.dev/api/v1/auth/google/callback` to the existing production client before cutover.
5. **Unreviewed fixes.** Lock-order deadlock fixes (`e548d0c`, `53f1d1f`, `36276eb`) are self-verified only; no independent reviewer. Beta only.
6. **Migrations on production Neon.** Take a Neon backup branch/restore point first; confirm 0001 to 0008 have no destructive statements.
7. **Known accepted findings:** R3-08/R3-14 ID existence hints; R3-09 in-flight read after revocation; R3-10 session IDs stored raw (hash after beta); R3-11 Google sign-in overwrites display name and makes a workspace per first login; R3-12 localhost trusted by Origin check; R3-13 local-only DB password string in `apps/api/wrangler.jsonc`; R3-04 randomized (not forced) interleaving test.
8. **Product gaps:** drag-and-drop not built (click/keyboard move only); unwired screens must be hidden or labelled coming soon; 13 skipped tests unexplained to the user.
9. **Operations:** cron was `* * * * *`, runbook sets `*/5`; no monitoring/alerting yet; no dev environment exercised.

## Handoffs

| # | Task | Owner | Needs from user | Evidence required |
|---|---|---|---|---|
| H1 | Add UAT redirect URI to a Google client; set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` for `--env uat` | User | Google console + own terminal | none (secrets) |
| H2 | Browser test UAT sign-in round trip, session cookie attributes, logout, 401 state | Deployment | H1 | screenshots, headers, `/api/v1/session` response |
| H3 | Set production secrets: `CURSOR_SECRET`, `DEV_LOGIN_SECRET` (admin), Google pair already set | User | own terminal | `wrangler secret list` names only |
| H4 | Add proxied production redirect URI to production Google client | User | Google console | none |
| H5 | Neon backup branch, then migrate production | Deployment | explicit go | backup branch id, migration log |
| H6 | Deploy Worker then Pages with proxy and service binding, smoke tests per `docs/RELEASE_BETA.md`, rollback ready | Deployment | explicit go | smoke test log, version ids |
| H7 | Smoke test: foreign-origin POST must 403, `/api/v1/system/*` without secret must fail, dev-login absent | Deployment | after H6 | curl output |
| H8 | Independent re-review of the 6 board-access features (stronger model preferred), then regenerate checklist | Backend + independent reviewer | none | passing record or honest fail |
| H9 | Hash session IDs (R3-10); fix R3-11 profile overwrite (needs Architect decision) | Backend | decision on R3-11 | tests |
| H10 | Drag-and-drop for cards with keyboard/click alternative retained | UI | none | browser walkthrough |
| H11 | Explain/enable the 13 skipped API tests | Backend | none | counts before/after |
| H12 | Monitoring, dev/uat promotion CI, move local DB string out of `wrangler.jsonc` | Deployment | none | config + CI run |

## Commands

```bash
npm run typecheck && npm run typecheck:web
npm test --workspace @flowboard/api     # needs Postgres; see database/compose.local.yaml
python3 scripts/render_feature_checklist.py
python3 scripts/check_backend_review.py <record.json> --feature <ID>
```

Key docs: `docs/RELEASE_BETA.md`, `docs/DEPLOY_SECRETS.md`, `docs/handoffs/frontend-backend-gaps.md`, `BACKEND_REVIEW_GATE.md`, `RULES.md`.
