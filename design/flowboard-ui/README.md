# Flowboard UI artifact — board and card detail

Status: design evidence only. Synthetic data, no API calls, no persistence. This is **not** the production app and does not verify any feature in `docs/FEATURE_CHECKLIST.md`.

The artifact explores the highest-risk Flowboard surfaces first: the board shell and the card-detail drawer. It is intentionally a dependency-free HTML/CSS/JavaScript prototype so the visual and interaction direction can be reviewed before the Next.js implementation exists.

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
| `/?role=viewer` | Read-only viewer board |
| `/?role=viewer&card=card_106` | Viewer card detail with no composer, upload or Move |
| `/?card=card_104` | Card detail with comments, images and activity |
| `/?card=card_102` | Card with two private image thumbnails |
| `/?role=manager&card=card_101` | Manager can edit, move and delete, but cannot grant managers |

Reloading resets all data. Theme preference is the only value stored locally.

## What is covered

### Board shell

- Compact desktop shell with workspace rail, breadcrumb top bar, presence, role preview and theme toggle.
- Responsive layout: rail becomes a drawer below 980px; columns become horizontally swipeable below 720px.
- Board header with project context and honest summary strip:
  - total cards;
  - due in 7 days;
  - overdue;
  - completed;
  - distribution by actual column counts.
- No invented progress percentage, win rate, velocity or story-point total.
- Search, assignee filter and due-date filter. Filters are client-side in the artifact; the production API must own filtering and pagination.
- Four columns with live counts, empty states, completed-column collapse and per-column quick add.
- Card anatomy: key, priority, title, description excerpt, private-image thumbnails, due state, comment/image counts and assignee stack.
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
- Delete card moves it to trash with a 24-hour recovery message and Undo in the prototype.
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
- Warm neutral canvas, white cards and a restrained green accent. Column tints are semantic, not decorative.
- The authoritative token values are the CSS custom properties at the top of `styles.css`: canvas, surface, ink, muted, accent, danger, warning, column tints, radii and shadows.
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
| CSS transitions | Framer Motion for enter/exit and layout transitions; CSS for simple hover/focus |
| Native drag events | dnd-kit with pointer, touch and keyboard sensors; keep the Move dialog as the accessible alternative |
| In-memory `FB` state | TanStack Query for server state and mutations; Zustand for ephemeral UI state |
| Manual form validation | React Hook Form + Zod at the client boundary; the same rules must be enforced by the API |
| Inline SVG sprite | Lucide icons |
| Custom toasts | Sonner or an equivalent accessible toast primitive |
| Screenshot review | Playwright interaction and visual checks once `apps/web` exists |

The production board must keep native scrolling. Lenis, if used, is limited to page-level scrolling; Locomotive Scroll is not recommended for a nested, drag-heavy board because transform-based scrolling complicates hit-testing, focus and nested scroll behavior.

## Verification performed

- `node --check` passes for all five artifact scripts.
- Browser console is clean in Chrome.
- Manual interaction checks: open/save/discard card, unsaved-close confirmation, move + Undo, drag/drop + Undo, filters, quick add + Undo, column rename/tone, share invite validation, delete + Undo, image upload/remove + Undo, comment post/edit/delete + Undo, mention insertion, role switching and theme switching.
- Screenshot review at 1440×1000 desktop, 390×844 mobile, dark theme, viewer role and mobile card detail.
- No horizontal page overflow at 390px; the board itself scrolls horizontally by design.

These checks establish artifact behavior only. They do not establish API behavior, authorization, persistence, accessibility conformance or production performance.

## Next design surfaces

After the board/detail direction is approved:

1. Projects list and project overview.
2. Trash with the exact 24-hour cutoff and restore states.
3. XLSX import: template, file selection, preview, row errors and commit result.
4. People and invitations, including pending/revoked states.
5. Activity and Inbox, including mention read/unread states.
6. Settings: project, board, columns and account.

Each screen should reuse the same tokens, role matrix and honest data rules, and should be reviewed before implementation.
