# Codex audit brief: security, quality and readiness scan (2026-10-30)

Audience: Codex, running as an independent auditor. Monitor: the Architect chat, which re-runs a sample of every high or critical claim before accepting it. This brief extends `docs/GEMINI_REVIEW_HANDOVER.md` (scope A claims and scope B items 1 to 13, still valid) and `docs/SECURITY_ROADMAP.md` (S1 to S15). Read both first. Everything added since that handover (migrations 0011 to 0014, B-1 to B-6, S-6 to S-13) has had **no independent review**.

## 0. Ground rules

1. Read-only on `apps/`, `database/`, `packages/`, `scripts/`, existing `docs/reviews/*`. Write only inside `docs/reviews/CODEX-AUDIT-20261030/`.
2. Fresh session. Do not grade work you wrote.
3. Never print, paste or commit a secret. No `git push`. No production Worker, Pages project or Neon branch. No account creation, no real credentials.
4. Local tests use a disposable Postgres on a free port (not 55432 or 55479). Record port, image and exit code for every command. If a command cannot run, say so; do not claim it passed.
5. Against deployed UAT (`https://flowboard-app-uat.pages.dev`) only unauthenticated requests and your own rate-limited probes. Anything needing a signed-in browser goes on a "needs the owner" list with exact steps.
6. Freeze the target first: `git status` clean, record `git rev-parse HEAD` and a SHA-256 manifest of scope roots. If in-scope files change, restart.
7. Every finding: `ID | severity | file:line | what is wrong | exact reproduction | suggested fix | confidence (confirmed or plausible)`. Also list what you tried that did not work. Severity: critical (cross-user or cross-project exposure, impersonation, privilege escalation, data loss), high (exploitable with a plausible account, or corrupting concurrency fault), medium, low.
8. Do not tune a score. Report "not covered" honestly.

## 1. Audit areas (run in this order)

### A. Authorization and data isolation (highest risk)
- Build the generated matrix from the route list (`apps/api/src/http/routes/`): every endpoint called as stranger, other-project member, same-project member without a board grant, Viewer, Member, Manager, Owner, revoked member, and with foreign or guessed ids. Expect 401, 403 or 404 and no data. The matrix test must fail when a route is missing from it (S2).
- New since the last review, check specifically: `PATCH /projects/:pid` (`defaultBoardId`, `brief`, `links`; Manager sending `defaultBoardId` must get 403 for the whole request; foreign or archived board ids), board PATCH (Owner only), `GET /projects/:pid/overview` (no board name, id, card title or count leaks for a no-grant member; archived boards excluded), activity feed visibility (project-scope rows for Owner and Manager only; board-scope rows only with a grant), invitation create, resend, revoke, accept (token handling, cross-project, wrong account, reuse, expiry).
- Mass assignment: send extra fields on every PATCH and POST; none may change role, owner, version or ids.
- IDOR on cards, comments, images, imports, trash, notifications.

### B. Invitations and tokens
- Raw token returned by create is a known accepted gap (P0-5). Check it is shown once, never stored raw (hash only), never in activity rows, logs, outbox rows or error messages, and that accept removes it from browser history (read `apps/web/src` accept screen).
- Token entropy, comparison method (constant time), expiry, single use, revoked and resent invitations invalidating the old token.
- Email normalisation (trim, lowercase, max 254) and abuse: invitation spam per project and per inviter (needs S1/S15).
- Header or CRLF injection in the email field and in names that will later enter an email.

### C. Sessions, cookies, CSRF, CORS
- Cookie attributes, hashing at rest, logout and revoke, session fixation, Origin and Referer checks on every cookie-authenticated write, no wildcard credentialed CORS, `next` return path cannot be an open redirect (try `//evil.test`, `/\evil.test`, encoded variants, `javascript:`).

### D. Pages Function proxy and edge
- Headers forwarded and stripped, `Set-Cookie` passthrough, client-supplied `X-Forwarded-*` or identity headers, `/api/*` never cached, legacy redirects not open, security headers and CSP on every route class (HTML, API, static, 404).

### E. Frontend
- XSS: card titles, descriptions, comments, board and project names, brief and links (https-only enforcement on render, `rel="noopener noreferrer"`), activity text, imported XLSX cells, column names and colours. Grep for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`.
- Storage: list every `localStorage`, `sessionStorage` and cookie key; confirm no token, email or card text; sign-out clears legacy keys.
- Dev-login absent from the built output (`apps/web/out`), not only from source.
- Source maps and secrets in the build output.

### F. Input parsers
- XLSX: zip bomb, row and column caps, shared-string abuse, formulas on later export, time and memory limits in a Worker.
- Images: sniffed versus declared type, SVG handling, size limit, filename handling, private access when requested directly, cleanup after a failed upload.

### G. Database
- Run all migrations 0001 to 0014 from empty and from a 0010-state database with data; check destructive statements, lock-heavy changes, idempotency, rollback story.
- Connection role privileges: can the runtime role drop, alter or truncate? (Expected today: yes, one broad role. Report as a finding for S3.)
- Constraints and indexes for the new tables and columns (`default_board_id` composite FK, `project_links`, activity). `EXPLAIN` the overview query, activity feed, board load with several thousand cards. Look for N+1.
- Orphan data after member removal, board hard delete, project delete, user deletion.

### H. Concurrency and idempotency
- Lock order (board row then card row), double import commit, invitation accept races (two tabs, two accounts), expectedVersion conflicts on project and column edits, idempotent replay not duplicating activity rows. Prefer forced interleavings over random ones.

### I. Abuse and availability
- Confirm the current state of rate limiting on sign-in, invitations, import, upload, comments (the Cloudflare binding limiter does not enforce). Run a bounded burst on UAT unauthenticated endpoints only and record statuses. State the minimum rule for beta.
- Request body limits, pagination caps, regex or query cost, cron overlap safety (trash purge).

### J. Observability and privacy
- What is logged on errors (tokens, emails, card text); `/health/ready` leakage; request ids; whether account or data deletion is possible on request; outbox rows hold no raw token or sensitive body.

### K. Dependencies and supply chain
- `npm audit` (production and dev separately), lockfile integrity, postinstall scripts, licences (no AGPL or Commons Clause in `apps/web` or `apps/api`), pinned CI actions, Node version in CI.
- Real secret scan of the working tree and full git history (gitleaks or trufflehog). Only a manual scan has been done so far.

### L. Quality, accessibility and docs drift
- Typecheck, lint, API and contracts suites with real counts; the 13 gated tests: why skipped and whether they skip in CI.
- Tests that mock what they claim to test; routes without tests.
- Accessibility (WCAG 2.1 AA) of the new screens: left rail (arrow keys, collapsed mode, focus), column editor, invite dialog, overview, role badge, board toolbar menu. Keyboard path, focus return, reduced motion honoured, contrast in both themes, touch targets.
- Drift: `docs/API.md`, contracts and actual routes (status codes, fields, activity actions table); `docs/FEATURE_CHECKLIST.md` must not claim backend verification that did not happen.

## 2. Deliverables (in `docs/reviews/CODEX-AUDIT-20261030/`)

- `manifest.json`: commit, file hashes, tool versions, command log with exit codes.
- `findings.md`: all findings in the format above, sorted by severity, with reproductions.
- `coverage.md`: one section per area A to L with verdict (pass, fail, not covered), evidence, and what you could not test.
- `needs-owner.md`: signed-in steps you could not do.
- `summary.md`: one page in plain English: top five risks, what blocks production, what can wait.
- Raw logs and probe scripts.

## 3. How the Architect monitors

1. Checks the manifest and commit match the pushed head.
2. Re-runs a sample: every critical and high finding, plus at least two "pass" claims chosen at random, and re-counts tests.
3. Rejects any claim without a command, an exit code or a reproduction.
4. Routes confirmed findings to Backend, UI or Deployment with severity and a fix target, and records dispositions in `docs/SECURITY_ROADMAP.md`.
5. Anything that touches backend closure still needs `BACKEND_REVIEW_GATE.md` (fresh reviewer, score strictly above 8.5).
