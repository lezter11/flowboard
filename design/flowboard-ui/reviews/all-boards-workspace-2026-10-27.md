# All boards opens in workspace Board

Date: 27 October 2026. Source snapshot: `all-boards-workspace-2026-10-27-manifest.json`. Scope is the local HTML artifact, not API/backend acceptance.

## User request and behavior

Projects and Project Overview All boards links open the full workspace Board using one explicit `project` and `scope=all`. Every card in that project on a board accessible to the preview identity is included. Cards show their source board and original column; the Board groups unlike source workflows into the canonical todo/active/done categories. Every completed card is displayed; no default completed-card truncation hides part of the aggregate. The search, due and assignee filters and List/Board layouts remain available.

The aggregate is read-only to prevent an ambiguous move, edit, create, delete or snapshot write crossing board boundaries. Selecting a card opens its source board/card, where normal permitted actions apply. Existing individual board links continue to open that individual full Board. Legacy Project All boards and `all-work.html` combined URLs redirect to the workspace; older individual-board redirects remain supported. Missing/unknown project, ambiguous board+aggregate and unknown or empty scope show a generic unavailable state.

Role changes rebuild the card projection from current local project membership and separate board grants. People with project membership but zero board grants see an empty project without hidden board names or counts. Archived project views remain read-only. These preview checks and browser-session snapshots are not backend authorization.

## Independent audit

GPT-6 Luna `/root/aggregate_board_analysis` supplied read-only design analysis. Independent GPT-6 Luna `/root/all_boards_workspace_audit` initially failed the source review because an unknown `scope` value fell through to the default Website board. The working-tree finding was repaired by rejecting all explicit scope values other than `all`; the original failing target was not separately frozen. The reviewer re-read the repair and ran `/tmp/flowboard-all-boards-check.mjs`, then reran expanded grant-revocation and source-board cases. Final bounded UI/source+mock assessment: **9.20/10**, no blockers. This is not a backend or rendered-browser acceptance score.

## Verification

- Actual-source mock-DOM harness verifies current Projects map link, Project Overview action and legacy combined URLs reach scoped full Board; existing individual board and legacy redirects still work.
- My Fashion card/board grants: Owner 10 cards from Web, Marketing and Operations; Manager 4 Web; Member 7 Web/Marketing; Viewer 3 Marketing. Role down/up reprojects the same view, excludes hidden board names and counts, and exposes no cross-project cards. Zero-board-grant project members see an empty scoped view.
- Source board and original column labels are rendered; category projection maps 3 todo, 4 active, 3 done; completed cards are not collapsed. Links navigate to the permitted source board/card. An inaccessible card deep link does not redirect.
- Aggregate role actions deny edit/move/manage/comment/upload/delete/invite, no drag/add control is rendered, and no source-board session snapshot is written. Individual-board creation and moves remain reflected in the combined stage and source label.
- Prior individual board regression checks pass: default Website, individual source board data, invalid/mismatched/unknown IDs, archived read-only, role changes, custom-board default columns, card detail Save/comment and session isolation.
- Node syntax and scoped `git diff --check` passed. Transcript: `all-boards-workspace-2026-10-27-checks.txt`. HTML local asset/structural checks recorded in the source review.

A bounded design detector pass on the affected HTML reported the same four pre-existing Project-page small-text/contrast findings captured in `board-navigation-2026-10-27.md`; no new ignore rules were added. Those findings are outside this requested navigation change and remain open.

## Limitations

No live browser rendering, actual pointer/keyboard event dispatch in a browser, screen-reader review, backend/API integration, live authorization or production persistence was verified. The client-side grant model and session storage remain synthetic preview fixtures. Backend board-level authorization and the project-scoped portfolio query remain separately gated.
