# Flowboard feature specification v0.3

Date: 2026-10-26. Status: implementation specification with explicit proposed defaults. No application feature is implemented yet. The user's latest requirements override earlier workspace-wide access, archive-only deletion and deferred image/import scope.

The complete deliverable list is [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md), generated from 98 stable definitions in [features.tsv](features.tsv). Each feature separately tracks Backend verification, UI verification and integrated acceptance. [API.md](API.md) defines service contracts; [handoffs](handoffs/README.md) defines evidence and sequencing.

## 1. Confirmed requirements and proposed defaults

Confirmed: an owner manages multiple projects; invitees see/work only in granted projects; owner sees all card activity; custom Kanban columns and draggable cards; full detail popup with title, description, priority, due date, assigned people, comments, image attachments, Save and Delete; deleted cards restorable for 24 hours; downloadable Excel template and upload-to-cards; Backend feature verification precedes UI implementation. Research agents for this task use GPT-6 Luna. User explicitly chose **owner and delegated project managers** for inviting/removing people and deleting/restoring cards.

Proposed defaults: one owner per workspace; one or more boards per project; project roles manager/member/viewer; all boards inherit project access; no board-only guest grants; plain-text description/comments; multi-assignee cards; image types PNG/JPEG/WebP; create-only XLSX import; exact 24-hour server-clock restore boundary. These choices are detailed below so the user can adjust them before affected implementation.

## 2. People, projects and permissions

Account = a person's login identity. Workspace = an owner's container for projects. A project grant = permission for that person inside one named project. Being a workspace member or owning another workspace does not imply access to sibling projects.

Example: Shubham owns Website and Operations. Priya is manager of Website and Sam is a member there. Priya and Sam can access every board under Website, but neither can discover Operations. Priya can invite a Website member; only Shubham can make that person a manager or transfer workspace ownership.

| Action | Workspace owner | Project manager | Project member | Project viewer |
|---|---|---|---|---|
| List/read projects | All owned workspace projects | Granted projects only | Granted projects only | Granted projects only |
| Create a project; archive/reopen project | Yes | No | No | No |
| Rename/configure an existing project | Yes | Own granted project | No | No |
| Create/archive boards; configure columns | Yes | Own granted project | No | No |
| Rename or describe a board (name, description) | Yes | No | No | No |
| Set the project's default landing board | Yes | No | No | No |
| Invite member/viewer; resend/revoke their invite | Yes | Own granted project | No | No |
| Grant/remove manager or change peer manager | Yes | No | No | No |
| Change/remove member/viewer grants | Yes | Own granted project | No | No |
| Create/edit/assign/move cards | Yes | Own granted project | Own granted project | No |
| Post comments/upload images | Yes | Own granted project | Own granted project | No |
| Edit own comment/remove own image | Yes | Yes | Yes | No |
| Moderate other comments/images | Yes | Own granted project | No | No |
| Delete card; browse trash; restore before cutoff | Yes | Own granted project | No | No |
| Upload/confirm Excel imports | Yes | Own granted project | No | No |
| Read card history/images | All owned projects | Granted projects | Granted projects | Granted projects |
| Project-wide audit/access events | All owned projects | Own granted project | No | No |
| Workspace security/owner activity view | Yes | No | No | No |
| Transfer workspace ownership | Yes, atomic transfer | No | No | No |

Managers cannot grant manager/owner, edit another manager's membership or extend their authority to another project. They can leave their own project grant. Workspace owner cannot remove/leave ownership without a valid transfer. Assignees must be active owner/manager/member eligible to work on the project; mentions may target active eligible project readers including viewers. These are explicit proposed defaults.

Every nested API/resource, search/count, image fetch, invitation, import, activity read and retry replay checks project ancestry on the server. UI hiding is not authorization. Revocation/role change takes effect on the next authorized request; already rendered data is cleared when the app learns of loss of access. In-flight writes and revocation use a shared transaction/lock protocol.

## 3. Navigation and project setup

Owner's initial screen: project list with Create project. Invitee's initial screen: only granted projects and invitation acceptance. Sidebar: workspace/project switcher; Boards; My tasks; Notifications; project People; project Activity; Trash for owner/manager; Settings appropriate to role.

Create project → name and optional description → create first board → choose default columns → invite people. Owner may create multiple projects. Project manager configures boards inside an existing project. Switching context changes queries/permissions; clear the previous project's private view state. Deep links preserve project/board/card IDs but must reauthorize.

Project archive is owner-only, makes its boards read-only, hides it from ordinary active lists and retains data. Owner can reopen. Board archive is owner/manager, similarly reversible. Neither archive pauses a deleted card's restore deadline. Permanent project/workspace destruction and account-erasure flows are later scope requiring explicit separate specification.

## 4. Board and workflow

Board header: project/board name, accessible member avatars, title search, filters, New card, Import (owner/manager), board name and description edit (owner only; B-3). Any summary shows defined counts of active/matching cards, not invented business progress percentages.

Columns: stable ID, label, color, category todo/active/done, manual order and total/matching counts. Default labels Not started, In progress, Testing, Blocked, Completed (new boards only; existing boards keep their columns). Owner/manager adds/renames/reorders; category is separate from label. Duplicate names after trim/case-normalization are rejected so import mapping is unambiguous. Removing final column or a column referenced by active/restorable cards is blocked with explanation; no silent card cascade. Initial maximum 12 columns is a proposed performance bound.

Cards: title; priority chip; optional due/overdue cue with text; assignees/overflow; comment and finalized-image counts. A compact card does not load its entire discussion/description. Loading a column's next page must clearly disclose unseen cards; full counts are not page length. Snapshot/cursor bounds are specified in API.md.

Drag within/across columns shows destination and pending state. Server owns ranks and validates latest versions and neighbors. Failed save restores canonical state and explains conflict without losing the draft. A visible Move menu supports click/tap and keyboard first/last/before/after placement, including long paginated columns. While filters hide cards, ambiguous relative drag is disabled and Move uses full canonical ordering. Priority never silently changes position.

## 5. Card detail and Save

Selecting a card opens a named dialog/drawer and shareable link. Header: title, project/board context, column, close and permitted menu. Form: description, priority, date-only due date, assignees. Sections/tabs: discussion, images and activity. Footer: Save, Cancel, Delete if owner/manager. Narrow views keep actions reachable without obscuring content.

Save changes form fields only; Post comment is separate; Upload image is separate. New cards must be saved before comments/images attach to a real ID. Field draft changes, comment draft and upload state are independent. Success applies canonical versions; field errors are attached to controls; pending action prevents duplicate submissions. Cancel/close/Escape with unsaved work offers keep editing/discard. Escape first dismisses any nested picker. Focus returns to the source card or nearest valid control.

Fields: trimmed title 1–200; description ≤20,000; priority none/low/medium/high/urgent (default none); nullable real Gregorian due date; zero or up to 20 eligible assignees. Due date is YYYY-MM-DD, not a midnight timestamp. Overdue means due before workspace today and not in done category. Reopening done work can make it overdue again. No start date, estimate, labels, custom fields or subtasks are silently implied by the reference images.

Concurrent edit/move returns a recoverable 409, retains user input and offers refresh/review. Do not invent a new expected version and overwrite another teammate's work. Card deleted/archived/project access revoked while open stops writes and offers the correct next action.

## 6. Comments, mentions and notifications

Project readers see chronological paginated discussion with author display and timestamps. Member/manager/owner posts plain text independently of Save. Comment length 1–10,000. Structured mention picker only returns eligible project people; UTF-16 spans and user IDs are validated server-side. Literal at-name text creates no notification.

Author can edit/delete own comment; owner/manager can moderate within scope. Edit uses a version and records that a change occurred. v1 edits update mentions but do not send new mention notifications. Deleted comment becomes a tombstone; removed body is not leaked through normal activity/inbox APIs. History preserves actor/action/time, with redaction of sensitive old bodies where required by the chosen retention policy.

Comment creation plus activity/mention intent/receipt commit atomically. Inbox notification is asynchronous and duplicate-safe; self-mentions do not notify. Inbox is actor-owned and project reauthorized, with unread/read state and safe deep link. Removed project access hides/redacts affected notifications. External email mentions, daily summaries, push and due reminders are later features; **invitation email** is required for the invitation flow and has its own durable delivery path.

## 7. Image references

In v1, image reference means an uploaded private image attached to a saved card. No remote URL downloading, rich HTML, embedded spreadsheet image import or arbitrary file type is required. Suggested limits: PNG/JPEG/WebP, ≤10 MiB each, ≤10 finalized images/card, decoded ≤20 megapixels and maximum dimension 8192. Server verifies bytes, dimensions and count rather than trusting filename/type. These bounds require actual parser/storage/runtime tests.

Flow: select/drop image in detail → authenticated staging → visible progress/cancel → verification → finalize card association → gallery/preview. Upload pending/failure does not falsely report a saved attachment or undo unrelated saved fields. Uploader or owner/manager may remove, with confirmation and activity. Replacement/annotation/inline description media are later scope.

Private object bytes use a portable storage adapter (initial R2 candidate), metadata/key in PostgreSQL. Use an authenticated download/thumbnail proxy with a fresh project check for each fetch; no public bucket or reusable signed-link shortcut that outlives revocation. Previously downloaded bytes cannot be recalled. Cleanup removes orphans and removed objects safely. No external network fetch is performed for an image URL pasted into a comment/workbook.

## 8. Delete, trash and exact restore window

Delete is a soft-delete command for owner/manager. Confirmation states card title, that it leaves the board and that recovery lasts 24 hours. Server sets deletedAt/deletedBy/restoreUntil=deletedAt+24 hours. Trashed cards disappear from active board/search/My tasks/counts, reject writes/new uploads/comments and are visible in project trash only to owner/manager. Normal readers receive a private missing/unavailable state.

Trash rows show title, actor, deletion time and exact restore deadline. Restore before server time `< restoreUntil` recovers the same ID, fields, comments, activity and finalized images that existed at deletion. Use original valid column and nearest surviving anchors; if unavailable, require explicit active destination/reopening the board/project. Restore never extends a prior deletion window through retries; a genuinely new later Delete starts a new 24-hour period.

At or after the deadline return 410 RESTORE_WINDOW_EXPIRED to authorized trash administrators even if the purge worker is late. A cleanup worker claims still-trashed due cards with fencing/version checks. It cannot purge after restore has won. Cleanup of objects/content is retryable after a committed purge transition. Pending purge is not a longer restore window.

After purge retain minimal actor/action/time/card-ID tombstones and import duplicate markers, not deleted descriptions/comment bodies/images or copies in notification/receipt/error payloads. Exact operational audit retention is a documented pre-production policy; this recovery window is not a claim that independent backups erase at exactly 24 hours. Backups do not extend app-level restore eligibility. Previously removed images/comments are not resurrected by card restore.

## 9. Excel template and import

Actual template: [download XLSX](../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx). Its Cards sheet has no sample cards; Instructions contains examples. Headers exactly: External ID, Title, Description, Priority, Due Date, Assignees, Status. [IMPORT_SPEC.md](IMPORT_SPEC.md) owns field rules and import state/validation details.

Owner/manager selects an authorized project/board and default todo column → uploads supported XLSX → validates/previews mapped rows → fixes any errors → explicitly confirms → receives linked card/result counts. Preview can persist temporary metadata but creates no cards/users/grants. Unknown status/person/date/duplicate changed ID blocks commit; no silent defaults beyond documented blank-field rules. No auto-invites or implicit member role changes.

Create-only import uses stable board-scoped text External ID. Same original row payload is already imported/skipped even if card was later edited; changed payload for an existing ID is a conflict requiring a new ID or ordinary card edit, not an automatic update. Trashed/purged originals are never recreated by retry. Preserve minimal scoped duplicate markers after purge. Each new card has normal permissions, activity and provenance.

Proposed starting bound: 200 data rows, 5 MiB compressed upload, 20 MiB expanded XLSX XML and limited parse time/cell lengths. Validate entire batch and commit new rows atomically after rechecking project grant, destination columns, eligible users and preview expiry. Invalid/conflict rows mean zero new cards. No chunked partial-success semantics in v1. If these bounds miss runtime limits, amend them or run bounded parsing in a durable compatible worker; never silently weaken atomicity.

Reject formulas/macros/external workbook links/embedded objects; never evaluate cached expressions. Real Excel dates honor 1900/1904 workbook metadata; strict ISO text is accepted; ambiguous date text is rejected. UTF-8 CSV, legacy XLS, comments/history/file import, automatic updates and import rollback are later scope. A successful importer does not yet exist; this is its specification and a usable template.

## 10. Activity and owner overview

Card activity is chronological and append-only to users. Record create, field edit, assign/unassign, from/to move, comment create/edit/delete, image finalize/remove, delete/restore/purge and import source, with actor ID/historical display, UTC server timestamp, operation ID and meaningful safe changes. Card change and its event commit together; no false event after failed mutation. Do not record tokens or file/comment body copies indiscriminately.

Owner sees workspace-wide activity across owned projects and can filter project/card/actor/action/date. Manager sees project-wide activity and member access events for that project; member/viewer sees authorized card-level history. Separate workspace security events/ownership transfer from card history. Paginate by stable timestamp+ID. No user-facing audit edit API and no promise of full event-sourced reconstruction.

## 11. Accessibility, errors and operational acceptance

Verify click/tap and keyboard movement, named focus-managed dialog, visible focus, color-independent priority/due status, reduced motion, zoom/narrow views, long text and IME/Unicode mentions. Loading, no projects, no cards, no matches, offline, revoked access, stale version, quota/file/date/row errors all have specific recovery actions. No fake successful toast when only local state changed.

Shared auth/session/CSRF, project authorization, bounded SQL/HTTP/queues, idempotency, retries, outbox recovery, private image fetch and real PostgreSQL concurrency tests remain release gates. The separate [50 engineering concerns](ENGINEERING_CHECKLIST.md) tracks infrastructure properties; this catalogue tracks product behavior. One feature passing does not complete every related engineering item.

## 12. Deferred product scope

No automatic adoption of AI agents, financial/vendor analytics, billing, sprints, WIP enforcement, time tracking, dependencies/subtasks, automations/webhooks, public sharing, board-only guest grants, custom roles/fields, external mention emails, arbitrary file types, live presence, realtime collaborative text or offline writes. Keep them as future proposals only if a real requirement emerges. Move Undo, owner transfer and reversible project/board archive are final release-hardening slices (S6), not prerequisites for a first working board.

## 13. Delivery order

S0 local runtime/DB/contracts → S1 owner/projects/invites/project RBAC → S2 board/card/movement/details → S3 discussion/activity/inbox → S4 private images/trash/restore/purge → S5 Excel import → S6 hardening/ownership/archive/Undo/benchmarks. Each item is Backend verified before its UI implementation, then integrated. Backend may work ahead on the next item while UI implements a previously handed-off feature. Owner/manager decisions above supersede research alternatives.


## Frontend creation rule — 2026-10-27

The user now requires an explicit Low/Medium/High/Urgent priority when creating a card in the UI. The HTML artifact enforces this in quick-add, the full Add Card form, and its sample import preview; blank/none is rejected without discarding the draft. Existing cards may still have none. The earlier API field/default above describes the existing server contract, which has not been changed or accepted by this frontend task. Coordinate backend validation and import/template alignment before product integration; this note does not claim a passed backend handoff.


## User-confirmed Projects access revision — 27 October 2026

The user explicitly chose **separate access for each board** and **combined card views only within one project**. This supersedes earlier statements that project grants automatically expose all child boards, and withdraws cross-project/workspace card aggregation. Keep workspace → project → boards → columns → cards; do not introduce nested project entities. For non-Owners the effective boundary is active project membership AND an active grant to that board. The Owner retains access to all boards in owned projects. A person can see an accessible project while having zero accessible boards; do not reveal hidden board names, IDs, counts or cards. The user chose Owner-only board-grant administration, no automatic backfill of existing members, and Manager permission to create boards. See [the recorded decisions](handoffs/proposals/board-access-decisions-2026-10-27.md). These decisions do not mean the backend has implemented the revised boundary.

The local Projects prototype implements synthetic visibility and an Owner access editor. This does not change current API authorization or prove server enforcement. Backend work is handed off through docs/handoffs/proposals/project-board-access-v2-2026-10-27.md; all affected reads/writes and revocation paths must be migrated and independently verified before integration. Existing failed backend handoffs remain separate.
