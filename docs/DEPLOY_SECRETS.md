# Deployment secrets and config checklist

Names only. Never put values in Git, docs or chat. Set secrets with `wrangler secret put NAME --env uat` (production: no `--env`); each environment gets its own value.

## Worker secrets (per environment, different values)

| Name | Purpose | Rule |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client | Prefer a separate OAuth client per environment |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Matches the client above |
| `CURSOR_SECRET` | Signs pagination cursors | 32+ random characters, unique per environment |
| `DEV_LOGIN_SECRET` | Admin secret for `/api/v1/system/*` | 32+ random characters, unique per environment, no default fallback |
| `BREVO_API_KEY` | Brevo transactional mail API key (B-10) | Set per environment. Absent means invitation email is disabled: rows wait, nothing else changes |

Do not set `DEV_LOGIN_ENABLED` or `NODE_ENV` on deployed Workers.

## Worker vars (committed in `apps/api/wrangler.jsonc`)

`FRONTEND_URL`, `CORS_ORIGIN` (exact Pages origin), `GOOGLE_REDIRECT_URI` (`https://<pages-host>/api/v1/auth/google/callback`, the proxied URL).

Mail vars (B-10), set in `wrangler.jsonc` or with `wrangler vars`, not secrets:

- `MAIL_FROM_EMAIL`: sender address, a verified sender in Brevo (for example `mail@<domain>`).
- `MAIL_FROM_NAME`: sender display name, for example `Flowboard`.
- `APP_ORIGIN`: the origin used to build the invitation link, for example `https://flowboard-app-uat.pages.dev`. Https only (plain http only for a local host), no path, query or credentials. It is never taken from the request.

The mailer is off unless `BREVO_API_KEY`, a valid `MAIL_FROM_EMAIL` and a valid `APP_ORIGIN` are all set. While it is off, invitation emails wait in the outbox, and the one-time link is still returned to the inviter by the API.

## Google console

Add each environment's `GOOGLE_REDIRECT_URI` as an authorized redirect URI before the first sign-in there.

## Bindings (two environments only: UAT and PROD)

The dev environment was dropped (decision in docs/decisions/2026-10-28-uat-first-release-policy.md). Neon branch `dev` and any `flowboard-app-dev` project were never wired; removal is pending Architect approval.


| Resource | uat | production |
|---|---|---|
| Worker | `flowboard-api-uat` | `flowboard-api` |
| Hyperdrive | `flowboard-hyperdrive-uat` -> Neon `uat` branch | `flowboard-hyperdrive` -> `production` |
| Pages project | `flowboard-app-uat` | `flowboard-app` |
| Pages service binding `API` | `flowboard-api-uat` | `flowboard-api` |

## Accepted risk: invitation link in the query string (B-10, accepted by the Architect)

The accept link is `${APP_ORIGIN}/invitation?token=...`. The web screen reads `?token=`, so the single-use token can appear in proxy, CDN or access logs for the Pages and Worker hosts. Accepted because the token is single use and expires (seven days). Do not add query logging of this path, and do not log the full request URL in new code.
