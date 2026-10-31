# Codex audit brief, round 4: own projects and roles, quotas, names, invitation email, UI (2026-10-31)

Audience: Codex, running as an independent auditor with a fresh session. Monitor: the Architect chat, which re-runs every critical and high claim and a random sample of "pass" claims before accepting anything. This brief extends `docs/CODEX_AUDIT_BRIEF.md` (rounds 1 to 3 rules and areas A to L still apply; re-read it first) and `docs/SECURITY_ROADMAP.md`. Do not grade work you wrote.

## 0. Ground rules (same as round 1, restated)

1. Read-only on `apps/`, `database/`, `packages/`, `scripts/`, `docs/` (except your own folder) and on every existing `docs/reviews/*` folder. Write only inside `docs/reviews/CODEX-AUDIT-20261031-D/`.
2. Never print, paste, store or commit a secret or connection string. No `git push`, no commits. No production Worker, Pages project, R2 bucket or Neon `production` branch: not even a read. No account creation, no real credentials, no use of any dev-login secret.
3. Local tests use a disposable Postgres on a free port (not 55432, 55479, 55492). Record port, image and exit code of every command. If a command cannot run, say so; never claim it passed.
4. Against deployed UAT (`https://flowboard-app-uat.pages.dev`, API Worker `flowboard-api-uat`) only unauthenticated requests and your own bounded, rate-limited probes. Anything that needs a signed-in Google session goes on `needs-owner.md` with exact steps (section 4).
5. **Freeze the target first.** The owner gives you a commit SHA when the code is frozen. If none is given, stop and ask; do not guess. Record `git rev-parse HEAD` (must equal the given SHA), `git status --short` (list anything untracked or modified outside your scope roots and say so; do not touch it), and a SHA-256 manifest of the scope roots (`apps/api/src`, `apps/web/src`, `apps/web/functions`, `packages/contracts/src`, `database/migrations`, `apps/api/wrangler.jsonc`, `apps/web/wrangler*.jsonc`). If an in-scope file changes while you work, stop and restart from the manifest step.
6. Every finding: `ID | severity | file:line | what is wrong | exact reproduction | suggested fix | confidence (confirmed or plausible)`. Severity: critical (cross-user or cross-project exposure, impersonation, privilege escalation, data loss), high (exploitable with a plausible account, or a corrupting concurrency fault, or a quota that can be bypassed), medium, low. Also list what you tried that did not work. Do not tune a score. Report "not covered" honestly.

## 1. What changed since the last audit (your scope)

Base: read the commit stamped in `docs/reviews/CODEX-AUDIT-20261030/manifest-pass2.json` (what you audited before) and audit everything after it: `git log <base>..<frozen SHA>` (also run `git diff --stat`). The unreviewed work, by task id (find each commit with `git log --grep`):

- **B-14** audit fixes (random R2 keys, filename refusal, outbox receipts and 30-day purge, migration 0017) and the **D-16 to D-20** deploys.
- **S-17** image alpha sample, animated WebP, focus return, inert background. **S-18** polling and the addendum (session, invitations, board access, boards, project). **S-19** invitation screens redesign. **S-20** board switcher and multi-board view; **S-21** merged multi-board view by column name, full-height columns, Updated pill. **S-22** (UI, in this round): name screen, Yours and Shared with you projects page, project switcher, landing, quota and error messages, Leave project.
- **Immediate invitation send fix** (the Worker now passes its `ExecutionContext` to Hono; reason-code logs) and the test-database preflight.
- **B-15** invitation email redesign (board card in an "In progress" column).
- **B-16** first and last name before accepting an invitation (migration 0018, `PATCH /api/v1/session/name`, `NAME_REQUIRED`).
- **B-17 to B-22** own projects and roles: `ensurePersonalWorkspace`, `POST /api/v1/projects`, quotas, creator board grant, workspace route changes, ownership transfer disabled, backfill migration 0019, member and invitation caps, invitation resend limits. Accepted decisions: `docs/handoffs/proposals/own-projects-decisions-2026-10-31.md`. Research (read-only, from code reading, not run): `own-projects-and-roles-cases-2026-10-31.md` and `own-projects-edge-cases-2026-10-31.md` (31 findings). **Treat the edge-case report as hypotheses to confirm or refute, not as facts.**

If any listed task has no commit at the frozen SHA, say so in `coverage.md`; do not audit what is absent.

## 2. Attack first (highest risk, in this order)

### A. Quotas and limits (new, blocker class if bypassable)
Rules to test against: at most **3 active owned projects per user** across every workspace the user owns (memberships never count; archived do not count); **5 active boards per project** whoever created them; **backstop 20 owned projects and 25 boards per project including archived**; 50 active members (Owner excluded); 50 pending invitations (unexpired); 5 project creates per minute and 30 per hour per user. Over-limit existing data is grandfathered. Overrides are `FB_LIMIT_*` environment values with invalid-value fallback.
- Bypass attempts: the old `POST /workspaces/:id/projects` route versus `POST /api/v1/projects`; board create; project reopen; board restore or reopen; ownership transfer target; import paths; any other writer of `projects` or `boards` (grep every INSERT and UPDATE of `archived_at`).
- Races with forced interleavings, not random timing: two parallel creates at the cap, two Managers creating the 5th board, create versus reopen, create versus archive, idempotent replay at the cap (must return the original, never `QUOTA_EXCEEDED`), double Google callback. Check advisory-lock order against the existing board-row then card-row order for deadlocks.
- Archive-and-recreate cycling against the backstop; env override edge values (0, negative, NaN, huge, empty string).
- `QUOTA_EXCEEDED` body (`error.details`: scope, limit, current?, remedy): `current` must appear only when the caller may already see it (a Manager must not learn hidden board counts or hidden board names). `GET /session` `limits` must not leak anything.

### B. Personal workspace, tenancy and the closed routes
- `ensurePersonalWorkspace` under concurrency (Google callback, invitation accept, first project create); exactly one personal workspace per user; deterministic primary workspace; the internal workspace name must not depend on the display name (100-character limit versus the 121-character display name).
- Migration 0019 backfill: idempotent (second run inserts 0 rows), no name collision, safe on a live database.
- `POST /api/v1/workspaces` closed; `GET /api/v1/workspaces` limited to owned; **`transfer-ownership` disabled** (try to call it directly, with an Idempotency-Key, as an owner, as a stranger). Any code, script or doc that still calls a removed route.
- Queries that assume a user has one workspace or filter on `workspace_id`; a user who owns project A and is only a Member of project B in someone else's workspace.

### C. Authorization (extend the generated route matrix; it must fail if a route is missing)
- Every new or changed route as: stranger, other-project member, same-project member without a board grant, Viewer, Member, Manager, Owner, revoked member, with foreign or guessed ids. Expect 401, 403 or 404 and no data. Mass assignment: extra fields on every POST and PATCH (`workspaceId` on `POST /projects` must be 422; role, owner, version, ids must never change).
- Roles: an invitee as Member or Viewer can create their own project (Owner there) but gets 403 creating a board in the shared project; a Manager gets 201. The Manager's creator grant covers **only** the board they created; grant administration stays Owner-only; a downgraded or removed Manager keeps or loses access exactly as documented. Leave project (including "cannot leave as the only Owner"), removal, role change, revoked and expired invitations, wrong-account accept, the same email invited to several projects.
- Information leaks: 404 versus 403 enumeration, activity feed and notifications between a user's own projects and shared projects, project and board names reachable without a grant, the invitation link or the project switcher revealing a project name before acceptance.

### D. Names (B-16)
- `NAME_REQUIRED` gate: try to accept an invitation without a saved name by replay, by changing the Idempotency-Key, by racing two tabs, by direct API calls; make sure nothing is written on refusal. `PATCH /session/name` validation: control characters, zero-width, bidi overrides, line and paragraph separators, 60 code points (not UTF-16 units), emoji, combining marks, whitespace collapse, strict body (unknown fields 422), CSRF and Origin, rate limit, idempotency.
- Where the display name flows: activity rows, mentions, assignee lists, notifications and the **invitation email subject and HTML**. Look for injection (HTML, CRLF, RTL spoofing) and for a name that breaks `GET /session` or any list.
- Existing users are prompted once, not on every sign-in.

### E. Invitation email and delivery (B-15 and fixes)
- HTML escaping of project name, inviter name and recipient email; CRLF and header injection; very long and hostile names; the token appears only in the accept link; the card key `INV-XXXX` is derived from the invitation id and **never** from the token or its hash; initials logic with odd emails; plain-text part mirrors the HTML.
- WCAG AA contrast of every text and fill pair in **both** light and dark palettes (verify the tests really cover both). Email-safety of the HTML (tables, inline styles, `bgcolor` fallbacks, no JS, no gradient text, images with alt and explicit size); dark-mode `@media` block and meta tags; behaviour at 320px width.
- Immediate send (`sendInvitationEmailSoon`): confirm with a forced test that the route runs it through `waitUntil` and that logs carry reason codes only (no token, address, name or provider body). Resend: per-inviter and per-project rate limits apply; an expired invitation cannot be revived beyond the documented rule; the 50 active-plus-pending cap holds. At-least-once delivery is documented; duplicate sends within a documented window are accepted.

### F. Frontend (S-17 to S-22)
- XSS and spoofing through project, board and column names, card titles, board chips, the switcher, the Boards dropdown and `?boards=` (parsing, stale ids, URL length, 6-board cap). Grep `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`.
- Open redirect and return-path handling on the name screen and the sign-in flow (try `//evil.test`, `/\evil.test`, encoded variants, `javascript:`); the invitation token in the URL, browser history and Referer after accept.
- Merged board view: cards stay bound to their own board on drag and move; a drop onto a column the card's board lacks is refused with a hint, not a silent failure; one failing board does not blank the others; polling load with six boards (request count and backoff); drafts not clobbered; STALE_BOARD_VERSION handled per board.
- Storage: every `localStorage` and `sessionStorage` key (the Boards selection, last location, easter-egg state): no tokens, emails or card text; sign-out clears them.
- Accessibility (WCAG 2.1 AA): the name screen, projects page, switcher, Boards dropdown, quota messages, invitation screens, Leave project dialog. Keyboard path, focus return, `prefers-reduced-motion` (all animation and easter eggs off), contrast in both themes, touch targets, phone width.
- Dev-login must be absent from the built output (`apps/web/out`) and from the production-style build.

### G. Database
Run migrations 0001 to the latest from empty, and from a 0010-state database with sample data: destructive statements, lock-heavy changes, idempotency, ordering (0018 names, 0019 backfill). Connection role privileges (the runtime role is still `neondb_owner`: a known beta gap, report it once, do not repeat it). `EXPLAIN` the session, projects list (`accessibleProjects`, unbounded?) and quota count queries; look for N+1 and missing indexes. Orphans after member removal, project archive, user deletion.

### H. Config and deploy hygiene (read the files; do not query production)
`apps/api/wrangler.jsonc` top level (production) versus `env.uat`: vars, R2 binding (private bucket, no public access), cron schedules, rate-limit namespaces, no `DEV_LOGIN_ENABLED` or `NODE_ENV`. `docs/UAT_DEPLOY.md` addenda D-16 to D-20 and the production log: do the recorded ids and counts match what you can verify from the repo and from UAT unauthenticated requests?

### I. Dependencies and secrets
`npm audit` (production and dev separately), lockfile integrity, new dependencies in the range, licences. Run gitleaks or trufflehog over the working tree **and** the range's history; known false positives are `Idempotency-Key` test headers and manifest hashes. A neon connection string was once printed into an Architect session's tool output (not in the repo); confirm none is in the repo or history.

### J. Tests and docs drift
Typecheck, lint, API, contracts and web suites with real counts; which tests skip and why (16 access-suite tests need a disposable database; confirm whether they run in CI). Tests that mock what they claim to test. `docs/API.md`, `packages/contracts`, the route list and `docs/FEATURE_SPEC.md` / `FEATURE_CHECKLIST.md` must agree; the checklist must not claim verification that did not happen.

## 3. Deliverables (in `docs/reviews/CODEX-AUDIT-20261031-D/`)

`manifest.json` (SHA, hashes, tool versions, command log with exit codes), `findings.md` (format above, sorted by severity, with reproductions), `coverage.md` (sections A to J with verdict pass, fail or not covered, evidence, and what you could not test), `needs-owner.md`, `summary.md` (one page, plain English: top five risks, what blocks production, what can wait), raw logs and probe scripts, and a `route-authorization-matrix-round4.json` with the executed results (do **not** overwrite older matrix files).

## 4. UAT end-to-end: split of work

**You (unauthenticated or local):** everything in section 2 that runs locally against a disposable Postgres or against UAT without a session: API probes, header and CSP checks on every route class, `/health/ready`, 401 and `no-store` behaviour, the email fixtures rendered locally for all roles with hostile names, contrast tests, migrations, forced-interleaving quota tests, the web unit tests and a static build.

**Owner (signed-in, two real Google accounts) — list each step with expected result in `needs-owner.md`, and make it a numbered checklist the owner can run on a phone:**
1. Invite a second account as Member; open the email (inbox or spam, light and dark mode, phone and desktop); confirm it arrives within seconds.
2. Sign in with the second account: the name screen appears once, prefilled; save; land back on the accept screen; accept; see the shared project; no boards without a grant.
3. As that Member/Viewer: create your own project (you are Owner there); create 3 projects; the 4th shows the calm quota message with the archive remedy and no dead end; archive one, then create again.
4. As a Manager in someone else's project: create boards up to 5 in total; the 6th is refused; the Manager can open the board they created and no others.
5. Leave a project; try to leave as the only Owner.
6. Two browsers: live refresh (about 15 seconds), conflict handling, merged multi-board view (tick several boards that share column names, one with an extra column, drag between columns, drop refused hint).
7. Wrong-account link, expired and revoked invitation, resent invitation.
8. Keyboard-only and reduced-motion pass on the new screens.

## 5. How the Architect monitors

Checks the manifest SHA against the owner-given SHA; re-runs every critical and high finding and at least two "pass" claims chosen at random; re-counts tests; rejects any claim without a command, an exit code or a reproduction; routes confirmed findings to Backend, UI or Deployment with severity and a fix target; records dispositions in `docs/SECURITY_ROADMAP.md`. Backend closure still needs `BACKEND_REVIEW_GATE.md` (fresh reviewer, score strictly above 8.5, no blockers).
