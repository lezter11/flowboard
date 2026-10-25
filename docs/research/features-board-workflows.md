# Board workflow feature specification

Research date: 26 October 2026. Status: product-research proposal for Architect review. This document describes requested behavior and implementable acceptance criteria; it does not claim that the feature or backend exists.

## Authority and scope

The current task-specific user request is authoritative for this report. It confirms multiple projects per owner, project-only invited access, a full owner activity log, configurable ordered columns, movable cards, a card detail popup, a 24-hour delete recovery period, and populated-card import from Excel. Existing [PRD](../../PRD.md), [API](../API.md), [architecture](../../ARCHITECTURE.md), and [design direction](../../DESIGN.md) are useful context, but some of their proposed defaults conflict with this scope. This report identifies those changes rather than silently treating the older defaults as accepted.

No deployment, application UI, database, provider, file storage, or notification integration has been inspected or validated. All flows below are proposed requirements for design and API review. The acceptance statements are future verification criteria.

### Confirmed task scope

- An owner can create and own multiple projects. People invited into a project can access only that project and its descendants. They do not gain access to sibling projects or workspace-wide resources by virtue of invitation.
- The owner can inspect a complete, chronological activity log for their owned projects, including actor and object identity and enough before/after detail to explain important changes.
- A board has custom columns and cards can be moved across columns and reordered within a column.
- Selecting a card opens a detail popup with title, description, priority, due date, assignees, comments, image references, and uploaded attachments. Save, comment posting, and file upload are separate actions with separate pending/error states.
- Deleted cards can be restored for 24 hours. This is a recovery window, not a promise of permanent archival or retention after expiry.
- A user can upload an Excel workbook and create cards populated from its rows.

Priority values, date-only deadlines, multiple assignees, activity detail granularity, who may invite project members, whether project guests may invite others, accepted workbook formats, import limits, and whether import is first-release scope need product/API confirmation. Where not confirmed, IDs below label a proposal or open decision.

### Contract changes to resolve before implementation

| Current draft | Requested scope | Required reconciliation |
|---|---|---|
| All active workspace members see every project and board | Project-only invited access | Add project membership/invitation authorization; decide whether an owner/admin can browse all projects and whether members can list only projects they joined. |
| Workspace roles are the primary permission boundary | Owner has multiple projects; access is scoped to one project | Define project roles and inheritance to boards, cards, comments, activity, imports, and files. Never authorize from a workspace role alone. |
| Archive card with no expiry | Recover deleted card for 24 hours | Add deletedAt/deletedBy/purgeAfter and restore semantics; distinguish archive if archive remains a separate concept. |
| Attachments are deferred | Popup includes image references and uploaded attachments | Define safe external link behavior, storage adapter, file metadata, access checks, upload limits, deletion and malware/content policy. |
| No spreadsheet import endpoint | Upload Excel rows as cards | Define accepted Excel formats, mapping/preview, validation, batch size, atomicity/partial success, duplicate retry, and default destination/order. |
| Activity feed is card-focused and history details are limited | Full owner activity log | Define owner scope, event coverage, retention/pagination, before/after redaction, and whether project members can see event subsets. |
| Existing card fields use plain-text description and comments | Card detail includes images and files | Clarify whether images are URLs embedded in description or first-class attached media; sanitize and protect private-project content. |

## Evidence and design lessons

Azure Boards documents adding, renaming, reordering, and removing columns; it requires moving work out before removal and provides both drag and menu movement. The useful lesson for Flowboard is that the workflow column is shared project configuration, while card position is a separate order. Keep priority labels separate from manual board position so users do not confuse “urgent” with “top of list.” [Microsoft: manage board columns](https://learn.microsoft.com/en-us/azure/devops/boards/boards/add-columns?view=azure-devops)

Trello describes card detail conversations and adding an attachment while commenting, and distinguishes uploaded copies from links to files hosted elsewhere. Flowboard’s requested separate Save, Post comment, and Upload actions should preserve independent drafts and failures even if a reference product combines some actions. [Atlassian: comment on a card](https://support.atlassian.com/trello/docs/commenting-on-cards/), [Atlassian: add attachments](https://support.atlassian.com/trello/docs/adding-attachments-to-cards/)

Linear documents private team membership, project resources, and restrictions on shared-issue access. This supports treating project membership as a real authorization boundary rather than a filtered list in the browser. A hidden project URL or guessed card ID must still fail at the API. [Linear: members and roles](https://linear.app/docs/members-roles), [Linear: private teams](https://linear.app/docs/private-teams), [Linear: projects](https://linear.app/docs/projects)

W3C WCAG 2.2 requires a single-pointer alternative to dragging, so keyboard support alone is not a complete substitute. WAI-ARIA dialog guidance covers moving focus into a dialog, containing Tab navigation, Escape, and returning focus to the opener or a logical fallback. [W3C: dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [W3C: modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

Azure Boards' CSV import uses a reviewable unsaved import result and reports row errors before save. That is a useful safety pattern for Flowboard's Excel upload: preview mapped cards and validation outcomes before committing a batch. A direct blind bulk insert would make spreadsheet mistakes difficult to detect or undo. [Microsoft: import work items from CSV](https://learn.microsoft.com/en-us/azure/devops/boards/queries/import-work-items-from-csv?view=azure-devops)

These products have broader plans, permissions, integrations, and workflows than Flowboard needs. The references inform interaction options, not a requirement to copy their hierarchy, billing, AI features, analytics, or terminology. The cost of project-level access is extra authorization checks and membership management; the benefit is that invited collaborators cannot discover unrelated project data. A simpler workspace-wide model is cheaper to build but directly conflicts with the requested privacy boundary.

## Feature inventory and proposed release slices

Priority legend: **V1 candidate** means needed to deliver the requested board workflow; **Later** means useful but not necessary for this slice; **Decision** means the user/Architect should settle scope before contract implementation.

### A. Project ownership, membership, and authorization

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| ACC-01 | V1 candidate | Owner can create, rename, open, and switch among multiple owned projects. Project list shows only projects the actor may access, with loading, empty, and failure states. | Project owner relation; owner-scoped project query; tenant-safe indexes; create/read/update authorization. |
| ACC-02 | V1 candidate | Owner invites a named/email-identified person to one project with an explicit project role; invitation clearly names the project. Invitee accepts, declines/ignores, or sees expired/revoked state. | Project invitation token hash, expiry, single use, accepted identity matching, role and audit event. Define who can invite and allowed roles. |
| ACC-03 | V1 candidate | Invitee can open the invited project and its boards/cards only. Direct URL, search, list, notification, file, and activity requests for a sibling/uninvited project reveal no contents. | Membership check on every read/write and receipt replay; project ancestry validation for all child IDs; consistent 403/404 privacy policy. |
| ACC-04 | V1 candidate | Owner can revoke project access; the former member's next request is denied. Existing authored comments/history remain attributable without exposing private project data elsewhere. | Membership status/version; revocation transaction; no sensitive shared cache; session authorization recheck. |
| ACC-05 | Decision | Decide project roles (suggested: owner, editor, commenter, viewer) and exact create/edit/move/delete/invite permissions. UI shows disabled actions with explanation; API remains authoritative. | Role matrix, endpoint policy, last-owner protection, project transfer/deletion rules. Workspace Owner/Admin/Member/Viewer proposal does not define this boundary. |
| ACC-06 | Later | Project settings support member list, pending invitations, role change, revoke, and resend/revoke-invitation actions with confirmation and results. | Paginated membership/invitation reads; expected versions; idempotent invite actions; audit coverage. |

### B. Board and column workflows

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| BRD-01 | V1 candidate | Project member opens an authorized board; columns, counts, first card page, and next-page affordances load without implying unseen cards are absent. | Project/board ancestry authorization; consistent bounded snapshot; canonical column/card order; explicit counts/cursors. |
| BRD-02 | V1 candidate | Project editor creates, renames, recolors, and reorders columns. Column order survives reload and is shared with other members. | Column CRUD/reorder commands; board structure version; color/name validation; activity event. |
| BRD-03 | V1 candidate | Empty column may be removed with clear confirmation. Populated column removal explains that cards must first be moved; no card becomes orphaned. | Reject deletion while any card references column (including deleted-but-restorable cards); return stable conflict; atomic relation checks. |
| BRD-04 | V1 candidate | Board supports horizontal narrow-screen scrolling with visible continuation and usable column controls; no essential action requires hover. | Bounded lists; responsive layout assumptions; avoid unbounded initial payload. |
| BRD-05 | Later | Optional soft work-in-progress count warning can signal congestion without blocking movement. | Optional limit and count semantics; no change to move authorization. Azure treats WIP as a flow signal; keep out of V1 unless requested. |

### C. Cards, create/edit, movement, and recovery

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| CRD-01 | V1 candidate | Create card from a column quick-add with required title, or from an explicit create action. Successful create appears in canonical position; failed create retains typed title. | Required title validation; default priority/date/assignee rules; column scope; idempotency receipt; activity event. |
| CRD-02 | V1 candidate | Compact card shows a readable title and supported priority, due date, assignees, and comment/attachment cues. Missing values are simply absent; overdue is not indicated by color alone. | Card summary projection and related people; date-only value; accurate metadata counts/indicators. |
| CRD-03 | V1 candidate | Drag moves a card between columns or within one column. Pointer drop preview identifies destination; save is optimistic; failure rolls the card back to canonical server order and explains why. | Atomic move with expected card/board versions and canonical neighbor IDs; destination ancestry; activity; idempotency. |
| CRD-04 | V1 candidate | Every drag operation has a click/tap Move menu with destination column and explicit first/last/before/after position. Keyboard users can open, navigate, choose, cancel, and hear a movement announcement. | Placement read for canonical unfiltered neighbors; no client renumbering of hidden cards; 409 stale conflict and canonical refresh. |
| CRD-05 | V1 candidate | When filters/search hide cards, ambiguous drag reordering is disabled or constrained; the UI explains how to use Move. The selected destination position applies to the canonical unfiltered list. | Placement endpoint excludes moved card; scoped filter cursor/snapshot; server validates adjacent IDs. |
| CRD-06 | V1 candidate | Concurrent move or edit never silently overwrites another user's newer change. Keep the user's unsaved fields available and show refresh/review choices on conflict. | Card version plus board structure/snapshot revision; conditional writes; 409 payload with current version; no blind retry. |
| CRD-07 | V1 candidate | Delete asks for confirmation, removes the card from active board views, and reports the 24-hour restore deadline. Owner/editor can restore before expiry; after expiry it cannot be restored. | Soft-delete metadata, purgeAfter, scheduled cleanup policy, scoped restore command, conflict when destination removed, activity for delete/restore/purge. Confirm whether project members may restore. |
| CRD-08 | Decision | Decide whether archive remains distinct from delete. If both exist, archive is reversible without a 24-hour expiry, while delete begins the recovery timer; label both actions clearly. | Separate archivedAt and deletedAt state machine, uniqueness/invariants, restore paths, archive listing and retention. Current PRD only has archive. |
| CRD-09 | Later | Undo a move/edit is available only when the latest version still permits the inverse action; otherwise explain the conflict. | Inverse command uses current expected version and normal authorization; never replay stale state blindly. |

### D. Card detail popup and comments

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| DTL-01 | V1 candidate | Selecting the card title/body opens a shareable detail URL in a dialog/drawer. Focus enters the popup, Tab stays within it, Escape closes unless a draft needs a decision, and focus returns to the originating card or a logical fallback. | GET card detail is independently authorized; route/deep link; loading/404/forbidden states; keyboard semantics. |
| DTL-02 | V1 candidate | Detail shows editable title, description, priority, due date, assignees, comments, image references, and uploaded attachment list. Long content scrolls without hiding Save/close. | Canonical detail resource; explicit null/omitted field semantics; activity/comment/file pagination. |
| DTL-03 | V1 candidate | Save commits card fields only. Save pending disables duplicate submissions; success adopts canonical versions; validation/conflict/network errors retain field draft and associate messages with inputs. | PATCH selected fields with expectedVersion, idempotency key, field validation, 409 conflict details, canonical response. |
| DTL-04 | V1 candidate | Comment composer has a separate Post action. Posting failure retains text and selected mentions without accidentally saving card fields; success clears only the posted comment draft. | Paginated comments; comment version/author; idempotent POST; transactionally recorded activity/outbox. |
| DTL-05 | V1 candidate | Mention picker offers only people allowed to access the project; choosing a suggestion creates a structured identity mention. Literal text that looks like `@name` does not notify by itself. | Active project-member search; validated user IDs/spans; access recheck at commit; notification policy. Decide if mentions notify in-app for V1. |
| DTL-06 | Later | Author may edit/delete own comment; authorized moderator may moderate with an explicit audit event. Deleted comment uses a tombstone without exposing removed body. | Expected comment version; soft-delete or redaction policy; moderator role; activity immutability. Current API proposes this but project-role authorization must replace workspace assumptions. |
| DTL-07 | Later | Activity tab shows card events separately from discussion; pagination and dates are clear. | Immutable activity query, actor display identity, project authorization and stable cursor. |

### E. Image references and uploaded attachments

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| ATT-01 | Decision | Clarify “image reference”: suggest a user-added HTTPS URL rendered as a link/preview, not arbitrary HTML or automatic remote image embedding in the first slice. Show domain and open safely; invalid/unsupported URLs remain editable. | URL validation, protocol allowlist, escaping, optional safe preview fetch policy; SSRF defense if server fetches previews; no access grant from sharing a link. |
| ATT-02 | V1 candidate | Upload files from detail popup with explicit Upload action and per-file pending/progress/success/failure/removal states. A failed upload retains a retryable local draft when browser permits. | Upload intent/finalize flow; object storage adapter; authorized project/card association; size/type limits, checksum and orphan cleanup. |
| ATT-03 | V1 candidate | Opening/downloading an attachment requires current project membership; copied object URLs do not become a public bypass. Deleting a card/attachment does not return a storage error as a success. | Authenticated download proxy or short-lived signed URL minted after authorization; private object bucket; delete receipt/audit; lifecycle cleanup. |
| ATT-04 | V1 candidate | UI displays safe filename, media type, size, image thumbnail when supported, and unavailable/deleted state. Do not execute uploaded HTML/SVG or trust filename MIME alone. | Server-side content validation; safe content-disposition; object metadata; provider-neutral stable key; malware-scanning decision. |
| ATT-05 | Later | Replace, reorder, or annotate attached images and make selected images inline in description. | Versioned attachment association/order and richer media editing; larger upload/render threat and complexity surface. |

### F. Excel workbook import

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| IMP-01 | Decision | Decide whether V1 accepts `.xlsx` only or also legacy `.xls`; provide a downloadable template/example with supported headings. “Excel” in the request means users can select a workbook, not that formulas/macros should execute. | Parser/library/runtime decision; file signature/type validation; workbook and row/cell limits; no macro execution. |
| IMP-02 | V1 candidate | Import starts inside a selected project/board and asks for a destination column/default card placement. Upload state shows progress/cancel. | Board/project authorization; staged import session; bounded upload; temporary storage and expiry. |
| IMP-03 | V1 candidate | Preview sheet/rows and map supported columns to title, description, priority, due date, assignees, image reference, and attachment references only where supported. Required title mapping is explicit; unknown columns are ignored only after showing that choice. | Column mapping schema; workbook parser; formulas read as displayed/cached values only by policy; assignee resolution exclusively against active project members. |
| IMP-04 | V1 candidate | Validate all rows before commit; show row number, invalid field and fix guidance. Invalid dates, unknown users, blank titles, overlong values, and untrusted formulas/links are not silently accepted. | Shared card validators; staged row result model; bounded error output; workbook parsing must not bypass regular card rules. |
| IMP-05 | V1 candidate | User confirms a summary (valid/invalid rows and card count) before creating cards. Result identifies created rows; retrying a lost response must not duplicate cards. | Batch command with idempotency receipt; explicit all-or-nothing vs valid-rows policy; activity event per card or summarized batch with traceable card IDs. |
| IMP-06 | Decision | Choose batch semantics: recommend reject entire import until errors are fixed for a first implementation; if partial success is desired, require explicit “import valid rows only” confirmation and a downloadable failure report. | Transaction size limits; staging table/job for larger imports; idempotent per-row key and durable batch status for async work. |
| IMP-07 | Later | Update existing cards from workbook, export to Excel/CSV, parent-child rows, formulas, macros, and large background imports are out of scope until separately designed. | Stable external row keys, conflict policy, data export/privacy, parser sandbox and async job architecture. |

### G. Owner activity log, search, filters, notifications, and settings

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| ACT-01 | V1 candidate | Owner can open a project activity log and see card create/edit/move/delete/restore, column changes, invitation/member changes, comment create/edit/delete, and attachment/import lifecycle events with actor and time. | Append-only activity records written atomically with mutation; project ancestry and role check; stable event types and actor/object IDs. |
| ACT-02 | V1 candidate | Owner can paginate newest/older events and open the affected object if still available. Deleted or purged objects show a truthful tombstone. | Cursor `(occurredAt,id)`, bounded page, privacy-safe event projection, no N+1 object lookup. |
| ACT-03 | Decision | Define “full” log: recommend all user-visible project changes with changed field names and safe before/after values, plus invitations/role/access actions. Never record passwords, tokens, raw file contents, or unrelated project data. | Event schema/versioning, sensitive-field redaction, retention and export policy; owner query across only owned projects. |
| ACT-04 | V1 candidate | Search/filter an authorized board by title, column, assignee, priority, due date, deleted state if permitted; clear chips and empty results are visible. | Scoped indexed query, filter-bound cursors and snapshot revision; avoid revealing title matches from other projects. |
| ACT-05 | Later | In-app inbox for mentions, assignments and project invitations; unread/read and empty/failure states. Email reminders, push, and due-date alerts remain later. | Recipient-specific authorized notification IDs, outbox/idempotency, membership recheck; no private text in unrestricted notification payload. |
| SET-01 | V1 candidate | Project settings expose name, columns, member roles, invitation state and project deletion/ownership actions only to authorized roles. Destructive actions explain impact and retain/recovery policy. | Per-action authorization; expected versions; owner-transfer/delete invariants; activity records. |
| SET-02 | Later | Workspace-wide preferences, themes, dashboards, custom fields, automation, and integrations are separate features, not implied by the reference screens. | Separate scope review; do not add undocumented data model or external integrations here. |

### H. Shared states, narrow screens, and accessibility

| ID | Priority | Behavior and UI acceptance | Backend/data dependency |
|---|---|---|---|
| UX-01 | V1 candidate | Board, detail, import, activity, and settings each have loading, empty, forbidden, not-found, offline, validation, save-failed, and stale-conflict states as applicable. Error recovery says what action remains safe. | Consistent error envelope and stable domain codes; cursor/version refresh routes; request IDs for support. |
| UX-02 | V1 candidate | Dialog dirty-close asks Save, Discard, or Continue editing; Escape follows the same rule. Separate unsaved card fields, comment text, and file upload draft are not silently mixed or lost. | Independent mutation resources and versions; close decision entirely client-side; failed writes retain drafts. |
| UX-03 | V1 candidate | Every action is available by keyboard and visible focus; drag has pointer menu alternative and keyboard move; movement is announced to assistive technology. | Canonical move response includes destination/order sufficient to announce and reconcile. |
| UX-04 | V1 candidate | At narrow widths, board can scroll horizontally; popup becomes viewport-sized drawer/page with reachable Save/close/comment controls; no clipped essential actions. | Responsive layout, paginated data, no API contract change. |
| UX-05 | V1 candidate | Text/labels are not communicated through color alone; avatars have names; controls have accessible names; errors link to fields; reduced-motion preference is respected. | Return display names for allowed referenced users only; no requirement for decorative animation. |
| UX-06 | Decision | Choose narrow-screen popup presentation (drawer vs route page) after first flow design; both preserve direct URL, focus and draft behavior. | Browser history/back handling and focus restoration; no provider dependency. |

## Cross-cutting backend invariants

1. Authorize a request by authenticated actor plus active membership in the specific project that owns the target resource. Resolve `file -> attachment -> card -> board -> project` and equivalent ancestry for columns, comments, import sessions, and activity. A syntactically valid ID is never proof of access.
2. Enforce project scope for reads, writes, search, assignee/mention pickers, activity, notification retrieval, download URL minting, import preview/commit, and idempotent replay. Apply the same rule to background cleanup and import workers.
3. Store due dates as date-only values if confirmed; never shift the chosen calendar day with browser/server timezone conversion. Keep timestamps as UTC instants.
4. Treat order as canonical server state. Versioned move commands validate source card, destination column and neighboring IDs in one transaction. A stale board returns a conflict and canonical refresh; the client does not infer order from an incomplete/filtered page.
5. Keep activity atomic with the successful mutation. A failed edit/move/delete/import produces no success activity event. Import batch history must link to each created card or make per-row outcomes queryable.
6. Keep uploaded objects private. File metadata and storage keys are associated with project-scoped records. Deletion, project revocation and expiry must stop future access even if the object has not yet been physically removed.
7. Use an idempotency key for non-idempotent operations (create, comment, invite, upload finalize, delete/restore, import commit). A retry after a lost response returns the original outcome without duplicating cards, comments, events, or notifications.
8. Simultaneous edits retain user-entered drafts and require an explicit resolution after a stale version. Saving card fields does not implicitly post a comment or finalize an upload.
9. Paginate board cards, comments, activity, project memberships and search results. Show totals and continuation so page bounds do not appear as missing data.
10. Use stable errors for `not authorized/not found`, `stale version`, `column not empty`, `import validation`, `file too large/type rejected`, and `delete window expired`. Avoid leaking SQL, object keys, invite tokens, or private project titles.

## Core journeys and edge cases

| Journey | Normal path | Required edge handling |
|---|---|---|
| Invite collaborator | Owner opens project members → enters invite identity/role → invitee accepts → project appears in their list | Duplicate pending invite; existing member; wrong email identity; expired/revoked token; inviter loses permission; membership revoked while popup remains open. |
| Move card | Drag or Move menu → choose destination/position → optimistic preview → server success | Two users move same card; destination column removed; hidden filtered cards; empty destination; card deleted during move; server response lost/retried. |
| Edit details and comment | Edit fields → Save; separately compose mention/comment → Post | One write fails while other succeeds; draft survives refetch; duplicate Save/Post; stale version; mention loses project access before commit. |
| Upload file | Choose local file → Upload → attach metadata → download/preview | Oversize/unsupported file; interrupted upload; upload completed but association failed; project access revoked; malicious content; stale signed URL; delete retry. |
| Delete/restore | Confirm delete → 24-hour deadline shown → restore from notification/trash/activity | Restore at expiry boundary; double restore; destination no longer exists; project access revoked; purge retries; activity still identifies a purged card without leaking content. |
| Excel import | Select board/column → upload → map → validate preview → confirm → show result | Empty workbook/sheet; multiple sheets; duplicate rows; formula cells; invalid dates/assignees; row-count/file limit; partial failure decision; lost response; import canceled or membership revoked before commit. |
| Owner activity | Open log → paginate/filter → open card/event | High event volume; removed actor; deleted object; sensitive before/after field; member cannot enumerate another project. |

## Release boundary recommendation

For the first vertical slice, prioritize project-scoped authorization and membership, then one board with configurable columns, card create/detail/save/comment, move with drag plus Move menu, 24-hour delete/restore, and owner activity. Attachments and Excel import need their own explicit backend contracts because object storage and batch validation introduce distinct failure paths. If schedule requires sequencing, build these features as later V1 slices without weakening the access boundary or pretending they are implemented.

Keep later: public/guest sharing beyond explicit project invitations, custom fields, workflow automation, WIP blocking, sprints, swimlanes, dashboards/analytics, email/push reminders, offline edits, live presence, collaborative text editing, attachment annotations/inline rich editor, workbook formula execution, broad bulk updates, and external integrations. No AI agent workflow, financial measure, vendor lifecycle, bidding, procurement, or approval-percentage requirement is supported by this task or by the references.

## Learning note: authorization is checked at the door to every resource

A project invitation is like a key to one Flowboard project, not a master key to the workspace. The web interface can hide other project names, but that is only presentation. The API must check the key again when someone opens a card, downloads a file, searches, restores a deleted card, or retries an import. This extra check costs implementation time and a few database reads, but prevents a guessed URL or stale tab from crossing the project boundary. A broad workspace role is simpler, but it does not satisfy project-only invited access. We will verify the boundary with two synthetic projects and an invited member who tries direct reads and writes across both.

The board also has two kinds of truth: the browser's immediate visual guess and the server's saved order. The browser can move a card on screen at once so the board feels quick; the server then confirms the canonical position. If another teammate changed the same board first, Flowboard should restore the saved order and explain the conflict. This costs some recovery UI, but avoids two people silently overwriting each other. We should verify with simultaneous synthetic moves and reload the board afterward.

## Primary source catalogue

- Microsoft Learn, [Manage columns on your board](https://learn.microsoft.com/en-us/azure/devops/boards/boards/add-columns?view=azure-devops) — add/edit/reorder/remove columns, safe removal, status movement.
- Microsoft Learn, [Customize cards](https://learn.microsoft.com/en-us/azure/devops/boards/boards/customize-cards?view=azure-devops) — card fields and ordering options.
- Microsoft Learn, [Import work items from CSV](https://learn.microsoft.com/en-us/azure/devops/boards/queries/import-work-items-from-csv?view=azure-devops) — staged review, required fields, row validation, limits and import caveats. This is CSV, not proof of `.xlsx` support.
- Atlassian Support, [Comment on a card](https://support.atlassian.com/trello/docs/commenting-on-cards/) — card conversation and attachment entry point.
- Atlassian Support, [Add an attachment to a card](https://support.atlassian.com/trello/docs/adding-attachments-to-cards/) — uploaded copy versus external file link and preview considerations.
- Linear Docs, [Members and roles](https://linear.app/docs/members-roles) — scoped access, suspended member behavior, guest model.
- Linear Docs, [Private teams](https://linear.app/docs/private-teams) — invited membership and restricted visibility patterns.
- Linear Docs, [Projects](https://linear.app/docs/projects) — project views, resources, and project membership context.
- W3C WAI, [WCAG 2.2 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) — single-pointer alternative to drag gestures.
- W3C WAI-ARIA APG, [Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) — focus entry/containment, Escape, accessible naming, and focus restoration.

## Evidence and open questions

Research source documentation only; no live product behavior, Flowboard API, UI, file storage, Excel parsing, security policy, or database behavior was tested. The feature IDs and acceptance criteria are proposed design coverage and must not be marked implemented or validated until built and exercised.

Before API implementation, resolve: (1) who can invite and project role matrix; (2) owner/admin visibility over all projects versus strict owner-only listing; (3) whether archive remains distinct from 24-hour delete; (4) whether Excel import is V1 and `.xlsx`/`.xls`/CSV scope; (5) all-or-nothing or explicit partial import; (6) attachment size/type/retention and safe image-reference semantics; (7) whether comments/mentions/in-app notifications and member activity views are V1; and (8) definition/retention of “full” owner activity. Until then, API and storage designs remain unresolved proposals.
