# Coverage and evidence — independent pass 2

**Frozen target:** branch `chore/baseline-2026-10-28`, commit `36dfb3a4172ca5cc910c6c6503b4efd641031e35`.

The exact target was extracted from Git to `/private/tmp/flowboard-pass2-36dfb3a` and tested there. The source manifest covers 317 tracked files in `apps/`, `database/`, `packages/`, and `scripts/`; its SHA-256 is recorded in `manifest-pass2.json`. The shared checkout’s in-scope status remained clean. A temporary Pages probe helper was briefly created in the extracted target’s `apps/web` tree to work around Node’s extensionless import resolution; it was removed, the target source manifest was recomputed, and the full suite was rerun against the clean frozen tree. No existing source file was edited.

**Test evidence:** complete `npm test` exited 0: API 644/644 and contracts 100/100 passed; 0 skipped. Focused tests exited 0: 91/91 across body caps, XLSX, assignee roles, invitation limits, migration 0015, safe-next, Origin checks, profile, mentions, and Brevo/outbox behavior. The PostgreSQL container used image `postgres:17.11-alpine` pinned to `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, port 55693, databases `flowboard_harness` and `flowboard_access_test`; it was removed after testing.

## A. Authorization and data isolation — **partial pass**

- Regenerated the inventory from the 15 routers mounted by target `apps/api/src/http/app.ts`: 93 method/path declarations × 10 required identities = 930 actual `app.request` calls against disposable PostgreSQL. The identities were anonymous, stranger, other-project member, same-project member without board grant, Viewer, Member, Manager, Owner, revoked member, and a manager of a sibling project using the primary project’s guessed IDs.
- Final status totals: 200: 147; 204: 10; 302: 20; 400: 353; 401: 83; 403: 35; 404: 228; 422: 54. All 930 cells, response shapes/counts, and the non-401/403/404 subsets are in `route-authorization-matrix-pass2-execution.json`.
- Of 584 cells whose status was not 401/403/404, 467 returned no substantive data: 353×400, 54×422, 20×302, 10×204, and 30×200 with empty data. The remaining 117 data-bearing cells were the health responses, downloadable import templates, permitted board/project reads, owner-only board access, and empty notification acknowledgements. No cross-project content was observed in this fixture.
- Limitation: write routes were generally given an empty JSON object (or an invalid token/binary byte) to avoid changing fixture state. Many return 400/422 before authorization is reached. The complete cell results are real route executions, but they do not prove every write permission branch. The fixture also maps one primary project, board, card and column; it is not a fuzzing campaign over every nested ID type.

## B. Invitations and tokens — **pass for local synthetic checks**

- Rechecked prior rate-limit gap: target `b7-invite-scope-limits.test.ts` passed 8/8, including limits that hold across rotating client IPs, shared project allowance, idempotent replay, and fail-closed storage errors.
- A simultaneous acceptance probe against two requests and separate idempotency keys returned statuses 200 and 400 (`INVALID_INVITATION`); the token ended accepted and exactly one active membership existed.
- Brevo sends used only a fake transport and synthetic values. No invitation was created or accepted on UAT.

## C. Sessions, cookies, CSRF, CORS, and safe-next — **pass locally; UAT auth not covered**

- Target suite passed session, logout, profile, safe-next, and Origin/Referer tests. Focused run: safe-next 4/4, Origin/CSRF 2/2, profile 11/11. Tests covered same-site Pages-origin behavior, hostile/missing Origin cases, return-path allowlisting, and the `HttpOnly`, `SameSite=Lax`, Secure-by-host cookie policy.
- The 930-cell matrix also exercised mounted session/profile/logout routes with synthetic sessions.
- No signed-in browser or authenticated UAT request was used. Full signed-in cookie behavior in the deployed Pages-to-Worker path remains unverified.

## D. Pages Function proxy and edge headers/caching — **pass for local behavior and bounded anonymous UAT**

- `probes/pages-function-pass2.mjs` used a local fake service binding. It verified forwarding of the public Pages URL and cookie, preservation of a 302 OAuth Location and Set-Cookie, `Cache-Control: no-store`, missing-binding 500/no-store, anonymous page redirect, and bypass of assets/API requests. The mock is not a deployed service-binding integration test.
- UAT received at most 45 anonymous GET requests over the audit, including retries; none carried Cookie or Authorization. The final bounded batch tested 12 paths. Session/projects/workspaces/cards/images/notifications returned 401, and guessed board/upload paths returned 404. HTML entry redirects were no-store and returned CSP, nosniff, and frame-denial headers. JSON API responses returned no-store; they did not carry CSP/nosniff, which is expected for the sampled JSON responses.
- No signed-in proxy/header forwarding, direct Worker-origin comparison, or exhaustive Pages response-class test was run. UAT deployment provenance for this commit is unknown.

## E. Frontend XSS, image gallery, mentions, brief/links, and storage keys — **pass by source review; browser payload tests not covered**

- Scanned target `apps/web/src`: no `innerHTML`, `outerHTML`, `eval`, or `new Function`. Two `dangerouslySetInnerHTML` sites are limited to fixed application theme/bootstrap and SVG sprite constants; user values are rendered through React text nodes. Mention spans are bounds-checked and rendered as text/`mark`, not HTML.
- Image gallery fetches private bytes via the API, creates local object URLs, and revokes them at cleanup. Filenames are used as text/alt labels. Project brief is rendered as text; link writes require HTTPS without credentials, and external links use `noopener noreferrer` without previews/fetches.
- Browser storage use is limited to theme and compact-rail preferences in localStorage. Logout removes `flowboard*` sessionStorage entries; no card, comment, image, invitation token, or session secret is stored there in the inspected source.
- No live browser XSS attempt, CSP mutation, current static rebuild, keyboard/contrast/reduced-motion review, or build-provenance check was run. The two fixed inline HTML sites and deployment CSP still need browser/runtime validation.

## F. Input parsers, body limits, and image storage — **pass for local regression; hosted R2 not covered**

- The 20 MiB+1 synthetic XLSX expansion was rejected by the decompressor output budget; the standalone probe’s Node external-memory delta was 40 bytes. Target XLSX suite passed 13/13, including pre-parse authorization and bomb cases.
- Route-aware body caps passed 11/11: signed-in imports at 5 MiB plus envelope and image uploads at 10 MiB plus envelope were accepted by the limit middleware; one byte over was rejected; anonymous and unrelated routes retained 1 MiB.
- Fake R2 driver test passed. Target Worker test suite covered upload, content, finalize, read, delete, no-bucket fail-closed, and separate fetch instances sharing a fake bucket. Real R2 binding policy, object lifecycle, and Worker memory/time limits remain unverified.

## G. Database, migrations, integrity, and role boundary — **pass for migration 0015; role boundary remains open**

- Target `b7-migration-0015.test.ts` passed 3/3, including migration from empty through 0016, repeatability, and rejection of a project/workspace mismatch in `project_links`.
- Complete API suite passed on disposable PostgreSQL 17.11. No test used production/UAT data.
- The security roadmap still says one broad database role and no RLS. The live UAT role was not queried. Populated 0010-to-0016 upgrade, zero-downtime locks, query plans at scale, read replicas, and sharding/partitioning are not established by this pass.

## H. Concurrency and idempotency — **pass for the three requested races; remaining route families not covered**

- **Invitation accept race:** two concurrent requests for one synthetic invitation yielded one success, one invalid invitation, one active membership.
- **Image finalize vs card delete:** a storage gate held finalization while the card-delete route began. Both returned 200; the card was trashed; its finalized image row and object remained available for the restore lifecycle. This did not test explicit image-removal racing finalization.
- **Double import:** two concurrent transactions committed one ready import; both observed `committed`, and only one imported card existed.
- Existing suite also passed idempotency, parallel board-write, lock-order, image-delete-after-commit, and image-cap tests. Restore/purge worker overlap and the full lock-order graph across every route family remain untested.

## I. Abuse and availability — **partial pass**

- Per-inviter/project invitation ceilings and upload/import body limits passed their focused local tests. The UAT traffic was anonymous and under the 60-request limit.
- No authenticated UAT bursts, real Worker rate-limit binding test, provider outage against Brevo, queue saturation, cron overlap, or query-cost/load test was run.

## J. Logging and privacy, including Brevo/outbox — **fail**

- The fake-mailer probe captured logs and confirmed the synthetic invitation token, recipient, and body marker were absent. Target `b10-invitation-email.test.ts` passed 17/17, including log redaction and retry behavior.
- After successful send, the outbox row still held the recipient email and template fields (`projectName`, `inviterName`, role, expiry). The literal rendered body was not stored, but message source data remains. This is FB-AUD-09.
- No UAT/production logs, real Brevo delivery, backups, erasure, or retention process was inspected.

## K. Dependencies and supply chain — **fail**

- `npm audit --omit=dev --json` exited 1 with 2 production advisories (1 moderate, 1 high). Full audit exited 1 with 5 (3 moderate, 2 high). Details are in FB-AUD-04 and raw audit JSON.
- This pass did not claim a full license inventory, history secret scan, build provenance, or CI run.

## L. Product quality and documentation drift — **partial pass**

- Complete target tests: 744/744 passed. Focused tests: 91/91 passed. No test failures or skipped tests.
- The API route matrix and source checks cover the new profile, mentions, brief/links, image gallery API, and migration behavior, but this was not a visual/accessibility review or full end-to-end UI acceptance.
- No build was run because the configured build writes into the frozen `apps/` tree. WCAG keyboard/contrast/touch/reduced-motion checks, current static export provenance, and checklist-to-handoff verification remain open.

## Attempts that did not establish behavior

- A first Docker API inspection was denied by local socket permissions; the already-running disposable PostgreSQL was reachable with explicit local-network approval, and the container was later removed successfully.
- The first standalone R2 probe assumed a process-global memory default and failed with the new expected 503 `CONFIG_ERROR`; it was rewritten to use a fake shared R2 binding. The corrected probe passed.
- The first Pages probe could not load an extensionless TypeScript import in Node. A temporary helper under the extracted target was removed; the final probe transpiles an in-memory copy to `/private/tmp`, leaves the target source frozen, and passed.
- The initial Node UAT fetch ended in `ECONNRESET`. Curl succeeded; the UAT set was rerun with a bounded curl harness. Two early harness runs had status parsing defects; the corrected final batch recorded actual status codes. All requests remained unauthenticated and within the 60-request ceiling.
- The first 930-cell harness run used a malformed rate-limiter injection. It was corrected and the 930 requests were rerun; only the final output is used for authorization classification.
