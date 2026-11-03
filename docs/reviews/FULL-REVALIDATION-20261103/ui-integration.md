# Flowboard all-98 UI and integration discovery — 2026-11-03

Frozen inspected commit: `917706ae0433df471c72736be4d548eb022236c4`. Read-only discovery. No tests, builds, browser, installations, network, cloud, credentials, application edits, scores or approvals. Only this report and its JSON companion were written.

**Actions.** Mapped all 98 feature IDs: 74 require UI; 24 have no standalone UI deliverable. Current `apps/web` is a Next.js app with implemented project, board/card, people/invite, image, import, inbox, activity, trash and settings surfaces. Source presence is separated from behavior verification.

**Why and options.** Clicking “Move to bottom” must mean the bottom of the whole Flowboard column. The current browser only knows its first 15 cards; deriving the destination from that partial list can conflict or move to the wrong intent. Fetching a small canonical placement from the existing server endpoint preserves correctness without downloading the entire board. The alternative is loading every card, which grows latency and memory.

**Evidence and limits.** There are zero `docs/handoffs/ui/*.json` and zero `docs/handoffs/integration/*.json` records. Related helper test sources are mapped below; the reported 239 web unit passes were not rerun here and do not establish browser acceptance. Historical scores in PROGRESS and audit scripts are not adopted. No current local or signed-in UAT UI acceptance is established. Exact file hashes and structured per-feature prerequisites are in [ui-integration.json](ui-integration.json).

**Next / your input.** Parent coordinates repairs, source-bound backend reapproval, local integrated browser evidence and fresh UI/integration records. After all gates pass, parent may carry out the already authorized direct UAT deployment and signed-in acceptance. No dev or production action is part of this survey. A genuine Google interaction may be required later if the UAT browser has no authorized usable session.

## Current source inventory

- Authentication: Google start link, session gate, local-only development login, saved-name step, user sign-out.
- Projects: Yours/Shared project groups, project switcher, create own project, overview/brief/links, default board, project archive/reopen.
- Boards/cards: board/list layouts, 2–6 selected boards inside one project, source-board-preserving edits/moves, quick/full card create, detail fields/assignees/date, optimistic pointer/touch drag, Move and toast Undo.
- Discussion/images: structured mention picker, post comments, activity display, serial image preparation/upload/cancel, private Blob gallery/lightbox, permitted image removal.
- Operations: Owner/Manager people/invitation administration, Owner board grants, inbox read state, My tasks, trash restore/destination, template/upload/preview/confirm import, contextual error/offline feedback.
- Not implemented UI surfaces: comment edit/delete/moderation, board archive/reopen, true column pagination and complete filters/placement, safe import reports/per-card result links. See precise findings.

## Findings and required follow-up

### UI-01 — Board page cannot retrieve cards after first 15

**Features:** BRD-03, BRD-07, QRY-01, QRY-02, UX-01. **Classification:** source_confirmed; no browser reproduction.

Board requests 15 cards/column. Unloaded count is a paragraph; Show more only expands the local done-column array. Client exposes no column-card cursor read. Card 16 cannot be found/opened through the column or searched there.

**Evidence:** `apps/web/src/lib/queries.ts:3`, `apps/web/src/components/board/board-column.tsx:140`, `apps/web/src/lib/api.ts:351`.

**Next:** Implement contract-bound cursor loads with stale refresh and dedupe; test a 31-card column and match beyond first page.

### UI-02 — Board search/filter ignores unloaded cards and omits priority/column

**Features:** QRY-01, QRY-02, BRD-03. **Classification:** source_confirmed; no browser reproduction.

matches() filters cached arrays; queries never receive changing filters. Result denominator is loaded allCards.length. No priority/column state/control and no project search call exists.

**Evidence:** `apps/web/src/components/board/board-view.tsx:173`, `apps/web/src/components/board/board-view.tsx:658`, `apps/web/src/lib/board-model.ts:39`, `apps/api/src/http/routes/cards.ts:447`.

**Next:** Use canonical server search/filter counts and cursor queries; expose required priority/column filters. Test filter totals and no-match states with hidden pages.

### UI-03 — Move uses first-page neighbors and lacks before/after placement

**Features:** CRD-07, CRD-08, CRD-09, UX-02. **Classification:** source_confirmed; no browser reproduction.

Move top/bottom counts loaded cards and derives neighbors from cached snapshot. Bottom with 31 cards can target after card 15 with null next, causing conflict or wrong intent; no bounded placement read or before/after option.

**Evidence:** `apps/web/src/components/board/move-dialog.tsx:13`, `apps/web/src/components/board/move-dialog.tsx:56`, `apps/web/src/components/board/board-view.tsx:204`, `apps/web/src/components/board/board-view.tsx:714`, `apps/api/src/http/routes/boards.ts:678`.

**Next:** Call placement endpoint for first/last/before/after and honor current versions; test real destination with unseen cards in filtered and merged views.

### UI-04 — Undo can use latest intervening version

**Features:** CRD-12. **Classification:** source_confirmed_risk_requires_reproduction; no browser reproduction.

Toast undo reads latest cached card.version and submits ordinary move, so an intervening edit that has polled can be accepted and its new order overridden. Dedicated move-undo handler enforces intervening-work checks.

**Evidence:** `apps/web/src/components/board/board-view.tsx:242`, `apps/api/src/http/routes/cards.ts:315`.

**Next:** Bind undo to successful command/result and use backend undo semantics; test teammate edit/move between move and undo.

### UI-05 — Comment edit/delete/moderation is absent

**Features:** COM-04, COM-05. **Classification:** source_confirmed; no browser reproduction.

Rendered comments only show author/time/body. API client exposes list/post only. No user can edit/delete own comment or moderate another through web.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:544`, `apps/web/src/lib/api.ts:408`.

**Next:** Implement versioned author edit and authorized delete/moderation with tombstones, confirmation and retry behavior.

### UI-06 — Board archive/reopen is absent

**Features:** BRD-08. **Classification:** source_confirmed; no browser reproduction.

Project lifecycle controls exist, board lifecycle methods/actions do not. Backend offers board archive/reopen.

**Evidence:** `apps/web/src/components/board/board-view.tsx:559`, `apps/web/src/app/settings/page.tsx:142`, `apps/web/src/lib/api.ts:179`, `apps/api/src/http/routes/boards.ts:737`, `apps/api/src/http/routes/boards.ts:856`.

**Next:** Add Owner/Manager board lifecycle and archived board discovery/reopen; test no card deletion and unchanged trash cutoff.

### UI-07 — Manager People controls offer forbidden role operations

**Features:** INV-06, INV-07, PRJ-05. **Classification:** source_confirmed; no browser reproduction.

All non-owner rows expose Manager option and Remove, disabled only for self/pending. A Manager is offered promoting Member to Manager, demoting/removing peer Manager. Server refusal is necessary but misleading controls remain.

**Evidence:** `apps/web/src/app/people/page.tsx:178`, `apps/web/src/app/people/page.tsx:182`.

**Next:** Derive target-aware permissions; Manager only sees Member/Viewer changes/removals and protected peer rows. Verify actual API denial too.

### UI-08 — Several retries lose logical command identity

**Features:** CRD-01, CRD-11, COM-02, INV-01, INV-02, INV-04, ATT-01. **Classification:** source_confirmed; no browser reproduction.

Comment rotates key on every error, quick-add has no retained key, invitation creation clears attempt on every error, image retry re-stages with new keys. A committed mutation plus lost response can create duplicate logical work; field patch retry may become stale rather than reconcile. Full add-card and new-project handle retained keys better.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:469`, `apps/web/src/components/board/board-view.tsx:286`, `apps/web/src/components/ui/invite-dialog.tsx:81`, `apps/web/src/lib/api.ts:368`, `apps/web/src/lib/image-uploads.ts:61`.

**Next:** Retain request payload/key through unknown outcomes; rotate on deliberate new intent or definitive refusal. Reproduce response loss after commit for create/comment/invite/image-finalize, assert one side effect.

### UI-09 — Drawer Save can partly save fields before status move fails

**Features:** CRD-04, CRD-05, CRD-06, CRD-10, CRD-11. **Classification:** source_confirmed; no browser reproduction.

Save first PATCHes fields then POSTs a move when dropdown changed. If move conflicts, fields already persisted while UI reports save failure and retains/reconciles draft later. Successful save waits for refetch to reset base/dirty.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:244`, `apps/web/src/components/board/card-detail-drawer.tsx:261`, `apps/web/src/components/board/card-detail-drawer.tsx:276`.

**Next:** Keep status change a separate immediate Move action or show precise partial outcome; reconcile canonical field response immediately. Browser trace delayed save/refetch dirty transitions including assignee save.

### UI-10 — Overdue dates use browser timezone rather than workspace timezone

**Features:** ACC-05, CRD-05, QRY-03. **Classification:** source_confirmed; no browser reproduction.

startOfToday() uses browser local calendar. No workspace timezone argument exists, so a workspace day and browser day disagreement mislabels due/overdue although YYYY-MM-DD input stays date-only.

**Evidence:** `apps/web/src/lib/dates.ts:4`, `apps/web/src/app/my-tasks/page.tsx:23`, `PRD.md:15`.

**Next:** Use server workspaceToday/canonical due state or explicit timezone calendar helper; test same due date in UTC and Asia/Kolkata around midnight.

### UI-11 — Session error is masked by stale successful data

**Features:** ACC-01, ACC-02, UX-01, UX-04. **Classification:** source_confirmed_risk_requires_reproduction; no browser reproduction.

Session state returns ready whenever query.data exists before checking query.isError. A background 401 retains last successful React Query data, preventing signedOut banner/redirect from activating and leaving stale privileges in UI. Backend still must deny writes.

**Evidence:** `apps/web/src/lib/session.tsx:48`, `apps/web/src/components/shell/session-gate.tsx:25`, `apps/web/src/components/polling.tsx:43`.

**Next:** Prioritize authentication failure, preserve only safe user drafts, clear protected caches on loss. Browser test successful session then real revoked session/refetch, with and without dirty input.

### UI-12 — Card drawer modality needs browser accessibility correction/verification

**Features:** CRD-03, UX-02. **Classification:** source_gap_browser_acceptance_missing; no browser reproduction.

Main drawer has aria-modal and local Tab trap, but unlike DialogLayer does not acquire inert lock for app background. Click/focus and screen-reader background exposure, nested modal return, and tablist arrow keys are unverified. Source lacks tablist keyboard pattern.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:65`, `apps/web/src/components/board/card-detail-drawer.tsx:77`, `apps/web/src/components/board/card-detail-drawer.tsx:112`, `apps/web/src/components/shell/app-shell.tsx:64`, `apps/web/src/components/ui/dialog-layer.tsx:36`.

**Next:** Unify modal stacking/focus/inert behavior and implement tab keyboard navigation; run keyboard and accessibility tree checks.

### UI-13 — Image list knowingly accepts incompatible response envelopes

**Features:** ATT-03. **Classification:** source_confirmed_contract_drift; no browser reproduction.

Source comment says backend data.items differs from contract data array; cast and fallback obscure broken response contract. No current contract-validated browser response evidence available.

**Evidence:** `apps/web/src/components/board/card-images.tsx:113`.

**Next:** Choose canonical schema on backend/contracts/client and assert actual response via integrated image flow; avoid permissive casts hiding malformed payloads.

### UI-14 — Pagination missing across management and feeds

**Features:** PRJ-02, PRJ-05, INV-05, RBAC-05, COM-01, AUD-01, AUD-03, AUD-04, DEL-02, NTF-02, QRY-03. **Classification:** source_confirmed; no browser reproduction.

API methods omit cursors; consumers mostly select .data. Activity Load more slices the first 100; card activity first 50; comments/trash/invites/directory/board access lack continuation. Session accessibleProjects itself is treated as complete. Cap effects must be checked against actual contracts before claiming list completeness.

**Evidence:** `apps/web/src/lib/api.ts:321`, `apps/web/src/lib/api.ts:332`, `apps/web/src/lib/api.ts:409`, `apps/web/src/lib/api.ts:424`, `apps/web/src/lib/api.ts:432`, `apps/web/src/lib/api.ts:436`, `apps/web/src/lib/api.ts:457`, `apps/web/src/app/activity/page.tsx:137`.

**Next:** Keep envelopes, add server cursor loops/load controls and role-loss resets. Use over-page synthetic fixtures for every paginated surface. Verify session project cap/continuation separately.

### UI-15 — Unsent comment drafts disappear through ordinary drawer/tab transitions

**Features:** COM-06, CRD-11, DEL-08. **Classification:** source_confirmed; no browser reproduction.

requestClose checks field dirtyRef only. Comments owns local state, conditional Comments/Activity unmounts it. Switching to Activity, closing a field-clean drawer or auto-closing on trash/revocation loses typed comment. No safe draft retention found.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:75`, `apps/web/src/components/board/card-detail-drawer.tsx:96`, `apps/web/src/components/board/card-detail-drawer.tsx:220`, `apps/web/src/components/board/card-detail-drawer.tsx:419`, `apps/web/src/components/board/card-detail-drawer.tsx:450`.

**Next:** Track independent drafts above conditional tabs; include comment draft in close protection and preserve safe text when access ends. Test field save, tab change, close/Escape, delete/revoke and reconnect.

### UI-16 — Profile avatar updates have no UI control

**Features:** ACC-03. **Classification:** source_confirmed; no browser reproduction.

Current account form edits displayName only. Catalogue still requires name/avatar updates. Decide provider-managed avatar expectation explicitly rather than claiming full profile editing.

**Evidence:** `apps/web/src/app/settings/page.tsx:69`, `apps/web/src/components/ui/avatar.tsx:1`.

**Next:** Reconcile provider-managed avatar scope or add supported avatar update flow with validation.

### UI-17 — Activity UI does not implement owner cross-project feed

**Features:** AUD-03, AUD-04. **Classification:** source_confirmed_scope_gap; no browser reproduction.

One active project is selected, even though header says WORKSPACE. No workspace activity client call, card filter or all-owned-project feed. Newer restriction on combined card views may deliberately affect this feature but does not itself retire audit feed.

**Evidence:** `apps/web/src/app/activity/page.tsx:27`, `apps/web/src/app/activity/page.tsx:35`, `apps/web/src/lib/api.ts:424`.

**Next:** Reconcile exact owner audit scope; implement current authorized feed/filter semantics and make heading/counts accurate.

### UI-18 — Import does not follow asynchronous/current status or full preview

**Features:** IMP-04, IMP-05, IMP-06, IMP-10. **Classification:** source_confirmed_contract_state_gap; no browser reproduction.

Upload always enters preview using one response; commit always enters done on 2xx; no status GET/poll client. NextCursor is disclosed but cannot load remaining preview. No explicit unknown status mapping UI. Current synchronous backend may mask missing state handling.

**Evidence:** `apps/web/src/app/import/page.tsx:81`, `apps/web/src/app/import/page.tsx:94`, `apps/web/src/app/import/page.tsx:250`, `packages/contracts/src/imports.ts:72`.

**Next:** Bind stage to returned state, add bounded status/cursor reads and expiry/cancel/unknown-commit recovery; implement explicit status mapping or document supported correction flow.

### UI-19 — Import results lack card links, provenance and safe report download

**Features:** IMP-09, IMP-11. **Classification:** source_confirmed; no browser reproduction.

Created rows render title/external ID as text, only Open board link. No import status/report GET, safe download, per-created-card link or batch receipt UI.

**Evidence:** `apps/web/src/app/import/page.tsx:285`, `apps/web/src/lib/api.ts:285`.

**Next:** Expose receipt/result/error report endpoints and scoped card links; verify leading formula characters remain text in report.

### UI-20 — Inbox/tasks/activity/trash do not register foreground refresh

**Features:** NTF-02, QRY-03, AUD-03, AUD-04, DEL-02, UX-04. **Classification:** source_confirmed; no browser reproduction.

Default window-focus refetch is false. These feed pages do not use usePollKeys, so active tabs do not receive mention/read updates or cleared private previews after grant removal until a fresh fetch/remount/action. Session polling alone does not refresh unregistered feeds.

**Evidence:** `apps/web/src/components/providers.tsx:18`, `apps/web/src/components/polling.tsx:36`, `apps/web/src/app/inbox/page.tsx:42`, `apps/web/src/app/my-tasks/page.tsx:35`, `apps/web/src/app/activity/page.tsx:35`, `apps/web/src/app/trash/page.tsx:44`.

**Next:** Register relevant queries and reconcile revoked authority/clear protected rows; test new mention, other-tab read, board/project revoke with screen left open.

### SCOPE-01 — Workspace/transfer catalogue rows are retired or shifted

**Features:** ACC-04, ACC-05, ACC-06, ACC-07. **Classification:** source_confirmed; no browser reproduction.

Keep all stable IDs. ACC-04 manual create and ACC-07 transfer are intentionally retired beta operations; ACC-06 maps to own/shared project switcher; ACC-05 workspace preferences remain absent/unreconciled. No automatic verified status is justified.

**Evidence:** `docs/features.tsv:9`, `apps/api/src/http/routes/workspaces.ts:20`, `apps/api/src/http/routes/workspaces.ts:161`, `apps/web/src/components/project/new-project-dialog.tsx:21`, `apps/web/src/app/settings/page.tsx:23`.

**Next:** Architect records explicit supersession/retirement and revised acceptance/evidence binding for each stable ID; verify 410 negatives and automatic personal-container path.

### SCOPE-02 — Catalogue access/board settings prose predates explicit board grants

**Features:** RBAC-05, INV-01, BRD-02. **Classification:** source_confirmed; no browser reproduction.

INV-01/RBAC-05 still mention inherited/all boards; current UI explicitly says zero boards until Owner grant. BRD-02 catalogue allows Manager rename but newer B-3 makes name/description Owner-only.

**Evidence:** `docs/features.tsv:17`, `docs/features.tsv:30`, `docs/FEATURE_SPEC.md:141`, `apps/web/src/components/ui/invite-dialog.tsx:129`, `apps/web/src/app/settings/page.tsx:67`.

**Next:** Preserve stable IDs and update acceptance with latest decisions; obtain current backend/UI/integration evidence against revised semantics.

### UI-21 — Delete confirmation omits named card and 24-hour recovery window

**Features:** DEL-01. **Classification:** source_confirmed; no browser reproduction.

Delete confirmation says only “Delete this card?” and “The card moves to the trash. Comments and images stay with it.” It omits the title and the explicitly required 24-hour recovery cutoff. Trash page explains 24 hours later, but the destructive decision lacks that context.

**Evidence:** `apps/web/src/components/board/card-detail-drawer.tsx:182`.

**Next:** Name the card and state recovery is available for 24 hours subject to server cutoff; verify accessible confirmation text before delete.

## Scope reconciliation before any done status

Stable IDs remain present. ACC-04 must be reconciled to automatic personal-container creation plus retired manual create; ACC-07 transfer is intentionally unavailable in beta (typed 410); ACC-06 is the own/shared project switcher. ACC-05 preferences are absent and need an explicit product disposition rather than an automatic n/a. RBAC-05 and INV-01 inheritance language is superseded by active project membership AND explicit board grant. BRD-02 manager rename language is superseded by Owner-only name/description (B-3). Owner cross-project audit is a distinct scope question from retired cross-project combined card views. No catalogue/handoff was modified by this survey.

## Executable local synthetic UI/integration strategy

This is a runbook, not an executed result. Use current backend setup and a new disposable PostgreSQL database. Inspect existing ports/containers first. `database/compose.local.yaml` is loopback PostgreSQL 17.11 on 55432 with tmpfs; its data disappears on stop. Keep synthetic credentials private and pass them through environment, never report values. Do not bind to hosted databases.

1. Freeze candidate SHA/source manifest. Verify backend gate and transitive prerequisites. Run `npm run typecheck:web`, `npm run build:web`, `npm run test --workspace @flowboard/web`; preserve actual logs/exit codes.
2. With private DATABASE_URL and fresh local DEV_LOGIN_SECRET configured, run `npm run db:migrate`; start local Node with `NODE_ENV=development DEV_LOGIN_ENABLED=true npm run dev:api`; start web with `API_URL=http://127.0.0.1:8787 npm run dev:web -- --hostname 127.0.0.1`. Confirm actual ports from startup output; choose a fresh port if occupied.
3. Seed only synthetic Owner/Manager/Member/Viewer, project member with zero board grants, separate hidden board/project, and invited person who owns another project. Create cookie sessions in separate browser contexts via local dev-login; it is disabled in deployed Worker/production.
4. Run LOCAL-03–LOCAL-08 below using real UI → same-origin proxy → mounted backend → disposable PostgreSQL, keeping a redacted request/status ledger and canonical server reads after writes. A fixture-only browser pass may isolate UI bugs, but cannot establish integration.
5. There is no repository Playwright/Cypress config or installed `@playwright/test`, `playwright`, `playwright-core`, `puppeteer` or `@axe-core/playwright` found. Package lock only contains Next optional peer metadata. Use parent browser tooling for a first manual synthetic pass; add a small repeatable browser harness as separately owned implementation work before claiming automated acceptance. No install performed here.

- **LOCAL-03:** Browser create project/board/columns, quick/full card, fields, assignments, search/cursors and keyboard/touch Move. Verify Persist/reload, all cards accessible beyond page one, counts/filter accurate, true last/before/after destinations, no cross-board/project mutation.
- **LOCAL-04:** Comment/mention/inbox and two-context updates; intentionally drop one response after server commit using browser response interception or local proxy. Verify One comment/event/notification under retry, correct email invite, stable command key, no draft loss, role restrictions.
- **LOCAL-05:** Images with real private proxy bytes; failed staged/finalize response, cancel, gallery/remove; revoke board/project while open. Verify Only finalized images count; fresh bytes denied after revoke; stale preview/metadata cleared; saved fields unaffected.
- **LOCAL-06:** Delete/restore boundary and explicit destination with controlled disposable DB timestamps; archive/reopen; intervening-move Undo. Verify Strict <24h, same card/comments/images, one winner of cleanup/restore; no stale-authority or undo overwrite.
- **LOCAL-07:** Download actual template; upload/preview/confirm/retry/cancel/expire and inspect created cards/results/report. Verify No cards before confirmation; all-or-none; leading zeros, dates, multiple assignees preserved; repeated original and trashed imports never duplicate; expired/revoked preview cannot commit.
- **LOCAL-08:** Real browser accessibility/responsiveness and reconnect evidence on integrated flows. Verify Tab/Shift-Tab/Escape, nested focus return, background inert, tab arrow keys, accessible names, live move/save errors, 320px and 200% zoom, long Unicode content, reduced motion, offline/focus/hidden-tab polling.

Synthetic volume must exceed every page boundary (31 cards/column, >50 history, >100 inbox/activity/tasks, multi-page comments); include long Unicode text, multiple assignees, real supported image bytes and the actual seven-column workbook. For exact 24-hour checks, control only disposable synthetic timestamps or a test clock; do not wait 24 hours or alter system time. Inject response loss after server commit to distinguish idempotency from repeated sequential success.

UI tests verify what a person can do; backend tests establish server authority. Example: hiding a Manager promotion option prevents confusion, while a mounted API negative test proves the Manager cannot promote by hand-crafted request. Both are needed and neither substitutes for the other.

## User-facing UAT cases (all pending)

Use fresh genuine Google authentication and authorized test accounts against the exact deployed UAT build only after closure gates. No existing login, UAT credentials, deployed resource or user data was inspected. Keep secrets and invitation links out of saved logs. Every case below is proposed and unobserved.

- **UAT-01 — Sign in, name, sign out and expiry** (ACC-01, ACC-02, ACC-03, UX-01): Google sign in, confirm own/shared landing and name, then revoke session in second context; safe typed text remains and protected data/actions stop.
- **UAT-02 — Personal projects and role boundaries** (ACC-04, ACC-05, ACC-06, ACC-07, PRJ-01, PRJ-02, RBAC-01, RBAC-02, RBAC-05): Invitee creates own project, remains ordinary role in shared project; zero-board project leaks nothing; retired manual workspace/transfer actions absent and typed 410 is tested through authorized API probes.
- **UAT-03 — Project settings, brief, archive and reopen** (PRJ-03, PRJ-04): Owner/Manager save allowed fields, stale save retains input; default board Owner-only; archived project rejects writes without altering trash deadline.
- **UAT-04 — Invite and manage exact project/board access** (PRJ-05, INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08, RBAC-03, RBAC-04): Send real UAT test invitation to authorized test account; matching accept, wrong-email refusal, rotation/revocation, Board grant Owner-only, Manager peer restrictions, revoke/leave and immediate private-resource denial.
- **UAT-05 — Boards, columns and complete pagination** (BRD-01, BRD-02, BRD-03, BRD-04, BRD-05, BRD-06, BRD-07, BRD-08): Create/rename board under correct role, add/rename/reorder/delete empty column, reject restorable references/final column, access card31 and archive/reopen board.
- **UAT-06 — Cards, independent drafts and save** (CRD-01, CRD-02, CRD-03, CRD-04, CRD-05, CRD-06, CRD-10, CRD-11, COM-06): Quick/full create requires priority; edit fields/assignees/date, delayed successful save clears dirty state, failure retains input; tab switch/close/Escape protects comments independently.
- **UAT-07 — Movement and Undo with two users** (CRD-07, CRD-08, CRD-09, CRD-12): Pointer/touch and keyboard/click first/last/before/after movement to paginated column; filtered Move ignores hidden cards for display only; stale move and intervening-work Undo refuse safely.
- **UAT-08 — Discussion, full history and inbox** (COM-01, COM-02, COM-03, COM-04, COM-05, AUD-01, AUD-02, AUD-03, AUD-04, AUD-05, AUD-06, NTF-01, NTF-02, NTF-03): Post and literal-vs-structured mention, read target notification, edit/delete/moderate under roles, paginate history/comments/inbox, recover lost response once, no revoked-access previews.
- **UAT-09 — Private images and lifecycle** (ATT-01, ATT-02, ATT-03, ATT-04, ATT-05, ATT-06, ATT-07): Upload permitted PNG/JPEG/WebP with real progress/cancel; malformed/capped bytes fail; preview/remove only authorized; revoke then fetch fails; trash/restore preserves finalized image until exact cutoff.
- **UAT-10 — Exact trash and purge** (DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-07, DEL-08): Delete leaves board/count/search immediately, Owner/Manager can restore strictly before cutoff with same content, invalid destination resolves explicitly, expired restore stable; no post-revocation writes or lost safe draft.
- **UAT-11 — Real workbook flow** (IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07, IMP-08, IMP-09, IMP-10, IMP-11): Download blank Cards template; populate synthetic rows, preview without writes, confirm atomically, open created card links/report; repeat/conflicting/formula/invalid-date/revoked/expired/cancelled cases remain safe.
- **UAT-12 — Discovery, reconnect, accessibility and performance** (QRY-01, QRY-02, QRY-03, UX-01, UX-02, UX-03, UX-04, UX-05, FND-01, FND-02, FND-03, FND-04): Search beyond first page; combine priority/assignee/due/column; My tasks scopes correctly; hidden tab pauses, focus reconnect refetches; keyboard/narrow/zoom/readers/reduced-motion complete same essential operations; record measured workflow/runtime performance.

## All 98 feature mappings

“Source” means entrypoints/components/helpers exist; it does not mean accepted. Related test file names are source pointers, with no fresh run and no assertion of full feature coverage. Backend-only rows have n/a UI surface but still require backend and integrated workflow evidence. Every row lacks current role-owned UI/integration evidence. JSON includes full original acceptance, transitive prerequisite IDs, per-feature UAT wording, all source refs and SHA-256 manifest.

| ID | UI required | Source entry / component | Helper tests (not browser) | Status / concrete gaps |
|---|---|---|---|---|
| FND-01 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| FND-02 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| FND-03 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| FND-04 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| ACC-01 | yes | /signin<br>`apps/web/src/app/signin/page.tsx:13`; `apps/web/src/components/auth/name-step.tsx:1` | `apps/web/test/signin-states.test.ts`; `apps/web/test/name-form.test.ts`; `apps/web/test/landing-rule.test.ts` | source_present_unverified; Google start link; local-only development email form; mandatory saved-name step. Findings: UI-11 |
| ACC-02 | yes | User menu > Sign out; session expiry<br>`apps/web/src/components/shell/user-menu.tsx:1`; `apps/web/src/components/shell/session-gate.tsx:18`; `apps/web/src/components/shell/app-shell.tsx:28` | `apps/web/test/signin-states.test.ts` | source_present_unverified; Logout clears query cache/storage. Expiry banner depends on session classification. Findings: UI-11 |
| ACC-03 | yes | /settings?tab=account<br>`apps/web/src/app/settings/page.tsx:69`; `apps/web/src/components/ui/avatar.tsx:1` | `apps/web/test/person-name.test.ts` | partial_source_unverified; Display name editing is wired; avatar is derived/displayed, no avatar update form found. Findings: UI-16 |
| ACC-04 | yes | n/a | No dedicated test identified | retired_scope_reconciliation_required; Standalone workspace creation intentionally has no web entrypoint. Personal container provisioned server-side; POST /workspaces returns typed 410. Findings: SCOPE-01 |
| ACC-05 | yes | n/a | No dedicated test identified | scope_reconciliation_required; No workspace name/timezone preference control in current four-tab project-first settings. Findings: SCOPE-01, UI-10 |
| ACC-06 | yes | Sidebar project switcher; /projects<br>`apps/web/src/components/shell/project-switcher.tsx:26`; `apps/web/src/app/projects/page.tsx:42` | `apps/web/test/project-switcher.test.ts`; `apps/web/test/landing-rule.test.ts` | source_present_unverified; Yours and Shared project groups, project-local roles, no user-facing workspace switcher. Findings: SCOPE-01 |
| ACC-07 | yes | n/a | No dedicated test identified | retired_scope_reconciliation_required; Ownership transfer intentionally UI-less and server endpoint returns typed 410 for beta. Findings: SCOPE-01 |
| PRJ-01 | yes | /projects > Create a project<br>`apps/web/src/components/project/new-project-dialog.tsx:25` | `apps/web/test/quota-messages.test.ts` | source_present_unverified; Workspace-less createOwnProject retains command identity on transport failures; existing own/shared project roles remain separate. |
| PRJ-02 | yes | /projects; /project?id=…<br>`apps/web/src/app/projects/page.tsx:42`; `apps/web/src/app/project/project-view.tsx:21` | `apps/web/test/project-switcher.test.ts` | source_present_unverified; Lists session accessibleProjects and fetched board lists; active/archived and name filtering. Findings: UI-14 |
| PRJ-03 | yes | /settings?project=…; project brief<br>`apps/web/src/app/settings/page.tsx:127`; `apps/web/src/components/project/brief-card.tsx:17` | No dedicated test identified | source_present_unverified; Project name/description/brief/links saves use expectedVersion; default board is Owner-only. |
| PRJ-04 | yes | /settings?project=… > Archive/Reopen<br>`apps/web/src/app/settings/page.tsx:116`; `apps/web/src/app/projects/page.tsx:48`; `apps/web/src/app/project/project-view.tsx:87` | No dedicated test identified | source_present_unverified; Owner project lifecycle confirmation and archived-project list exist. |
| PRJ-05 | yes | /people; card/add-card assignee picker<br>`apps/web/src/app/people/page.tsx:18`; `apps/web/src/components/board/card-detail-drawer.tsx:230`; `apps/web/src/app/add-card/page.tsx:33` | `apps/web/test/assignees.test.ts`; `apps/web/test/person-name.test.ts` | source_present_unverified; Management directory and board-scoped eligible assignee lookup wired. Findings: UI-07, UI-14 |
| INV-01 | yes | Board/People > Invite people<br>`apps/web/src/components/ui/invite-dialog.tsx:44` | `apps/web/test/invite-email.test.ts` | source_present_unverified; Project-scoped invite creation, pending/history list, resend/revoke, copy one-time link, project-vs-board access disclosure. Findings: UI-08, UI-14, SCOPE-02 |
| INV-02 | yes | Board/People > Invite people<br>`apps/web/src/components/ui/invite-dialog.tsx:44` | `apps/web/test/invite-email.test.ts` | source_present_unverified; Project-scoped invite creation, pending/history list, resend/revoke, copy one-time link, project-vs-board access disclosure. Findings: UI-08, UI-14 |
| INV-03 | yes | /invitation?token=…; /invitations/accept<br>`apps/web/src/components/invitation/accept-screen.tsx:1`; `apps/web/src/app/invitation/page.tsx:1`; `apps/web/src/app/invitations/accept/page.tsx:1` | `apps/web/test/invitation-fx.test.ts` | source_present_unverified; Matching-account accept, switch-account, wrong/expired token handling, landing after acceptance. |
| INV-04 | yes | Board/People > Invite people<br>`apps/web/src/components/ui/invite-dialog.tsx:44` | `apps/web/test/invite-email.test.ts` | source_present_unverified; Project-scoped invite creation, pending/history list, resend/revoke, copy one-time link, project-vs-board access disclosure. Findings: UI-08, UI-14 |
| INV-05 | yes | Board/People > Invite people<br>`apps/web/src/components/ui/invite-dialog.tsx:44` | `apps/web/test/invite-email.test.ts` | source_present_unverified; Project-scoped invite creation, pending/history list, resend/revoke, copy one-time link, project-vs-board access disclosure. Findings: UI-08, UI-14 |
| INV-06 | yes | /people > Manage members<br>`apps/web/src/app/people/page.tsx:45`; `apps/web/src/app/people/page.tsx:164` | No dedicated test identified | partial_source_unverified; Role PATCH includes expectedVersion; removal wired. Manager UI does not reflect peer/promotion restrictions. Findings: UI-07 |
| INV-07 | yes | /people > Manage members<br>`apps/web/src/app/people/page.tsx:45`; `apps/web/src/app/people/page.tsx:164` | No dedicated test identified | partial_source_unverified; Role PATCH includes expectedVersion; removal wired. Manager UI does not reflect peer/promotion restrictions. Findings: UI-07 |
| INV-08 | yes | /settings?project=… > Leave project<br>`apps/web/src/app/settings/page.tsx:88`; `apps/web/src/app/settings/page.tsx:330` | `apps/web/test/leave-project.test.ts` | source_present_unverified; Confirmed leave removes project-keyed cache and refreshes session; Owner has no leave action. |
| RBAC-01 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| RBAC-02 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| RBAC-03 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| RBAC-04 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| RBAC-05 | yes | Invite dialog; /people > Board access<br>`apps/web/src/components/ui/invite-dialog.tsx:129`; `apps/web/src/app/people/page.tsx:137` | No dedicated test identified | source_present_unverified; Current source discloses explicit per-board grants; historical all-boards inheritance acceptance is superseded. Findings: SCOPE-02, UI-14 |
| BRD-01 | yes | Project/board > New board<br>`apps/web/src/components/ui/new-board-dialog.tsx:1`; `apps/web/src/app/project/project-view.tsx:168` | `apps/web/test/quota-messages.test.ts` | source_present_unverified; Owner/Manager create; actual creator grant and navigation require backend + browser verification. |
| BRD-02 | yes | Project board list; board title edit; Settings > Board<br>`apps/web/src/app/project/project-view.tsx:108`; `apps/web/src/components/ui/edit-board-dialog.tsx:1`; `apps/web/src/app/settings/page.tsx:142` | No dedicated test identified | source_present_unverified; Accessible boards list; rename/description controls Owner-only per newer B-3 decision. Findings: SCOPE-02 |
| BRD-03 | yes | /board?id=…<br>`apps/web/src/components/board/board-view.tsx:47`; `apps/web/src/components/board/board-column.tsx:1` | `apps/web/test/board-selection.test.ts`; `apps/web/test/board-merge.test.ts` | partial_source_unverified; First 15 cards per column rendered with totals; snapshot evidence is source only. Findings: UI-01, UI-02 |
| BRD-04 | yes | Board actions / Settings > Edit columns<br>`apps/web/src/components/board/columns-dialog.tsx:24` | No dedicated test identified | source_present_unverified; Add/rename/color/category, earlier/later buttons, guarded delete request using expectedBoardVersion. |
| BRD-05 | yes | Board actions / Settings > Edit columns<br>`apps/web/src/components/board/columns-dialog.tsx:24` | No dedicated test identified | source_present_unverified; Add/rename/color/category, earlier/later buttons, guarded delete request using expectedBoardVersion. |
| BRD-06 | yes | Board actions / Settings > Edit columns<br>`apps/web/src/components/board/columns-dialog.tsx:24` | No dedicated test identified | source_present_unverified; Add/rename/color/category, earlier/later buttons, guarded delete request using expectedBoardVersion. |
| BRD-07 | yes | Board column footer<br>`apps/web/src/components/board/board-column.tsx:140` | No dedicated test identified | partial_source_unverified; Disclosure of unloaded cards exists; Show more expands only already-fetched done cards. No next-page request. Findings: UI-01 |
| BRD-08 | yes | n/a | `apps/web/test/board-selection.test.ts` | ui_missing; Read-only display understands archived boards, but no archive/reopen mutation method or control exists. Findings: UI-06 |
| CRD-01 | yes | Board > Add card; /add-card?board=…<br>`apps/web/src/components/board/board-column.tsx:146`; `apps/web/src/components/board/board-view.tsx:278`; `apps/web/src/app/add-card/page.tsx:54` | No dedicated test identified | partial_source_unverified; Both forms require explicit priority; full form uses a retained key; quick-add generates a key for each request. Findings: UI-08 |
| CRD-02 | yes | Board/list card<br>`apps/web/src/components/board/board-card.tsx:1` | `apps/web/test/person-name.test.ts` | source_present_unverified; Compact title, priority/date/assignees, comment/image counts and stable key. |
| CRD-03 | yes | /board?id=…&card=…<br>`apps/web/src/components/board/card-detail-drawer.tsx:52`; `apps/web/src/components/board/board-view.tsx:729` | `apps/web/test/inert-lock.test.ts` | source_present_unverified; Named modal drawer with Escape/Tab handling and source-card focus restoration. Findings: UI-12, UI-15 |
| CRD-04 | yes | Card drawer > Save changes<br>`apps/web/src/components/board/card-detail-drawer.tsx:197` | `apps/web/test/assignees.test.ts` | source_present_unverified; Plain fields, date-only input, none accepted for existing cards, board-eligible multi-assignee picker, explicit save. Findings: UI-09, UI-10 |
| CRD-05 | yes | Card drawer > Save changes<br>`apps/web/src/components/board/card-detail-drawer.tsx:197` | `apps/web/test/assignees.test.ts` | source_present_unverified; Plain fields, date-only input, none accepted for existing cards, board-eligible multi-assignee picker, explicit save. Findings: UI-09, UI-10 |
| CRD-06 | yes | Card drawer > Save changes<br>`apps/web/src/components/board/card-detail-drawer.tsx:197` | `apps/web/test/assignees.test.ts` | source_present_unverified; Plain fields, date-only input, none accepted for existing cards, board-eligible multi-assignee picker, explicit save. Findings: UI-09, UI-10 |
| CRD-07 | yes | Board pointer/touch drag<br>`apps/web/src/components/board/board-view.tsx:204`; `apps/web/src/components/board/board-column.tsx:123` | `apps/web/test/board-merge.test.ts` | partial_source_unverified; Optimistic move rollback, per-source-board merged movement; neighbor computation uses loaded snapshots. Findings: UI-03 |
| CRD-08 | yes | Card > Move; filtered board > Move<br>`apps/web/src/components/board/move-dialog.tsx:18`; `apps/web/src/components/board/board-view.tsx:714` | No dedicated test identified | partial_source_unverified; Keyboard/click Move only top/bottom; filtered drag disabled. No bounded placement read or before/after selection. Findings: UI-03 |
| CRD-09 | yes | Card > Move; filtered board > Move<br>`apps/web/src/components/board/move-dialog.tsx:18`; `apps/web/src/components/board/board-view.tsx:714` | No dedicated test identified | partial_source_unverified; Keyboard/click Move only top/bottom; filtered drag disabled. No bounded placement read or before/after selection. Findings: UI-03 |
| CRD-10 | yes | Card drawer save/conflict/discard<br>`apps/web/src/components/board/card-detail-drawer.tsx:207`; `apps/web/src/components/board/card-detail-drawer.tsx:244` | `apps/web/test/error-catalogue.test.ts` | partial_source_unverified; Draft reconcile and stale warning exist; field patch then status move are separate calls; no dedicated draft-sync/browser test. Findings: UI-08, UI-09, UI-15 |
| CRD-11 | yes | Card drawer save/conflict/discard<br>`apps/web/src/components/board/card-detail-drawer.tsx:207`; `apps/web/src/components/board/card-detail-drawer.tsx:244` | `apps/web/test/error-catalogue.test.ts` | partial_source_unverified; Draft reconcile and stale warning exist; field patch then status move are separate calls; no dedicated draft-sync/browser test. Findings: UI-08, UI-09, UI-15 |
| CRD-12 | yes | Move success toast > Undo<br>`apps/web/src/components/board/board-view.tsx:242` | `apps/web/test/toast-policy.test.ts` | partial_source_unverified; Undo issues ordinary move using current cached version, not the move-undo handler/intervening-work guard. Findings: UI-04 |
| COM-01 | yes | Card drawer > Comments<br>`apps/web/src/components/board/card-detail-drawer.tsx:450` | No dedicated test identified | partial_source_unverified; Chronological list renders first response only; cursor envelope discarded. Findings: UI-14 |
| COM-02 | yes | Card drawer > Post comment<br>`apps/web/src/components/board/card-detail-drawer.tsx:458` | `apps/web/test/mentions.test.ts` | partial_source_unverified; Independent comment mutation with key ref; every failure rotates key. Findings: UI-08 |
| COM-03 | yes | Comment > Mention / type @<br>`apps/web/src/components/board/card-detail-drawer.tsx:481` | `apps/web/test/mention-ui.test.ts`; `apps/web/test/mentions.test.ts` | source_present_unverified; Board-scoped eligible people, structured spans, combobox/listbox and keyboard handlers; real IME/browser acceptance remains pending. |
| COM-04 | yes | n/a<br>`apps/web/src/components/board/card-detail-drawer.tsx:544` | No dedicated test identified | ui_missing; Comments display body/edited marker. No edit/delete/moderate control or client mutation exists. Findings: UI-05 |
| COM-05 | yes | n/a<br>`apps/web/src/components/board/card-detail-drawer.tsx:544` | No dedicated test identified | ui_missing; Comments display body/edited marker. No edit/delete/moderate control or client mutation exists. Findings: UI-05 |
| COM-06 | yes | Comment composer while editing/saving fields<br>`apps/web/src/components/board/card-detail-drawer.tsx:450`; `apps/web/src/components/board/card-detail-drawer.tsx:413` | `apps/web/test/mention-ui.test.ts` | partial_source_unverified; Composer owns separate state; tab conditional unmount and close behavior need draft-loss correction. Findings: UI-15 |
| ATT-01 | yes | Card drawer > Choose/drop/paste images<br>`apps/web/src/components/board/card-images.tsx:104` | `apps/web/test/image-prepare.test.ts`; `apps/web/test/image-uploads.test.ts` | source_present_unverified; Serial preparation, progress, cancel/retry; staging and finalize are distinct. Findings: UI-08 |
| ATT-02 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| ATT-03 | yes | Card drawer gallery > image viewer<br>`apps/web/src/components/board/card-images.tsx:39`; `apps/web/src/components/board/card-images.tsx:79`; `apps/web/src/components/board/card-images.tsx:113` | `apps/web/test/image-uploads.test.ts` | source_present_unverified; Private Blob URLs, lazy tiles/lightbox; list tolerates two incompatible envelope shapes. Findings: UI-13 |
| ATT-04 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| ATT-05 | yes | Gallery remove image > confirmation<br>`apps/web/src/components/board/card-images.tsx:155`; `apps/web/src/components/board/card-images.tsx:206` | `apps/web/test/image-uploads.test.ts` | source_present_unverified; Uploader/Owner/Manager remove guard and confirmation; storage cleanup remains backend. |
| ATT-06 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| ATT-07 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| AUD-01 | yes | Card drawer > Activity<br>`apps/web/src/components/board/card-detail-drawer.tsx:606` | No dedicated test identified | partial_source_unverified; Safe event text and historical actor rendering; first 50 events only. Findings: UI-14 |
| AUD-02 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| AUD-03 | yes | /activity<br>`apps/web/src/app/activity/page.tsx:25` | No dedicated test identified | partial_source_unverified; One selected project, client actor/action/date filters, client Show more; no workspace aggregate API use or card filter. Findings: UI-14, UI-17, UI-20 |
| AUD-04 | yes | /activity<br>`apps/web/src/app/activity/page.tsx:25` | No dedicated test identified | partial_source_unverified; One selected project, client actor/action/date filters, client Show more; no workspace aggregate API use or card filter. Findings: UI-14, UI-17, UI-20 |
| AUD-05 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| AUD-06 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| DEL-01 | yes | Owner/Manager card > Delete<br>`apps/web/src/components/board/card-detail-drawer.tsx:162` | No dedicated test identified | source_present_unverified; Soft-delete confirmation submits current card/board versions, but does not name the card title or exact 24-hour window. Findings: UI-21 |
| DEL-02 | yes | /trash > Restore<br>`apps/web/src/app/trash/page.tsx:33`; `apps/web/src/app/trash/page.tsx:62` | `apps/web/test/restore-destination.test.ts` | source_present_unverified; Manage-role project selection, server-clock skew, deadline display, restore/destination picker. Findings: UI-14, UI-20 |
| DEL-03 | yes | /trash > Restore<br>`apps/web/src/app/trash/page.tsx:33`; `apps/web/src/app/trash/page.tsx:62` | `apps/web/test/restore-destination.test.ts` | source_present_unverified; Manage-role project selection, server-clock skew, deadline display, restore/destination picker. Findings: UI-14 |
| DEL-04 | yes | /trash > Restore<br>`apps/web/src/app/trash/page.tsx:33`; `apps/web/src/app/trash/page.tsx:62` | `apps/web/test/restore-destination.test.ts` | source_present_unverified; Manage-role project selection, server-clock skew, deadline display, restore/destination picker. Findings: UI-14 |
| DEL-05 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| DEL-06 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| DEL-07 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| DEL-08 | yes | Open card after trash/revocation<br>`apps/web/src/components/board/card-detail-drawer.tsx:90` | No dedicated test identified | partial_source_unverified; Drawer detects trashed/missing card and closes; safe unsent drafts are discarded on close. Findings: UI-15 |
| IMP-01 | yes | /import > Download template<br>`apps/web/src/app/import/page.tsx:130` | No dedicated test identified | source_present_unverified; Same-origin template endpoint download; actual bytes and workbook use need integration. |
| IMP-02 | yes | /import target selectors<br>`apps/web/src/app/import/page.tsx:50` | No dedicated test identified | source_present_unverified; Only active manageable projects/accessible active boards, default column picker. |
| IMP-03 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| IMP-04 | yes | /import > Validate workbook > Preview<br>`apps/web/src/app/import/page.tsx:81`; `apps/web/src/app/import/page.tsx:208` | No dedicated test identified | partial_source_unverified; Row errors and mapped values rendered; no status polling, next-page retrieval, explicit status mapping control. Findings: UI-18 |
| IMP-05 | yes | /import > Validate workbook > Preview<br>`apps/web/src/app/import/page.tsx:81`; `apps/web/src/app/import/page.tsx:208` | No dedicated test identified | partial_source_unverified; Row errors and mapped values rendered; no status polling, next-page retrieval, explicit status mapping control. Findings: UI-18 |
| IMP-06 | yes | /import > Confirm import<br>`apps/web/src/app/import/page.tsx:94`; `apps/web/src/app/import/page.tsx:260` | No dedicated test identified | partial_source_unverified; Preview digest/default column/version bound commit with retained confirmation key; any successful response treated as done. Findings: UI-18 |
| IMP-07 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| IMP-08 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| IMP-09 | yes | /import > Result; card Activity<br>`apps/web/src/app/import/page.tsx:277`; `apps/web/src/components/board/card-detail-drawer.tsx:606` | No dedicated test identified | partial_source_unverified; Result lists created row text and board link; no created-card links, batch receipt view, safe report download. Findings: UI-19 |
| IMP-10 | yes | /import > reset/back/cancel<br>`apps/web/src/app/import/page.tsx:90` | No dedicated test identified | partial_source_unverified; Reset calls cancel when allowed; expiry/status recovery requires actual status polling. Findings: UI-18 |
| IMP-11 | yes | /import > Result; card Activity<br>`apps/web/src/app/import/page.tsx:277`; `apps/web/src/components/board/card-detail-drawer.tsx:606` | No dedicated test identified | partial_source_unverified; Result lists created row text and board link; no created-card links, batch receipt view, safe report download. Findings: UI-19 |
| NTF-01 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| NTF-02 | yes | /inbox<br>`apps/web/src/app/inbox/page.tsx:36` | No dedicated test identified | partial_source_unverified; Inbox threads/details, safe link, read/mark all. No registered polling or cursor continuation. Findings: UI-14, UI-20 |
| NTF-03 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |
| QRY-01 | yes | Board > Search/Assignee/Due filters<br>`apps/web/src/components/board/board-view.tsx:173`; `apps/web/src/components/board/board-view.tsx:578` | No dedicated test identified | partial_source_unverified; Filters work on loaded card arrays; priority/column filter controls and project search API call absent. Findings: UI-01, UI-02 |
| QRY-02 | yes | Board > Search/Assignee/Due filters<br>`apps/web/src/components/board/board-view.tsx:173`; `apps/web/src/components/board/board-view.tsx:578` | No dedicated test identified | partial_source_unverified; Filters work on loaded card arrays; priority/column filter controls and project search API call absent. Findings: UI-01, UI-02 |
| QRY-03 | yes | /my-tasks<br>`apps/web/src/app/my-tasks/page.tsx:32` | No dedicated test identified | source_present_unverified; Per-project assigned queries grouped by due state/project with priority/project/due filters; first 100 only. Findings: UI-10, UI-14, UI-20 |
| UX-01 | yes | All pages; error notes and shell banners<br>`apps/web/src/components/ui/error-note.tsx:1`; `apps/web/src/components/shell/app-shell.tsx:20`; `apps/web/src/components/board/board-column.tsx:133` | `apps/web/test/error-catalogue.test.ts`; `apps/web/test/error-codes.test.ts`; `apps/web/test/error-note.test.ts` | source_present_unverified; Specific empty/error/retry/offline UI exists; false no-match on unloaded cards is a real gap. Findings: UI-01, UI-11, UI-15 |
| UX-02 | yes | Card drawer/Move/columns/dialogs<br>`apps/web/src/components/ui/dialog-layer.tsx:14`; `apps/web/src/components/board/card-detail-drawer.tsx:77`; `apps/web/src/components/board/move-dialog.tsx:18` | `apps/web/test/inert-lock.test.ts` | source_present_unverified; Source labels, focus trap, visible Move and column reorder buttons; browser keyboard/assistive-tech acceptance absent. Findings: UI-03, UI-12 |
| UX-03 | yes | Board/list/detail at narrow width/zoom<br>`apps/web/src/app/globals.css:1`; `apps/web/src/components/board/card-detail-drawer.tsx:108` | No dedicated test identified | source_present_unverified; Responsive styles exist; no real viewport/zoom/touch/long-content acceptance evidence. |
| UX-04 | yes | Foreground board refresh; reconnect<br>`apps/web/src/components/polling.tsx:24`; `apps/web/src/components/providers.tsx:10` | `apps/web/test/poller.test.ts` | partial_source_unverified; Visibility/focus/reconnect and move hold logic exists; several feeds never register and session expiry can stay ready. Findings: UI-11, UI-20 |
| UX-05 | no | n/a | n/a | not_applicable_backend_only; n/a: no standalone UI deliverable in catalogue; actual backend semantics must be exercised through the related integrated flow. |

## Evidence ownership and completion limits

Do not use this discovery report as a passing reviewPath or mark features done from it. Parent must preserve failed rounds, fix with owned file boundaries, freeze a fresh manifest, obtain independent review, and write feature-specific UI/integration records bound to passing backend evidence before checklist regeneration. Browser outcomes need actual named assertions, network statuses and screenshots/accessibility evidence where relevant. Local synthetic behavior and UAT behavior remain separate evidence.

Memory was used only for lookup guidance; all current claims above were checked against current source. Prior note: MEMORY.md:185–198 (backend-before-UI/evidence distinction), rollout 01a17470-0521-72f1-906d-d8dda6550527.
