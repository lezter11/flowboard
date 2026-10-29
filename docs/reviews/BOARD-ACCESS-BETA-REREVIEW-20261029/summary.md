# Executive Summary: Flowboard Board Access Beta Re-Review

**Review Date**: 2026-10-29  
**Review Target**: Commit `6e15bd0` (Branch `chore/baseline-2026-10-28`)  
**Reviewer**: `independent-reviewer-gemini` (Model: `gemini-2.5-pro`, Fresh Context)  
**Overall Verdict**: **PASS**  
**Weighted Score**: **8.985 / 10** (Unrounded threshold: > 8.5)

---

## 1. Score Breakdown by Category

| Category | Weight | Minimum | Score | Verdict | Key Evidence |
| :--- | :---:| :---:| :---:| :---:| :--- |
| **Security & Authority** | 30% | 9.0 | **9.2** | PASS | Immediate revocation across all routes; session token hashing in DB (R3-10); Google display name protection (R3-11); CSRF Origin check; private image access check. |
| **API & Functional Correctness** | 25% | 8.5 | **9.0** | PASS | 450/450 tests pass with zero skips; additive card keys and project prefixes; column tones; non-enumerating 404 responses. |
| **Data Integrity & Concurrency** | 15% | 8.5 | **9.0** | PASS | Board-first lock order in comments and imports eliminates R3 deadlocks (0 deadlocks measured across 20 forced interleavings); atomic idempotency receipts; 24h trash purge. |
| **Test Quality & Evidence** | 15% | 8.5 | **9.0** | PASS | All 13 concurrency/lock suites executed unskipped on isolated PostgreSQL; 4 targeted probe scripts verified lock ordering, replays, session hashing, and origin gates. |
| **Maintainability & Portability** | 10% | 7.5 | **8.5** | PASS | Modular monolith with shared Zod contracts; embedded migrations (0001..0010) byte-identical between Node and Worker; clean dependency licenses (100% MIT/Apache). |
| **Operations & Performance** | 5% | 7.0 | **8.5** | PASS | Safe error envelopes (no credential or stack leaks); constant-time board snapshot query (~7 queries, zero N+1); 503 retryable mapping on serialization conflict. |
| **Total Weighted Score** | **100%** | **> 8.5** | **8.985** | **PASS** | **All category minimums met; zero hard blockers; zero coverage gaps.** |

---

## 2. Top 5 Operational Risks for Production Release

1. **Unexercised Hosted Sign-in Path (Pre-Cutover)**:
   - *Risk*: `SameSite=Lax` cookies through the Pages Function proxy have been exercised in synthetic tests and UAT configuration, but end-to-end browser sign-in with live Google OAuth in production requires user consent and production redirect URI registration (`H1`/`H4`).
   - *Mitigation*: Run UAT browser verification before production cutover; retain rollback Worker version (`acefdb67-...`) and Pages deployment ID.
2. **Missing Production Secrets**:
   - *Risk*: `CURSOR_SECRET` (R3-07) and `DEV_LOGIN_SECRET` (admin secret for `/api/v1/system/*`) must be configured in production via `wrangler secret put` before the Worker goes live, or board access listing returns `503 CONFIG_ERROR`.
   - *Mitigation*: Follow secrets-first ordering in `docs/RELEASE_BETA.md` Phase 3 before deploying code.
3. **Application-Level Rate Limiting Absent**:
   - *Risk*: Flowboard enforces body limits (1 MiB) and execution deadlines, but lacks per-IP rate limiting on `/api/v1/auth/google`, invitations, and comments.
   - *Mitigation*: Configure Cloudflare WAF rate limiting rules (10 req/min on auth, 60 req/min on writes) at the edge.
4. **Missing Static Site Security Headers on Pages**:
   - *Risk*: `apps/web/public/` currently lacks a `_headers` file, meaning Cloudflare Pages does not automatically attach Content-Security-Policy or anti-clickjacking headers to static assets.
   - *Mitigation*: Add `_headers` to `apps/web/public/` defining `Content-Security-Policy` and `X-Frame-Options: DENY`.
5. **Database Migration on Production Neon**:
   - *Risk*: Applying migrations 0001–0010 on production Neon branch.
   - *Mitigation*: All migrations are strictly additive (no destructive statements). Take a point-in-time Neon backup branch (`npx neonctl branches create ...`) immediately prior to migration.

---

## 3. What Must Be Done Before Production Cutover

1. Operator sets `CURSOR_SECRET` and `DEV_LOGIN_SECRET` via `wrangler secret put`.
2. Add production Pages redirect URI (`https://flowboard-app.pages.dev/api/v1/auth/google/callback`) to the Google Cloud OAuth client.
3. Create Neon production backup branch.
4. Apply migrations 0001–0010 to production Neon database via direct connection endpoint.
5. Deploy Worker and Pages simultaneously using the runbook in `docs/RELEASE_BETA.md`.

---

## 4. What Can Safely Wait for Post-Beta Hardening

- Per-column cursor-based pagination (P-011).
- Zod dependency minor upgrade to `>=4.6.7` (memory exhaustion patch).
- In-memory rate limiting middleware inside the Worker (covered by Cloudflare WAF for beta).
- Advanced CSV export formula sanitization (export feature is not yet built).
