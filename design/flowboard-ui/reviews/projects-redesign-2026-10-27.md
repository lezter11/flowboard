# Projects redesign — independent design review

Date: 27 October 2026. Final source: [projects-redesign-2026-10-27-manifest.json](projects-redesign-2026-10-27-manifest.json). Checks: [projects-redesign-2026-10-27-checks.txt](projects-redesign-2026-10-27-checks.txt).

Status: **PASS for the local design artifact — 8.6/10, zero blockers, all six categories at least 8.5.** This is not API, persistence, authorization or backend acceptance. The backend per-board access requirement remains unimplemented and separately gated.

## Scope

The review covers `design/flowboard-ui/screens/projects.html/js`, `project.html/js`, `all-work.html/js/css`, `portfolio-model.js`, `projects-hub.css`, the shared `styles.css`, `screens.js/css`, the review hub and the screen README, plus the three project handoff/research documents in the manifest. The approved board and sign-in artifacts are out of scope and were preserved.

## Acceptance criteria

- Palette 1 only: thistle, petal, baby pink, icy blue, sky blue and plum; no new palette; Inter on the product pages.
- Workspace → project → boards → columns → cards; My Fashion contains Web, Marketing and Operations; no nested project.
- Projects index defaults to a connected project map with a compact list alternate (`?view=list`).
- Project overview shows the connected board tree, at-a-glance completion, Owner-only people reach, non-owner “Your access”, create board with initial grants, Owner-only per-board grant editor and archived read-only state.
- Project work combines cards inside exactly one project, in list or board layout, with URL state and a read-only preview.
- A non-owner needs a project grant **and** a separate board grant; the Owner has implicit access in owned projects. Hidden boards leak no name, ID, count, card, option or person, including after a preview role switch.
- Zero-board projects are supported; the Owner is locked in a new board’s grants; creation never copies all project members by default.
- No API, persistence or authorization claim; synthetic fixtures and `sessionStorage` only.

## Review history

The reviewer inspected the exact source and ran rendered checks in three passes:

1. **7.8 / FAIL.** Blocker B1: the Project work board strip was cached by project id only, so an Owner → Manager switch left “Operations · 3 cards” visible. Responsive findings at 390px and a hidden list-view archive control were also found.
2. **7.9 / FAIL.** B1 was fixed, but blocker B2 found the same “hide without clearing” pattern in four hidden surfaces: the card preview, people reach, board-access editor and denied-project content retained the previous identity’s board names, card titles, counts or IDs in the DOM.
3. **8.6 / PASS.** All five B2 paths now clear on close or role change and restore correctly when the Owner returns. The responsive sweep is clean from 390 to 1440, the list archive control is reachable, and no console errors were observed. A final confirmation pass checked the toast clearing and README correction at the same score.

## Final scores

| Category | Score |
|---|---:|
| Visual craft / Palette 1 fidelity | 8.5 |
| Hierarchy and navigation model | 9.0 |
| Role scoping and data isolation | 8.5 |
| Accessibility and responsive behavior | 8.5 |
| Code quality and robustness | 8.5 |
| Documentation and handoff accuracy | 8.5 |
| **Overall** | **8.6** |

## Verified behavior

- Owner/Manager/Member/Viewer see 3/1/2/1 boards and 10/4/7/3 cards in My Fashion. Operations is absent from text, DOM and options for every non-owner. A denied board deep link shows “Work unavailable” with no cards; a denied project shows “Project unavailable”.
- B1: a role cycle Owner → Manager → Member → Viewer → Owner → Manager rebuilds the strip each time; totals stay 10 / 4 / 7 / 3 / 10 / 4 and the strip matches the totals.
- B2: opening a card, people reach, the access editor or the new-board editor as Owner and switching to Manager leaves only generic dialog chrome; no hidden board name, column, card title, member row, count or href remains. Switching back to Owner restores the current project. A denied project’s content is emptied and its breadcrumb becomes “Projects / Project unavailable”.
- Board creation with initial grants works locally: the Owner is locked, selected project members are granted, and a non-member cannot be added. Revoking and restoring David’s Web grant changes his visible boards and cards immediately. Archived projects hide creation and grant editing; list-view reopen is reachable at 390px.
- Project work is single-project only. Board-denied and project-denied states use distinct copy; totals are hidden rather than showing a misleading zero. Filters, sort, search, board strip, list/board layouts, URL state and card deep links behave as designed.
- 390–1440 width sweep: `scrollWidth === clientWidth` at 390/481/500/560/600/620/680/720/760/800/1024/1440. Dialogs fit at 390. The 24px card-title target, `role="img"` people label and Inter font load are present.
- Toasts are cleared on role switch so an old “Access updated for Operations” message cannot outlive the identity that saw it; the new role announcement still appears.

## Resolved findings

- **B1** stale Project work board strip after a role switch — fixed by keying the strip on project plus authorized board ids.
- **B2** hidden DOM after a role switch — fixed by clearing the card preview, people list, access editor, new-board editor and denied-project panels; all restore on the next authorized render.
- **N1** 481–720px overview overflow — fixed by removing the fixed action indent at the 760px breakpoint.
- **N2** board-denied totals/copy — fixed with board-specific copy and hidden totals.
- **N3** Inter only on the Projects pages and hub — accepted: the approved board artifact is preserved and intentionally not edited.
- **N4** unused `--ph-plum-ink` — removed; `tone-slate` uses Palette 1 plum in both themes.
- **N5** stale board toast after a role switch — fixed by clearing `#toasts` before the new role announcement.
- **N6** stale README reload copy — corrected to match `sessionStorage` behavior.

## Limits

- No API, database, authentication or server-side authorization was exercised. The role switcher is a preview affordance, not authentication; all grants are synthetic session state.
- Chromium-only. No Safari/Firefox, screen-reader, 200% zoom, forced-colors or text-scaling pass.
- Load-more is unreachable with the seeded 10-card fixture, so the limit URL state was verified through the handler rather than a real paging flow.
- Inter depends on Google Fonts at runtime; offline rendering falls back. The approved board still uses the system fallback because it was preserved unchanged.
- This review covers the Projects design screens only. It does not re-review the approved board, sign-in, or the other screen-library surfaces.

## Backend boundary

No backend source, contract, migration or checklist was changed. The implemented UI assumes read models and a board-creation route that do not exist yet; those requirements and open decisions are in [the revised per-board access handoff](../../../docs/handoffs/proposals/project-board-access-v2-2026-10-27.md#implemented-ui-design-and-required-read-models-27-october-2026). Existing backend review status is unchanged and is not approved by this design score.

## Verdict

**PASS (design artifact): 8.6/10, zero blockers, every category at least 8.5.** The visible hierarchy, palette, role scoping and responsive behavior hold; the hidden-DOM leak class is closed on the paths tested. Integration still requires server-side board authorization, the project/board read models, board creation with grants, and a new backend review.
