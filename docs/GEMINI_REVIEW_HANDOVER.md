# Independent review handover for Gemini (2026-10-29)

You are the **independent reviewer**. You did not write the code under review, so you may judge it. Your job is to try to **disprove** the claims below, not to confirm them. A pass must be earned with evidence; a fail with a clear reason is a good result.

Repo: `/Users/shubham/Documents/Flowboard`, branch `chore/baseline-2026-10-28`, review target commit **`6e15bd0`** (nothing is pushed). Stack: Hono API on a Cloudflare Worker (`apps/api`), Next.js 15 static export on Cloudflare Pages (`apps/web`, plus `apps/web/functions` Pages Functions), PostgreSQL on Neon through Hyperdrive (`database/migrations` 0001 to 0010), shared Zod contracts (`packages/contracts`).

Read first, in this order: `BACKEND_REVIEW_GATE.md` (the rubric and vetoes), `RULES.md`, `docs/FEATURE_SPEC.md`, `docs/API.md`, `docs/decisions/2026-10-28-beta-risk-acceptance.md`, `docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/` (the last failed review: criteria, findings, probes you can reuse), `docs/GEMINI_HANDOFF.md`.

## 0. Rules for this review

1. **Read-only on source.** Do not edit anything under `apps/`, `database/`, `packages/`, `scripts/`, or any existing folder in `docs/reviews/`. Write only your own new folder (section 5).
2. **Fresh session.** Do not run this in the session that wrote H12 (CI workflow, `docs/MONITORING.md`, `wrangler.jsonc` change). You must not grade your own work: for those three files, say "reviewed by author, not independent" and list them as a coverage gap.
3. **Never** print, paste or commit secrets. No `git push`. No production Neon branch, no production Worker, no deployed UAT writes with real accounts. Reading the public UAT sign-in page and unauthenticated endpoints is fine.
4. Tests run only on a **disposable Postgres on a free port** (not 55432 or 55479, which are in use). Record the port, the image and the exit code of every command. If your environment cannot run a command, say so; do not claim it passed. `review_unavailable` is an honest outcome.
5. Freeze the target first: `git status` must be clean, record `git rev-parse HEAD` and a SHA-256 manifest of the scope roots (the R3 criteria file shows the format and `scripts/check_backend_review.py` shows what it validates). If any in-scope file changes during your review, stop and restart.
6. Do not tune the score to land above 8.5. Exactly 8.5 fails. Minimums per category are in the gate.
7. For each high or critical finding, give the exact attack path or failing input so a second person can reproduce it, and say what you tried that did **not** work.

## 1. What is claimed (scope A, the formal scored review)

Feature ids as in `docs/features.tsv`; the six board-access features, the three lock-order and import fixes, and the later additive work. Treat each claim as "unproven until you break or confirm it".

| # | Claim | Where to look |
|---|---|---|
| A1 | Non-Owners need project membership **and** a separate board grant; no automatic grants; only the Owner administers board grants; Managers may create boards | `apps/api/src/http/routes/board-grants.ts`, `boards.ts`, `projects.ts`, `members.ts`, adapters, `docs/handoffs/proposals/board-access-decisions-2026-10-27.md` |
| A2 | Revoking a member or grant takes effect on the next request, including cards, comments, images, activity, trash, notifications, imports | all routes under `apps/api/src/http/routes/` |
| A3 | Lock order is board row, then card row (R3-01, R3-02 deadlock fixes, commits `e548d0c`, `53f1d1f`) and double import commit is impossible (`36276eb`) | `adapters/cards.ts`, `comments.ts`, `imports.ts`, test files for these |
| A4 | Idempotency receipts are atomic with the write; optimistic version conflicts return the documented status | `adapters/` receipts code, migration 0004 |
| A5 | Session token is stored only as a SHA-256 hash; cookie holds the raw token; logout/revoke works with either | `adapters/session.ts` (commit `dc55063`) |
| A6 | Google sign-in keeps a user-edited display name and only updates the avatar when non-empty | `routes/google-auth.ts` (commit `8318792`) |
| A7 | Origin/Referer check on every cookie-authenticated state-changing request; credentialed CORS without wildcard `pages.dev` or `workers.dev`; localhost trusted only as documented (R3-12) | middleware under `apps/api/src/http`, runtime entry points |
| A8 | `/api/v1/system/*` needs a 32+ char secret and is locked otherwise; `GET /boards/:id/access` returns 503 without `CURSOR_SECRET` | `routes/system.ts`, board access route |
| A9 | 24-hour card trash: exact restore cutoff, purge cannot race restore, retryable storage cleanup | `adapters/trash.ts`, migration 0006, cron entry |
| A10 | XLSX import: preview then atomic commit; invalid workbook rejected with no partial write | `routes/imports.ts`, `docs/IMPORT_SPEC.md` |
| A11 | Private images: only users who can read the card can fetch the image | `routes/images.ts`, migration 0005 |
| A12 | New optional fields (card key, excerpt, overdue/due-soon counters, createdBy, column tone, trash/my-tasks keys, activity card links) never leak anything the caller could not already read | commits `e08079b`, `7a8f295`, `b9a7b6b`, `0ce963b`; tests `parity-fields-privacy.test.ts`, `card-key-counts-creator.test.ts` |
| A13 | Migrations 0009 and 0010 are additive, idempotent, backfill correctly, and are safe against data that already exists | `database/migrations/0009_*.sql`, `0010_*.sql`, `migration-0009-backfill.test.ts`, `adapters/embedded-migrations.ts` |

### Known and accepted findings (do not re-report as new; do tell us if any is worse than described)

R3-07 `CURSOR_SECRET` per environment; R3-08 and R3-14 ID existence hints; R3-09 one in-flight read after revocation; R3-12 localhost trusted; R3-04 interleaving test is randomized rather than forced. Fixed since: R3-10 (session hashing), R3-11 (display name guard), R3-13 (local DB string removed). These acceptances are a **user risk decision**, not a gate pass (`docs/decisions/2026-10-28-beta-risk-acceptance.md`).

### How to run

```bash
npm ci
npm run typecheck && npm run typecheck:web
# start a disposable Postgres on a free port, then run the API tests against it
npm test --workspace @flowboard/api
npm test --workspace @flowboard/contracts
python3 scripts/render_feature_checklist.py   # read only; do not commit its output
```

Report real counts. Expect hundreds of tests, with 13 gated tests that may skip (see `docs/TEST_INVENTORY.md`; CI database name may differ from the test safety fence, so check whether they skip in CI too).

## 2. Additional audits (scope B, not yet done by anyone independent)

Scored review above only covers the backend gate. These areas have **no independent review at all**. Report each as pass, fail or not covered, with evidence. Ordered by risk.

1. **Pages Function proxy** (`apps/web/functions/api/*`, `boards`, `projects`). Same-origin proxy to the Worker over a service binding. Check: which headers are forwarded and stripped, whether `Set-Cookie` passes through intact, whether a client can inject `X-Forwarded-*` or identity headers the Worker trusts, any open redirect in the legacy `/projects/:id` and `/boards/:id` redirects, whether `/api/*` responses can be cached by the edge.
2. **Frontend security** (`apps/web/src`). XSS via card titles, descriptions, comments and imported XLSX text; any `dangerouslySetInnerHTML`; invitation token read from the URL (is it removed from history, kept only in memory, ever sent to a third party or logged); `sessionStorage`/`localStorage` use (board caching was removed; confirm none remains and that sign-out clears legacy keys); dev-login is compiled out of production builds (`NODE_ENV !== 'production'` gate, verify in the built output, not just the source); security headers and CSP for the Pages site (`_headers` file or lack of one).
3. **XLSX parser safety.** Zip bomb or oversized sheet, huge row counts, formula injection (`=cmd|...`) on later export, malformed shared strings, size and time limits, memory use inside a Worker.
4. **Image upload path.** Content-type sniffing versus declared type, size limit, filename handling, how private access is enforced when the image is requested directly, cleanup after failed upload (migration 0006).
5. **Migrations 0001 to 0010 against a production-like state.** Look for destructive statements, lock-heavy changes, reliance on empty tables. Production still runs an old build and its migration state is unknown; say what a safe production migration needs.
6. **Rate limiting and abuse.** Is there any limit on sign-in, invitation creation, import, image upload, comment spam? If none, say what Cloudflare-side rule would be the minimum for beta.
7. **Performance and query counts.** Board load with a few thousand cards, per-column paging (P-011 is not yet built), N+1 patterns in the new counters and activity feed, indexes for the new queries (`EXPLAIN` on the disposable DB).
8. **Cron and background work.** Trash purge job every 5 minutes: idempotent, safe under overlap, bounded batch, failure behavior, logs without personal data.
9. **Accessibility** of the new UI: keyboard-only path through board, move dialog, drawer, Manage members, Board access; focus return; reduced motion honoured by Motion animations; colour contrast in both themes; touch targets. Use the `design:accessibility-review` approach (WCAG 2.1 AA).
10. **Dependencies and supply chain.** `npm audit`, lockfile pinned, licences (the skills audit already flagged AGPL and Commons Clause repos; confirm none is a dependency of `apps/web` or `apps/api`), anything postinstall-running.
11. **Docs versus reality drift.** `docs/API.md`, the contracts package and actual routes: list any endpoint, status code or field that differs. `docs/FEATURE_CHECKLIST.md` currently shows 0 backend features verified, which is correct; confirm nothing claims otherwise.
12. **Observability and privacy.** What is logged on errors (tokens, emails, card text), whether `/health/ready` leaks versions or secrets, and whether account or data deletion is possible if a user asks.
13. **Test quality.** The 13 skipped tests, tests that mock what they claim to test, tests that call helpers not wired to routes, and whether the 3 deadlock fixes have a **forced** (not random) interleaving test. If not, write the probe in your own review folder and report the result.

## 3. What is deliberately out of scope

Visual fidelity to the prototype (tracked in `docs/UI_PARITY_REPORT.md`), the production deployment itself (`docs/RELEASE_BETA.md` is not executed), and the unfinished screens (share dialog, column editor, archive/reopen, invitation preview).

## 4. What we cannot give you from here

Signed-in testing on deployed UAT needs the owner's browser session. If you need it, list the exact steps and screens and we will run them with the owner. Do not attempt to create accounts or enter credentials anywhere.

## 5. Deliverable

Create **`docs/reviews/BOARD-ACCESS-BETA-REREVIEW-20261029/`** and put in it:

- `criteria.json` frozen before you start (copy the R3 criteria and extend with A5, A6, A12, A13; do not weaken any).
- `<manifest-sha256>-round-1.json`, following `docs/reviews/record.template.json`, with the six weighted categories, `findings`, `hardBlockers`, `coverageGaps`, `reviewer` identity (model name and session), `implementer`, and `verdict` (`pass`, `fail`, `incomplete` or `review_unavailable`).
- Raw logs of every command you ran (with exit codes) and any probe scripts.
- `scope-b-report.md`: one section per audit item 1 to 13, each with verdict, evidence and severity.
- `summary.md` (one page, plain English): verdict, score, top five risks, what must be fixed before production, what can wait.

Then run `python3 scripts/check_backend_review.py <your record.json> --feature <ID>` for each feature and attach the output. Do not run the checklist generator over the repo.

### Finding format

`ID | severity (critical, high, medium, low) | file:line | what is wrong | how to reproduce or attack | suggested fix | confidence (confirmed, plausible)`

Severity guide: **critical** cross-project or cross-user data exposure, impersonation, privilege escalation, data loss; **high** exploitable with a plausible account, or a concurrency fault that corrupts or hangs; **medium** limited impact or needs unusual conditions; **low** hardening. Anything critical or confirmed-high is a hard blocker under the gate.

## 6. Hand-back

When done, append one row to the Pending table in `docs/GEMINI_LOG.md` (date, handoff `REVIEW-1`, target commit, files created, test counts, risks) and report to the Architect chat. The Architect then checks every high or critical claim independently before accepting it.
