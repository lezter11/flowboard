# Deployment secrets and config checklist

Names only. Never put values in Git, docs or chat. Set secrets with `wrangler secret put NAME --env <dev|uat>` (production: no `--env`); each environment gets its own value.

## Worker secrets (per environment, different values)

| Name | Purpose | Rule |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client | Prefer a separate OAuth client per environment |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Matches the client above |
| `CURSOR_SECRET` | Signs pagination cursors | 32+ random characters, unique per environment |
| `DEV_LOGIN_SECRET` | Admin secret for `/api/v1/system/*` | 32+ random characters, unique per environment, no default fallback |

Do not set `DEV_LOGIN_ENABLED` or `NODE_ENV` on deployed Workers.

## Worker vars (committed in `apps/api/wrangler.jsonc`)

`FRONTEND_URL`, `CORS_ORIGIN` (exact Pages origin), `GOOGLE_REDIRECT_URI` (`https://<pages-host>/api/v1/auth/google/callback`, the proxied URL).

## Google console

Add each environment's `GOOGLE_REDIRECT_URI` as an authorized redirect URI before the first sign-in there.

## Bindings

| Resource | dev | uat | production |
|---|---|---|---|
| Worker | `flowboard-api-dev` | `flowboard-api-uat` | `flowboard-api` |
| Hyperdrive | own config -> Neon `dev` branch | own config -> Neon `uat` branch | `flowboard-hyperdrive` -> `production` |
| Pages project | `flowboard-app-dev` | `flowboard-app-uat` | `flowboard-app` |
| Pages service binding `API` | `flowboard-api-dev` | `flowboard-api-uat` | `flowboard-api` |
