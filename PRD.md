# Flowboard PRD v0.3

Date: 2026-10-26 (Asia/Kolkata). Status: requirements plus explicitly labeled proposed defaults.

## Confirmed by the user

Flowboard is our own collaborative board application, similar in concept to Azure Boards. Users can drag cards between customizable columns (examples: Not started, Started, In progress, Testing, Completed). Cards have titles, priority, due dates and assignees. Clicking a card opens a dialog with details, comments and teammate mentions. Additional UI references will follow. Cloudflare hosting and GitHub source control are preferred. Architect coordinates separate Backend and UI chats; initial research uses two GPT-6.1 Sol agents.

## Recommended first release

Workspace → projects → boards → columns → cards. One workspace has one owner who manages multiple projects. Invited people see only explicitly granted projects; each grant inherits to that project's boards/cards. Project roles are manager/member/viewer. Ownership of another workspace grants no special rights here. Each board owns its columns and card ordering.

Default columns: Not started, In progress, Testing, Completed. Column labels, color and order are configurable. A stable category (`todo`, `active`, `done`) is separate from the display label. Renaming a column must not change reporting semantics. Do not delete a nonempty column; offer an explicit bulk move first. Card Delete moves it to trash, recoverable strictly before server deletedAt + 24 hours. Owner and project managers can delete/restore. App restore expires even if physical cleanup is delayed; card archive is not a separate v1 feature.

Cards: title, plain-text description initially, priority (`none`, `low`, `medium`, `high`, `urgent`), optional date-only due date, zero or more assignees, comments, activity history, version and active/trashed/purged state. These priority labels and multi-assignee support are proposed defaults. Store dates as `YYYY-MM-DD`; timestamps as UTC. Display overdue status against the workspace timezone. No browser-local conversion of a date-only due date.

Comments support structured teammate mentions selected from active eligible project people, including the workspace owner. Preserve text plus validated mention identifiers; do not infer notifications from an arbitrary `@name` string. First release includes an in-app notification inbox. Private reference-image uploads and create-only Excel import are required release features. Invitation email is part of onboarding; email mention alerts, reminders, custom typed fields, dependencies, sprints and swimlanes remain later scope.

## Role-based access (updated user decision)

Workspace Owner sees every owned project. Project Manager manages boards/settings and invites/removes Member/Viewer only inside their granted project; only Owner appoints/removes managers or transfers ownership. Member creates/edits/moves cards, comments and uploads images in granted projects. Viewer reads granted project data only. Owner and Manager delete/restore cards and run Excel imports. All roles are checked on server requests, including images, search, history, imports and retry replay.

The detailed [permission matrix and flows](docs/FEATURE_SPEC.md) and [98-feature checklist](docs/FEATURE_CHECKLIST.md) govern delivery. Project-only access and Owner/Manager administration supersede earlier workspace-wide visibility and global admin proposals. Exactly one owner and ownership transfer need transactional enforcement.

## Board and dialog behavior

Dragging is optimistic; failed writes restore the server state and explain the failure. Every card also has a Move menu usable by click/tap and keyboard, with destination and position choices, visible focus and an announcement after movement. Keyboard support alone does not provide the required pointer alternative to dragging. The detail dialog traps focus, closes with Escape unless there is an explicit unsaved-change decision, restores focus to its originating card, and has a shareable card URL. Details load independently of the compact board card.

During filtered views, use the Move menu and fetch the canonical destination boundary before submitting. Disable ambiguous drag reordering while filters are active in v0.1; explain this in the UI. Hidden cards are never renumbered by a client. Server returns canonical order. A stale board revision yields a conflict and refresh, not a guessed overwrite. Undo is a new authorized command using the latest expected versions; it may conflict.

Search/filter by title, assignee, priority and due date. Paginate comments and column cards; never silently hide cards behind a count. Show loading, empty, forbidden, failed, offline and conflict states. Initial collaboration uses foreground refresh/polling and refetch after writes; no offline writes or guaranteed live presence. Card details contain separate Save, Post comment and Upload actions; Delete is owner/manager only. Owner can inspect card activity and a cross-project audit feed with safe before/after changes.

## Reference interpretation

Preserved originals: [dark board](docs/references/board-dark.png), [light board](docs/references/board-light.png). Useful cues: compact columns, card hierarchy, avatars, status chips, due indicators, counts and drag feedback. Neither screenshot establishes financial, bidding, vendor lifecycle, approval percentages or analytics requirements. No visual theme or final layout is accepted yet.

## Release acceptance

1. Two members can create cards, edit details, comment and mention active teammates; a viewer cannot mutate.
2. Columns can be added, renamed and reordered; removing a populated column returns a useful conflict.
3. Mouse and keyboard movement survive reload; concurrent stale moves return 409 without lost updates.
4. Every resource read/write verifies workspace membership; cross-workspace column, card, assignee and mention identifiers are rejected.
5. A retry after a lost response creates one card/comment/event/notification, not duplicates.
6. Due dates retain the chosen day across timezones; dialog and board work at narrow widths and with keyboard navigation.
7. Membership revocation applies to open tabs on their next request; no sensitive data remains in shared caches.
8. Migrations and recovery are rehearsed with synthetic data before production data exists.

## Users and outcomes

Primary assumed audience: small collaborative teams tracking shared work; the exact business niche and workforce-only versus public SaaS audience remain open. Success means a user can find owned work, move it through a team-defined workflow, discuss it, and reliably see the saved result after refresh or concurrent editing.

## New confirmed constraints

Performance is the first technical priority, measured end-to-end rather than inferred from a framework name. Start within available free tiers where practical and document their limits/cold starts. Keep domain logic and data portable so Cloudflare, AWS or Azure hosting can be changed through a deliberate migration. Plan all 50 requested engineering concerns and track design coverage separately from implementation and validation.

GitHub repository supplied by the user: https://github.com/lezter11/flowboard. Maintain PRD.md, ARCHITECTURE.md, DESIGN.md, RULES.md, TASKS.md and PROGRESS.md at the project root. All supplied visual references live under docs/references. The latest reference suggests a light task board with left navigation, lifecycle summary, compact cards and teal accents; visual details remain exploratory.

## Learning and collaboration

Every substantive response ends with a compact structured explanation of actions, why/options, evidence, and next steps including any user input. Explain technical terms on first use and use a Flowboard example. Record project-specific decisions and alternatives in architecture decision notes, not only in chat.

## Feature baseline and delivery

The latest user request confirms project-scoped invitation/privacy, Owner plus Project Manager administration, complete card activity, exact 24-hour deleted-card recovery, private images and an Excel template/import. [FEATURE_SPEC.md](docs/FEATURE_SPEC.md) details flows and edge cases; [IMPORT_SPEC.md](docs/IMPORT_SPEC.md) defines the seven-column workbook and preview/commit semantics. [FEATURE_CHECKLIST.md](docs/FEATURE_CHECKLIST.md) enumerates the 98 planned implementation units.

Backend implements and verifies one unit, publishes a contract/evidence handoff, then UI implements it and integrated acceptance checks it. Design/research/template delivery does not mark an application feature done. The owner/manager decision is confirmed; numeric caps, role granularity and later-release defaults remain explicit reviewable proposals.


## User-confirmed Projects access revision — 27 October 2026

The user explicitly chose **separate access for each board** and **combined card views only within one project**. This supersedes earlier statements that project grants automatically expose all child boards, and withdraws cross-project/workspace card aggregation. Keep workspace → project → boards → columns → cards; do not introduce nested project entities. For non-Owners the proposed effective read boundary is active project membership AND an active grant to that board. The Owner retains access to all boards in owned projects. A person can see an accessible project while having zero accessible boards; do not reveal hidden board names, IDs, counts or cards. Owner-only board grant administration is the initial UI preview default; Manager delegation and existing-data grant backfill still need an explicit backend/product decision.

The local Projects prototype implements synthetic visibility and an Owner access editor. This does not change current API authorization or prove server enforcement. Backend work is handed off through docs/handoffs/proposals/project-board-access-v2-2026-10-27.md; all affected reads/writes and revocation paths must be migrated and independently verified before integration. Existing failed backend handoffs remain separate.
