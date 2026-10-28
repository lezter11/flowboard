# Project board arrows → full workspace Board

Date: 27 October 2026. Source snapshot: `board-navigation-2026-10-27-manifest.json`. Scope: local synthetic HTML prototype, not backend authorization or product acceptance.

## User request and behavior

Clicking a board name, chip or arrow in Projects or Project Overview navigates to the full workspace Board at `index.html?project=…&board=…`. All boards remains the project-scoped combined view. Legacy project and All boards URLs with a board parameter redirect to the full Board and preserve role, theme, project, board, card and view. An explicitly empty board ID is unavailable rather than falling back to Website Kanban.

A small context adapter resolves the selected project and board through the local separate-board-access model before rendering. It loads that board's own columns and cards, renders its title and breadcrumb, and provides standard columns for a new empty board. The unscoped Board URL retains the original Website Kanban default. Project/board mismatch, unknown board or missing grant shows a generic unavailable state. Archived boards remain read-only. Role changes re-evaluate access.

The same workspace UI supports card creation, move, card detail Save, comments and existing Undo. Browser-session snapshots are keyed by board ID so work remains isolated and shows up in project preview totals after navigation. Snapshot writing requires edit access and active project/board status. These are local fixture changes, not secure authorization or API-backed persistence.

## Independent review

Read-only GPT-6 Luna `/root/board_routing_analysis` identified why changing only href would show the wrong Website cards. A separate GPT-6 Luna `/root/workspace_board_navigation_audit` reviewed the implementation and ran the supplied source/mock-DOM tests. It identified a legacy redirect dropping `view`, which was fixed; the confirmation checked role/theme/project/board/card/view and an empty board ID. Final qualified source + mock assessment: **9.2/10; no blockers**. The auditor did not conduct a rendered-browser or backend review.

## Verification

`/tmp/flowboard-board-navigation-detail-check.mjs` passed, including:

- Default Website and Web, Marketing, Operations board routes, correct board title, breadcrumb context, distinct source columns/cards and deep link URLs.
- Move, required-priority add, reload persistence, board isolation and project preview totals; newly created boards start with standard columns.
- Owner, Manager, Member, Viewer, denied board, mismatched project, unknown/empty board, role change, archived read-only and denied viewer editing.
- Real detail drawer open, title Save and comment Post persist to the selected board and flow back to its project preview.
- Project map branch markup and project overview board links use workspace URLs, retaining role/theme. Project and legacy All boards redirects preserve scope, card and view.

Transcript: `board-navigation-2026-10-27-checks.txt`. Changed JavaScript passed `node --check`; HTML nesting/unique-ID/local-asset checks and `git diff --check` passed.

A bounded Impeccable scan on the changed surface flagged four existing Project-page typography/contrast issues (2.0:1 contrast; 9.5px functional text; two 11.5px text findings) outside this navigation change. They were not suppressed or broadened into this task. Existing scoped brand/font exceptions remain unchanged.

## Limits

No live browser rendering, native focus/motion/fullscreen behavior, production authorization, real database persistence or backend integration was verified. The current client-side grants and session storage are preview fixtures; the revised board-grant backend handoff remains separately gated. The screenshot reference is preserved as REF-17 in `docs/references/manifest.json`.
