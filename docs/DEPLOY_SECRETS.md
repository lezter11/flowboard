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

## Delivery guarantee: invitation email is at-least-once (B-14)

Brevo's transactional send API (`POST /v3/smtp/email`, https://developers.brevo.com/reference/send-transac-email, read 2026-10-30) documents no idempotency key. Its `headers` field sets email headers, so it is not used as one. The sender therefore cannot prove that a message was not accepted before a crash.

What that means: if the Worker or database connection fails after Brevo accepts an invitation and before the outbox row is marked delivered, the scheduled drain sends the same accept link again. The duplicate is harmless: the link is single use and the first delivery is the one that works. Operators see the duplicate as a second email, not as data loss.

The outbox row keeps the token and recipient only until it settles. After that it holds `{providerMessageId}`, and settled rows are deleted after 30 days (B-14).

## Accepted risk: invitation link in the query string (B-10, accepted by the Architect)

The accept link is `${APP_ORIGIN}/invitation?token=...`. The web screen reads `?token=`, so the single-use token can appear in proxy, CDN or access logs for the Pages and Worker hosts. Accepted because the token is single use and expires (seven days). Do not add query logging of this path, and do not log the full request URL in new code.
