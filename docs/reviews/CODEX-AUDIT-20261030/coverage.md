# Coverage and evidence

Target: commit `371cc9f31dd605ddead4eda743c2d26e12c07fca`, branch `chore/baseline-2026-10-28`. Scope freeze was rechecked after tests: in-scope Git status is clean and all 291 tracked-file hashes still match `manifest.json`. No source file was changed.

`pass` means the bounded checks in that area passed; `fail` means at least one supported risk or spec gap was found; `not covered` means the requested check was not completed. A passing test is not evidence for a feature or runtime it did not exercise.

## A. Authorization and data isolation — **fail**

- Generated a route inventory from routers actually mounted in `apps/api/src/http/app.ts`: 93 method/path declarations, each paired with 10 identity cases (unauthenticated, stranger, other-project member, same-project member without board grant, Viewer, Member, Manager, Owner, revoked member, foreign/guessed ID). `python3 probes/route-matrix.py --check` passed: every mounted route is represented, and a new route fails the check until the matrix is updated. The matrix records all role cells as `not_executed`; this is a completeness guard, not the requested 930 live authorization calls.
- Full API/contract suites exercised the current PostgreSQL integration tests: 533 API tests and 54 contract tests passed, zero skipped. Existing board-access suites are included.
- Confirmed Viewer assignment despite the documented eligible-assignee roles: see FB-AUD-03 and `raw/viewer-assignee-repro.txt`.
- Not covered: every role against every route, all foreign-ID variants, and a live signed-in role matrix on UAT. Activity and project overview scope had positive/negative integration tests in the suite but not every endpoint/identity combination.

## B. Invitations and tokens — **fail**

- Full suites passed the invitation/auth tests; activity/overview response tests checked that token and invitee email do not leak in those response bodies.
- The invitation rate counter is keyed by client IP only, with no inviter or project counter; see FB-AUD-05 and its deterministic source-key probe.
- Not covered: signed-in UAT create/resend/revoke/accept, OAuth invitation-token history in a browser, expiry/reuse across two accounts, email-provider headers/CRLF behavior, and raw provider/log inspection using real callbacks. No owner credentials were used.

## C. Sessions, cookies, CSRF, CORS — **not covered**

- Source review covered session hashing/logout, cookie middleware, Origin checks, configured CORS origins, and safe-next handling. Local session/auth tests passed as part of the 533 API tests.
- Not covered: authenticated browser CSRF probes on UAT, the full cookie/Origin/Referer matrix on every write route, OAuth return-path edge cases against the deployed Pages origin, or credentialed CORS responses on all route classes.

## D. Pages Function proxy and edge — **not covered**

- Source review covered the Pages `/api/*` proxy, manual redirect handling, copied `Set-Cookie`, `Cache-Control: no-store`, and entry middleware. Ten unauthenticated UAT paths are recorded in `raw/uat-unauth-probes.tsv`; root and `/health/live` were redirected to sign-in, and API session/workspace/project reads returned 401.
- `/signin` and `/robots.txt` returned CSP, HSTS, frame, MIME, referrer and permissions headers. The sampled JSON API responses showed `Cache-Control: no-store`; this small sample is not a route-class header audit.
- Not covered: signed-in header forwarding/Set-Cookie behavior, spoofed forwarded identity headers end-to-end, every 404/redirect/API response class, and direct Worker-origin comparisons.

## E. Frontend — **not covered**

- Source grep found no application-authored `innerHTML`, `dangerouslySetInnerHTML`, `eval`, or `new Function` usage in the reviewed source; React renders the domain text. UI typecheck passed.
- Static output scan found 131 files, checked 59 HTML/JS files, zero `dev-login` string matches and zero `.map` files in `apps/web/out`. The checked-out export has no verified build provenance, so this is not a current-build guarantee. The Worker distribution contains a source map; deployment inclusion was not checked.
- Not covered: browser XSS attempts for real card/import values; full inventory and mutation testing of storage keys; current build artifact regeneration (would write in-scope output); and visual/keyboard/reduced-motion/contrast/touch WCAG checks for the new screens.

## F. Input parsers — **fail**

- Confirmed XLSX inflate limit is applied after decompression: small ZIP expands past 20 MiB before returning 413. See FB-AUD-02, `probes/xlsx-inflate-repro.mjs`, and `raw/xlsx-inflate-repro.txt`.
- Confirmed runtime image storage is the default process-local memory driver, with no Worker durable-storage binding/injection. See FB-AUD-01 and `raw/storage-isolate-repro.txt`.
- Confirmed the global 1 MiB body cap rejects larger upload bodies before route validation, despite 5 MiB XLSX and 10 MiB image limits in the product docs; see FB-AUD-08 and `raw/import-body-cap.txt`.
- The 533 API tests include image byte validation, spoofing rejection, authenticated delivery, quota, orphan cleanup and trash lifecycle, but use the in-process storage driver and do not establish durable Worker storage.
- Not covered: very large shared-string/row/time limits, real Worker memory/time behavior, actual R2 access control, private image fetch after isolate change, or a signed-in UAT upload/download.

## G. Database — **fail**

- Full suite passed on disposable PostgreSQL 17.11; migration/integrity tests ran, including empty-schema migrations and byte-match checks for embedded migrations. Database test environment: container image `postgres:17.11-alpine` pinned to digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, port 55257, database `flowboard_harness`; board-access suites used the separate `flowboard_access_test` database.
- Confirmed `project_links` accepts a mismatched workspace/project pair despite both single-column foreign keys; see FB-AUD-07 and `raw/project-links-fk-repro.txt`.
- The repository security roadmap identifies one broad role and no RLS; see FB-AUD-06. No real UAT runtime database role was queried.
- Not covered: migration from a populated 0010 snapshot through 0014, zero-downtime lock/rollback behavior, real runtime role grants, query-plan/`EXPLAIN ANALYZE` under thousands of cards, replication/sharding/partitioning, and comprehensive orphan checks after user/project/board deletion.

## H. Concurrency and idempotency — **not covered**

- Existing mounted PostgreSQL tests for parallel board writes, lock-order interleaving, idempotent replay, and outbox behavior passed as part of the suite; zero tests skipped after the two-database setup was corrected.
- Not covered: forced simultaneous project PATCH lock upgrades, invitation accept versus member removal, simultaneous invite acceptance by two accounts, double import commit, restore versus purge against worker overlap, or lock-order graph across all route families. Static leads from earlier reviewers were not promoted to findings without a reproduction.

## I. Abuse and availability — **fail**

- UAT probes were unauthenticated and bounded: 10 initial GET paths plus 11 GET requests to Google sign-in start (21 successful HTTP requests total). All 10 auth-start requests returned 302; request 11 returned 429. No redirects were followed and no OAuth credentials/cookies were recorded. See `raw/uat-rate-limit-burst.tsv`.
- Source confirms invitation limits are IP-keyed only (FB-AUD-05); general write rate limit is approximate, per-location and fail-open. Request body and deadline middleware are configured globally.
- Not covered: signed-in invite/import/upload/comment bursts, upload byte/rate behavior, database-unavailable limiter behavior on UAT, queue backpressure, cron overlap under deployed Workers, and route-specific pagination/query cost.

## J. Observability and privacy — **not covered**

- API/contract tests passed response/activity redaction checks for invitation tokens and emails in the tested paths. Request-id and generic health responses were inspected in source.
- The OAuth callback logs raw text from a failed provider token response (`apps/api/src/http/routes/google-auth.ts:156-159`); no provider failure was induced, and no evidence that the response contains a secret was established.
- Not covered: actual production/UAT logs, alert delivery, user/account erasure workflows, backup retention, all error paths for tokens/card text, and outbox privacy under all provider failures.

## K. Dependencies and supply chain — **fail**

- `npm audit --omit=dev --json`: exit 1, 2 production-tree advisories (1 moderate, 1 high). Full `npm audit --json`: exit 1, 5 total (3 moderate, 2 high). Installed tree confirmed with `npm ls` (exit 0). Details and sanitized raw JSON are under `raw/` and FB-AUD-04.
- Lockfile parsed: 323 package entries; three entries declare install scripts. Two workflow actions found and both are pinned to full commit SHAs. `.node-version` is 24.15.0, matching observed Node. A text search of the lockfile found no AGPL/Commons-Clause terms; lockfiles do not provide a complete licence inventory.
- `gitleaks` and `trufflehog` are unavailable. No full-history secret scan was run. This audit does not claim the repository or history is secret-free.
- Not covered: validated license metadata for all installed packages, CI execution on the target commit, and full working-tree/history secret scanning. `npm run build` was not run because its configured build writes generated files under the read-only in-scope `apps/` tree.

## L. Quality, accessibility and documentation drift — **fail**

- `npm run typecheck`: exit 0. `npm run typecheck --workspace @flowboard/web`: exit 0. `npm test` on the corrected disposable database setup: API 533/533 pass, contract 54/54 pass, zero skipped; aggregate exit 0. The first run used the wrong database name for board-access tests and failed; the setup was corrected and the clean full rerun passed.
- Confirmed documentation/code drift: API/spec list assignable roles as owner/manager/member, while the mounted assignment route accepts a Viewer (FB-AUD-03).
- The generated route inventory guards against omissions but does not claim that every actor case was executed.
- Not covered: lint, production/static build, accessibility WCAG review of new screens, complete status/field/activity action drift, and checking every feature checklist row against fresh handoffs.

## What was tried and did not work

- The first test invocation could not connect to localhost because sandbox networking denied access (`EPERM`); it did not reach PostgreSQL. The same authorized suite was rerun with local network permission.
- The first reachable suite used `flowboard_harness` for both database variables. Board-access tests intentionally reject that name; this run failed 15 tests and is not the accepted test result. A clean disposable container was recreated, a second database named `flowboard_access_test` was created, and the corrected complete run passed 533 API plus 54 contract tests.
- The first UAT curl loop could not resolve `curl` from the escalated shell PATH (10 command attempts exited 127 and sent no requests). It was retried using `/usr/bin/curl`; the resulting requests are the 21 recorded UAT requests.
- The first XLSX/storage probe invocation used an incorrect relative import path; it was corrected, then both probes completed with the results above. The initial route-matrix generator had a Python tuple-unpack typo; corrected generator and completeness check both passed.
- No authenticated UAT action, production access, deployment, source edit, push, or real credential use occurred.
