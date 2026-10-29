# Flowboard security hardening roadmap (2026-10-29)

Status: proposal, scheduled **after** the UI/UX work. Nothing here is implemented unless the "Status" column says done. Quota and plan figures marked (unverified) come from memory and must be checked in the Cloudflare and Neon dashboards before we rely on them.

Plain-English model: Flowboard is a building. Identity is the front door, authorization is the lock on each room, the database is the vault, the edge (Cloudflare) is the perimeter, monitoring is the alarm and the guard, and the release process is how new locks get installed. This roadmap says which of those are strong, which are missing, and in what order to fix them.

Threat actors we plan for: a curious invited user trying to see another project; a stranger scanning the public site; an automated or AI-assisted attacker probing every endpoint cheaply and tirelessly; a request flood; a stolen laptop or leaked secret; a poisoned dependency or tool instruction (supply chain, prompt injection into our own agents).

## Where we stand

| Area | State | Evidence |
|---|---|---|
| Sign-in | Google OAuth only, no passwords; session cookie HttpOnly, Secure, SameSite=Lax; session token stored hashed | done; verified on UAT |
| Authorization | Project membership plus board grant; revocation on next request; independent review 8.985 pass | done; docs/reviews/BOARD-ACCESS-BETA-REREVIEW-20261029 |
| CSRF and CORS | Origin/Referer check on cookie writes; no wildcard origins | done |
| Browser hardening | CSP (with unsafe-inline trade-off), nosniff, frame deny, referrer and permissions policy | done on UAT |
| Input handling | Zod validation, parameterized SQL, body limits, bounded XLSX and image parsing | done; no attacker-style testing yet |
| Dependencies | zod advisory fixed; remaining npm audit items are build or dev tooling | done; recheck regularly |
| Edge abuse control | Cloudflare binding limiter does not enforce; PostgreSQL limiter in progress | open |
| Database isolation | App-level only; one broad database role; no row-level security | open |
| Monitoring and alerts | Documented as planned, not implemented | open |
| Attack-style testing | None beyond our own and one AI reviewer | open |
| Incident response | None written | open |

## Phase 1: before any production cutover (blockers)

| # | Work | Owner | Done when |
|---|---|---|---|
| S1 | Exact rate limit on sign-in, invitations, import, upload (PostgreSQL counters) | Backend, then Deployment verifies on UAT | burst test returns real 429s; recorded in docs/UAT_DEPLOY.md |
| S2 | Attack-style authorization matrix: for every endpoint, call it as stranger, other-project member, same-project member without board grant, viewer, and revoked user, with guessed or foreign IDs; expect 401, 403 or 404 and no data. Auto-generated from the route list so new routes cannot be forgotten | Backend, reviewed by Support | test suite fails when a route is missing from the matrix; all negative cases pass |
| S3 | Least-privilege database access: separate roles for app runtime, migrations and read-only reporting; runtime role cannot drop or alter tables; decide on PostgreSQL row-level security as a second wall (see decision D2) | Backend + Deployment | roles exist on UAT; tests run as the runtime role; decision recorded |
| S4 | Alerts that reach a human: uptime probe on /health/ready, 5xx rate, cron silence, auth failure spikes, database errors; implement what docs/MONITORING.md only plans | Deployment | a deliberately broken UAT triggers an alert you actually receive |
| S5 | Flood plan and quota check: confirm the Workers and Pages request quotas, Neon connection and compute limits (unverified figures), and what happens when each is exhausted; write the runbook (what to turn off, what to block, who to tell) | Deployment | docs/RUNBOOK_INCIDENTS.md reviewed; numbers verified in dashboards |
| S6 | Secrets hygiene pass: list every secret, owner, rotation steps; rotate the ones that appeared in chat or terminal history; confirm no secret in git history, logs or build output | Deployment + Support | docs/DEPLOY_SECRETS.md has rotation steps; secret scan clean |
| S7 | Production safety checks from docs/RELEASE_BETA.md: backup branch with data, migration state check, rollback ids | Deployment | all evidence recorded before the go |
| S8 | Independent re-review of the changes since 6e15bd0 that touch security (limiter, CI, headers, zod 4) by a stronger reviewer | Architect arranges | review record passes the gate |

## Phase 2: first month in production

| # | Work | Owner |
|---|---|---|
| S9 | Real security headers review under load of CSP reports; move toward nonce-based CSP if we ever move off static export | UI + Deployment |
| S10 | Dependency and supply-chain routine: weekly `npm audit`, lockfile review, pinned CI actions by SHA (done), no unreviewed postinstall scripts, update policy | Support |
| S11 | Penetration-style test by someone who did not build it: authenticated and unauthenticated, including IDOR (guessing another record's ID), mass assignment, cache and CORS tricks, file upload and XLSX abuse, invitation token handling | Support with a stronger model; consider a human tester before public launch |
| S12 | Logging that supports investigation: request ids, actor id, action, outcome, never tokens or card text; retention period; who can read | Backend + Deployment |
| S13 | Account and data lifecycle: user deletion or export on request, session revocation ("sign out everywhere"), invitation expiry, revoked-member cleanup | Backend |
| S14 | Backup and restore drill: restore a Neon branch to a point in time and boot the app against it; write the time it takes | Deployment |
| S15 | Abuse controls beyond rate limits: invitation spam, comment spam, mention floods, upload quotas per project | Backend |

## Phase 3: ongoing

- Custom domain with Cloudflare zone rules, bot protection and managed WAF rules when the product needs a real URL (a paid plan is needed for the 60-second rules we want; see docs/RATE_LIMITING.md).
- Durable Objects or an edge limiter if traffic outgrows database counters.
- Annual (or per major feature) independent security review; keep the review gate.
- Tabletop incident exercise twice a year: "the site is flooded", "a secret leaked", "a user reports seeing another team's board".

## Threats specific to AI agents

1. **AI-assisted attackers**: they scan faster and try every combination of IDs and roles. Defence is S2 (exhaustive negative tests), S1 (exact limits), S3 (second wall in the database) and S4 (we notice).
2. **Prompt injection into our own tooling**: web pages, issue text, third-party skills and tool outputs can contain instructions aimed at an AI agent. Controls we already follow: only the user's chat gives instructions; no installing third-party skills without the audit in docs/SKILLS_AUDIT.md; no secrets in chat; read-only reviews; dangerous actions need the user's yes. Add: never give an agent production credentials; use a deploy account with scoped tokens.
3. **Product features that call an LLM** (none today). If we add AI summaries or assistants later: treat every card, comment and imported cell as untrusted input to the model, never let model output trigger actions without a user check, never put other users' data into one prompt, and log prompts without personal data.
4. **Malicious automation as a user**: signed-in bots hammering the API. Controls: S1, S15, per-user (not only per-address) limits.

## Decisions needed from the user

- D1: custom domain now, later, or never (changes edge options; no cost today).
- D2: row-level security in PostgreSQL (strong second wall, more complexity and test work) or least-privilege roles only (simpler). Architect recommends roles first, RLS after the pen test shows the need.
- D3: whether to pay for a human penetration test before public launch.
- D4: alert destination (email, phone push) for S4.

## How we will know it worked

Each item has an evidence line. We do not mark an item done on a design or a passing unit test alone: S1 needs a burst test, S2 needs the generated matrix passing, S4 needs a real alert received, S14 needs a timed restore. Results go in docs/UAT_DEPLOY.md or the review folders, and the gate in BACKEND_REVIEW_GATE.md still applies to backend changes.
