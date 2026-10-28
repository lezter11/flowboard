# Flowboard screens — design library

Status: **design evidence only.** Synthetic data, local browser state and no API calls. This library is separate from the approved board/card-detail artifact and does not verify any feature in [`docs/FEATURE_CHECKLIST.md`](../../../docs/FEATURE_CHECKLIST.md). The UI checklist remains 0/98.

This library adds twelve product surfaces beyond the approved board: Sign in, Invitation accept, My tasks, Projects, Project workspace, Add card, Inbox, Activity, Trash, People, Import and Settings. The Project workspace owns the project overview. All boards and each individual board link open the full workspace Board section. It reuses the board artifact's `styles.css` and `detail.css` for tokens, shell, dialogs and toasts.

## Preview

From the repository root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory design/flowboard-ui
```

Open <http://127.0.0.1:4173/screens/> for the screen library, or <http://127.0.0.1:4173/> for the approved board.

The artifact also opens from disk, but a local server is recommended so the XLSX template link, storage and clipboard behavior stay consistent.

## Screen inventory

| # | Screen | File | What it demonstrates |
|---|---|---|---|
| — | Screen library | `index.html` | Review hub, screen inventory, role-aware deep links and honest coverage notes. |
| 01 | Projects | `projects.html` | Project map (default) and compact list: project root with counts/completion, connected board branches with per-board stats and access, search, create project, archive/reopen. |
| 02 | Project workspace | `project.html` | One project workspace: Overview first, a persistent `[Overview] [board]… [All boards]` switcher, board links to the full workspace, a read-only All boards action, at-a-glance completion, Owner-only people reach or a non-owner access list, create board with initial grants, Owner-only per-board access editor and archived read-only state. |
| 03 | Add card | `add-card.html` | Save-first card creation, validation, date-only due date, eligible assignees, and images/comments only after a real card ID. |
| 04 | Inbox | `inbox.html` | Actor-owned notifications, unread/read state, mentions, assignments and safe deep links. |
| 05 | Activity | `activity.html` | Workspace/project/card scopes, actor/action/date filters, load-more and access events for Owner/Manager. |
| 06 | Trash | `trash.html` | Exact 24-hour server-clock boundary, expiring-soon warning, expired state, restore and role restriction. |
| 07 | People | `people.html` | Roster, pending invitations, role changes, Owner-only Manager grants and the role matrix. |
| 08 | Import | `import.html` | Seven-column XLSX contract, sample previews, invalid/conflict blocking and all-or-nothing commit. |
| 09 | Settings | `settings.html` | Project, board/column, account and appearance tabs; dirty state; archive/reopen; read-only role state. |
| 10 | Sign in (locked) | `signin.html` | Locked for this design iteration: Palette 1, IBM Plex Sans and “Sign in with Flowboard”; callback/expiry/rate-limit states remain illustrative. |
| 11 | Invitation accept | `invitation.html` | Token-safe preview, signed-out/in, accepted, expired, revoked, mismatch and invalid states. |
| 12 | My tasks | `my-tasks.html` | Actor-owned assignments across accessible projects, due buckets, project context and local completion. |

The approved board remains at `../index.html` and the board/detail notes remain at `../README.md`.

## Shared shell and review controls

- `screens.js` injects the rail, top bar, breadcrumbs, presence, role preview, theme toggle, dialog layer, toast layer and SVG sprite. There is no build step. The Sign in and Invitation accept pages use a focused shell without the workspace rail; they keep the theme toggle and sprite.
- `screens.css` holds screen-specific layout, summary strips, tables, role matrix, import/trash/settings patterns and responsive rules.
- `data.js` holds the synthetic projects, members, notifications, activity, trash and import samples. Reloading resets every change except the theme preference.
- Light theme is the default. Dark theme is a token variant selected by the top-bar toggle or `?theme=dark`; the preference is stored under `flowboard-ui-theme`.
- `View as` is a design-review control, not authentication. The fixed preview identities are **Alice Owner**, **Charlie Manager**, **David Member** and **Eve Viewer**. A roster role change does not change the preview identity; People shows a mismatch note and asks you to reload to restore the synthetic roster.
- Role and theme are propagated through links with `?role=` and `?theme=`. The Owner role is the default and is removed from the URL.
- Restricted screens render an access-denied state rather than a blank page. UI hiding is never presented as authorization.

### Fixed role capabilities

| Capability | Owner | Manager | Member | Viewer |
|---|---:|---:|---:|---:|
| Read project, boards and cards | Yes | Yes | Yes | Yes |
| Create, edit, assign and move cards | Yes | Yes | Yes | No |
| Comment and upload private images | Yes | Yes | Yes | No |
| Delete card and restore before 24h | Yes | Yes | No | No |
| Invite Member or Viewer | Yes | Yes | No | No |
| Grant or remove Manager | Yes | No | No | No |
| Configure boards and columns | Yes | Yes | No | No |
| Create, archive or reopen project | Yes | No | No | No |
| Upload and confirm Excel imports | Yes | Yes | No | No |
| See project access events | Yes | Yes | No | No |

Members can create cards through Add card. The Add card denial applies to **Viewer** only. Trash and Import are Owner/Manager only. People and Settings are read-only for Member/Viewer.

### Project and board access fixtures

- **My Fashion** is the default project. It has three boards: **Web** (Alice, Charlie, David), **Marketing** (Alice, David, Eve) and **Operations** (Alice only), with ten synthetic cards. The Owner sees all three boards and ten cards.
- **Website Redesign** is active with one **Website Kanban** board and all four people. **Brand Refresh** is archived with one **Brand Guidelines** board and only Alice and Eve.
- A non-owner needs the project grant **and** a grant for each board. Charlie/Manager therefore sees Web only (4 cards); David/Member sees Web and Marketing (7 cards); Eve/Viewer sees Marketing only (3 cards). Operations is hidden from all three, including its name, counts and cards.
- The Owner can create a board with initial grants from current project members only. The Owner is locked in; other members are opt-in. A project can exist with zero boards, and its first board can be created from the empty state.
- Local project, board, archive and grant changes are stored under `flowboard-portfolio-demo-v2` in `sessionStorage`. Reloading keeps them for the tab session; a new session resets them. No API is called.
- Archived projects are read-only: New board and the per-board access editor are hidden, and only the Owner sees reopen controls.

## Deep links for review

| Review state | URL |
|---|---|
| Screen library | `/screens/` |
| Sign in, signed out | `signin.html` |
| Sign in, callback error | `signin.html?state=callback-error` |
| Sign in, expired session | `signin.html?state=expired` |
| Sign in, rate limited | `signin.html?state=locked` |
| Sign in with invitation return path | `signin.html?next=invitation.html%3Fstate%3Dvalid%26signed%3D1` |
| Invitation, signed out | `invitation.html` |
| Invitation, signed in | `invitation.html?signed=1` |
| Invitation accepted | `invitation.html?state=accepted&signed=1` |
| Invitation expired | `invitation.html?state=expired` |
| Invitation revoked | `invitation.html?state=revoked` |
| Invitation wrong account | `invitation.html?state=mismatch&signed=1` |
| Invitation already a member | `invitation.html?state=already&signed=1` |
| Invitation invalid link | `invitation.html?state=invalid` |
| My tasks as Owner | `my-tasks.html` |
| My tasks as Member | `my-tasks.html?role=member` |
| My tasks as Viewer, empty | `my-tasks.html?role=viewer` |
| My tasks, high priority | `my-tasks.html?priority=high` |
| My tasks, completed shown | `my-tasks.html?completed=1` |
| Projects, map (default) | `projects.html` |
| Projects, list | `projects.html?view=list` |
| Projects, archived | `projects.html?tab=archived` |
| Projects as Manager | `projects.html?role=manager` |
| Projects as Member | `projects.html?role=member` |
| Projects as Viewer | `projects.html?role=viewer` |
| Project workspace, Overview | `project.html?project=my-fashion` |
| Workspace Board, Web | `../index.html?project=my-fashion&board=fashion-web` |
| Project workspace, All boards | `project.html?project=my-fashion&tab=all` |
| Project workspace, All boards board layout | `project.html?project=my-fashion&tab=all&view=board` |
| Project workspace as Manager | `project.html?project=my-fashion&role=manager` |
| Project workspace as Member | `project.html?project=my-fashion&role=member` |
| Project workspace as Viewer | `project.html?project=my-fashion&role=viewer` |
| Archived project as Owner | `project.html?role=owner&project=brand-refresh` |
| Archived project as Viewer | `project.html?role=viewer&project=brand-refresh` |
| Project workspace, hidden board denied | `project.html?project=my-fashion&board=fashion-operations&role=member` |
| Legacy Project work redirect | `all-work.html?project=my-fashion` |
| Add card as Owner | `add-card.html` |
| Add card as Member | `add-card.html?role=member` |
| Add card as Viewer, denied | `add-card.html?role=viewer` |
| Inbox | `inbox.html` |
| Inbox as Viewer | `inbox.html?role=viewer` |
| Inbox unread filter | `inbox.html?filter=unread` |
| Activity as Owner | `activity.html` |
| Activity as Manager | `activity.html?role=manager` |
| Activity as Member | `activity.html?role=member` |
| Trash, active window | `trash.html?role=owner&state=active` |
| Trash, expiring soon | `trash.html?role=owner&state=expiring` |
| Trash, expired | `trash.html?role=owner&state=expired` |
| Trash as Manager | `trash.html?role=manager` |
| Trash as Member, denied | `trash.html?role=member` |
| People as Owner | `people.html` |
| People invite dialog | `people.html?invite=1` |
| People as Manager | `people.html?role=manager` |
| People as Viewer | `people.html?role=viewer` |
| Import with blocking rows | `import.html?sample=errors&stage=preview` |
| Import with clean rows | `import.html?sample=clean&stage=preview` |
| Import confirmation | `import.html?sample=clean&stage=confirm` |
| Import result | `import.html?sample=clean&stage=done` |
| Import as Member, denied | `import.html?role=member` |
| Settings, project tab | `settings.html?tab=project` |
| Settings, board and columns | `settings.html?tab=board` |
| Settings, account | `settings.html?tab=account` |
| Settings, appearance | `settings.html?tab=appearance` |
| Settings as Viewer, read-only | `settings.html?role=viewer` |
| Settings in dark theme | `settings.html?tab=appearance&theme=dark` |
| Approved board | `../index.html` |
| Approved board, dark | `../index.html?theme=dark` |
| Approved board, viewer card | `../index.html?role=viewer&card=card_106` |

## Screen notes

### Sign in

- The provider set is deliberately not final. The page shows SSO, Google and Microsoft as layout options, then states that no production identity provider or callback route exists.
- `?state=` previews callback failure, expired session, access denied and rate limiting. The provider buttons simulate a redirect and never create a session.
- `?next=` accepts only a same-folder `.html` path. It is used to show the return path from sign-in to an invitation. Absolute URLs, protocol-relative URLs and parent paths are rejected.
- Email-only sign-in is not shown because the backend review treats it as unsafe. The production provider and callback contract remain a P0 backend decision.

### Invitation accept

- The preview shows only the project name, inviter, role and expiry before acceptance. It deliberately omits the member list, project description, card content and any token.
- Signed-out acceptance routes through Sign in with a return path. Signed-in acceptance simulates a successful grant and then shows the accepted state.
- `?state=` previews accepted, expired, revoked, email mismatch, already a member and invalid link. `?signed=1` previews the signed-in variant.
- There is no decline action because the backend contract has no decline route. “Not now” simply leaves the page.
- The invitation fixture is Maya Chen; the email-mismatch state uses David Member. These identities are local to this screen and do not change the fixed View-as identities.

### My tasks

- The queue is derived from the signed-in preview identity. Alice, Charlie and David have assignments; Eve is a Viewer and is not assignable, so her queue is empty by design.
- Open tasks are grouped into Overdue, Due today, Next 7 days, Later and No due date. Completed cards are hidden behind a disclosure and use the same filters.
- Each row carries project, board and column context plus priority, due state, comment count and image count. Opening a row uses the approved board deep link.
- Filters cover text, project, priority and due bucket. They update the URL and never widen project access.
- Marking a card done uses the shared confirmation dialog, moves the card locally and updates the counts. The copy explains that production needs current card and board versions. Viewers cannot change cards.


### Projects

- Two layouts over the same accessible project list: **Map** (default) shows a project root connected to its board branches; **List** is a compact row with board chips. `?view=` keeps the choice in the URL.
- Each project root shows authorized board count, card/open/overdue counts, completion, active/archived state and the Owner-only archive/reopen action. Each board branch shows its own counts, completion, access label and open link.
- Search filters project names, descriptions and authorized board names in the loaded fixture set. It does not imply complete server search.
- Active and Archived tabs use the real synthetic project list. Counts cover only boards the current preview identity can open; hidden boards contribute nothing.
- New project is Owner-only and local. Archive/reopen is Owner-only, confirmed, and changes the local preview only.
- Manager/Member/Viewer see no create or archive controls; they see only projects they belong to and only granted boards.

### Project workspace

- One destination owns the project: Overview first, then one tab per board the identity can open, then a read-only **All boards** tab. The switcher is persistent and sticky, so people move between boards without leaving project context. Board tabs are URL-backed (`?board=`), All boards is URL-backed (`?tab=all`), and the bare project URL is Overview.
- **Overview** is the default landing. A connected board tree lists only boards the current identity can open; each row carries card/open/overdue counts, completion, description, access and an open link. The aside shows an “At a glance” completion donut, Owner-only People board-reach bars, or a non-owner “Your access” chip list, plus an explicit project-access-versus-board-access rule.
- **Board links** open the full workspace Board shell at `../index.html?project=…&board=…`. It loads only that board’s own cards and columns; a newly created empty board starts with the standard workflow. Scoped changes use per-board browser-session snapshots, while archived boards remain read-only and unavailable boards show a generic message.
- **All boards** opens a read-only combined view in the full workspace Board for exactly one project. It keeps the previous combined list/board layouts, filters, sort, paging and card preview. A card keeps its source board and column; it is never moved or copied. Hidden boards contribute no names, counts, cards or options.
- Owner can create a board with name, optional description and initial grants from current project members. The Owner is locked in; other members are opt-in. A zero-board project shows a first-board prompt.
- The Owner-only access editor edits one board at a time, lists current project members only, keeps the Owner locked, stages changes until Save, and never grants a non-member. It is hidden while the project is archived.
- Archived projects show a read-only banner and hide New board, the access editor and archive actions except Owner reopen.
- A project the identity cannot read renders an access-denied state, not a blank page. A board the identity cannot open renders “Board unavailable” without leaking its name, counts or cards.
- `all-work.html` is now a redirect shim: it forwards legacy `?project=&board=` and All-boards filter parameters into the project workspace, so old review links still land in the right tab. The separate screen, script and stylesheet are gone.

### Add card

- The save-first contract is explicit: the card title and fields create the card and return a card ID; images and comments attach only after that ID exists.
- Title is required, 1–200 characters, plain text. Description is optional up to 20,000 characters. Due date is a calendar date with no time or time zone.
- Assignees are project people who can work on cards; Viewers are never assignable.
- After Save, the prototype shows staged images (local placeholders, not uploads), a first comment composer and activity. Nothing is sent or persisted.
- `Open board` returns to the approved board without a fake card ID. `View card` explains that the created card exists only in prototype memory.
- Cancel/discard uses the shared confirmation dialog when the form is dirty.

### Inbox

- Notifications belong to the signed-in person only. Alice has 3 unread, Charlie 1, David 2 and Eve 1 in the synthetic data.
- Filters: All, Unread, Mentions. Mark all read, toggle individual read state and open a notification.
- Deep links are role-checked before navigation in production; the prototype explains that a link to a lost project must show an access-denied state, not the card.
- No email, push notification, digest or unsubscribe behavior is implemented.

### Activity

- Owner sees card history and access events across owned projects. Manager sees granted projects only. Member/Viewer see card history only; access, trash, import and settings events are hidden.
- Filters cover project, person, action and date range; Load more expands the synthetic feed. Filters cannot widen role scope.
- The feed is read-only design evidence, not an audit trail. Production retention, immutability and export are later scope.

### Trash

- The restore deadline is fixed at `deleted_at + 24 hours` on the server clock. A client cannot extend or shorten it.
- The prototype state selector previews Active, Expiring soon (within 1 hour) and Expired states. It changes only the sample timestamp.
- Owner/Manager can browse and restore. Member/Viewer see an access-denied state and no trash surface.
- Restore returns the card to its previous column with comments and private images attached to the original card ID. Expired restore returns a gone state; permanent purge timing and storage deletion are later scope.
- On mobile the table becomes a stacked card so the restore action stays visible.

### People

- Roster shows project people only; being in Acme Corp does not reveal another project.
- Owner can invite Member/Viewer, change any non-owner role, grant/remove Manager and remove people. Manager can invite Member/Viewer, change Member/Viewer grants and remove Member/Viewer, but cannot grant Manager or edit a peer Manager.
- Pending invitations are Owner/Manager only. Resend and revoke update local prototype state; no email is sent.
- The role matrix is explanatory. The fixed View-as identities are documented in the page and in the top-bar title.
- Member/Viewer see a read-only roster with no invite, role or removal controls.

### Import

- Contract: `.xlsx` only, 5 MiB maximum, 200 nonempty data rows maximum, seven required columns (`External ID`, `Title`, `Description`, `Priority`, `Due Date`, `Assignees`, `Status`), create-only, all-or-nothing.
- Invalid or conflicting rows block the whole batch. The error sample has 5 rows: 3 ready, 1 invalid due date and 1 External ID conflict. The clean sample has 3 ready rows.
- Confirm creates no partial success: if any row is invalid or conflicting, commit stays disabled. The result stage reports created cards and skipped/conflicting rows.
- Comments, mentions, activity, images, projects, boards, people and card keys are not imported. Unknown people or statuses block the batch.
- **The prototype cannot parse XLSX.** A selected file is validated by name and size only; previews use the labelled sample rows. The template download is a real XLSX file copied into this folder.
- Owner/Manager only; Member/Viewer see an access-denied state.

### Settings

- Tabs: Project, Board and columns, Account, Appearance.
- Project name/description edits, board name/description, column add/rename/move/remove, archive/reopen and theme are local-only. Dirty state is shown; Save is explicit.
- Archive is reversible and Owner-only. Reopening restores editing. Deleted-card restore deadlines continue while archived.
- Member/Viewer see disabled controls and a read-only explanation. Account fields are disabled design placeholders; profile editing is later scope.
- Appearance switches light/dark tokens immediately. No setting is persisted except the theme preference.

## Intentional limitations

- No API, database, server state, authentication, session handling or authorization enforcement.
- No real project/member/invite/role persistence. Reloading keeps this tab's demo edits in sessionStorage; closing the tab resets them.
- No XLSX parsing, workbook byte handling, upload progress or server validation.
- No email delivery, mention notifications, push notifications or digests.
- No real image storage, signed URLs, upload or image verification. Add card images are local placeholders.
- No real comments, mentions, activity log, audit retention or export.
- No pagination, optimistic concurrency, conflict resolution or real-time updates.
- No production accessibility conformance claim. The screens use skip links, labelled controls, focus handling in shared dialogs, visible focus and reduced-motion rules, but a formal audit is still required.
- No feature in this library is integrated or verified. The UI checklist remains 0/98.

## Design review checks performed

- `node --check` passes for `portfolio-model.js`, `projects.js`, `project.js`, `screens.js` and `hub.js`.
- HTML unique-ID and local asset-link checks pass for `projects.html`, `project.html`, `all-work.html` and `screens/index.html`; CSS brace balance passes for `project-work.css`, `projects-hub.css`, `screens.css` and `styles.css`.
- Headless Chrome review covers the unified workspace at 800px and 390px-class widths in light and dark: Overview, Web/Marketing/Operations board tabs, All boards list and board layouts, card preview, archived project and the legacy redirect. No console errors; no horizontal document overflow.
- Role assertions: Owner sees My Fashion 3 boards/10 cards; Manager 1/4; Member 2/7; Viewer 1/3. The switcher, board rows, All boards counts and card lists all rebuild on role change; Operations appears zero times in text or DOM outside the Owner view. A Member deep link to the Operations board renders “Board unavailable” with zero cards and no board name.
- Link assertions: portfolio board arrows open `project.html?project=…&board=…`; “All boards” opens `?tab=all`; “Open project” opens the bare project URL (Overview). `all-work.html` forwards project/board/card and All-boards filter parameters.
- Interaction checks: empty and duplicate project-name validation; zero-board project and first-board creation; board creation with Owner + Charlie (2 people); revoking and restoring David's Web grant; archived project hiding New board and the access editor; single Reopen action in the archived banner; reopen; search/stage/priority filter and reset; board layout toggle; card deep link by ID and by board; card preview close via Escape and URL cleanup; history back/forward restores the active tab; a role switch away from a no-longer-granted board drops the `board` param and falls back to Overview without changing the direct denied-deep-link state.
- Shared-shell check: the compact summary strip used by the hub, Activity, People and Trash keeps its row layout, stacked label/value and divider rules after the board summary refresh.
- Earlier checks for the other screens (role gates, sign-in states, invitation, My tasks, Add card, Inbox, Activity, Trash, People, Import, Settings) remain historical evidence for those surfaces and were not re-run in this pass.

These checks establish artifact behavior only. They do not establish API behavior, authorization, persistence, search completeness, migration or production performance.

Last reviewed: 27 October 2026.

Independent review: [project-workspace-unification-2026-10-27.md](../reviews/project-workspace-unification-2026-10-27.md) — see the record for the current score. This is not API, authorization, persistence or backend approval.


27 October Project workspace revision: `projects.html` (Map/List) → `project.html?project=my-fashion` with `[Overview] [Web] [Marketing] [Operations] [All boards]`. Overview is the default landing; board arrows now open the selected full workspace Board; All boards is the read-only combined view; old `all-work.html` links redirect into the right tab. The index uses a connected project-to-board map by default, with a compact list alternate. My Fashion seeds separate board memberships; the Owner can create a board with initial grants and stage/save local grant edits from each board's Access button. Palette 1 tones identify project/board nodes and meters; the mark/tone is presentation only. Server access, API paging, summary read models and migration are pending the revised backend handoff. Reference analysis and the backend proposal are under root docs/research and docs/handoffs/proposals.


### Board navigation follow-up

Project map board names, chips and arrows, plus board links in Project Overview, open the full workspace Board with the project and board IDs. Legacy project and All boards links containing a board ID redirect there too, preserving role, theme, card and view parameters. The workspace validates the selected project/board against the local separate-board grants; missing, mismatched or inaccessible boards do not fall back to Website Kanban. Archived boards open read-only. The standalone Board default without a board ID remains Website Kanban. Per-board session snapshots keep local preview edits separate and refresh project card counts. These are client-side fixtures, not backend authorization or integrated persistence.


### All boards navigation follow-up

Projects and Project Overview All boards actions now open the full workspace Board with `scope=all` and one explicit project ID. Project-scoped accessible cards are grouped into three semantic stages, labeled with their original board and column, and open their source board when selected. The combined view never writes or mutates source-board snapshots. Existing `project.html?tab=all` and `all-work.html?project=…` links redirect to this workspace view. Individual board links remain unchanged. This is local design evidence and does not establish backend access or persistence.
