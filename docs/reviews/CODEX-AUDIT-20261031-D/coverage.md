# Coverage

Frozen source: `99ae250d1c1f6fddf7747bd5676a7234abf72a11`; detached worktree. Counts below describe commands actually run, not the full product surface. The Round 1 handover (`docs/GEMINI_REVIEW_HANDOVER.md`) and `RULES.md` were consulted from this exact commit after source/test probing, rather than before as their read order asks. This sequencing deviation is recorded; the findings and test evidence are still tied to the frozen commit.

## A. Quotas and limits — fail

- Read the quota adapters and exercised the existing B-14/B-16/B-17/B-18 focused tests on disposable PostgreSQL: 61/61 passed. The project-create route paths both call the shared active/total quota checks; board create and reopen use a project advisory lock. The limits parser falls back on invalid values.
- Generated the route set from `apps/api/src/http/app.ts` and `apps/api/src/http/routes/*.ts`. It found 95 route declarations, matching all 93 routes in the previous matrix plus `PATCH /api/v1/session/name` and `POST /api/v1/projects`. Executed 950 cells (10 identities per route); results are in `route-authorization-matrix-round4.json`. Statuses: 147×200, 10×204, 20×302, 362×400, 85×401, 35×403, 228×404, 63×422. The 117 non-auth-status cells with data and 485 non-auth-status cells without data are retained in the matrix. Successful reads for project members without board grants are scoped project-level reads; the test did not inspect every response field for information leakage.
- **Fail:** the explicitly disabled ownership-transfer route still succeeds for an Owner, does not acquire user quota locks, and does not check the target's owned-project quota. See FB-R4-01 and `raw/acc-lifecycle.log`.
- Not covered: forced parallel create-at-cap, create versus reopen/archive, idempotent replay at cap, double Google callback, override edge values against every route, or exhaustive target-at-cap transfer reproduction.

## B. Personal workspace, tenancy and closed routes — fail

- `ensurePersonalWorkspace` uses a user advisory lock and a stable internal name; the focused tests passed. `POST /api/v1/workspaces` is still mounted and returned validation responses in the matrix; the old project-create route remains quota-checked.
- **Fail:** `POST /api/v1/workspaces/:workspaceId/transfer-ownership` is not disabled and can assign an arbitrary existing account as Owner. It also bypasses the new target user's quota. The task instructions and the integration test disagree about intended behavior; Round 4's explicit disabled requirement governs this audit.
- Not covered: migration 0019 rerun against representative legacy data, multi-workspace user query assumptions, user-at-cap transfer interleaving.

## C. Authorization — fail

- The generated source route matrix executed all 950 route/identity cells with synthetic users and foreign/guessed IDs. No route was absent from the generated set. Matrix JSON includes every response and the non-401/403/404 classifications.
- **Fail:** ownership transfer changes a whole workspace's owner for a target not in that workspace and without target consent; see FB-R4-01.
- Matrix limitations: all routes received generic `{}` bodies (or an invalid token for invitation accept), not valid per-route attack payloads; a 200 does not automatically mean a leak. OAuth start was run with a synthetic client ID and returned redirects. This is not a complete authorization proof or signed-in browser test.
- Not covered: full mass-assignment fuzz across every POST/PATCH, invitation wrong-account/revocation/expiry flows, route-by-route response-field classification, or permission transitions after role changes.

## D. Names — not covered

- Static review found the fixed internal personal-workspace name helper and code-point name validators. Focused B-16 tests passed within the 61-test set.
- Not covered: complete direct-route gate/replay/race tests, hostile names through every activity/notification/email surface, or deployment data counts.

## E. Invitation email and delivery — not covered

- Focused local tests included invitation email, immediate send, and outbox behavior; the relevant focused suite passed 61/61. UAT probes did not invoke an invitation or use credentials.
- Not covered: hostile HTML/CRLF fixtures end-to-end, all light/dark contrast pairs, 320px client rendering, at-least-once duplicate delivery, actual mail arrival, resend limits across accounts, or provider-side log/privacy verification.

## F. Frontend — fail

- `npm run typecheck` passed. Web tests passed 145/145. Source search found only static `dangerouslySetInnerHTML` uses for bootstrap scripts and fixed SVG symbols; no `eval` or `new Function` result was observed in the source search.
- **Fail:** a shared project can be labeled with the current user's unrelated owned workspace name by the fallback in `apps/web/src/lib/active-project.ts`; see FB-R4-03.
- Not covered: hostile content/XSS runtime tests, name-screen/open-redirect browser matrix, storage key inventory/sign-out clearing, six-board polling and drag flows, keyboard/focus/reduced-motion/contrast/touch/phone checks, built-output dev-login/source-map scan, or a static production-style build. The build was not run because it would write generated artifacts under the read-only `apps/web` tree.

## G. Database — not covered

- PostgreSQL 17.11 disposable container on localhost port 55801; focused tests exercised migrations used by their cases. No production database was accessed.
- Not covered: complete migration chain from empty and a seeded 0010 state through 0019, migration lock/downtime analysis, least-privilege role verification, query plans/EXPLAIN, and representative orphan scans. The broad `neondb_owner` runtime role remains a documented known beta gap, not rechecked on any remote database.

## H. Config and deploy hygiene — fail

- Sanitized structural review of API and Pages Wrangler configs found R2 binding `IMAGES`, one cron schedule at each Worker environment, and no `DEV_LOGIN_ENABLED` or `NODE_ENV` vars. Anonymous UAT requests to the documented UAT Worker returned `/health/ready` 200, `/api/v1/session` 401, and `/api/v1/projects` 401; all carried `Cache-Control: no-store`. Pages `/` returned 200 with CSP, nosniff, referrer policy and frame denial. Four successful anonymous UAT responses were received across the app and API; three earlier requests to an incorrectly guessed Worker hostname failed DNS and did not reach the service.
- **Fail / deployment evidence limit:** the deploy log says the latest Pages deployment is from `4accf6a` (S-21), while the audited source includes later B-16 to B-22 changes. The anonymous probe cannot attest that UAT serves the frozen SHA. Production sections in deploy docs were read as repository evidence only; no production API, account, Worker, Pages, R2, or database was queried.
- Not covered: signed-in UAT behaviors, UAT commit identity from a live build artifact, deployed R2 access controls, Cloudflare secret values, or production claims.

## I. Dependencies and secrets — fail

- `npm ci --ignore-scripts` succeeded. `npm audit --omit=dev --json` exited 1 with two production-tree advisories (one high, one moderate). `npm audit --json` exited 1 with five (two high, three moderate). See FB-R4-02 and raw JSON reports.
- Gitleaks 8.30.1 scanned the frozen worktree and all available Git history: 249 detections in each pass, all `generic-api-key`; reports use 100% redaction. The findings were not individually triaged, so this audit cannot claim a clean secret scan. No detected value was printed in the report or final response.
- Not covered: license compatibility review, CI action pinning review, or a complete manual triage of the redacted detections.

## J. Tests and docs drift — not covered

- `npm run typecheck`: exit 0. Web suite: 145/145, zero skipped. Contracts suite: 108/108, zero skipped. Focused API B-14/B-16/B-17/B-18 and immediate-send suite: 61/61, zero skipped. Account lifecycle integration: 7/7, zero skipped.
- Full `npm test` was attempted after installing dependencies but was interrupted before completion (exit 130); no complete API suite count is claimed. An earlier attempt before dependency installation exited 1 because `pg` was missing. The focused API and lifecycle tests are the only passing API counts reported.
- Not covered: lint command (no lint script was run), complete API suite, all docs/contracts/route parity, feature checklist evidence, and full WCAG audit.
