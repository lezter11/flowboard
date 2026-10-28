# Project workspace unification — independent design review

Date: 27 October 2026. Final source: [project-workspace-unification-2026-10-27-manifest.json](project-workspace-unification-2026-10-27-manifest.json). Checks: [project-workspace-unification-2026-10-27-checks.txt](project-workspace-unification-2026-10-27-checks.txt).

Status: **PASS for the local design artifact — 8.8/10, zero blockers, all six categories at least 8.5.** This is not API, persistence, authorization or backend acceptance. The per-board access requirement remains unimplemented and separately gated.

## Scope

The review covers the unified project experience: `screens/project.html/js` and `project-work.css` (Overview, board tabs, All boards), `screens/projects.html/js` (portfolio map/list and board deep links), `portfolio-model.js`, `screens.js/css`, `projects-hub.css`, the legacy `all-work.html` redirect, the review hub `index.html`/`hub.js`, the shared `styles.css` and `detail.css`, the approved board's Projects action link, both READMEs, and the three project handoff/research documents in the manifest. The approved board and sign-in artifacts are otherwise preserved and out of scope.

## Acceptance criteria

- Palette 1 only: thistle, petal, baby pink, icy blue, sky blue and plum; no new palette; Inter on the product pages.
- Workspace → project → boards → columns → cards. My Fashion contains Web, Marketing and Operations; no nested project.
- One Project workspace owns Overview, board tabs and combined cards. There is no separate “Project work” destination, and Overview is the default landing.
- All boards is a read-only tab; individual boards remain the editable source of truth in production. Combined views keep source project/board/column context and never move or copy cards.
- Board arrows deep-link to the board tab (`project.html?project=…&board=…`), not the read-only combined list. “Open project” lands on Overview.
- A persistent switcher moves between boards without leaving project context; URL state is correct and back/forward works.
- A non-owner needs a project grant **and** a separate board grant; the Owner has implicit access in owned projects. Hidden boards leak no name, ID, count, card, option or person, including after a preview role switch and on denied deep links.
- Zero-board projects are supported; the Owner is locked in a new board's grants; creation never copies all project members by default.
- No API, persistence or authorization claim; synthetic fixtures and `sessionStorage` only. Backend untouched.
- Accessibility basics: skip link, labelled controls, focus handling, visible focus, reduced motion; responsive with no horizontal document overflow.

## Review history

This revision was reviewed in two passes by the same independent reviewer, against an exact source manifest. It supersedes the earlier [Projects redesign review](projects-redesign-2026-10-27.md) (8.6 PASS for the pre-unification artifact, now historical evidence only).

1. **8.2 / FAIL.** Blocker **B1**: the board-summary refresh had replaced the base `.summary` rules, so the compact summary strip still used by the hub, Activity, People and Trash rendered as a 375–440px stack instead of a row strip. Moderate findings: **M1** a revoked board id stayed in the URL after a preview role switch, and **M3** the review record did not exist. Minor: stale hub lede, two `h1`s, 4px switcher occlusion at 721–860px, a duplicate Reopen action, and project marks all falling back to thistle.
2. **8.8 / PASS.** All of the above were fixed and re-measured with the browser cache disabled: the compact strip is restored and scoped, the role switch drops only an unreadable board, the manifest is exact, and the hub copy and heading structure are corrected. The record and checks file are written from this verdict, which is the one condition the reviewer attached to PASS.

## Final scores

| Category | Score |
|---|---:|
| Visual craft / Palette 1 fidelity | 8.6 |
| Hierarchy and navigation model | 9.1 |
| Role scoping and data isolation | 9.3 |
| Accessibility and responsive behaviour | 8.6 |
| Code quality and robustness | 8.8 |
| Documentation and handoff accuracy | 8.6 |
| **Overall** | **8.8** |

Overall is 53.0 / 6 = 8.83, rounded to one decimal.

## Verified behavior

- **One destination.** The project URL is Overview by default; `[Overview] [Web] [Marketing] [Operations] [All boards]` is one persistent sticky switcher. Board tabs are URL-backed with `?board=`, All boards with `?tab=all`, and back/forward restores the active tab.
- **Board tabs** render the source board's own columns and cards in project context (Web → Ready, Building, Review, Published; 4 cards). Only the approved Website Kanban board links to the editable board; the rest are read-only previews.
- **All boards** keeps the combined list and board layouts, filters, sort, paging and card preview. Stage filter (`done`) reports “3 shown · 3 matching cards · 10 in this project”; search `checkout` narrows to one card; totals stay project-scoped. Board layout groups by To do / In progress / Completed. A card keeps its source board and column; the preview links back to `project.html?project=…&board=…`.
- **Role scoping.** Owner 3 boards / 10 cards, Manager 1/4, Member 2/7, Viewer 1/3. The switcher, board rows, All boards counts and card lists rebuild on role change. Operations appears zero times in text or DOM outside the Owner view.
- **Denied states.** A Member deep link to the Operations board renders “Board unavailable” with no board name, count or card. The denied board id is absent from the DOM.
- **M1 fixed.** Owner on Operations → Member drops `board=fashion-operations`, lands on Overview, and leaves no Operations trace. Readable boards are preserved: Web → Member keeps `board=fashion-web`; Marketing → Viewer keeps `board=fashion-marketing`; All boards → Member keeps `tab=all`.
- **Portfolio links.** Board arrows open `project.html?project=my-fashion&board=fashion-web` (and the other boards); “All boards in this project” opens `?tab=all`; “Open project” opens the bare project URL. No “Project work” action or footer remains.
- **Legacy redirect.** `all-work.html` forwards `role`, `theme`, `project`, `board` and `card`, and the All-boards filters (`q`, `stage`, `priority`, `sort`, `limit`, `view`, `card`) into the matching project tab. A redirect with `board` + `card` opens the board with the card preview shown.
- **Creation and access.** Owner can create a board with initial grants (created “Support”, 0 cards, active tab). The Owner is locked in; other members are opt-in. The access dialog lists project members only, stages changes until Save, and never grants a non-member.
- **Archived project.** Banner states read-only retention; New board and the access editor are hidden; exactly one Reopen action remains, in the banner.
- **Responsive and theme.** At 800px the All boards card is 102px tall with a 3px tone edge instead of the earlier 139px stacked block; no horizontal document overflow at 800 or 390. Light and dark themes both render; 0 console errors across project Overview, board tab, All boards, projects and the hub.
- **Hub.** 12 screens, “Project workspace” card, one `h1`, hero heading demoted to `h2`, lede lists Project workspace, no `all-work` links, no “Project work” copy.

## Resolved findings

- **B1** compact summary strip broken on hub/Activity/People/Trash — fixed by restoring the strip under a scoped `.summary.compact` selector (stat, bars, 720px and 420px rules) so the approved board's `.summary-overview`/`.summary-health` markup cannot inherit it.
- **M1** revoked board id left in the URL after a role switch — fixed by a role-driven render that falls back to Overview and clears `selectedBoardId` only when the active board is no longer readable.
- **M3** missing review record — manifest, this record and the checks file now exist; 20/20 hashes match.
- **m1** stale hub lede — “Project workspace” added; the “Twelve” count now matches.
- **m2** two `h1`s on the hub — hero heading demoted to `h2` with matching CSS.
- **m4** 4px switcher occlusion at 721–860px — switcher stays at `top: 60px` until the 720px topbar breakpoint.
- **m5** duplicate Reopen on archived projects — only the banner action remains.
- **m6** project marks all thistle — `gold → sky`, `sage → icy`; My Fashion thistle, Website Redesign sky, Brand Refresh icy.

## Remaining non-blocking findings

- **Dark icon-chip contrast.** `#493957` on a 38–42% thistle mix is roughly 1.75:1; decorative glyphs beside text, but lock/board icons nearly vanish in dark mode.
- **Off-palette greens.** `#5b9870` (Active dot in `projects-hub.css`) and `--palette-pastel-green: #b8f2c8` (`styles.css`, also `detail.css`/`card-variants.css`) are semantic but not Palette 1 values.
- **390px switcher clipping.** Tab labels clip at both edges with no fade or scroll affordance.
- **Dead or duplicated CSS.** `.view-pill` has no rule or usage; `.project-dot` has a rule but no usage; the restored base rules make some `screens.css` overrides redundant.
- **Two plums.** `#715087` for workspace tones versus the shell's derived `#684B7C` (documented as derived in `DESIGN.md`).
- **Duplicated `TONE_ALIASES` table** in `project.js` and `projects.js` — drift risk.
- **Sign-in surface** keeps IBM Plex Sans and a green panel; locked by `DESIGN.md`, so out of scope.

## Limits

- Synthetic fixtures only; no server, session or real authorization exercised. The role switcher is a preview affordance, not authentication.
- Chromium-only via CDP; no Safari/Firefox, screen reader, 200% zoom, forced-colors or text-scaling pass. Contrast figures are computed from tokens, not from an automated audit.
- The first measurement pass reused a cached `screens.css` and mis-reported the hero heading; every number above comes from a cache-disabled re-run. Future reviews of this artifact should disable cache or version asset URLs.
- Depth: the four project surfaces plus hub, Activity, People and Trash. Sign-in, invitation, My tasks, Add card, Import and Settings were not re-reviewed beyond their hub links.
- Shared checkout, no commit boundary. This certifies that *this revision* is backend-free, not that the repository is.

## Backend boundary

This revision is design-only: the 20-file manifest is 17 files under `design/flowboard-ui` plus three `docs/` research/proposal documents, with no `apps/api`, database or contract file. The screens continue to state that project/board/card records are local fixtures with no API, persistence or authorization claims. The shared checkout still carries unrelated `apps/api` changes from another workstream. Board-level authorization, project-grant-plus-board-grant enforcement, summary read models and board creation remain backend handoff work under [BACKEND_REVIEW_GATE.md](../../../BACKEND_REVIEW_GATE.md); nothing here proves them.

## Verdict

**PASS (design artifact): 8.8/10, zero blockers, every category at least 8.5.** The unified project workspace, board deep links, read-only All boards, role scoping and responsive behavior hold, and the shared-shell regression is closed. Integration still requires server-side board authorization, the project/board read models, board creation with grants, and a new backend review.
