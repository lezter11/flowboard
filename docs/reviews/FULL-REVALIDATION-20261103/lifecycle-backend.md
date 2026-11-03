# Lifecycle backend discovery — 2026-11-03

Actions: mapped all **69** assigned features at `917706ae0433df471c72736be4d548eb022236c4`. This is source discovery, not acceptance or independent approval. Only these two evidence files were written.

Why and options: a Flowboard import preview is a promise about exactly which cards will be created. Keeping one normalized original row and checking its External ID again at confirmation is simpler than allowing duplicate cards and repairing them later. The former needs a small data migration and careful current-grant locks; the latter breaks create-once behavior and is not an acceptable v1 fallback.

Evidence and limits: mounted route → adapter → schema → existing test source has been traced below. **No test/build/install, network/cloud call or credentials read occurred.** Existing test declarations are not fresh passing evidence. Historical self-ratings do not approve this target. UI focus/drafts/viewport/polling and signed-in hosted acceptance remain separate. `sourceReferenceHashes` in JSON freezes cited bytes for discovery only; full gate scope still needs all reachable dependencies and actual command logs.

## Current definitions and conflicts

- **DOC-01** Board name/description Owner-only supersedes TSV Manager rename; Manager retains column/archive authority where specified. Sources: `docs/features.tsv:32`, `docs/FEATURE_SPEC.md:57`, `apps/api/src/adapters/boards.ts:342`.
- **DOC-02** Explicit low/medium/high/urgent is current UI requirement; server/template still allow none. Coordinate acceptance/contract/template once; existing none on legacy cards remains permitted. Do not silently change every existing-card priority value. Sources: `docs/FEATURE_SPEC.md:136`, `docs/IMPORT_SPEC.md:69`, `packages/contracts/src/cards.ts:29`, `apps/api/src/services/excel-parser.ts:671`.
- **DOC-03** Separate board grants and one-project combined card view supersede project-wide inheritance and cross-project QRY03 wording; clarify whether My Tasks latest own-projects amendments allow UI fanout, without broad new endpoint. Sources: `docs/FEATURE_SPEC.md:141`, `docs/features.tsv:94`, `apps/api/src/adapters/cards.ts:1215`.
- **DOC-04** 31 Oct creator grant amendment supersedes 27 Oct no implicit grant for new Manager-created board; existing project members get no backfill and grant administration stays Owner-only. Older test title is stale, and access-list404 still tests Owner-only administration. Sources: `docs/handoffs/proposals/own-projects-decisions-2026-10-31.md:11`, `apps/api/src/http/routes/boards.ts:106`, `apps/api/test/board-access.test.ts:215`.
- **DOC-05** Leading not-implemented prose and historical self-scores are stale history; source exists but no fresh runtime pass or gate approval is established by this discovery. Sources: `docs/FEATURE_SPEC.md:3`, `docs/IMPORT_SPEC.md:3`, `TASKS.md:15`, `docs/FEATURE_CHECKLIST.md:7`.

## Source findings and repair candidates

### GAP-01 — Description discarded and original hash drift (high)

Features: IMP-04, IMP-06, IMP-07. Parsed description enters preview hash but not persisted row; commit writes empty description and hashes empty. Persist normalized original payload/hash and use same representation for preview/commit/retry. Test nonempty multiline Unicode description roundtrip, same original skip after edit and changed description conflict.

Sources: `apps/api/src/adapters/imports.ts:383`, `apps/api/src/adapters/imports.ts:420`, `apps/api/src/adapters/imports.ts:482`, `apps/api/src/adapters/imports.ts:1086`, `apps/api/src/adapters/imports.ts:1124`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-02 — Separate ready previews can create duplicate cards (high)

Features: IMP-06, IMP-07. Only preview looks up duplicate markers; commit creates card then marker ON CONFLICT DO NOTHING. Recheck/reserve IDs under board lock before any card insert; parallel same and changed-payload preview commits must yield one logical creation or all-none conflict.

Sources: `apps/api/src/adapters/imports.ts:298`, `apps/api/src/adapters/imports.ts:850`, `apps/api/src/adapters/imports.ts:1086`, `apps/api/src/adapters/imports.ts:1135`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-03 — Importer permits assignee without board grant (high)

Features: IMP-06, IMP-08, CRD-06. Import queries use project membership alone. Reuse canonical board eligibility and lock target ownership/membership/grants deterministically through commit; add grant removal and viewer/demotion race tests.

Sources: `apps/api/src/adapters/imports.ts:280`, `apps/api/src/adapters/imports.ts:997`, `apps/api/src/services/board-assignees.ts:11`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-04 — Temporary import copies lack cleanup/retention (high)

Features: IMP-09, IMP-10, IMP-11, DEL-07, AUD-06. Cancelled/expired preview rows retain titles/emails; scheduled list has no import cleanup. Purge does not scrub rows tied to deleted card. Add minimal result/provenance design and bounded retryable terminal-content cleanup, preserve marker, demonstrate no copied content after purge.

Sources: `apps/api/src/adapters/imports.ts:585`, `apps/api/src/adapters/imports.ts:1244`, `apps/api/src/services/trash-purge.ts:107`, `apps/api/src/runtime/worker.ts:82`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-05 — Preview binding incomplete and mapping hash placeholder (high)

Features: IMP-02, IMP-05, IMP-06, IMP-07. Mappings digest uses row ID and empty assignees; commit can override default column not recomputed in digest, no stored board structure revision. Preserve original row and explicit mappings separately; bind intended actor/target/configuration/eligibility and define actor-sharing policy. Test renamed/deleted mapped columns, changed default and stale mapped retries.

Sources: `apps/api/src/adapters/imports.ts:89`, `apps/api/src/adapters/imports.ts:727`, `apps/api/src/adapters/imports.ts:830`, `apps/api/src/adapters/imports.ts:951`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-06 — Numeric dates lack styles and parser explicit CPU budget (medium)

Features: IMP-03, IMP-04, IMP-08. Numeric type alone implies serial date; no date-style semantics. Explicit row/expanded limits exist but no CPU deadline/cell-count bound. Parse date styles, reject general numeric date fields and bound/time actual Worker validation; fuzz malformed package/XML and limit edges.

Sources: `apps/api/src/services/excel-parser.ts:49`, `apps/api/src/services/excel-parser.ts:586`, `apps/api/src/services/excel-parser.ts:691`, `docs/IMPORT_SPEC.md:23`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-07 — Recovery dedupe is card-link-wide, lease implementation differs (medium)

Features: NTF-01, NTF-03. Normal synchronous comment path already inserts recipient rows, so ordinary two-comment loss is not established. Recovery-only missing notifications for two events on same card can collapse via link dedupe, and no event-recipient unique key exists. Use stable logical event identity; crash/restart/overlap/failure injection needed. Current transaction locks recover on DB disconnect; no expiring fenced outbox lease columns exist.

Sources: `apps/api/src/adapters/comments.ts:376`, `apps/api/src/adapters/notifications.ts:245`, `apps/api/src/adapters/notifications.ts:352`, `database/migrations/0001_initial.sql:163`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-08 — Expired/purged card or import default FK may block empty-column delete (medium)

Features: BRD-06, DEL-04. Guard checks active/restorable only but FK restricts all card/default-column references. Existing success case physically deletes fixture. Add mounted tests with expired/purged and terminal import references; choose safe explicit reference policy and error mapping rather than weakening ancestry.

Sources: `apps/api/src/adapters/boards.ts:877`, `database/migrations/0001_initial.sql:101`, `database/migrations/0001_initial.sql:216`, `database/migrations/0003_constraints.sql:51`, `apps/api/test/brd01-brd07.test.ts:685`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-09 — Archive route concurrency contract divergence (low)

Features: BRD-08. Lifecycle schema declares expectedVersion; inline route ignores body and applies transitions unconditionally. Establish intended archive/reopen semantics and same-key/stale opposite-command tests. This is source contract mismatch candidate, not a newly invented requirement.

Sources: `packages/contracts/src/boards.ts:47`, `apps/api/src/http/routes/boards.ts:737`, `apps/api/src/http/routes/boards.ts:856`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-10 — Deleted comment body remains in direct notification snippet (medium)

Features: COM-05, AUD-06, NTF-02. Post copies up to200 body characters into notification; tombstone clears comment/spans but does not identify/redact this copy. Requirement says deleted bodies redacted under retention policy, which is not explicit here. Define policy and event/comment identity, test authorized inbox after deletion and prevent copied-body resurrection.

Sources: `apps/api/src/adapters/comments.ts:381`, `apps/api/src/adapters/comments.ts:672`, `apps/api/src/adapters/notifications.ts:64`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-11 — Image validation fidelity is header-level (verification)

Features: ATT-02. Valid header/dimensions suffice without decoding all pixel stream/chunk CRCs. Test malformed/truncated payload with syntactically valid header; clarify whether supported-byte validation requires decodable image. Avoid unsupported claim that magic/dimension checks establish full decoder safety.

Sources: `apps/api/src/services/image-validator.ts:64`, `apps/api/src/services/image-validator.ts:92`, `apps/api/src/services/image-validator.ts:268`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

### GAP-12 — Worker template packaging unproved (verification)

Features: IMP-01. Template download relies on process-relative fs file and no artifact binding is visible. Require actual isolated Worker template download/bytes inspection; Node integration alone cannot establish Worker bundle contains XLSX.

Sources: `apps/api/src/adapters/imports.ts:34`, `apps/api/src/http/routes/imports.ts:58`, `apps/api/wrangler.jsonc:4`.

source-grounded; no reproduction executed in this discovery. No numerical approval score is assigned.

## Per-feature acceptance map

Each row is `source_mapped_unverified`. Acceptance is quoted from the stable catalogue; the conflict notes above identify superseding decisions. All paths are repository-relative; line numbers refer to the frozen commit. All mounted endpoints below are under `/api/v1`; activity/comments/trash/import/inbox routers receive their prefix at app.ts.

### BRD-01 — Create board

Acceptance: Owner/manager creates a board with default columns atomically inside an authorized project.

- Mounted: `apps/api/src/http/routes/boards.ts:50 POST projects/:projectId/boards`.
- Adapter: `apps/api/src/adapters/boards.ts:138 createBoard`; `apps/api/src/adapters/board-grants-foundation.ts:140 grantCreatorBoardAccess`.
- Contract: `packages/contracts/src/boards.ts:24`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:114`; `apps/api/test/brd01-brd07.test.ts:203`; `apps/api/test/b18-own-projects.test.ts:1`.
- Current implementation: Owner/Manager atomic board plus five default columns; transaction also grants creator Manager this new board only; active/total quotas enforced in mounted route.
- Required verification / limits: Rerun role matrix, same-key create, concurrent cap and creator-only grant through mounted handler; historical no-creator-grant test titles must not override 31 Oct amendment.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### BRD-02 — Board list and settings

Acceptance: List only accessible project boards; owner/manager renames a board without breaking card IDs/links.

- Mounted: `apps/api/src/http/routes/boards.ts:144 GET projects/:projectId/boards`; `apps/api/src/http/routes/boards.ts:227 PATCH boards/:boardId`.
- Adapter: `apps/api/src/adapters/boards.ts:238 listProjectBoards`; `apps/api/src/adapters/boards.ts:310 updateBoard`.
- Contract: `packages/contracts/src/boards.ts:34`; `packages/contracts/src/boards.ts:70`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:304`; `apps/api/test/brd01-brd07.test.ts:330`; `apps/api/test/board-description-default-board.test.ts:1`.
- Current implementation: List active accessible boards; PATCH keeps IDs, uses snapshot version and Owner-only name/description rule.
- Required verification / limits: Run Owner/Manager/member/viewer/no-grant/removed replay paths, rename link stability and owner-transfer interleaving. TSV owner/manager rename wording is superseded by FEATURE_SPEC:57.
- Mapped gaps: DOC-01.

### BRD-03 — Bounded consistent board snapshot

Acceptance: Metadata, counts and first column pages share one snapshot; caps/cursors are explicit and all filters count beyond the visible page.

- Mounted: `apps/api/src/http/routes/boards.ts:207 GET boards/:boardId`.
- Adapter: `apps/api/src/adapters/boards.ts:1111 getBoardSnapshot`.
- Contract: `packages/contracts/src/boards.ts:188`; `packages/contracts/src/boards.ts:201`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:795`; `apps/api/test/board-access.test.ts:614`.
- Current implementation: Repeatable-read snapshot holds board access; returns bounded per-column pages, totals, filters, versions, people and cursor metadata.
- Required verification / limits: Run concurrent mutation/read and revocation/read on separate connections; verify all filter counts beyond page and bounded query plans with realistic cardinality.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### BRD-04 — Add and rename columns

Acceptance: Owner/manager configures unique normalized names, colors and todo/active/done categories with expected board version.

- Mounted: `apps/api/src/http/routes/boards.ts:318 POST boards/:boardId/columns`; `apps/api/src/http/routes/boards.ts:402 PATCH boards/:boardId/columns/:columnId`.
- Adapter: `apps/api/src/adapters/boards.ts:431 addColumn`; `apps/api/src/adapters/boards.ts:559 updateColumn`.
- Contract: `packages/contracts/src/boards.ts:87`; `packages/contracts/src/boards.ts:95`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:392`; `apps/api/test/brd01-brd07.test.ts:454`; `apps/api/test/brd01-brd07.test.ts:492`.
- Current implementation: Manager/Owner column changes use structure version, normalized uniqueness and max12 columns; category and tone are independent labels.
- Required verification / limits: Run normalized Unicode/case names, sibling column IDs, stale version, archived context and failed-write rollback including receipt/activity.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### BRD-05 — Reorder columns

Acceptance: Pointer and click/tap/keyboard ordering persist atomically; missing/duplicate/foreign IDs and stale revisions fail clearly.

- Mounted: `apps/api/src/http/routes/boards.ts:487 POST boards/:boardId/columns/reorder`.
- Adapter: `apps/api/src/adapters/boards.ts:710 reorderColumns`.
- Contract: `packages/contracts/src/boards.ts:108`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:554`.
- Current implementation: Exact complete column ID set and expected structure version update positions and activity atomically.
- Required verification / limits: Run duplicate/missing/foreign ID and two-writer races; pointer, keyboard and click/tap behavior belongs to UI verification.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### BRD-06 — Remove empty column

Acceptance: Owner/manager cannot remove final column or any column referenced by active/restorable cards; no silent card deletion/move occurs.

- Mounted: `apps/api/src/http/routes/boards.ts:571 DELETE boards/:boardId/columns/:columnId`.
- Adapter: `apps/api/src/adapters/boards.ts:811 deleteColumn`.
- Contract: `packages/contracts/src/boards.ts:120`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:685`; `database/migrations/0003_constraints.sql:51`.
- Current implementation: Rejects final column, active cards and unexpired trashed cards; truly empty column deletes and compacts.
- Required verification / limits: Existing test physically deletes trash fixture before successful column deletion; test expired/purged-card and import-default references explicitly, including expected safe refusal instead of raw FK/server failure.
- Mapped gaps: GAP-08.

### BRD-07 — Card pagination and column counts

Acceptance: Load more retains canonical order without duplicates; empty column and empty filtered column are distinct and stale cursors refresh.

- Mounted: `apps/api/src/http/routes/boards.ts:711 GET boards/:boardId/cards`.
- Adapter: `apps/api/src/adapters/boards.ts:1479 listBoardCards`.
- Contract: `packages/contracts/src/cards.ts:136`.
- Existing tests, not run: `apps/api/test/brd01-brd07.test.ts:862`; `apps/api/test/board-access.test.ts:509`.
- Current implementation: Keyset position/ID pages bind board/filter/date/snapshot/order revision; active/matching counts are separate.
- Required verification / limits: Run off-page filter counts, same-rank tie, malformed/foreign/stale cursor, inserts/moves between pages, revocation/read, timezone-day rollover and query bounds.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### BRD-08 — Archive and reopen board

Acceptance: Owner/manager makes board read-only or reopens it; no card is deleted and pending trash deadlines continue.

- Mounted: `apps/api/src/http/routes/boards.ts:737 POST boards/:boardId/archive`; `apps/api/src/http/routes/boards.ts:856 POST boards/:boardId/reopen`.
- Adapter: `apps/api/src/http/routes/boards.ts:737 inline transactional handlers`; `apps/api/src/adapters/rbac.ts:391`.
- Contract: `packages/contracts/src/boards.ts:47`; `packages/contracts/src/boards.ts:52`.
- Existing tests, not run: `apps/api/test/lifecycle-undo.test.ts:235`; `apps/api/test/b18-own-projects.test.ts:1`.
- Current implementation: Manager/Owner archive retains content and blocks writes; reopen checks active-board cap and archived parent. Neither updates trash cutoff.
- Required verification / limits: Run archive/reopen vs writes/imports/grant revoke, read-only project rejection, idempotent no-op semantics and deadline continuity. Route bodies currently ignore lifecycle expectedVersion schema; decide/document whether archive concurrency is last-writer-wins.
- Mapped gaps: GAP-09.

### CRD-01 — Quick create card

Acceptance: Member/manager/owner creates title in an active authorized column; required field and retry failures retain draft and create once.

- Mounted: `apps/api/src/http/routes/cards.ts:39 POST boards/:boardId/cards`.
- Adapter: `apps/api/src/adapters/cards.ts:254 createCard`.
- Contract: `packages/contracts/src/cards.ts:18`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:187`; `apps/api/test/crd01-crd11.test.ts:1206`.
- Current implementation: Member+ creates one authorized active card, validates structure version/column and writes activity/receipt atomically; token create retry path additionally uses semantic identity.
- Required verification / limits: Run invalid/blank/long title, response loss, concurrent same key, revoke/trash/archive races and required-priority product alignment.
- Mapped gaps: DOC-02.

### CRD-02 — Compact card summary

Acceptance: Show title, priority, due date, assignees and accurate comment/image counts without loading full descriptions/history.

- Mounted: `apps/api/src/http/routes/boards.ts:207 GET boards/:boardId`; `apps/api/src/http/routes/boards.ts:711 GET boards/:boardId/cards`.
- Adapter: `apps/api/src/adapters/cards.ts:100 toCardSummary`; `apps/api/src/adapters/cards.ts:186 fetchCardCounts`.
- Contract: `packages/contracts/src/cards.ts:80`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:330`; `apps/api/test/card-key-counts-creator.test.ts:1`.
- Current implementation: Lightweight summaries carry title/priority/date/assignee IDs and comment/finalized-image counts, optional key/excerpt.
- Required verification / limits: Run counts after comment tombstone/image failure/delete/trash and off-page rows; verify no full discussion/description payload and bounded SQL at scale.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-03 — Open detail dialog and deep link

Acceptance: Card link loads an authorized popup/drawer or direct-page view with focus restoration and recoverable missing/loading states.

- Mounted: `apps/api/src/http/routes/cards.ts:142 GET cards/:cardId`.
- Adapter: `apps/api/src/adapters/cards.ts:425 getCard`.
- Contract: `packages/contracts/src/cards.ts:100`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:353`; `apps/api/test/card-key-counts-creator.test.ts:1`.
- Current implementation: Authorized detail loads card plus historical people and creator; active resource visibility is checked independently.
- Required verification / limits: Run missing/sibling/zero-grant/removed/trash and response contract; URL opening, focus and recoverable loading are UI responsibilities.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-04 — Edit title and description

Acceptance: Explicit Save validates plain text and expected card version; Cancel/discard never overwrites saved state.

- Mounted: `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`.
- Adapter: `apps/api/src/adapters/cards.ts:527 updateCard`.
- Contract: `packages/contracts/src/cards.ts:40`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:403`.
- Current implementation: Plain text bounds and expectedVersion update fields only, increment card/snapshot versions and append field history.
- Required verification / limits: Run failed update rollback, stale two-writer race, archived/revoked access and receipt replay. Cancel/discard has no separate backend mutation.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-05 — Priority and due date

Acceptance: Five priority values and optional date-only deadline save/reset consistently; invalid calendar dates fail and overdue excludes done cards.

- Mounted: `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`.
- Adapter: `apps/api/src/adapters/cards.ts:527 updateCard`; `apps/api/src/adapters/boards.ts:39 getWorkspaceToday`.
- Contract: `packages/contracts/src/cards.ts:10`; `packages/contracts/src/common.ts:1`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:491`; `apps/api/test/qry01-qry03.test.ts:255`.
- Current implementation: Server accepts five priorities including none, optional real date-only deadlines; overdue queries exclude done category in workspace timezone.
- Required verification / limits: Run clear/reset, leap/year/month dates, date-only timezone/DST boundary and done/reopen semantics. New-card explicit priority rule is a known coordinated contract change.
- Mapped gaps: DOC-02.

### CRD-06 — Assign project teammates

Acceptance: Assign zero/multiple active eligible project users or owner; removed identities stay labeled historical and cannot be newly assigned.

- Mounted: `apps/api/src/http/routes/cards.ts:39 POST boards/:boardId/cards`; `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`.
- Adapter: `apps/api/src/adapters/cards.ts:138 validateAssigneeIds`; `apps/api/src/services/board-assignees.ts:11`.
- Contract: `packages/contracts/src/cards.ts:18`; `packages/contracts/src/cards.ts:40`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:561`; `apps/api/test/b24-assignee-eligibility.test.ts:110`.
- Current implementation: Card validator and picker use Owner or active Manager/Member with this board grant; historical assignees display separately.
- Required verification / limits: Run grant removal/demotion/owner-transfer concurrent with new assignment and max20/duplicates. Import does not reuse this shared rule.
- Mapped gaps: GAP-03.

### CRD-07 — Drag across and within columns

Acceptance: Server validates neighbors and versions, changes rank/history atomically and returns canonical position; failure restores server order.

- Mounted: `apps/api/src/http/routes/cards.ts:240 POST cards/:cardId/move`.
- Adapter: `apps/api/src/adapters/cards.ts:733 moveCard`.
- Contract: `packages/contracts/src/cards.ts:71`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:674`; `apps/api/test/comment-move-replay.test.ts:40`.
- Current implementation: Canonical neighbor checks, dual card/order revisions, bounded recompact, same-transaction move/history/receipt return canonical card.
- Required verification / limits: Run equal/gap exhaustion ranks, nonadjacent/foreign/trashed neighbors, same/foreign column, separate-connection competing moves and rollback after final write.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-08 — Click tap and keyboard Move

Acceptance: Visible Move chooses column plus first/last/before/after via bounded placement read; equivalent outcome without dragging.

- Mounted: `apps/api/src/http/routes/boards.ts:678 GET boards/:boardId/columns/:columnId/placement`; `apps/api/src/http/routes/cards.ts:240 POST cards/:cardId/move`.
- Adapter: `apps/api/src/adapters/boards.ts:935 getPlacement`; `apps/api/src/adapters/cards.ts:733 moveCard`.
- Contract: `packages/contracts/src/boards.ts:125`; `packages/contracts/src/cards.ts:71`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:833`; `apps/api/test/board-access.test.ts:664`.
- Current implementation: Bounded first/last/before/after neighbor read excludes moving card; same move endpoint persists keyboard/click operation.
- Required verification / limits: Run anchor missing/foreign/stale and placement-to-write intervening move; accessibility interaction itself remains UI evidence.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-09 — Filtered movement

Acceptance: Explain disabled ambiguous drag while filters apply; Move uses full destination order rather than renumbering visible cards only.

- Mounted: `apps/api/src/http/routes/boards.ts:678 GET boards/:boardId/columns/:columnId/placement`; `apps/api/src/http/routes/cards.ts:240 POST cards/:cardId/move`.
- Adapter: `apps/api/src/adapters/boards.ts:935 getPlacement`.
- Contract: `packages/contracts/src/boards.ts:125`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:833`.
- Current implementation: Placement derives full destination order rather than the filtered visible subset.
- Required verification / limits: Run hidden-neighbor placement on filtered multi-page column and stale revisions; explanatory drag-disabled UI not evidenced by backend.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-10 — Concurrent edits and move conflicts

Acceptance: Stale field/order version returns 409 without partial side effects; preserve draft and allow deliberate refresh/reapply.

- Mounted: `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`; `apps/api/src/http/routes/cards.ts:240 POST cards/:cardId/move`.
- Adapter: `apps/api/src/adapters/cards.ts:527 updateCard`; `apps/api/src/adapters/cards.ts:733 moveCard`.
- Contract: `packages/contracts/src/cards.ts:40`; `packages/contracts/src/cards.ts:71`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:935`; `apps/api/test/board-concurrency.test.ts:16`.
- Current implementation: Conflicts return 409 with no accepted partial field/order side effects; shared errors classify DB deadlock/serialization as retryable.
- Required verification / limits: Run real simultaneous separate clients and failure injection, not only sequential stale calls; verify UI draft reconciliation separately.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-11 — Save pending errors and unsaved drafts

Acceptance: Save affects fields only; comment/upload actions are independent; retries keep command identity and closing protects unsaved work.

- Mounted: `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`; `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`; `apps/api/src/http/routes/images.ts:79 POST cards/:cardId/image-uploads`.
- Adapter: `apps/api/src/adapters/idempotency.ts:53`; `apps/api/src/adapters/cards.ts:527`.
- Contract: `packages/contracts/src/cards.ts:40`.
- Existing tests, not run: `apps/api/test/crd01-crd11.test.ts:982`; `apps/api/test/crd01-crd11.test.ts:1143`; `apps/api/test/crd01-crd11.test.ts:1247`.
- Current implementation: Independent field/comment/upload commands require stable keys; minimal receipts reauthorize before replay and do not preserve old content.
- Required verification / limits: Run response loss and changed-payload key conflicts for each operation, revoke/trash/replay interleavings. Unsaved draft/close behavior is entirely UI-owned.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### CRD-12 — Move undo

Acceptance: Undo is a new authorized versioned move; it succeeds once or explains conflict without overwriting intervening work.

- Mounted: `apps/api/src/http/routes/cards.ts:315 POST cards/:cardId/move-undo`.
- Adapter: `apps/api/src/http/routes/cards.ts:315 inline versioned undo handler`; `apps/api/src/adapters/cards.ts:733 moveCard`.
- Contract: `packages/contracts/src/cards.ts:71`.
- Existing tests, not run: `apps/api/test/lifecycle-undo.test.ts:155`.
- Current implementation: Undo reconstructs prior movement as a new authorized move with current expected versions and new history.
- Required verification / limits: Run repeat undo, unrelated intervening field/move, deleted/archived destination, revoked actor and same-key response-loss replay; UI conflict explanation separate.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### COM-01 — Comment read and pagination

Acceptance: Project readers see chronological comments with author displays; stable cursors do not expose other project content.

- Mounted: `apps/api/src/http/routes/comments.ts:32 GET cards/:cardId/comments`.
- Adapter: `apps/api/src/adapters/comments.ts:73 listCardComments`.
- Contract: `packages/contracts/src/discussion.ts:67`; `packages/contracts/src/discussion.ts:85`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:427`; `apps/api/test/com-del.test.ts:454`; `apps/api/test/board-access.test.ts:562`.
- Current implementation: Chronological createdAt/ID cursor bound to card, historical author display and tombstone-safe reads under board grant.
- Required verification / limits: Run inserts tied timestamps, malformed/foreign cursor, deleted comments, no-grant card and revocation during multi-query response assembly.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### COM-02 — Post comment

Acceptance: Member/manager/owner posts plain text independently of card Save; atomic event/outbox/receipt and lost-response retry create one comment.

- Mounted: `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`.
- Adapter: `apps/api/src/adapters/comments.ts:277 postComment`.
- Contract: `packages/contracts/src/discussion.ts:41`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:228`; `apps/api/test/com-del.test.ts:276`; `apps/api/test/comment-move-replay.test.ts:40`.
- Current implementation: Comment, mentions, direct inbox rows, activity, outbox and receipt commit together independently of card fields.
- Required verification / limits: Run final-write rollback, duplicate/lost response, post vs move/trash/revoke and comment body bounds; ensure accepted notification intent retained.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### COM-03 — Mention project teammate

Acceptance: Accessible picker resolves active project identities; validated UTF-16 spans produce mentions and literal at-name text does not notify.

- Mounted: `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`.
- Adapter: `apps/api/src/http/routes/projects.ts:1 people picker`; `apps/api/src/adapters/comments.ts:231 validateMentions`.
- Contract: `packages/contracts/src/discussion.ts:9`; `packages/contracts/src/discussion.ts:33`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:343`; `apps/api/test/com-del.test.ts:364`; `apps/api/test/b9-mention-access.test.ts:82`.
- Current implementation: Explicit UTF-16 mention spans validate board readers; literal at-name text has no notification side effect.
- Required verification / limits: Run Unicode surrogate/IME edges, span/body mismatch, duplicate recipient/self, revoked eligible recipient while posting and picker no-email disclosure.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### COM-04 — Edit own comment

Acceptance: Author updates with expected version; edit activity persists and v1 edits do not resend mention notifications.

- Mounted: `apps/api/src/http/routes/comments.ts:171 PATCH comments/:commentId`.
- Adapter: `apps/api/src/adapters/comments.ts:452 editComment`.
- Contract: `packages/contracts/src/discussion.ts:51`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:514`; `apps/api/test/com-del.test.ts:533`; `apps/api/test/b9-mention-access.test.ts:137`.
- Current implementation: Only current author with write access edits expected version; activity persists and v1 edit does not re-notify.
- Required verification / limits: Run author demotion/revocation/trash and response-loss replay; ensure new/removed spans validate and no fresh notifications emitted.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### COM-05 — Delete and moderate comment

Acceptance: Author or owner/manager tombstones a comment, records action and hides body from normal reads; other members cannot moderate.

- Mounted: `apps/api/src/http/routes/comments.ts:284 DELETE comments/:commentId`.
- Adapter: `apps/api/src/adapters/comments.ts:604 deleteComment`.
- Contract: `packages/contracts/src/discussion.ts:62`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:575`; `apps/api/test/com-del.test.ts:602`; `apps/api/test/com-del.test.ts:1143`.
- Current implementation: Author or Manager/Owner tombstones body and removes spans while recording action; other Members denied.
- Required verification / limits: Run moderator demotion concurrent with delete/replay; verify copied original comment snippet in existing notifications follows deleted-body retention policy.
- Mapped gaps: GAP-10.

### COM-06 — Independent comment drafts

Acceptance: Typing, mention selection and post error survive field saves/refetch; no comment posts accidentally through Enter in a picker.

- Mounted: `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`.
- Adapter: `apps/api/src/adapters/comments.ts:277 postComment`.
- Contract: `packages/contracts/src/discussion.ts:41`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:757`; `apps/api/test/com-del.test.ts:1168`.
- Current implementation: Comment endpoint independent from field Save; trashed parent refuses post/replay.
- Required verification / limits: No backend can prove picker Enter handling or preservation of local draft through save/refetch; UI browser verification required.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-01 — Image upload staging

Acceptance: Authorized editor requests bounded upload and sees progress/cancel; private staging cannot attach files across projects.

- Mounted: `apps/api/src/http/routes/images.ts:79 POST cards/:cardId/image-uploads`; `apps/api/src/http/routes/images.ts:157 PUT image-uploads/:uploadId/content`; `apps/api/src/http/routes/images.ts:272 DELETE image-uploads/:uploadId`.
- Adapter: `apps/api/src/adapters/images.ts:127 createImageUpload`; `apps/api/src/adapters/images.ts:224 receiveImageContent`; `apps/api/src/adapters/images.ts:590 cancelImageUpload`.
- Contract: `packages/contracts/src/images.ts:16`; `packages/contracts/src/images.ts:55`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:263`; `apps/api/test/b11-cleanup-cap-people.test.ts:125`.
- Current implementation: Private staged upload binds card/uploader, hash/bytes/type, expiry and max10 including live stages.
- Required verification / limits: Run cross-project/board/upload IDs, staged-cap concurrency, cancellation during byte receipt, revoke/archive/trash and response-loss replay; progress is UI-owned.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-02 — Validate and finalize image

Acceptance: Accept validated PNG/JPEG/WebP bytes with size/dimension/count caps; reject SVG/HTML/spoofed MIME and finalize only after verification.

- Mounted: `apps/api/src/http/routes/images.ts:189 POST image-uploads/:uploadId/finalize`.
- Adapter: `apps/api/src/adapters/images.ts:338 finalizeImageUpload`; `apps/api/src/services/image-validator.ts:268`.
- Contract: `packages/contracts/src/images.ts:8`; `packages/contracts/src/images.ts:16`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:432`.
- Current implementation: Validates hash, size, magic/dimensions and markup rejection for PNG/JPEG/WebP; finalize locks active card/count and only then creates saved image.
- Required verification / limits: Run truncated/corrupt stream beyond valid header, spoof/polyglot, mismatched dimensions/hash, size20MP/8192/10MiB exact edges and concurrent finalizes. Validator checks headers rather than full image decode; clarify required fidelity.
- Mapped gaps: GAP-11.

### ATT-03 — Card image gallery

Acceptance: Finalized images show filename/size/thumbnail and preview; failed or pending upload is not shown as a saved attachment.

- Mounted: `apps/api/src/http/routes/images.ts:301 GET cards/:cardId/images`; `apps/api/src/http/routes/images.ts:360 GET images/:imageId/thumbnail`.
- Adapter: `apps/api/src/adapters/images.ts:650 listCardImages`; `apps/api/src/adapters/images.ts:703 getImageContent`.
- Contract: `packages/contracts/src/images.ts:73`; `packages/contracts/src/images.ts:92`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:679`.
- Current implementation: Gallery lists finalized metadata only; thumbnail endpoint currently serves same bytes as content, not a generated reduced thumbnail.
- Required verification / limits: Run pending/failed/removed filtering and authorized trashed Gallery; browser memory/loading and whether full-byte thumbnail meets performance need are unmeasured.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-04 — Private image delivery

Acceptance: Authenticated proxy checks current project access on every fetch; no public bucket/long-lived URL or project-revocation bypass.

- Mounted: `apps/api/src/http/routes/images.ts:338 GET images/:imageId/content`; `apps/api/src/http/routes/images.ts:360 GET images/:imageId/thumbnail`.
- Adapter: `apps/api/src/http/routes/images.ts:38 getImageForDelivery`; `apps/api/src/adapters/images.ts:703 getImageContent`.
- Contract: `packages/contracts/src/images.ts:73`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:718`; `apps/api/test/board-access.test.ts:1086`; `apps/api/test/b7-image-storage-r2.test.ts:153`.
- Current implementation: Authenticated private proxy rechecks access after storage IO; no-store/nosniff delivery; no-bucket fails503.
- Required verification / limits: Run current grant/Manager demotion after storage read, owner transfer, trashed roles and encoded filename. Live R2 public-access policy/durable storage and signed-in UAT remain unverified.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-05 — Remove attached image

Acceptance: Uploader or owner/manager removes image with confirmation/history; removed images are absent from active card and cleanup is retryable.

- Mounted: `apps/api/src/http/routes/images.ts:382 DELETE images/:imageId`.
- Adapter: `apps/api/src/adapters/images.ts:774 deleteCardImage`; `apps/api/src/adapters/images.ts:878 deleteStorageAfterCommit`.
- Contract: `packages/contracts/src/images.ts:95`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:776`; `apps/api/test/b8-image-delete-after-commit.test.ts:83`.
- Current implementation: Uploader or Manager/Owner with current access removes versioned row/history; durable deletion key commits before byte deletion.
- Required verification / limits: Run upload-owner grant loss, moderator demotion, failed DB commit, postcommit storage failure and replay; no bytes removed on rollback.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-06 — Orphan cleanup and storage limits

Acceptance: Expired uploads/unreferenced objects are cleaned safely; quotas fail visibly without breaking existing saved card fields.

- Mounted: `apps/api/src/runtime/worker.ts:82 scheduled`.
- Adapter: `apps/api/src/adapters/images.ts:897 cleanupOrphanUploads`; `apps/api/src/services/trash-purge.ts:19 processPendingStorageDeletions`.
- Contract: `packages/contracts/src/images.ts:12`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:857`; `apps/api/test/b11-cleanup-cap-people.test.ts:77`.
- Current implementation: Expiry cleanup persists retry keys and fenced storage-deletion lease; max10 caps staged+finalized count; storage binding required.
- Required verification / limits: Run overlapping scheduled jobs, crash/reclaim and failed storage delete; total account/bucket quota and actual deployed schedule/durability not proved.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### ATT-07 — Attachment lifecycle in trash

Acceptance: Trashing card preserves finalized files until restore cutoff; restore recovers them and purge never destroys a successfully restored card's images.

- Mounted: `apps/api/src/http/routes/trash.ts:24 POST cards/:cardId/delete`; `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`; `apps/api/src/runtime/worker.ts:82 scheduled`.
- Adapter: `apps/api/src/adapters/trash.ts:193 deleteCard`; `apps/api/src/adapters/trash.ts:506 restoreCard`; `apps/api/src/services/trash-purge.ts:107 purgeExpiredTrash`.
- Contract: `packages/contracts/src/images.ts:73`; `packages/contracts/src/trash.ts:10`.
- Existing tests, not run: `apps/api/test/att01-att07.test.ts:958`; `apps/api/test/com-del.test.ts:1211`.
- Current implementation: Trash preserves finalized files; restore same card ID restores references; purge writes deletion keys only after still-trashed winner transition.
- Required verification / limits: Run restore vs purge on separate connections, image finalize/delete vs trash, worker crash/storage retry and no resurrection of earlier removed image.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-01 — Card activity timeline

Acceptance: Owner sees create, field change, assignment, move, comment and actor/server timestamp chronologically with stable pagination.

- Mounted: `apps/api/src/http/routes/activity.ts:24 GET cards/:cardId/activity`.
- Adapter: `apps/api/src/adapters/activity.ts:109 listCardActivity`; `apps/api/src/adapters/activity.ts:647 recordActivity`.
- Contract: `packages/contracts/src/discussion.ts:88`; `packages/contracts/src/activity-actions.ts:12`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:166`; `apps/api/test/activity-coverage-b5.test.ts:116`.
- Current implementation: Chronological append-only-to-users card facts with timestamp/actor/source; authorized card timeline uses stable cursor.
- Required verification / limits: Run exact action coverage through mounted routes, actor historical label after removal, tied timestamp pagination, no event on rollback and board-revocation read race.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-02 — Field and movement history

Acceptance: Record safe before/after field values and from/to columns; historical name changes and removed people remain understandable.

- Mounted: `apps/api/src/http/routes/activity.ts:24 GET cards/:cardId/activity`.
- Adapter: `apps/api/src/adapters/cards.ts:643 field changes`; `apps/api/src/adapters/cards.ts:977 moveChanges`; `apps/api/src/adapters/activity.ts:647 recordActivity`.
- Contract: `packages/contracts/src/discussion.ts:88`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:166`.
- Current implementation: Field old/new and assignee added/removed values; moves retain column IDs/title and position; historical people resolved.
- Required verification / limits: Run rename/remove people/column after action and verify meaningful historical display; copied description/history must be scrubbed on purge, including import copies.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-03 — Owner cross-project activity

Acceptance: Owner filters owned workspace activity by project/card/actor/action/date; invited users cannot access sibling-project audit data.

- Mounted: `apps/api/src/http/routes/activity.ts:77 GET workspaces/:workspaceId/activity`.
- Adapter: `apps/api/src/adapters/activity.ts:442 listWorkspaceActivity`.
- Contract: `packages/contracts/src/discussion.ts:88`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:315`; `apps/api/test/activity-coverage-b5.test.ts:378`.
- Current implementation: Owner-only workspace feed supports project/card/actor/action/date filters and stable scoped cursor.
- Required verification / limits: Run ownership transfer during feed, forged sibling filter/card/cursor, unknown events and long dates/actions; no raw token/invitee-email content.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-04 — Manager and member audit scopes

Acceptance: Manager sees project activity/access changes; member/viewer sees card activity only for granted project; workspace security log is owner-only.

- Mounted: `apps/api/src/http/routes/activity.ts:44 GET projects/:projectId/activity`; `apps/api/src/http/routes/activity.ts:24 GET cards/:cardId/activity`.
- Adapter: `apps/api/src/adapters/activity.ts:270 listProjectActivity`; `apps/api/src/adapters/activity.ts:109 listCardActivity`.
- Contract: `packages/contracts/src/discussion.ts:88`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:394`; `apps/api/test/activity-coverage-b5.test.ts:298`; `apps/api/test/board-access-activity-notifications.test.ts:69`.
- Current implementation: Manager project feed includes project facts and granted-board facts; Member/Viewer only card feed on granted board; unknown board scope hidden.
- Required verification / limits: Run manager with zero/one board, revoked board with off-page items, former owner, access-change fact visibility and cursor invalidation.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-05 — Lifecycle import and image events

Acceptance: Trash/restore/purge/import/image events are traceable; no secret token or raw file appears in audit payloads.

- Mounted: `apps/api/src/http/routes/activity.ts:24 GET cards/:cardId/activity`; `apps/api/src/http/routes/activity.ts:44 GET projects/:projectId/activity`.
- Adapter: `apps/api/src/adapters/activity.ts:647 recordActivity`; `apps/api/src/services/trash-purge.ts:236`.
- Contract: `packages/contracts/src/discussion.ts:88`; `packages/contracts/src/activity-actions.ts:12`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:748`; `apps/api/test/activity-coverage-b5.test.ts:244`.
- Current implementation: Image finalize/remove, trash/restore/purge and import source/batch emit auditable facts in owning transaction.
- Required verification / limits: Run every lifecycle action including purge whose normal card timeline becomes unavailable; verify project/owner audit retains minimal action/time without content.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### AUD-06 — Append-only history and redaction

Acceptance: No user edits audit facts; sensitive/deleted bodies are redacted under retention rules while actor/action/time facts persist.

- Mounted: `apps/api/src/http/routes/activity.ts:24 GET cards/:cardId/activity`.
- Adapter: `apps/api/src/adapters/activity.ts:609 redactCardActivity`; `apps/api/src/services/trash-purge.ts:107`.
- Contract: `packages/contracts/src/discussion.ts:88`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:429`; `apps/api/test/b14-purge-redaction.test.ts:37`.
- Current implementation: No user audit edit endpoint; purge clears card/comment/history/notification content while keeping actor/action/time and duplicate marker.
- Required verification / limits: Import row titles/emails and copied comment snippets require complete retention inventory; test normal and errored paths plus backups policy separately.
- Mapped gaps: GAP-04, GAP-10.

### DEL-01 — Delete card with 24-hour recovery

Acceptance: Owner/manager confirms Delete, moves card to trash with server deletedAt/restoreUntil and immediately excludes it from active counts/search.

- Mounted: `apps/api/src/http/routes/trash.ts:24 POST cards/:cardId/delete`.
- Adapter: `apps/api/src/adapters/trash.ts:193 deleteCard`.
- Contract: `packages/contracts/src/trash.ts:4`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:656`; `apps/api/test/com-del.test.ts:695`.
- Current implementation: Manager/Owner versioned delete stores server timestamp plus24h, anchors and actor; state excluded from active reads/counts.
- Required verification / limits: Run single-winner delete, stale retry, current permission, archive, immediate search/count exclusion and no deadline extension on replay.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-02 — Project trash list

Acceptance: Owner/manager lists trashed cards with actor/deadline and restore action; member/viewer cannot browse trash.

- Mounted: `apps/api/src/http/routes/trash.ts:117 GET projects/:projectId/trash`.
- Adapter: `apps/api/src/adapters/trash.ts:321 listProjectTrash`.
- Contract: `packages/contracts/src/trash.ts:26`; `packages/contracts/src/trash.ts:45`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:776`; `apps/api/test/com-del.test.ts:793`; `apps/api/test/board-access.test.ts:716`.
- Current implementation: Bounded Manager/Owner trash list filters by current board access and carries deadline/canRestore/blockedReason.
- Required verification / limits: Run hidden off-page boards, manager demotion while assembling, cursor/timestamp ties, expired/purged handling and private not-found consistency.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-03 — Restore before deadline

Acceptance: Owner/manager restores same ID/content/comments/finalized images strictly before server cutoff; no-op repeats do not extend deadline.

- Mounted: `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`.
- Adapter: `apps/api/src/adapters/trash.ts:506 restoreCard`.
- Contract: `packages/contracts/src/trash.ts:10`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:850`; `apps/api/test/com-del.test.ts:863`; `apps/api/test/att01-att07.test.ts:958`.
- Current implementation: Versioned authorized restore before cutoff keeps ID/content/comment/image references and clears trash fields.
- Required verification / limits: Run restore duplicate/lost response, version races, cutoff -1ms/0/+1ms under controlled server time and no previously deleted comments/images restored.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-04 — Restore destination conflict

Acceptance: Original valid column/nearest surviving position is default; absent/read-only destination requires explicit authorized active target or reopening board.

- Mounted: `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`.
- Adapter: `apps/api/src/adapters/trash.ts:506 restoreCard`.
- Contract: `packages/contracts/src/trash.ts:10`; `packages/contracts/src/trash.ts:58`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:908`.
- Current implementation: Original column/nearest surviving anchor defaults; explicit same-board authorized destination required if missing; archived parent/board requires reopen.
- Required verification / limits: Run neighbors both/one gone, equal ranks, cross-board supplied target, missing imported default constraints and concurrent reorder/archive; no silent move to hidden board.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-05 — Expired restore denial

Acceptance: At or after deletedAt plus exactly 24 hours restore returns stable expired response even if cleanup has not run.

- Mounted: `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`.
- Adapter: `apps/api/src/adapters/trash.ts:578 cutoff comparison`.
- Contract: `packages/contracts/src/trash.ts:52`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:1010`; `apps/api/test/ux-integration.test.ts:351`.
- Current implementation: Authorized restore at/after server restoreUntil returns410 even before cleanup.
- Required verification / limits: Existing UX test uses a card expired one hour ago; must add/control exact millisecond equality and transaction-wait crossing cutoff. No real deadline test executed here.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-06 — Purge and restore races

Acceptance: Conditional state/version and job fencing allow one winner; cleanup cannot purge restored data or files.

- Mounted: `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`; `apps/api/src/runtime/worker.ts:82 scheduled`.
- Adapter: `apps/api/src/adapters/trash.ts:506 restoreCard`; `apps/api/src/services/trash-purge.ts:107 purgeExpiredTrash`.
- Contract: `packages/contracts/src/trash.ts:10`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:1211`; `apps/api/test/att01-att07.test.ts:958`.
- Current implementation: Row-locked still-trashed selection and conditional transition make restore/purge one winner; storage deletes staged durably after transition.
- Required verification / limits: Run deterministic two independent connections, both lock winners, cutoff, multiple workers, worker crash after claim/commit and failed object delete; sequential calls alone insufficient.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### DEL-07 — Content purge and audit retention

Acceptance: After cutoff remove recoverable content/files via retryable cleanup; retain minimal audit/duplicate tombstones with no deleted body.

- Mounted: `apps/api/src/runtime/worker.ts:82 scheduled`.
- Adapter: `apps/api/src/services/trash-purge.ts:107 purgeExpiredTrash`; `apps/api/src/adapters/idempotency.ts:16 minimalReceiptOutcome`.
- Contract: `packages/contracts/src/trash.ts:26`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:1211`; `apps/api/test/b14-purge-redaction.test.ts:37`.
- Current implementation: Card text/comment bodies/history/notification titles and images scrubbed; content-free receipts and import duplicate markers retained.
- Required verification / limits: Purged imported card still has title/assignee-email copies in card_import_rows; cleanup/retention must minimize those while retaining duplicate markers and minimal provenance.
- Mapped gaps: GAP-04.

### DEL-08 — Deleted card interaction guards

Acceptance: Trashed/expired cards reject edits/moves/comments/new uploads; UI explains disappearance while retaining safe unsent drafts.

- Mounted: `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`; `apps/api/src/http/routes/cards.ts:240 POST cards/:cardId/move`; `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`; `apps/api/src/http/routes/images.ts:79 POST cards/:cardId/image-uploads`.
- Adapter: `apps/api/src/adapters/cards.ts:527 updateCard`; `apps/api/src/adapters/comments.ts:277 postComment`; `apps/api/src/adapters/images.ts:127 createImageUpload`.
- Contract: `packages/contracts/src/cards.ts:40`; `packages/contracts/src/discussion.ts:41`; `packages/contracts/src/images.ts:16`.
- Existing tests, not run: `apps/api/test/com-del.test.ts:743`; `apps/api/test/com-del.test.ts:750`; `apps/api/test/com-del.test.ts:757`; `apps/api/test/crd01-crd11.test.ts:1247`.
- Current implementation: Trashed/expired cards hidden from normal readers and refuse ordinary mutations; lifecycle checks run before replay where implemented.
- Required verification / limits: Run every child operation edit/delete/finalize/content/cancel plus stale receipts after trash/purge and revoked access; UI draft preservation/disappearance explanations separate.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### IMP-01 — Download Excel template

Acceptance: Versioned seven-column Cards template plus Instructions downloads without example rows in the import sheet.

- Mounted: `apps/api/src/http/routes/imports.ts:76 GET import/template`; `apps/api/src/http/routes/imports.ts:77 GET boards/:boardId/card-import-template`.
- Adapter: `apps/api/src/adapters/imports.ts:34 getImportTemplatePath`.
- Contract: `packages/contracts/src/imports.ts:73`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:445`.
- Current implementation: Authenticated download serves seven-column workbook from filesystem path; board-specific variants authorize board first.
- Required verification / limits: Actual template blank-sheet behavior and deployed Worker filesystem/package availability need explicit tests; no template asset bundling is evident in wrangler.jsonc.
- Mapped gaps: GAP-12, DOC-02.

### IMP-02 — Choose authorized import target

Acceptance: Owner/manager chooses one project/board and default column; upload cannot create projects/users/grants or override destination.

- Mounted: `apps/api/src/http/routes/imports.ts:141 POST boards/:boardId/imports`.
- Adapter: `apps/api/src/adapters/imports.ts:170 assertImportAccessBeforeParse`; `apps/api/src/adapters/imports.ts:216 createCardImport`.
- Contract: `packages/contracts/src/imports.ts:95`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:478`; `apps/api/test/b7-xlsx-budget.test.ts:201`.
- Current implementation: Owner/Manager choose target board/default column; authority checked before parser; cannot create projects/users/grants from data.
- Required verification / limits: Run hidden-board Manager, parent archive/revoke between preparse/commit, foreign default/status target and file body abuse. Commit currently allows defaultColumnId override beyond digest binding.
- Mapped gaps: GAP-05.

### IMP-03 — Bounded literal workbook parsing

Acceptance: Accept supported XLSX only, enforce compressed/expanded/cell/row limits and reject formulas/macros/external package links without evaluating them.

- Mounted: `apps/api/src/http/routes/imports.ts:141 POST boards/:boardId/imports`.
- Adapter: `apps/api/src/services/excel-parser.ts:49 unzipXlsx`; `apps/api/src/services/excel-parser.ts:325 parseExcelWorkbook`.
- Contract: `packages/contracts/src/imports.ts:35`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:568`; `apps/api/test/b7-xlsx-budget.test.ts:87`.
- Current implementation: 5MiB compressed/20MiB inflated/200 rows/100 entries; reject formulas, macro executable parts, external/embedded and XXE markers without evaluation.
- Required verification / limits: No explicit parser CPU/cell-count time budget or date-style parser; regex XML/package validation needs adversarial malformed/namespaced/sheet-dup/relationship cases and real Worker memory/CPU measurement.
- Mapped gaps: GAP-06.

### IMP-04 — Map and validate template fields

Acceptance: Exact seven headers map shared card validators; status/date/email errors name row/field and no invalid value is silently guessed.

- Mounted: `apps/api/src/http/routes/imports.ts:141 POST boards/:boardId/imports`.
- Adapter: `apps/api/src/adapters/imports.ts:216 createCardImport`; `apps/api/src/services/excel-parser.ts:564 row mapping`.
- Contract: `packages/contracts/src/imports.ts:42`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:674`.
- Current implementation: Seven supported headers validate normalized fields/status/email/date, row errors explicit; required-only headers permitted by IMPORT_SPEC.
- Required verification / limits: Nonempty Description is parsed/hashed then dropped from stored preview and inserted cards; numeric dates need actual styles; explicit priority coordination outstanding.
- Mapped gaps: GAP-01, GAP-06, DOC-02.

### IMP-05 — Preview new existing and conflict rows

Acceptance: Preview counts new/already-imported/conflicting/invalid rows, displays mapping and writes no cards; user corrects errors before confirming.

- Mounted: `apps/api/src/http/routes/imports.ts:171 GET imports/:importId`; `apps/api/src/http/routes/imports.ts:200 POST imports/:importId/mappings`.
- Adapter: `apps/api/src/adapters/imports.ts:552 getCardImportStatus`; `apps/api/src/adapters/imports.ts:727 updateImportMappings`.
- Contract: `packages/contracts/src/imports.ts:42`; `packages/contracts/src/imports.ts:73`; `packages/contracts/src/imports.ts:102`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:837`.
- Current implementation: Preview persists rows/counts without cards; mapping changes only to same-board columns and returns version/digest.
- Required verification / limits: Mapped digest uses row ID placeholder and empty assignees instead of normalized payload; mapping mutates original status, affecting original-row retry identity; inspect cancelled/expired content cleanup.
- Mapped gaps: GAP-05, GAP-04.

### IMP-06 — Explicit atomic confirmation

Acceptance: Bind preview to actor/target/digest/expiry; revalidate grant/columns/assignees and create all new rows in one bounded transaction or none.

- Mounted: `apps/api/src/http/routes/imports.ts:291 POST imports/:importId/commit`.
- Adapter: `apps/api/src/adapters/imports.ts:850 commitCardImport`.
- Contract: `packages/contracts/src/imports.ts:95`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:930`; `apps/api/test/imp01-imp06.test.ts:1148`; `apps/api/test/lock-order-interleave.test.ts:19`.
- Current implementation: Single transaction rechecks actor write grant, archived state, import version/digest/expiry, current columns and project assignee roles before all cards/events.
- Required verification / limits: Does not recheck duplicate markers or board-granted assignees; default target override not digest-bound, no stored structure revision/creator binding; description lost. Add last-row failure injection.
- Mapped gaps: GAP-01, GAP-02, GAP-03, GAP-05.

### IMP-07 — External ID and retry deduplication

Acceptance: Board-scoped text External ID preserves zeros; duplicate upload/race creates once, changed ID payload conflicts and deleted imports never resurrect silently.

- Mounted: `apps/api/src/http/routes/imports.ts:141 POST boards/:boardId/imports`; `apps/api/src/http/routes/imports.ts:291 POST imports/:importId/commit`.
- Adapter: `apps/api/src/adapters/imports.ts:298 preview duplicate lookup`; `apps/api/src/adapters/imports.ts:1086 card insert`; `apps/api/src/adapters/imports.ts:1135 marker insert`.
- Contract: `packages/contracts/src/imports.ts:24`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:1060`; `database/migrations/0001_initial.sql:248`.
- Current implementation: Board-scoped text External ID markers preserve leading zero and survive trash/purge; preview compares normalized original hash.
- Required verification / limits: Two ready previews can both insert cards because marker conflict ignored after card insert; description/hash and mapped status differ from original payload. Separate-connection regression mandatory.
- Mapped gaps: GAP-01, GAP-02, GAP-05.

### IMP-08 — Date and multi-assignee conversion

Acceptance: Real 1900/1904 Excel dates or strict ISO map to date-only values; semicolon emails resolve active eligible project users only.

- Mounted: `apps/api/src/http/routes/imports.ts:141 POST boards/:boardId/imports`; `apps/api/src/http/routes/imports.ts:291 POST imports/:importId/commit`.
- Adapter: `apps/api/src/services/excel-parser.ts:586`; `apps/api/src/services/excel-parser.ts:691`; `apps/api/src/adapters/imports.ts:280`; `apps/api/src/adapters/imports.ts:997`.
- Contract: `packages/contracts/src/imports.ts:42`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:674`; `apps/api/test/imp01-imp06.test.ts:1192`.
- Current implementation: 1900/1904 serial conversion plus strict ISO; semicolon emails map active project editors/Owner.
- Required verification / limits: Any numeric cell treated as date without date style; assignee queries omit board grants and target-grant locking, contrary shared B24 rule.
- Mapped gaps: GAP-03, GAP-06.

### IMP-09 — Results and safe error download

Acceptance: Result links created cards and row outcomes; safe report cannot execute spreadsheet formulas or leak another project's data.

- Mounted: `apps/api/src/http/routes/imports.ts:350 GET imports/:importId/report`.
- Adapter: `apps/api/src/adapters/imports.ts:1254 getImportReport`.
- Contract: `packages/contracts/src/imports.ts:42`; `packages/contracts/src/imports.ts:73`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:1133`.
- Current implementation: Current Manager/Owner board access required; bounded report uses CSV formula escaping and card IDs/outcomes.
- Required verification / limits: Run formula-leading whitespace/tab/CR/Unicode prefixes, quoted delimiters/newlines, hidden-board/grant-loss read, stale row metadata after purge; UI link flow separate.
- Mapped gaps: GAP-04.

### IMP-10 — Cancel expire and clean preview

Acceptance: Cancel before commit/expiry cleans temporary content; once transaction begins show actual final result rather than promise cancellation.

- Mounted: `apps/api/src/http/routes/imports.ts:317 DELETE imports/:importId`; `apps/api/src/http/routes/imports.ts:171 GET imports/:importId`.
- Adapter: `apps/api/src/adapters/imports.ts:1211 cancelCardImport`; `apps/api/src/adapters/imports.ts:552 getCardImportStatus`.
- Contract: `packages/contracts/src/imports.ts:10`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:837`.
- Current implementation: Cancel allowed before committing; expiry30min checked on status/commit; committed result cannot be cancelled.
- Required verification / limits: Cancel/expiry only change state and no scheduler removes preview rows; test cleanup within hour, overlapping cancel/commit and exact expiry. Raw workbook not persisted, but personal preview rows are.
- Mapped gaps: GAP-04.

### IMP-11 — Import provenance and activity

Acceptance: Import receipt links actor/batch/rows/created cards, while each card behaves like a normal card with a creation activity event.

- Mounted: `apps/api/src/http/routes/imports.ts:291 POST imports/:importId/commit`.
- Adapter: `apps/api/src/adapters/imports.ts:1152 per-card activity`; `apps/api/src/adapters/imports.ts:1172 batch activity`.
- Contract: `packages/contracts/src/discussion.ts:88`; `packages/contracts/src/imports.ts:73`.
- Existing tests, not run: `apps/api/test/imp01-imp06.test.ts:1237`.
- Current implementation: Created cards get normal card_created source/import ID/external ID/rowNumber and batch card_import_committed fact.
- Required verification / limits: Verify normal card semantics including human key and creator attribution, no descriptions/email/body copies in retained audit, and retention removes preview content without erasing minimal provenance.
- Mapped gaps: GAP-04.

### NTF-01 — Durable in-app mention inbox

Acceptance: One event/recipient notification appears after commit; no self-mention or duplicate logical delivery and no stale private preview leak.

- Mounted: `apps/api/src/http/routes/comments.ts:67 POST cards/:cardId/comments`; `apps/api/src/http/routes/notifications.ts:24 GET notifications`.
- Adapter: `apps/api/src/adapters/comments.ts:376 direct notifications`; `apps/api/src/adapters/notifications.ts:245 processOutboxLease`.
- Contract: `packages/contracts/src/discussion.ts:114`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:471`; `apps/api/test/b9-mention-access.test.ts:124`.
- Current implementation: Normal comment transaction inserts one notification per unique nonself recipient plus durable outbox intent; inbox applies current project/board access.
- Required verification / limits: Recovery consumer deduplicates by card link rather than comment/event ID; direct insertion is counterevidence to ordinary lost-notification claim. Test two distinct recovered events same card plus concurrent consumers and normal/direct overlap.
- Mapped gaps: GAP-07.

### NTF-02 — Inbox read state and deep link

Acceptance: Actor opens accessible project/card and marks read; removed-access notifications are redacted/hidden and never reveal content.

- Mounted: `apps/api/src/http/routes/notifications.ts:24 GET notifications`; `apps/api/src/http/routes/notifications.ts:44 PATCH notifications/:id/read`; `apps/api/src/http/routes/notifications.ts:60 POST notifications/mark-all-read`.
- Adapter: `apps/api/src/adapters/notifications.ts:107 listNotifications`; `apps/api/src/adapters/notifications.ts:151 markNotificationRead`; `apps/api/src/adapters/notifications.ts:195 markAllNotificationsRead`.
- Contract: `packages/contracts/src/discussion.ts:114`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:542`; `apps/api/test/board-access-activity-notifications.test.ts:86`.
- Current implementation: Scoped inbox cursor and current-access SQL; read markers hold board grant and recheck visibility; old hidden notifications disappear.
- Required verification / limits: Run cursor revocation, owner-transfer/demotion, trashed card snippets, actual deep link route and list-read race; list transaction alone has no explicit grant lock in current source.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### NTF-03 — Outbox retry and failed-work recovery

Acceptance: Lease/fenced consumer retries bounded jobs and quarantines failures; restart/duplicate handling does not lose accepted notification intent.

- Mounted: `apps/api/src/runtime/worker.ts:82 scheduled`.
- Adapter: `apps/api/src/adapters/notifications.ts:245 processOutboxLease`.
- Contract: `packages/contracts/src/discussion.ts:110`.
- Existing tests, not run: `apps/api/test/aud-ntf.test.ts:638`; `apps/api/test/b11-cleanup-cap-people.test.ts:115`.
- Current implementation: Bounded SKIP LOCKED DB transaction processes pending/processing rows, backoff/max retries quarantine; Worker scheduled entry invokes processor.
- Required verification / limits: Despite name, processor holds transaction locks rather than persisting expiring lease/fencing token. Test crash/restart, overlap, poison SQL abort, partial recipient recovery, admin retry and Node deployment runner; Node entry has no scheduler.
- Mapped gaps: GAP-07.

### QRY-01 — Project-scoped search

Acceptance: Title search returns authorized active cards only with pagination and safe historical people mapping.

- Mounted: `apps/api/src/http/routes/cards.ts:447 GET projects/:projectId/cards/search`.
- Adapter: `apps/api/src/adapters/cards.ts:1009 searchProjectCards`.
- Contract: `packages/contracts/src/cards.ts:136`.
- Existing tests, not run: `apps/api/test/qry01-qry03.test.ts:205`; `apps/api/test/board-access.test.ts:778`.
- Current implementation: Project-scoped title/description search returns active cards only from currently granted boards; actor/filter/access-revision scoped pagination/counts.
- Required verification / limits: Run hidden off-page board, removal, wildcard/Unicode queries and historical identities; search-vs-revoke lock and representative explain plans.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### QRY-02 — Assignee priority date column filters

Acceptance: Filters combine predictably, distinguish total/matching counts and exclude trash; no global project discovery through query parameters.

- Mounted: `apps/api/src/http/routes/boards.ts:207 GET boards/:boardId`; `apps/api/src/http/routes/boards.ts:711 GET boards/:boardId/cards`; `apps/api/src/http/routes/cards.ts:447 GET projects/:projectId/cards/search`.
- Adapter: `apps/api/src/adapters/boards.ts:1050 buildCardFilterClauses`; `apps/api/src/adapters/cards.ts:1009 searchProjectCards`.
- Contract: `packages/contracts/src/boards.ts:170`; `packages/contracts/src/cards.ts:136`.
- Existing tests, not run: `apps/api/test/qry01-qry03.test.ts:255`.
- Current implementation: Assignee/priority/due/column query facets combine and produce total/matching counts beyond page; active only; date uses workspace today.
- Required verification / limits: Run all facet combinations, no matches vs empty, done overdue, unknown filter IDs, revoked assignee/historical mapping and cursor rebind after filter/date change.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### QRY-03 — My assigned tasks

Acceptance: Show actor's assignments across only accessible projects, grouped by project and due state; removed access disappears on next request.

- Mounted: `apps/api/src/http/routes/cards.ts:474 GET me/tasks`; `apps/api/src/http/routes/cards.ts:503 GET workspaces/:workspaceId/my-tasks`.
- Adapter: `apps/api/src/adapters/cards.ts:1215 getMyTasks`.
- Contract: `packages/contracts/src/cards.ts:80`.
- Existing tests, not run: `apps/api/test/qry01-qry03.test.ts:318`; `apps/api/test/board-access.test.ts:908`.
- Current implementation: Current API requires projectId and filters assignee to authorized active cards/boards; bounded100 rows sorted due date.
- Required verification / limits: TSV cross-project grouped wording conflicts with newer within-project aggregate rule; do not add cross-project endpoint blindly. No cursor/completeness for more than100 tasks.
- Mapped gaps: DOC-03.

### UX-01 — Empty loading failed and forbidden states

Acceptance: First project/empty board/no matches/loading/offline/validation/permission errors have accurate actions and preserve relevant drafts.

- Mounted: `apps/api/src/http/routes/boards.ts:207 GET boards/:boardId`; `apps/api/src/http/routes/cards.ts:142 GET cards/:cardId`.
- Adapter: `apps/api/src/http/errors.ts:1`; `apps/api/src/http/middleware/error-handler.ts:1`.
- Contract: `packages/contracts/src/common.ts:1`.
- Existing tests, not run: `apps/api/test/ux-integration.test.ts:174`.
- Current implementation: Backend empty data, validation/permission/conflict errors are structured with request IDs and no-store.
- Required verification / limits: API tests establish payload/error behavior only; browser offline/retry/recovery actions and safe drafts need separate UI tests.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### UX-02 — Accessible movement and dialog

Acceptance: Keyboard and click/tap complete all essential operations; focus, announcements, labels and color-independent cues are verified in browser.

- Mounted: `apps/api/src/http/routes/boards.ts:678 GET boards/:boardId/columns/:columnId/placement`; `apps/api/src/http/routes/cards.ts:142 GET cards/:cardId`.
- Adapter: `apps/api/src/adapters/boards.ts:935 getPlacement`.
- Contract: `packages/contracts/src/boards.ts:125`; `packages/contracts/src/cards.ts:100`.
- Existing tests, not run: `apps/api/test/ux-integration.test.ts:251`.
- Current implementation: Backend supports placement and detail payload needed for click/keyboard workflow.
- Required verification / limits: No backend test proves focus trapping/restoration, labels, announcements or keyboard completion; browser acceptance remains open.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### UX-03 — Narrow viewport and long content

Acceptance: Board scroll and detail layout work at narrow width/zoom; long titles, many assignees and image/comment lists remain usable.

- Mounted: `apps/api/src/http/routes/cards.ts:142 GET cards/:cardId`; `apps/api/src/http/routes/comments.ts:32 GET cards/:cardId/comments`; `apps/api/src/http/routes/images.ts:301 GET cards/:cardId/images`.
- Adapter: `apps/api/src/adapters/cards.ts:425 getCard`; `apps/api/src/adapters/comments.ts:73 listCardComments`.
- Contract: `packages/contracts/src/cards.ts:100`; `packages/contracts/src/discussion.ts:85`.
- Existing tests, not run: `apps/api/test/ux-integration.test.ts:287`.
- Current implementation: Bounded text/assignees/list payloads support long content rendering.
- Required verification / limits: Narrow viewport, zoom, scroll/actions, huge comments/images and accessibility require browser measurements; payload bounds alone do not establish usable UI.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### UX-04 — Refresh reconnect and safe polling

Acceptance: Pause hidden-tab polling, refresh on focus and reconcile versions; no optimistic duplicate/older response overwrites newer data.

- Mounted: `apps/api/src/http/routes/boards.ts:207 GET boards/:boardId`; `apps/api/src/http/routes/cards.ts:165 PATCH cards/:cardId`.
- Adapter: `apps/api/src/adapters/boards.ts:1111 getBoardSnapshot`; `apps/api/src/adapters/cards.ts:527 updateCard`.
- Contract: `packages/contracts/src/boards.ts:188`; `packages/contracts/src/cards.ts:40`.
- Existing tests, not run: `apps/api/test/ux-integration.test.ts:323`.
- Current implementation: Snapshot/card versions and conflict responses support reconciliation; private responses no-store.
- Required verification / limits: Hidden-tab pause/focus refresh, out-of-order response discard, unsaved-assignee bug and duplicate optimism are UI/network-timing responsibilities; no claim from source alone.
- Mapped gaps: No definite missing behavior identified in this bounded source scan; execution and fresh review remain required..

### UX-05 — Performance and full workflow acceptance

Acceptance: Representative Worker/Node warm/cold benchmarks, project isolation, exact restore boundary and repeated import pass documented gates.

- Mounted: `apps/api/src/runtime/node.ts:1`; `apps/api/src/runtime/worker.ts:1`; `apps/api/src/http/routes/imports.ts:291 POST imports/:importId/commit`; `apps/api/src/http/routes/trash.ts:156 POST cards/:cardId/restore`.
- Adapter: `apps/api/src/http/app.ts:63 createApp`; `apps/api/src/adapters/boards.ts:1111 getBoardSnapshot`.
- Contract: `packages/contracts/src/index.ts:1`.
- Existing tests, not run: `apps/api/test/ux-integration.test.ts:351`; `apps/api/test/worker.test.ts:1`; `apps/api/test/node.test.ts:1`.
- Current implementation: Backend has local workflow integration tests, one warm in-process snapshot latency assertion and separate runtime harnesses.
- Required verification / limits: Single <100ms synthetic snapshot is not representative Worker/Node warm/cold p95/p99/load benchmark; repeated import has material gaps, exact cutoff tests and full signed-in workflow still required.
- Mapped gaps: GAP-01, GAP-02, GAP-04.

## Meaningful commands — not executed

Use pinned Node24 and repository test DB guard; all databases must be isolated local disposable synthetic fixtures. Never run broad TRUNCATE-based suites against UAT or a shared database. Direct Node test commands bypass the package precheck, so run its database guard first and inspect every skipped suite.

- `npm run typecheck` — Shared TypeScript/API/MCP typecheck; web requires separate workspace command.
- `npm run build` — API TypeScript and Worker dry-run build, no deploy; inspect bundle includes template.
- `npm run test --workspace @flowboard/contracts` — Shared schemas and OpenAPI contract suites.
- `npm run test --workspace @flowboard/api` — All API suites; precheck test database isolation; supply only disposable local DB configurations and fail on unplanned skips.
- `cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/brd01-brd07.test.ts test/crd01-crd11.test.ts test/com-del.test.ts test/att01-att07.test.ts test/imp01-imp06.test.ts test/aud-ntf.test.ts test/lifecycle-undo.test.ts test/qry01-qry03.test.ts test/ux-integration.test.ts` — Focused mounted lifecycle acceptance; same safe disposable fixtures as API harness.
- `cd apps/api && NODE_ENV=test WRANGLER_SEND_METRICS=false node --test-concurrency=1 --test test/board-access.test.ts test/board-access-activity-notifications.test.ts test/board-access-boards-imports-trash.test.ts test/board-access-cards-images.test.ts test/board-concurrency.test.ts test/lock-order-interleave.test.ts test/comment-move-replay.test.ts` — Explicit FLOWBOARD_ACCESS_TEST_DATABASE_URL to separate disposable local PostgreSQL; forced concurrency and current board access (many skip without it). Run database guard first when invoking directly.
- `python3 scripts/check_backend_review.py <independent-record.json> --feature <ID>` — Only after fresh reviewer verifies exact immutable manifest/test logs. No fabricated score or pass.

## Dependency-ordered repair / acceptance work

1. Reconcile frozen criteria/current decisions (DOC01-05); inventory all copies/receipts and agree minimal import result/retention contract. Architect owns contracts.
2. Persist normalized original import row including description/hash, original status plus separate mapping; bind target/configuration/expiry and define actor ownership (GAP01/05). Upgrade migration and embedded migration parity required.
3. At confirm, lock canonical actor/target grants and board state in global lock order; revalidate assignees and reserve/recheck external IDs before card writes (GAP02/03); add late failure rollback tests.
4. Add bounded terminal import-content cleanup and purge-linked redaction while preserving minimal result/duplicate tombstones; stable comment-event identity allows snippet redaction and recipient dedupe (GAP04/07/10). Verify old-format rows upgrade safely.
5. Correct XLSX date-cell/style semantics and parser bounds; prove actual Worker template and import runtime budgets (GAP06/12), resolve image decoding fidelity based on acceptance (GAP11).
6. Test expired/purged/default-column FK deletion and archive/reopen concurrency contract (GAP08/09), then run focused+full suites and representative Node/Worker measurements.
7. Freeze complete reachable manifest, fresh independent reviewer and passing gate; bind Backend handoffs, regenerate checklist via owning Architect, then UI/browser/integrated UAT. No deployment executed or authorized by this report itself.

Next / your input: parent Architect can freeze criteria and dispatch bounded repairs using these findings. No action needed from the user for this discovery. A fresh independent reviewer, exact full source manifest, strictly >8.5 score with category minimums/no blockers and passing mandatory tests are required before any feature closes; no handoff was changed here.

## Proposed repair acceptance criteria — parent must freeze before coding

These criteria supplement the69 per-ID acceptance/verification rows, do not replace them or authorize new source scope. Every item is **not executed**. Priority frontend requirement is separate; preserve API/MCP default-none compatibility until a coordinated requirement change. Notifications and members are owned by the identity stream; import repairs must not edit them concurrently.

- **LC-01** (IMP-04, IMP-06, IMP-07): Nonempty description survives actual XLSX upload/preview/confirm/card read byte-for-byte under documented normalization; same ORIGINAL payload skips after later card edit, changed original description conflicts.
- **LC-02** (IMP-06, IMP-07): Prepare two ready previews before confirming either; commit same External ID on separate PostgreSQL connections. Exactly one logical card and marker exist, no partial batch when a changed payload loses; repeat after trash and purge never resurrects.
- **LC-03** (CRD-06, IMP-06, IMP-08): Card and XLSX assignee validators agree for Owner/Manager/Member/Viewer with and without board grants. Deterministically race target grant removal/demotion against commit on separate connections; no assignment commits after preceding revocation wins.
- **LC-04** (IMP-05, IMP-06): Normalize/persist original payload separately from mappings. Confirm uses intended preview configuration, expiry, current authorized actor policy and digest. Changed target/default/columns or assignee eligibility fails stale or requires an explicitly revalidated preview; no placeholder hashes counted as binding.
- **LC-05** (IMP-10, IMP-09, IMP-11, DEL-07, AUD-06): Bounded scheduled cleanup removes personal temporary preview content after cancellation/expiry/completion/failure within documented hour; purge removes card-content copies from import rows/reports as policy requires. Lost job/retry/overlap does not remove active preview or minimal duplicate/provenance identity.
- **LC-06** (IMP-03, IMP-08): Actual XLSX date-style cells honor1900/1904; generic numeric cell is not guessed as date. ISO, leap/day60/range/timezone cases agree. Compressed/expanded/rows/cells/parser CPU-memory limits fail safely in actual Node and isolated Worker without evaluation.
- **LC-07** (NTF-01, NTF-03): Two different comment events on the same card each retain one recipient delivery; same event retries/overlapping recovery do not duplicate. Include direct transactional creation counterevidence and injected missing-delivery recovery; crash/restart/poison SQL and retry quarantine retain accepted intent.
- **LC-08** (COM-05, AUD-06, NTF-02): Document deleted-comment notification-snippet retention explicitly; enforce that policy across own/moderated delete, normal inbox, recovery and eventual purge without hiding minimal event/actor/time facts.
- **LC-09** (BRD-06, DEL-04): Delete column with active/restorable card refuses. Expired/purged/default-import references follow explicit safe policy and stable client error, no raw FK500, silent card deletion or weakened tenant ancestry.
- **LC-10** (BRD-08): Archive/reopen current Owner/Manager board-grant policy, archived-parent guard, write exclusion and trash deadline continuity pass. Clarify schema expectedVersion versus inline route behavior; do not invent new mandatory version semantics without coordinated contract decision.
- **LC-11** (ATT-01, ATT-02, ATT-04, ATT-05, ATT-06, ATT-07, DEL-05, DEL-06): Private image boundary holds after actual storage IO/revocation/demotion; invalid decodability acceptance is explicit. At restore cutoff-1ms/0/+1ms one authorized restore/purge winner preserves/restores or removes finalized bytes appropriately, with durable cleanup retry and failed-commit preservation.
- **LC-12** (IMP-01, UX-05): Isolated Worker downloads real supplied workbook bytes; Cards blank seven-column sheet creates zero tasks and copied synthetic Instructions examples create valid tasks. Representative Node/Worker warm/cold dataset and query/runtime/memory logs replace single in-process latency assertion; browser acceptance separately verifies UX IDs.
