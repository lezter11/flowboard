# Flowboard design direction

Status: reference-informed exploration, not a fully accepted product-wide visual design. The sign-in page is locked for this design iteration with Palette 1 and IBM Plex Sans. Palette 1 is also applied to the board design artifact for this review; production rollout and final logo approval remain under review. Updated 2026-10-26.

## Source and ownership

All originals and their checksums live in [docs/references](docs/references/README.md). UI owns implementation in apps/web after the shared contract and first visual flow are ready. Backend also reads the reference catalogue to understand visible states, counts, metadata and detail-loading needs. Reference business content never expands scope.

The dedicated [brand design guide](design/flowboard-ui/brand/design.md) tracks sign-in color tokens, typography decisions, themes, logo status and Flowboard-created asset locations. It is separate from the product reference catalogue.

## Direction to explore

The newest reference suggests a quiet light workspace: slim left navigation, readable task heading, a broad lifecycle summary, pale column surfaces, white cards and compact metadata. Palette 1 now colors the board artifact's wordmark, column surfaces and action cues, with dark mode as a matching token variant. Earlier references show other density and summary treatments. Do not infer an AI-agent navigation system, financial metrics or workflow automation.

Proposed initial vibe: calm, precise and easy to scan. Favor layout and typography over decorative effects. Card title is strongest, then assignee/priority/date and comment/activity metadata. Large boards use horizontal scrolling with clear affordances; details use a focus-managed dialog/drawer suitable for viewport size.

## Tentative tokens

These values mirror the current prototype's runtime tokens where noted. They are proposed starting values, not sampled brand assets or approved product-wide tokens.

| Token | Proposal | Reason |
|---|---|---|
| Font | IBM Plex Sans on sign-in; board artifact retains its Inter-first system stack | Typography rollout is scoped to the sign-in design until reviewed across dense board states |
| Palette 1 | Thistle `#CDB4DB`, Pastel Petal `#FFC8DD`, Baby Pink `#FFAFCC`, Icy Blue `#BDE0FE`, Sky Blue `#A2D2FF` | User-selected calm pastel palette, applied to light and dark board-artifact tokens |
| Canvas / secondary surface / card | `#F8F5FA` / `#F1EBF5` / `#FFFFFF` (light); `#201C24` / `#28222E` / `#302A36` (dark) | Neutral surfaces keep card content readable while the palette carries the accents |
| Main text / accent | `#2D2532` / derived plum `#684B7C` (light); pale text / thistle action (dark) | Derived text/action colors maintain contrast on pastel surfaces |
| Border | `#E3D9E9` (light) / `#4B4052` (dark) | Low-contrast separation without relying on nested containers |
| Radius | 8px controls, 12px cards | Consistent compact geometry |
| Spacing | 4px base; 8/12/16/24px common steps | Predictable density |

## Sign-in direction for review

Use a two-column desktop layout: the sign-in action sits on the left and a compact Flowboard board preview sits on the right. Stack the form first and preview second on narrow screens. This keeps the Google action early in the usual left-to-right scan and preserves a board view without squeezing the sign-in area. A form on the right could also work; research has not established a reliable conversion winner for either position.

A study of frequent travelers reported that sign-in location did not make a discernible difference across left, center and top placements, while hard-to-see controls caused trouble. That study supports clear, prominent placement more strongly than any universal left/right rule. We choose left-form/right-preview because it follows the user's two references and reads naturally in this English interface. If Flowboard usage later gives us enough people to compare variants, sign-in completion and time-to-action would be useful measures.

The sign-in preview provides three switchable user-proposed palettes and IBM Plex Sans. The board design artifact now uses selected Palette 1 in light and dark themes, but its type stack and the production app remain separate rollout decisions. The proposed sign-in type scale is H1 36–40px, H2 22–24px, H3 16px, body 16px and supporting text 14px. The smaller board preview scrolls inside its frame on narrow screens so labels remain legible. See the brand guide for tokens and asset rules.

The Google control uses the explicit “Continue with Google” label, the standard multicolor G on white, and a white outlined button. Google's current branding guidance recommends its Identity Services rendered button for a production integration; this HTML control is only a design preview and makes no OAuth request.

Sources: [Center Centre sign-in placement study](https://articles.centercentre.com/user_expectations/), [Google Identity sign-in button guidelines](https://developers.google.com/identity/branding-guidelines).

## Components and states

### Board header and motion

The board design artifact refines REF-05 after the space feedback in REF-09. A 34px title/actions row and compact toolbar replace the large summary panel. The toolbar includes search, icon filters, card appearance and a small all-board status strip. Column headings provide the visible status legend; total/open/completed counts remain accessible and the status bar names its actual column counts. Due/overdue icons expose their meaning and counts through labels/tooltips, disappear at zero, and never show a simulated update time. Filter match counts appear only while filters are active.

Navigation starts collapsed to prioritize the canvas. The hamburger expands the rail on desktop; below 980px and in fullscreen it opens a modal navigation drawer with an inert background, focus trap, close button, scrim and Escape dismissal. Fullscreen requests the document root so card drawers and dialogs remain included. Unsupported or rejected requests retain an expanded-window layout; the exit control and Escape restore the ordinary layout and prior desktop navigation state. Escape in an active card/dialog is left to that layer. Browser behavior follows the [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API), and needs real browser verification.

The board fills the available width and remaining viewport height, with horizontal board browsing and vertical column scroll. List view owns its vertical scroll. Wide columns reveal more description text through container queries, while text measures remain bounded. Width caps and redundant footer copy are removed from this board artifact only; the sign-in and other screen artifacts retain their existing layouts.

Palette 1 colors the bar and the existing wordmark. The primary action stays plum for contrast. The view switch moves its selected background in 220ms, SVG action icons respond in 180ms, and status-bar segments move in 240ms only when counts change. Content starts visible, no perpetual animations run, and reduced-motion preferences remove spatial transitions.

The HTML artifact uses CSS and the browser's Web Animations API. The future React app uses Motion for React for state-driven transitions; GSAP is optional for a complex authored sequence. Native scrolling remains the board default. See [ADR 0003](docs/decisions/0003-nextjs-frontend.md) for the library boundaries and alternatives.

The user-supplied [image compression snippet](docs/snippets/compressCardImage.ts) is preserved for later frontend use. It is a saved reference, not an integrated upload path; its fixed-quality encoding does not enforce the comment's 250 KB target.

### Card comparison: Focus and Soft glass

The card design is being compared, not locked. `?cards=focus` (default) and `?cards=glass` show the same records with distinct anatomy. The board toolbar's Cards selector preserves filters, view state and column scroll positions. List view retains its compact existing layout and hides the comparison selector until Board view returns.

| Direction | Reading order and material | Tradeoff |
|---|---|---|
| Focus | Priority/deadline scan row; strong title and compact description; owner at the start of a divided footer, activity counts and stable key at the end. Solid surfaces, defined edge, no card shadow. | Best for dense scanning; metadata can wrap in narrow columns. |
| Soft glass | Quiet key and frosted Move control; larger, lighter title; description followed by priority/deadline signals and an owner/activity footer. Opaque pearly surface lightly mixed with its column color. | More expressive and slightly taller; blur support and visual contrast need device checks. |

Move remains a separate control outside the card-open target, visible in both directions and enlarged to 44px for coarse pointers. Focus, hover, drag, reduced-motion, reduced-transparency, increased-contrast and forced-color paths remain explicit. Glass is limited to the small action tray, with an opaque fallback; task content itself is not translucent. No progress percentage, financial value or invented task field is introduced.

REF-10/11 refinements: the status strip uses about 58% of a wide toolbar and the bar fills its available area. Card lists and the composer cannot flex-shrink inside the scrolling column, with a 12px gap and explicit inset. Board image previews default off and can be enabled from the Card display gear; only the boolean preference is stored locally. Attachment counts and card-detail access are preserved. Description previews use one line, up to two on wide columns; short desktop viewports hide descriptions to prioritize titles and metadata. Target four visible rows where there are enough cards, without hard card heights or tiny functional text. Rendered capacity still requires viewport checks.

The current board includes an empty red Blocked column before Completed. It is an active custom workflow stage, not a completed category. In progress uses a stronger blue surface; Testing uses cool pastel grey. Completed remains pastel green. Priority colors are user-directed semantic colors: High is muted red, Urgent deeper red, Medium blue and Low green. Labels remain visible alongside colors. The brand guide records the light/dark color pairs.

Research: Apple's [materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) treats Liquid Glass as a controls/navigation layer and recommends standard materials for content. Carbon's [tile guidance](https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines) informs keeping actions distinct. [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) guide readable labels and usable controls. These are design constraints, not proof of conformance.

Board shell, workspace/project switcher, column header/count/settings, task card, quick add, filter bar, card dialog, assignee/mention picker, comments/activity, Move menu, confirmation and notification inbox. Summary counts must have a defined denominator and filter scope; never infer progress percentage from a column name.

Each component needs loading, empty, error, disabled, pending and permission states where applicable. A stale move shows a recoverable conflict and canonical state, not a false success. Support long titles, duplicate names, emoji, no assignee, multiple assignees and overdue dates.

## Interaction and performance

Provide visible click/tap Move as well as keyboard support and drag. Preserve focus; announce movement; never rely on color alone. Dialogs manage focus, labels, Escape and unsaved drafts. Mention selection must respect IME input and ordinary editing.

Lazy-load detail content, paginate board/comment data and measure rendering with realistic card counts. Consider virtualization only after profiling; test drag, focus and screen-reader behavior with it. Bundle size and interaction latency get measured budgets rather than assumptions.

## Pending design review

- [ ] Choose final light/dark direction and accent.
- [ ] Review one board + card dialog + Move + comment flow.
- [ ] Agree desktop/narrow viewport behavior and card density.
- [ ] Verify contrast, keyboard, click/tap alternatives, zoom and reduced motion in implementation.
- [ ] Record approved tokens/components here before scaling UI work.

## Required screen flows v0.3

Follow [FEATURE_SPEC.md](docs/FEATURE_SPEC.md) for detailed behavior. Project navigation shows only owned/granted projects. Owner sees all owned projects; Manager is labeled inside the current project. People/settings/import/trash actions follow the Owner/Manager permission matrix.

Screens to design and implement after corresponding backend handoff: sign-in/invitation states; projects and project setup; project board list; board/search/filters and counts; card popup with fields and separate Save/Post/Upload; private image gallery; chronological card activity and owner cross-project feed; project people/pending invitations; 24-hour trash with exact deadline and restore destination; Excel template/download/upload/preview/mapping/error/confirm/result states; My tasks; inbox; archive/reopen settings.

Card Delete is Owner/Manager only and explains the 24-hour recovery period. Popup shows title, description, priority, date-only due date, project-eligible assignees, comments, images and activity. Uploading/posting must not accidentally save form drafts. File/upload errors stay specific; expired restore never looks successful. The seven-column import template has blank Cards and separate Instructions/examples.

Visual exploration may proceed before backend completion, but production UI implementation for each feature follows its verified API/evidence handoff. UI updates its own evidence and regenerates the central checklist; it must not mark a fixture-only screen integrated.


### Board color and interaction refinement — 2026-10-27

Testing uses cool grey (`#EDF0F3` light / `#30353D` dark), with `#D5DCE4` in the pastel picker. Completed retains pastel green (`#B8F2C8` picker/distribution, `#EAF6ED` light column / `#223B2C` dark column). Column settings offer ten named pastel presets with a live preview: Lavender, Ice blue, Grey, Green, Coral, Rose, Mint, Peach, Butter and Lilac. Arrow keys, Home and End select within a single-tab-stop radio group. Selection is staged until Save; Cancel preserves the existing column.

A shared floating tooltip provides status-column name, card count and share of all board cards, plus overdue and upcoming deadline counts. These are card distribution counts, not estimates of task completion. Overdue uses a clock-alert icon; due soon uses a calendar-clock icon. Tooltips use safe text, appear on keyboard focus as well as pointer hover, remain hoverable, dismiss with Escape, and clear on scroll, resize, board replacement and overlay changes. Existing titled board controls, metadata and bounded card descriptions participate. Brief hover/focus motion preserves layout; reduced motion disables transforms and tooltip arrival animation. Touch retains the existing actionable controls.

Verification covers source and mock-DOM interactions only. Rendered placement, actual pointer travel and screen-reader output still require an interactive browser check.


### Board follow-up and Settings parity — 27 October 2026

Status details show immediately on pointer hover or mouse hover through capture-phase event handling, with keyboard focus retained as an additional way to reveal them. Clicking or focusing is not required. Tooltip text remains hoverable with a short leave grace period. No click handler is used to reveal it.

The separate Settings → Board and columns editor now uses the same ten-color pastel direction as the board editor. Visible swatches, selection checks and a named live preview replace the legacy Neutral/Blue/Amber/Green select. A finite whitelist rejects unsupported colors; arbitrary hex input is intentionally absent, so users cannot select a non-pastel color. These settings remain local preview state, independent of the approved board artifact.

New-card creation requires an explicit Low, Medium, High or Urgent priority. Neither the board composer nor full Add Card form silently selects one. Invalid submission retains typed content and shows an error. The sample import preview blocks missing/none/unsupported priority and preserves valid row priorities when creating its local cards. Existing fixture cards with no priority are unchanged. This is a user-requested frontend rule; existing API/default/import contracts still permit none and require a separately coordinated backend change before integration.

Bounded independent source/mock-DOM review: 9.1/10, no blockers, with browser rendering unverified. Review evidence is under design/flowboard-ui/reviews/board-followup-2026-10-27.md. Projects backend research is prepared under docs/research/projects-ui-backend-readiness-2026-10-27.md; Projects UI redesign is not started by this work.


### Projects → boards and one-project workbench — 27 October 2026

Three preserved visual references inform the design: REF-14's connected summaries, REF-15's vertical branching, and REF-16's parent/child hierarchy. Flowboard uses ordinary linked project cards and a semantic connected board list rather than a freeform node canvas. This supports keyboard navigation and a naturally stacked mobile layout. Project identity marks and board nodes carry the existing pastel brand colors; broad content areas remain calm readable surfaces.

Projects supports search, Active/Archived tabs, Cards/List layouts and Owner-only local create/archive/reopen. A project overview shows its visible boards and an All boards action. My Fashion demonstrates Web, Marketing and Operations. Each board has independent membership, configurable through an Owner access dialog with staged Save/Cancel and a locked Owner row. Non-Owners need both project membership and board access. Project cards count only the current person's accessible boards; a zero-board project stays visible without revealing hidden board names/counts.

All boards always selects ONE project, including for the Owner; it has no cross-project card aggregation. The full workspace Board groups accessible cards into todo/active/done categories and displays each source board and original column. Its combined view is read-only; a card opens on its source board for editing. Individual boards retain their own original columns. Archived boards are read-only and inaccessible boards show a generic unavailable state.

The local complete fixture arrays support derived totals, title/due sorting and archived browsing. These are preview behaviors, not API commitments: the earlier QRY-04 proposal had fixed updatedAt ordering and no totals, and its project-wide inheritance assumption is now superseded. Before API wiring, the revised board-grant contract and every dependent authorization path must pass the backend gate; unavailable counts/sorts/archive scopes must be omitted or deliberately implemented. Session storage only retains local demo project/archive/board-membership edits and is not server authorization or persistence.

Current scoped independent source/mock assessment: 9.1/10, no blockers. Prior 8.9 assessment covered the now-superseded inheritance policy. Rendered browser behavior remains unverified. See design/flowboard-ui/reviews/projects-board-access-2026-10-27.md.


### Project board navigation — 27 October 2026

Each board name and arrow in Projects, and each board link in Project Overview, opens the full workspace Board for that project and board. All boards opens the full workspace Board with a read-only, project-scoped combined view. A workspace Board shows its own original columns and cards, with the correct board name and breadcrumb; new empty boards start with the standard workflow. Local preview changes are keyed by board and retained in browser-session storage so they are not mixed with another board. Access is checked against local project and board grants, archived boards are read-only, and an inaccessible or mismatched board shows a generic unavailable state. These frontend fixtures are not evidence of server authorization or production persistence.


### All boards in the workspace Board — 27 October 2026

The Projects map and Project Overview All boards actions open `index.html?project=…&scope=all`. The full Board displays every card from the current person’s accessible boards in that one project. Three semantic stages group cards from different custom workflows; each card shows its original board and column and links to that source board/card. All completed cards are displayed without a collapsed remainder. The combined view is read-only: creation, drag/move, edit, deletion and snapshot writes are unavailable there. This avoids applying a move to the wrong source board; individual boards retain their normal editing behavior. Role changes rebuild the projection using current preview grants, and malformed scopes or inaccessible projects show a generic unavailable state. This is synthetic browser-session behavior and does not implement server authorization.
