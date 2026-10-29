# Rate limiting is not effective yet: production blocker, UAT accepted — 2026-10-29

Status: Architect decision. Supersedes the "approximate burst softener is enough" wording in docs/decisions/2026-10-29-rate-limiter-uat-finding.md.

## Evidence

- Worker-side binding limiter (commits 8b41fe6, a401adc, e57b4de) is deployed on UAT (Worker 77edff23). Bindings are present, `cf-connecting-ip` survives the Pages service-binding hop (no `rate_limit_client_ip_missing` in `wrangler tail`), and no `rate_limit_binding_absent` appears.
- A 42-request burst of GET /api/v1/auth/google returned 302 for 41 requests (one no status). Eleven Cloudflare locations served it; WAW served 12 and ARN 11, all 302, although the limit is 10 per 60 s. Per-location counting alone would have refused those, so the binding is looser than "approximate per location". A cause beyond location (for example counters kept per machine inside a location) is plausible but unproven.
- Conclusion: the limiter has not been observed to refuse any request on UAT. Treat rate limiting as **not in effect**.

## Decision

1. Beta/UAT: accept. There are no live users, sign-in is Google OAuth only (no password to guess), and every write needs a session and a board grant. The code stays (fail-open, diagnostic logs) because it is harmless and may tighten under real traffic, but no document or review may claim a limit is enforced.
2. Production: **blocker.** Before the production cutover we need an exact, verified limit on sign-in, invitation, import and image-upload routes. Two real routes, to be chosen by the user:
   - A custom domain on Cloudflare plus zone rate-limiting rules (exact at the edge; plan limits in docs/RATE_LIMITING.md section 2; this also gives a proper product URL).
   - Durable Objects counters in the Worker (exact, global; paid-plan and complexity questions in the Backend finding), or a PostgreSQL window-counter table for the few sensitive routes only.
3. Whichever route is chosen must be proven by a burst test that actually returns 429, recorded in docs/UAT_DEPLOY.md, before it counts.

## Tracking

Pre-production list: security headers (done), zod 4 (done), CI fixed (committed, Actions run not yet seen), independent review of CI/monitoring (done), **real rate limiting (open)**.
