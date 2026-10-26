# Frontend behavior and reliability specification

Date: 2026-10-26. Status: planning and acceptance criteria only; no frontend implementation or browser verification claimed. Companion: [detailed checklist](FRONTEND_BEHAVIOR_CHECKLIST.md). Research: [coverage findings and sources](research/frontend-behavior-research.md).

## What this document is for

Define what happens when someone uses Flowboard: clicks, types, saves, navigates, loses connection, changes projects or encounters someone else's edit. Visual direction, layout, typography, colors, animation styling and mockup approval remain with the user and their designer/Deepseek. Functional keyboard, touch and focus checks belong here because they determine whether an action actually works.

The existing [98-unit catalogue](features.tsv) is a **shared product catalogue**, not backend-only. It already tracks Backend, UI and Integration separately. It contains **74 units requiring a standalone UI handoff and 24 without one**. A backend-only control may still have an observable frontend consequence: a removed member's next request must fail and the browser must stop showing editable private content.

This document expands that catalogue into browser acceptance cases. It does not create a second product backlog, change API requirements, prove the mockups work with a server or mark existing feature boxes complete. The catalogue is comprehensive for the currently specified release, not a guarantee of zero bugs. Add a regression case whenever a new defect or requirement appears.

## Authority and current evidence

Use [FEATURE_SPEC.md](FEATURE_SPEC.md) for permissions/flows, [API.md](API.md) for request and response behavior, [IMPORT_SPEC.md](IMPORT_SPEC.md) for Excel, [handoffs](handoffs/README.md) for delivery and [BACKEND_REVIEW_GATE.md](../BACKEND_REVIEW_GATE.md) for backend approval. If those documents disagree or omit a required response, stop that particular behavior at a recorded contract decision rather than inventing a frontend workaround.

The HTML artifacts under `design/flowboard-ui/` and `screens/` explicitly use synthetic/local state. Their successful clicks or screenshots do not prove persistence, private image access, import transactions, concurrency or session security. `apps/web` was absent when this document was prepared. A separate Deepseek HTML file not supplied in this workspace has not been assessed.

The backend audit is a failed baseline with ongoing repairs, not approved API readiness; see [audit entry point](audits/README.md). This documentation does not unblock integration. The [Next.js direction](decisions/0003-nextjs-frontend.md) remains a recorded proposal with deployment/scaffold checks; the behavior cases apply whichever frontend framework is ultimately verified.

## How to use the checklist

Each stable `FE-*` identifier describes a testable behavior and maps to existing product IDs. **C** means derived from the current product/API contract. **P** means a proposed engineering safeguard that makes broad reliability goals concrete; agree its acceptance before implementation. P is not delivered, visually approved or automatically mandatory backend scope. **P0** is privacy, data loss, wrong authority, duplicate/destructive effects or a broken critical journey; **P1** is normal functional/recovery coverage; **P2** is additional compatibility/hardening. Priority is a proposed test order, not permission to omit required behavior.

All boxes start unchecked. A box can be closed only with a current browser/test evidence link identifying source revision, backend approval consumed, fixture/accounts, exact steps/command, expected and actual outcome, environment and remaining limits. Browser tests using mocked responses establish frontend behavior under those responses; real API + isolated PostgreSQL tests establish integration separately. Neither replaces the other. Keep official U/I approval in the existing role-owned handoffs and generated [feature checklist](FEATURE_CHECKLIST.md); this planning checklist never overrides those gates.

For every rendered action, implementers must record:

| Question | Example: moving a card |
|---|---|
| Who may act and in which scope? | Owner, manager or member of this project; viewer cannot move |
| What exact event starts it? | One deliberate drop or Move confirmation, not opening the dialog |
| What data/version is submitted? | Card/version, board structure version and canonical neighboring IDs |
| What happens while pending? | Provisional destination; repeated action is controlled |
| What proves success? | Server outcome plus canonical refetch; an animation alone proves nothing |
| What if it fails or the answer is lost? | Explain conflict or uncertain outcome; preserve intent; recover using the same command identity |
| What if the user leaves? | Do not update a different project's screen or claim the server canceled the move |
| What test proves this? | Browser scenario plus real concurrent server regression where applicable |

Every visible link/button/menu item must have an implemented, tested behavior or a deliberate unavailable state with a reason. No placeholder success messages or interactive controls that silently do nothing. Clicking a nested card menu must not also open the card or trigger its parent form.

## Common action state rules

An action state is simply the answer to “what is this action doing now?” Use explicit states so a Save button cannot be both failed and successful.

| State | Browser behavior |
|---|---|
| Idle/editing | Act only on current authorized context; keep field/comment/upload drafts separate |
| Locally invalid | Identify the actual input problem; no write sent; retain entered values |
| Pending | Prevent accidental duplicate logical submissions; do not block unrelated permitted actions without reason |
| Confirmed | Apply server IDs/versions, then fetch canonical data; clear only the successfully submitted draft |
| Rejected | Explain field, authority, conflict or limit error; retain only data the actor is still allowed to hold |
| Outcome unknown | A timeout/disconnect/abort may occur after commit; reconcile before treating it as failure or issuing a new command |
| Context gone | Discard/ignore late results from the previous route/account; release local resources; server may still have completed a write |

**Idempotency** means repeating the same command does not create another logical result. Example: a comment saved just before Wi-Fi failed must not appear twice when Retry is clicked. Keep the same key/body for that retry; editing the intended command creates a new intent. Replaying a receipt is not fresh card state. No offline write queue or automatic replay of old drafts after reauthentication is in scope.

**Optimistic display** means showing a provisional change before the server confirms it. It improves responsiveness but needs recovery. Do not blindly restore an old whole-board snapshot when one move fails: that could erase a newer successful change shown in another part of the board. Reconcile affected resources by ID/version and keep failed user intent separate from saved truth.

## Failure response matrix

Apply the relevant cases to every applicable flow. A completed HTTP request can still contain an error status; check status and response shape before presenting success. [MDN Fetch guidance](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch).

| Failure | Required or proposed frontend response |
|---|---|
| Offline / network error | C: explain lack of confirmed save; preserve authorized draft; no offline queue |
| Timeout / aborted write / connection lost after submit | C: outcome may be unknown; recover using existing resource/status route or same-key replay supported by that feature; never invent a status endpoint |
| Obsolete read canceled | P: ignore it quietly; no scary save-failed message for a harmless abandoned read |
| 400 | C: malformed input/cursor; fix input or refresh the collection; no infinite retry |
| 401 | C: invalidate active session view, stop protected writes and offer sign-in; no cached private-data flash |
| 403 | C: explain insufficient authority in visible scope; refresh capabilities; hiding controls is not server enforcement |
| 404 | C: private missing/unavailable state; no distinction revealing a sibling resource |
| 409 stale version/cursor/preview | C: preserve intent, refresh the affected data, ask for deliberate review/reapply; never guess newer versions |
| 409 idempotency conflict | C: do not change the body under an existing key or hide the collision as successful retry |
| 410 | C: expired restore/preview to authorized users; stop that action; do not extend deadlines locally |
| 413 / 422 | C: field/file/row-specific feedback; retain unrelated successfully saved state |
| 429 | C: respect Retry-After; P: cancel automatic retry on lost access/context and cap attempts/time |
| 5xx | C: safe failure with request ID where supplied; no provider details; P: bounded retry only when safe |
| Invalid JSON, wrong schema, HTML instead of API JSON | P: controlled client error, no crash or success toast; sanitized diagnostics without private body dumps |
| Asset/chunk/client exception | P: recover affected route/panel with a safe reload path; no invisible infinite spinner |

## Draft and privacy policy to agree before building

The contract protects unsent drafts from ordinary field errors, conflicts and refetches. Proposed implementation default: keep drafts in memory, keyed by actor + project + card; do not introduce persistent private drafts, cached image bytes, tokens or raw workbooks in browser storage. Theme/density preferences may be stored separately if storage failure is harmless.

On session expiry, lock the private editing surface; expose a draft again only after the same identity and current project authority are confirmed. No automatic submit. On explicit logout, account change or confirmed access revocation, clear private caches/object URLs and remove private drafts from active UI; never carry them into another account. A persistent recovery feature needs a separate privacy/expiry decision. This resolves “preserve drafts” without silently promising that private content survives logout on a shared computer.

The app cannot recall bytes someone already downloaded or prevent every browser/OS snapshot. Test and clear application-controlled displays/caches on back-forward restoration and access revalidation; do not claim retroactive erasure of external copies. HTTP cache policy and framework/router/client caches need separate evidence.

## Decisions not to invent from mockups

| Decision | Existing rule / missing detail |
|---|---|
| Sign-in and callback | Real provider/audience, callback/error and verified-session contract must be agreed; role query parameters and email-only login are not identity |
| Frontend hosting | Next.js Node/Cloudflare/static mode and actual cache/session behavior still require a spike; no direct frontend database access |
| Card status in drawer | API excludes ancestry/movement from generic field Save. A status picker must use the Move command. If it also contains dirty field edits, agree sequencing/partial-failure behavior; no invented atomic Save+Move |
| Restore countdown | API lifecycle shapes specify serverNow, restoreUntil, canRestore and blockedReason, plus authorized expiry details. Validate them against reviewed shared schemas; server-offset countdown is advisory and the server alone decides eligibility |
| Restore destination | API specifies RESTORE_DESTINATION_REQUIRED/READ_ONLY_CONTEXT, explicit choice among the original board's active columns and reopening as authorized. No cross-board restore in v1; verify the shared schemas/handlers match |
| Upload status | API defines ImageUpload states, receivedBytes, status URL and same-ID/digest retries. Verify those shapes and ALREADY_FINALIZED handling; transferred bytes do not mean saved image |
| Import status | API defines ImportStatus, canCommit, cancellationAllowed, expected version/digest and COMMIT_IN_PROGRESS status recovery. Verify the shared schemas/handlers match; no cancellation guarantee once committing |
| Private draft recovery | Above in-memory policy is proposed. Persistence, reload recovery and expiry are not existing release promises |
| Browser and device matrix | Proposed desktop Chromium/Firefox/WebKit plus real supported mobile touch checks; agree supported versions/devices before browser acceptance |
| Performance | Agree datasets and measured budgets; do not infer speed from framework names or visual smoothness |
| Comment normalization | Trim/UTF-16 mention offsets must match shared validators; do not silently retarget a mention when text changes |

Do not add mark-all notifications, public links, card archive, permanent card delete, arbitrary attachments, bulk import updates, automatic invitations from XLSX, AI, billing or offline edits. Archived projects/boards remain readable to authorized readers; archive blocks writes and does not expire read access or pause trash deadlines.

## Verification plan

1. Map each actual mockup control to the action contract and relevant FE/product IDs. Assess the specific Deepseek version when supplied; this document does not inspect an unseen file.
2. Use deterministic client/component checks for normalization, independent drafts, reducers/state changes, query identity and date/mention helpers.
3. Use browser checks to click/type/drag/navigate. Inject slow, reordered, refused, malformed and lost responses; assert saved-state messaging, privacy and recoverability. Simulated network failures are useful frontend evidence, not proof of database invariants. [Playwright network controls](https://playwright.dev/docs/network).
4. Use two authenticated browser contexts plus approved isolated API/PostgreSQL for shared edits, revocation, invitation and restore/import races. Keep accounts/projects separate; never use production data. [Playwright isolation](https://playwright.dev/docs/browser-contexts).
5. Test each release workflow with a real reload and fresh read. At minimum: create/edit/move/comment/image; invite/accept/remove; trash/restore/expiry; valid/invalid/repeated import. Verify exact server outcomes, not just toast text or screenshots.
6. Record supported browsers, touch/keyboard, timezone/clock, network and data size. Require no unexplained console errors, unhandled promises or runaway request loops in those tested paths. An intentionally injected error is captured, not ignored by the test harness.

For every user-facing mutation, include success, invalid input, repeated activation, lost response, appropriate role denial, stale data and leaving the context while pending. Use risk-based combinations rather than claiming every possible browser/network/input permutation has been tested. Retain bug reproductions as regression cases under stable FE IDs.

This task creates documents only. No frontend package, dependencies, product handlers, review approvals or generated feature checkmarks are changed. Shared root documents and other chats' active edits remain untouched; these companion documents can be adopted by Architect/UI without claiming implementation is ready.
