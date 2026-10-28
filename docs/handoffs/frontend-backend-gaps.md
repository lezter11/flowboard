# Frontend → backend handoff: contract and runtime gaps

Rewritten 2026-10-28 by the Backend chat against branch `chore/baseline-2026-10-28` (baseline `f20ca22`, plus Backend fixes). The 2026-10-26 version described commit `6120e51`; most of its route-coverage claims are obsolete and are replaced here. Not a review record and not approval: **0 of 98 backend features currently pass the review gate** (see [Review status](#review-status)).

## Status snapshot (measured, not claimed)

- **94 handlers are mounted** (counted from `createApp().routes`, 2026-10-28). `OPENAPI_ROUTES` declares 67 operations; **65 match a mounted handler** after stripping the `/api/v1` prefix.
- The 2 declared-but-unmatched operations are naming drift, not missing features:
  - declared `POST /workspaces/{workspaceId}/transfer-owner`; mounted `POST …/transfer-ownership`.
  - declared `POST /notifications/{notificationId}/read`; mounted `PATCH /notifications/:id/read`.
  Fixing either side changes a shared contract, so it needs an Architect decision.
- 29 mounted handlers have no OpenAPI entry: health probes, `PATCH /session/profile`, `dev-login`, Google auth (2), `GET /projects`, `access-summary`, `DELETE …/members/:uid`, board access/grants (3), `move-undo`, `GET /workspaces/:wid/my-tasks`, the unprefixed import aliases (`/imports/*`, `/import/template`, `/boards/:id/imports`, `/boards/:id/import-template`), `POST /notifications/mark-all-read`, `activity/health`, `notifications/health`, `system/status`, `system/migrate`.
- Mounted route groups: session, Google auth, workspaces, projects, invitations, members, boards and columns, board grants, cards, comments, trash, images, imports, activity, notifications, system. **No declared group is missing a handler.** `apps/web` exists (Next.js); UI integration is the UI chat's record, not claimed here.
- API tests on an isolated PostgreSQL 17 (port 55491, both `flowboard_harness` and `flowboard_access_test`): **375 tests, 375 pass, 0 skipped** after Backend fixes on 2026-10-28. Typecheck passes. Local only; no Worker-on-Cloudflare or production run.

## Review status

- 98 handoff files say `status: verified`, but `scripts/check_backend_review.py` rejects every referenced review record, so the generated checklist counts **0 backend verified**. 92 records fail with `target changed` (shared adapters such as `boards.ts`, `cards.ts`, `comments.ts`, `invitations.ts`, `imports.ts`, `activity.ts`, `images.ts`, `idempotency.ts` changed for board-access cutover and later fixes). 6 records (`BRD-01`, `RBAC-01`…`RBAC-05`, round 8) fail because their directory scope gained new files (`google-auth.ts`, `system.ts`, `embedded-migrations.ts`, `cors-policy.test.ts`).
- Do not treat a "verified" handoff status as UI-ready. UI-ready means a passing review record that the checker accepts.

## Production sign-in: what exists, what is untested

**Exists (code)**
- `GET /api/v1/auth/google` redirects to Google with a random `state` stored in a 10-minute HttpOnly `SameSite=Lax` cookie; `GET /api/v1/auth/google/callback` checks that state, exchanges the code, reads userinfo, upserts the user by lower-cased email, creates a personal workspace when the user owns none, creates a DB session and redirects to `FRONTEND_URL`.
- Session: opaque id in an HttpOnly cookie `flowboard_session`, 7 days, `SameSite=Lax`, `Secure` off localhost. `GET /session` returns the actor and accessible projects. `POST /session/logout` revokes the DB session and returns `204`.
- Changed 2026-10-28 (commits `4c27508`, `22fe21e`): the Google callback now rejects an unverified or missing `email_verified` claim; cookies were returned to `SameSite=Lax`; credentialed CORS no longer trusts every `*.pages.dev` or `*.workers.dev` origin (only localhost and the `CORS_ORIGIN` list); the admin secret has no built-in default outside tests and needs 32+ characters.

**Dev-login gating**
- `POST /session/dev-login` returns `404` when the Worker has a `HYPERDRIVE` or `DATABASE_URL` binding. On Node it works only when `NODE_ENV=test`, or `NODE_ENV=development` with `DEV_LOGIN_ENABLED=true` and `DEV_LOGIN_SECRET` of 32+ characters. A deployed environment must not set those. Signing in to an existing account needs the secret in `X-Dev-Secret`.
- `GET /system/status` and `POST /system/migrate` (migrations over HTTP) are protected only by `X-Dev-Secret`/`DEV_LOGIN_SECRET`. They are closed (403) when the secret is unset or short. Whether they should exist in production at all is an Architect/deploy decision.

**Untested or open**
- The Google flow is tested only with a mocked `fetch` (new `google-auth-system.test.ts`): state mismatch, unverified email, verified sign-in. Never exercised against real Google, with a real redirect URI, or on the deployed Worker. `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI` and `FRONTEND_URL` configuration is unverified. No PKCE or nonce; no ID-token signature check (userinfo over TLS is used instead).
- **Cross-site deployment (breaking with `SameSite=Lax`).** Today's web `*.pages.dev` and API `*.workers.dev` are different sites. `apps/web/src/lib/api.ts` sends `credentials: 'include'` to `NEXT_PUBLIC_API_URL`; if that is set to the Worker URL, the browser will not send the Lax cookie on those calls and every request after Google sign-in is `401`. `SameSite=None` is not a safe fix: it only worked because CORS also trusted every `*.pages.dev`/`*.workers.dev` origin, and browsers increasingly block third-party cookies anyway. Production-safe topologies, either of which keeps Lax:
  1. **Same-origin proxy (smallest change):** leave `NEXT_PUBLIC_API_URL` unset so the browser calls `/api/...` on the web origin, and have the web host forward `/api/*` to the Worker (Cloudflare Pages `_redirects` proxy rule, a Pages Function, or Next `rewrites` on a server runtime; static `NEXT_EXPORT=true` output has no rewrites). The session cookie is then first-party to the web origin. Set `GOOGLE_REDIRECT_URI` to `https://<web-origin>/api/v1/auth/google/callback` (same origin, so the OAuth state cookie also round-trips) and `FRONTEND_URL` to the web origin.
  2. **Custom domain:** `app.example.com` and `api.example.com` share a registrable domain, so they are same-site and Lax cookies flow with `credentials: 'include'`. Add `https://app.example.com` to `CORS_ORIGIN`.
  Not verified: which topology the live deployment uses (Deployment chat owns it). Backend cannot test a deployed topology; `cors-policy.test.ts` pins the Backend side (Lax, no wildcard origins).
- CSRF: `originCheckMiddleware` (2026-10-28) rejects cookie-authenticated POST/PUT/PATCH/DELETE whose `Origin`/`Referer` is neither the origin the user sees (the Pages proxy keeps its own URL), localhost, nor in `CORS_ORIGIN`, or that Fetch Metadata marks cross-site. It returns the existing `403 FORBIDDEN` envelope, so no shared contract changed. Backend-only tests; not exercised through the real Pages Function. No rate limiting on auth routes.
- `GET /session` still returns no session expiry (dev-login does). `logoutResponseSchema` in contracts expects a JSON body while the route returns `204`.
- The Google route has no independent review. The six records above need a delta review that includes it.

## Open gaps, re-checked 2026-10-28

Status uses what was verified in source today; items marked "not re-checked" come from the 2026-10-26 report and are unconfirmed.

| ID | Gap | Status |
|---|---|---|
| P0-1 | Production sign-in contract | Google flow exists (above); `expiresAt` on `GET /session`, failure-code docs and real-provider tests still open |
| P0-2 | Declared vs mounted API | Largely resolved (65/67 matched, 2 naming drifts). `OPENAPI_ROUTES` still lacks `implemented/planned` and a CI parity check |
| P0-3 | Error codes and typed `details` | Not re-checked |
| P0-4 | Global 1 MiB body limit and 5 s deadline vs images/imports | Global 1 MiB default still set in `app.ts`; per-route limits for 10 MiB images and 5 MiB XLSX not re-checked |
| P0-5 | Invitation tokens | **Still open**: create (`invitations.ts:98`) and resend (`:336`) return `token: rawToken`. No preview route |
| P0-6 | Member directory authority and pagination | Not re-checked |
| P0-7 | Idempotency replay before authorization | Not re-checked; board/card/comment/trash paths were fixed in earlier repair rounds |
| P0-8 | Logout contract and expiry | Schema/route mismatch still present (above) |
| P2 | Origin/CSRF check | Added (above); awaiting review |
| New | `GET /boards/:id` uses optional auth and answers 404 for unknown ids but 401 for existing ones, which reveals whether a board id exists | Low; fix is to authenticate first |
| New | `POST /notifications/mark-all-read` is mounted; `docs/FRONTEND_BEHAVIOR_SPEC.md` says not to add mark-all | Product conflict for the Architect |

Screen-level P1 items (project role/filter/archive metadata, activity and notification typing, `/me/tasks` context, card detail shape, import mapping, image/trash metadata, settings) were not re-checked in this pass. Use the 2026-10-26 text in git history (`git show 6120e51:docs/handoffs/frontend-backend-gaps.md`) as a candidate list, not as current fact.

## Recommended backend order

1. Re-review under the gate (delta review for the six board-access records; grouped re-review for the rest).
2. Close P0-5 (token-free invitation responses plus preview), P0-8 and `expiresAt`.
3. Origin check, body/deadline classes, error-code union.
4. Contract naming drift (Architect).

## What this document does not claim

It changes no contract and approves nothing. Route counts and test results are local observations on one disposable database. Read `BACKEND_REVIEW_GATE.md` for what approval requires.
