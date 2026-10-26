# Flowboard screens — design library

Status: **design evidence only.** Synthetic data, local browser state and no API calls. This library is separate from the approved board/card-detail artifact and does not verify any feature in [`docs/FEATURE_CHECKLIST.md`](../../../docs/FEATURE_CHECKLIST.md). The UI checklist remains 0/98.

This library adds the nine product surfaces beyond the approved board: Projects, Project overview, Add card, Inbox, Activity, Trash, People, Import and Settings. It reuses the approved artifact's `styles.css` and `detail.css` for tokens, shell, dialogs and toasts. The approved board files are unchanged.

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
| 01 | Projects | `projects.html` | Active/archived project lists, project-only visibility, real counts, create project, archive and Owner-only reopen. |
| 02 | Project overview | `project.html` | One project's boards, summary counts, recent activity, team, access, trash/import entry points and archived read-only state. |
| 03 | Add card | `add-card.html` | Save-first card creation, validation, date-only due date, eligible assignees, and images/comments only after a real card ID. |
| 04 | Inbox | `inbox.html` | Actor-owned notifications, unread/read state, mentions, assignments and safe deep links. |
| 05 | Activity | `activity.html` | Workspace/project/card scopes, actor/action/date filters, load-more and access events for Owner/Manager. |
| 06 | Trash | `trash.html` | Exact 24-hour server-clock boundary, expiring-soon warning, expired state, restore and role restriction. |
| 07 | People | `people.html` | Roster, pending invitations, role changes, Owner-only Manager grants and the role matrix. |
| 08 | Import | `import.html` | Seven-column XLSX contract, sample previews, invalid/conflict blocking and all-or-nothing commit. |
| 09 | Settings | `settings.html` | Project, board/column, account and appearance tabs; dirty state; archive/reopen; read-only role state. |

The approved board remains at `../index.html` and the board/detail notes remain at `../README.md`.

## Shared shell and review controls

- `screens.js` injects the rail, top bar, breadcrumbs, presence, role preview, theme toggle, dialog layer, toast layer and SVG sprite. There is no build step.
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

### Project-only access fixtures

- **Website Redesign** is active and includes all four people: Alice, Charlie, David and Eve.
- **Brand Refresh** is archived and includes only Alice and Eve.
- Charlie/Manager and David/Member therefore cannot see Brand Refresh, including on the Archived tab. Alice/Owner and Eve/Viewer can see it.
- Archived projects hide their boards from editing; only the Owner sees reopen controls. Viewer sees a read-only archived overview.

## Deep links for review

| Review state | URL |
|---|---|
| Screen library | `/screens/` |
| Projects, active | `projects.html` |
| Projects, archived | `projects.html?tab=archived` |
| Projects as Manager | `projects.html?role=manager` |
| Projects as Member | `projects.html?role=member` |
| Project overview | `project.html?project=website-redesign` |
| Archived project as Owner | `project.html?role=owner&project=brand-refresh` |
| Archived project as Viewer | `project.html?role=viewer&project=brand-refresh` |
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

### Projects

- Active and Archived tabs; counts use the real synthetic project list, not invented progress percentages.
- Project cards show board count, card count, people, updated/archived time and the actual column distribution.
- New project, archive and reopen are local-only dialogs. Archive is Owner-only; reopen is shown only to the Owner.
- Pending-invite badges and the review link are visible only to Owner/Manager.
- The role guide is explanatory; it does not grant access.

### Project overview

- Summary strip shows boards, cards, people, in-trash count, due-in-7-days and overdue counts. The in-trash stat is hidden from Member/Viewer because trash is restricted.
- Boards, recent activity, team, access, trash, import and project details share the same project grant.
- Pending invitations are visible only to Owner/Manager. Member/Viewer see a locked trash/import explanation instead of entry points.
- Archived project banner explains read-only boards and the Owner-only reopen path.
- Activity includes access events only for Owner/Manager.

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
- No real project/member/invite/role persistence. Reloading resets synthetic state.
- No XLSX parsing, workbook byte handling, upload progress or server validation.
- No email delivery, mention notifications, push notifications or digests.
- No real image storage, signed URLs, upload or image verification. Add card images are local placeholders.
- No real comments, mentions, activity log, audit retention or export.
- No pagination, optimistic concurrency, conflict resolution or real-time updates.
- No production accessibility conformance claim. The screens use skip links, labelled controls, focus handling in shared dialogs, visible focus and reduced-motion rules, but a formal audit is still required.
- No feature in this library is integrated or verified. The UI checklist remains 0/98.

## Design review checks performed

- `node --check` passes for every JavaScript file in this folder.
- HTML tag-balance validation passes for all ten HTML files.
- Headless Chrome audit: no console errors or warnings, no duplicate IDs, no missing sprite icons and no horizontal page overflow at 390px.
- Role-gate assertions cover 101 checks across Owner/Manager/Member/Viewer, including Projects visibility, archived project access, People controls, Activity access events, Settings read-only state and Add card/Trash/Import denials.
- Screenshot review covers 1440×1100 light/dark, 390×844 mobile and review states for role gates, trash states, import errors/clean/result and archived projects.
- Manual interaction checks covered project create/archive/reopen, Add card save/validation/attachments, Inbox filters/read state, Activity filters/load more, Trash states/restore, People invite/role changes, Import samples/commit and Settings tabs/dirty state/columns/theme.

These checks establish artifact behavior only. They do not establish API behavior, authorization, persistence, XLSX parsing, email delivery or production performance.

Last reviewed: 26 October 2026.
