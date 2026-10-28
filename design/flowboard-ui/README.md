# Flowboard UI artifact — board and card detail

Status: design evidence only. Synthetic data, no API calls, no persistence. This is **not** the production app and does not verify any feature in `docs/FEATURE_CHECKLIST.md`.

The artifact explores the highest-risk Flowboard surfaces first: the board shell and the card-detail drawer. It is a dependency-free HTML/CSS/JavaScript design artifact for visual and interaction review. Its records and interactions are synthetic and do not connect to or verify the production app.

## Preview

From the repository root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory design/flowboard-ui
```

Open <http://127.0.0.1:4173/>.

The artifact also works when opened directly from disk, but a local server is recommended so clipboard and storage behavior is consistent.

### Deep links for review

| URL | Shows |
|---|---|
| `/?theme=dark` | Dark token variant |
| `/?view=list` | The same cards grouped by status in List view; filters, card detail and Move remain available |
| `/?cards=focus` | Focus card comparison: deadline first, crisp surface and ownership footer |
| `/?cards=glass` | Soft glass card comparison: pearly surface, content-first hierarchy and frosted Move control |
| `/?role=viewer` | Read-only viewer board |
| `/?role=viewer&card=card_106` | Viewer card detail with no composer, upload or Move |
| `/?card=card_104` | Card detail with comments, images and activity |
| `/?card=card_102` | Card with two private image thumbnails |
| `/?role=manager&card=card_101` | Manager can edit, move and delete, but cannot grant managers |

Reloading resets synthetic card data. Theme and the image-preview display preference are stored locally; view and card appearance use URL state.

## What is covered

### Board shell

- Compact desktop shell with workspace rail, breadcrumb top bar, team avatars (without a live-presence claim), role preview and theme toggle.
- The compact board shell fills available width and the remaining viewport height. Columns retain a readable minimum width and scroll horizontally when needed; each column owns its vertical scroll. Wide columns reveal longer descriptions without unbounded text lines. List mode owns its vertical scroll.
- Navigation starts collapsed. The hamburger toggles the desktop rail and opens a focus-managed modal drawer below 980px or in fullscreen.
- Palette 1 is used across light and dark board surfaces: Thistle `#CDB4DB`, Petal `#FFC8DD`, Baby Pink `#FFAFCC`, Icy Blue `#BDE0FE` and Sky Blue `#A2D2FF`.
- Compact board title/actions row with a working List/Board switch, share control, Add card action and fullscreen toggle. View state remains in the URL; switching views retains filters and in-memory edits.
- A compact status strip in the toolbar replaces the earlier REF-05 summary panel after REF-09 feedback. It covers all cards before filters:
  - total cards;
  - due in 7 days;
  - overdue;
  - completed;
  - distribution by actual column counts.
- Fullscreen targets the document root to include sibling drawers/dialogs. Unsupported or denied native requests keep an expanded-window fallback. Escape and the exit control restore the layout; card/dialog Escape handling takes priority in the fallback. No automatic fullscreen request occurs on page load.
- Selected-view feedback, action icons and count changes use short CSS/Web Animations transitions with reduced-motion support. The artifact adds no motion-library dependency.
- No invented progress percentage, win rate, velocity or story-point total.
- Search, assignee filter and due-date filter. Filters are client-side in the artifact; the production API must own filtering and pagination.
- Five columns with live counts, empty states, completed-column collapse and per-column quick add: Not started, In progress, Testing, Blocked and Completed. Blocked starts empty; existing records are not moved or fabricated.
- Card anatomy: key, priority, title, description excerpt, private-image thumbnails, due state, comment/image counts and assignee stack.
- Two card comparisons live in `card-variants.css`. Use the Cards selector in Board view; it preserves filters and column scroll. Soft glass keeps reading areas opaque, limits blur to a small action control, and includes solid/reduced-transparency fallbacks. Both variants preserve all card operations and share the same records.
- Board image previews are off on first use. The gear beside the appearance selector opens Card display → Show image previews; this local preference is available to every reader. Attachment counts and card-detail images remain available. List view omits previews.
- Cards now use compact spacing and a one-line description default (two on wide columns). Short desktop windows hide the description preview while keeping full text in card details. Four-card capacity is the density target where a column has four or more records; actual visible rows depend on height, title/metadata wrapping, input type and the preview setting.
- The status strip targets roughly 58% of the wide toolbar, and its distribution bar fills that space. Card lists/composers do not shrink inside column scrolling; a 12px gap and inset separate the quick-add form from existing cards.
- Drag and drop when unfiltered; filtered views disable drag and surface the accessible Move path.
- Move dialog with destination, top/bottom position, current counts and Undo.
- Column settings dialog for name and accent, gated to Owner/Manager.
- Share dialog for Owner/Manager, including pending-invite preview and an explicit “no email is sent” note.

### Card detail

- Right-side drawer on desktop, full-screen sheet on mobile.
- Editable title, description, status, priority, multiple assignees and date-only due date.
- Separate **Save changes** and **Discard**; a dirty-state indicator; unsaved-close confirmation.
- Status changes inside the drawer are staged until Save. Moving from the board or Move dialog is immediate and can be undone.
- Comments: post, mention, edit own comment, delete own comment, moderate others as Owner/Manager, relative timestamps and an edited marker.
- Activity tab: creation, assignment, due date, priority, moves, comments and image events.
- Private images: upload, remove, per-image privacy label, file-type/size/count validation copy, immediate upload independent of Save.
- Delete card moves it to trash with a 24-hour recovery message and Undo in this synthetic artifact.
- Viewer state: all fields read-only, no composer, no upload, no Move/Delete, no comment moderation.
- Member state: can edit, move, comment and upload; cannot configure columns, invite, delete or browse trash.
- Keyboard and screen-reader support: focus trap, Escape handling, focus return, visible focus rings, labelled icon-only actions, tab semantics and reduced-motion rules.

## Intentional exclusions

This artifact does **not** cover:

- Projects, Trash, Import, People, Activity, Inbox or Settings screens.
- Authentication, invitations, email delivery, permissions enforcement or session handling.
- Real image storage, signed URLs, upload progress from a server, or image verification.
- XLSX template download, preview or commit.
- Real-time updates, optimistic server reconciliation, pagination or conflict handling.
- WIP limits, labels, swimlanes, story points, approvals, AI agents or automation.
- Charts beyond the summary distribution. “Graphs” in the reference were interpreted as the compact summary bars; separate analytics screens are not designed here.
- Production drag-and-drop. The artifact uses native HTML5 drag events; production should use dnd-kit for touch, keyboard and sensors.

## Design rules

- Light theme is the default. Dark theme is a token variant, not a separate layout.
- Palette 1 supplies the wordmark colors, column tints, focus/action accents and avatar colors in both themes. Neutral surfaces keep text and cards calm; danger and warning colors remain semantic so overdue and destructive states are easy to recognize.
- The authoritative token values are the CSS custom properties at the top of `styles.css`: palette, canvas, surface, ink, muted, accent, danger, warning, column tints, radii and shadows.
- 4px spacing base; 8/12/16/22px radii; 12px minimum metadata size in production tokens.
- Typography uses the Inter stack with a system fallback. Production should self-host Inter through `next/font` or an equivalent licensed setup.
- Due dates are calendar dates (`YYYY-MM-DD`), displayed without times or time zones.
- Private images are visibly marked; the UI never implies a public URL.
- Destructive actions explain recovery. Card deletion says “move to trash” and states the 24-hour window.
- Save, Post comment and Upload are separate actions because they have different failure and retry semantics.
- Summary numbers are derived from the same synthetic card list as the board. They are not independent marketing metrics.

## Production mapping

The artifact deliberately uses no build step. The production mapping is a proposal recorded in [ADR 0003](../../docs/decisions/0003-nextjs-frontend.md).

| Artifact | Production direction |
|---|---|
| Static HTML shell | Next.js App Router route + layout; server components for static shell where useful |
| CSS custom properties | Tailwind theme tokens backed by CSS variables; light default, dark variant |
| Hand-written dialogs/drawer | Radix Dialog/Popover/Tabs primitives or shadcn components with the same focus behavior |
| CSS / Web Animations | Motion for React for state-driven enter/exit and layout transitions; CSS for simple hover/focus |
| Native drag events | dnd-kit with pointer, touch and keyboard sensors; keep the Move dialog as the accessible alternative |
| In-memory `FB` state | TanStack Query for server state and mutations; Zustand for ephemeral UI state |
| Manual form validation | React Hook Form + Zod at the client boundary; the same rules must be enforced by the API |
| Inline SVG sprite | Lucide icons |
| Custom toasts | Sonner or an equivalent accessible toast primitive |
| Screenshot review | Playwright interaction and visual checks once `apps/web` exists |

The production board keeps native scrolling for nested columns, touch, keyboard and drag behavior. Lenis or Locomotive may be evaluated for a future marketing page; Locomotive v5 already uses Lenis, so they are not combined. See ADR 0003 for the motion boundaries.

## Verification performed

- Earlier artifact work recorded interaction and screenshot checks. Those checks are not a rendered review of the current palette and responsive changes.
- Current pass: JavaScript syntax and whitespace checks pass; the independent design audit scored the source without browser rendering. Responsive behavior, visual contrast and icon motion still need a rendered review at laptop, wide-monitor and mobile sizes.
- REF-05 header pass: HTML nesting/unique IDs and reference JSON pass. Node VM probes of the actual board source check total/open/completed counts, List/Board controls and URL state, preserved filters, reopened-card counts and Viewer restrictions. An extended probe builds a mock DOM from the current HTML with Python HTMLParser, executes the actual startup callback, and checks the deep-linked role/view/theme, account-link labeling and all role switches. These probes do not establish rendered layout or browser interaction behavior.
- Card comparison pass: source probes check both style URLs, matching card IDs, date semantics, filters, List mode, roles and native open/Move delegation. The title is a native button; all remaining card fields are exposed as sibling content. Sampled opaque-content/priority text pairs have a minimum calculated contrast of 5.94:1; this is not a full rendered contrast audit. The [independent source review](reviews/card-variants-2026-10-26.md) records the failed first round and passing second round.
- Compact-workspace pass: parsed-HTML VM checks cover desktop/mobile navigation, inert/focus restoration, Tab/Escape/scrim behavior, fullscreen success/failure/unsupported paths, external fullscreen exit, duplicate-click prevention, dialog guards and restored navigation preferences. These mock state transitions do not verify browser fullscreen permission or rendered scrolling/layout. See the [independent source review](reviews/compact-workspace-2026-10-26.md).
- Density/status pass: both Luna implementation streams and the independent Luna reviewer completed source review. Parsed-HTML VM checks cover default-off previews, opt-in/out storage, both styles/List/Viewer behavior, retained attachment data, five columns, Blocked Move/Undo, composer open/submit/Undo and popup Escape/focus return. Priority text samples meet at least 6.10:1, and tested light text on pastel surfaces meets at least 5.75:1. The [Luna source audit](reviews/density-status-2026-10-27.md) is provisional because rendered four-row fit and composer geometry remain unverified.

Source review establishes the artifact's intended behavior only. It does not establish API behavior, authorization, persistence, accessibility conformance or production performance.

## Next design surfaces

After the board/detail direction is approved:

1. Projects list and project overview.
2. Trash with the exact 24-hour cutoff and restore states.
3. XLSX import: template, file selection, preview, row errors and commit result.
4. People and invitations, including pending/revoked states.
5. Activity and Inbox, including mention read/unread states.
6. Settings: project, board, columns and account.

Each screen should reuse the same tokens, role matrix and honest data rules, and should be reviewed before implementation.


Column colors now use ten named pastel presets in the column menu → settings. Testing is cool grey and Completed is pastel green. Picker arrows/Home/End preview a choice; Save commits it in this local artifact. Hover or focus the status bar segments and deadline icons for their counts, and hover titled controls/metadata for context. Card titles expose their bounded description on focus/hover. Tooltips dismiss with Escape; reduced-motion preferences suppress the new arrival and hover transforms. These changes have source/mock-DOM checks; browser rendering is not verified in this session.


27 October follow-up: status tooltips appear immediately on pointer/mouse hover, with no click required. The separate Settings column editor now has visible named pastel swatches and staged validation. New cards require explicit priority in quick-add, Add Card and sample import; failed validation keeps the draft. Import preserves row priority. Actual XLSX parsing and server enforcement remain outside this artifact. Projects redesign preparation is recorded in `docs/research/projects-ui-backend-readiness-2026-10-27.md` at the repository root.


Project workspace: open `screens/projects.html` for the connected project map (or `?view=list`), then open My Fashion. The project is now one workspace: **Overview** lands first, a persistent switcher moves between `[Overview] [Web] [Marketing] [Operations] [All boards]`, board arrows deep-link to the board tab, and **All boards** is the read-only combined view. The separate “Project work” destination is gone; `screens/all-work.html` is a redirect shim that forwards legacy project/board/filter links into the right tab. The independent review is [reviews/project-workspace-unification-2026-10-27.md](reviews/project-workspace-unification-2026-10-27.md) (see the record for the current score; not backend approval). The Owner can create a board with initial grants and edit each board's membership in the project overview; Manager/Member/Viewer see only granted boards, and hidden boards never appear in tabs, counts, options, cards or the DOM. Switch the preview role to compare allowed boards/cards. Local session storage retains these demo grant choices. Combined views keep source project/board/column context and never move/copy cards. Palette 1 tones identify nodes and meters; mark/tone are presentation only. This is a local prototype; backend board-level authorization, summary read models and board creation are a new, separately gated handoff, not integrated behavior.


Project board arrows now open the selected full workspace Board (`index.html?project=…&board=…`). Project/board identity, separate-access preview, source columns/cards and browser-session changes stay scoped to that board. Existing board-only URL defaults remain available. This is local prototype state; backend authorization and persistence are not integrated.


All boards navigation: from a project, **All boards in this project** now opens the full workspace Board at `index.html?project=…&scope=all`. It displays all cards from accessible boards in that project, grouped by workflow category and labeled with their source board and column. Open a card to edit it on its own board. The combined view itself is read-only; separate-board access and one-project scope remain in effect. This is local prototype state only.
