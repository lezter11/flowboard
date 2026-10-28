# Hover, Settings colors, required priority and Projects preparation

Date: 27 October 2026. Scope: design/flowboard-ui local HTML artifact. Backend acceptance, production UI integration and locked sign-in are outside scope.

## Work ownership and acceptance

Parent fixed delegated immediate hover handling, the full Add Card form, the sample import priority path and documentation. GPT-6 Luna settings_pastel_fix implemented the separate Settings editor; priority_required_fix implemented board composer priority and a shared local-card guard. GPT-6 Luna projects_backend_research prepared the source map. A separate GPT-6 Luna fixes_independent_audit reviewed source and then ran both parent verification probes read-only.

Acceptance: status details appear on hover without clicking; Settings uses visible selected pastel-only choices with validation; new cards cannot be created with blank/none/unsupported priority and invalid submissions retain the draft; existing board roles/modes/movement/Undo remain intact; Projects research is prepared without backend modifications.

## Independent findings and result

Initial bounded source review: **8.9/10**, no source blocker. Found duplicate Lavender and Lilac swatch colors in the new Settings CSS. Fixed Lilac to #D7C6EA; Lavender remains #CDB4DB. After independently running both source/mock-DOM checks, reviewer revised the bounded score to **9.1/10**, no blockers. Final small dialog label/selected-color-name changes were separately read and confirmed with no score change.

This is a bounded source + mocked interaction assessment, not a whole-project visual, browser, security or backend acceptance score. Final source hashes: board-followup-2026-10-27-manifest.json.

## Changes

- Pointerover and mouseover capture show status/tooltips immediately; focus remains an additional route. No click handler is required. Pointer-out hiding is scoped to the current trigger/tooltip with a short grace period; pointer transfer into the tooltip remains supported. Touch hover is ignored.
- Settings Board and columns now offers ten named visible pastel swatches, selected checks, a single radio-group tab stop, arrow/Home/End navigation, staged preview and save-time whitelist validation. No arbitrary hex input exists, so non-pastel choices cannot be submitted through the control. The selected pastel name appears next to the preview; Edit uses Save column. Settings remains preview-only and separate from board state.
- Quick-add explicitly selects Low/Medium/High/Urgent, retains title when invalid and preserves selection on rerender. Successful creation and cancellation reset it; Undo remains available. FB.createCard rejects unsupported priority before pushing local cards. Existing fixtures with none are unchanged.
- Full Add Card uses blank placeholder + required marker + explicit whitelist/error/aria-invalid checks. Its separate local creation function validates before mutation. Sample import validates priority before preview counts and batch commit, and preserves row priorities rather than replacing them with none.
- Frontend-only rule documented in FEATURE_SPEC, IMPORT_SPEC and a decision note. Backend/server defaults and the real workbook template still permit none and need a coordinated revision before integration.
- Projects research documents current project routes/roles/fields, fixture-only summary data, missing list totals, lifecycle constraints and blocked backend acceptance. Projects redesign has not begun.

## Verification

Passed node syntax checks on board-interactions.js, board.js, data.js, screens/settings.js, screens/add-card.js and screens/import.js. Passed HTML nesting/unique-ID checks for board/Settings/Add Card, CSS brace checks, and scoped git diff --check.

Both parent and independent reviewer ran:

- node /tmp/flowboard-density-check.mjs: actual-source mock board startup, both card styles, List/filter/role/date/count/URL behavior, Move/native opening/Undo, image settings, navigation/fullscreen states and failure recovery, Add composer, ten board palette choices, immediate pointer/mouse hover with no focus/click, hover retention/hide/Escape/cleanup, missing-priority draft retention and shared local guard.
- node /tmp/flowboard-form-check.mjs: actual closure validation/mutation functions exposed in a VM, with display/navigation helpers stubbed. Full Add Card rejects blank/none/unknown and retains title, all four valid priorities save. Sample import invalid priority blocks the whole batch and four valid values survive commit. Settings tests ten swatches, one tab stop, End selection, staged reopen, invalid tone rejection, valid Save and local-only boundary.

Transcript: board-followup-2026-10-27-checks.txt. These are mocked behavioral probes, not DOM layout or actual pointer testing in a browser.

One bounded Impeccable pass also inspected changed board interaction/CSS and complete Settings/Add Card documents. Whole-page inherited CSS produced 76 findings (small text, existing fonts/wordmark and other earlier surfaces), with two elevation advisories. Those were not represented as newly introduced regressions or used to broaden this task. No new ignore rules were added. The bounded independent score above does not claim these older whole-page findings are cleared.

## Remaining verification

Actual browser rendering, event delivery in the user's browser, screen-reader behavior and hover geometry remain unverified. The original report could not be reproduced in a browser in this session; the fix changes the event path and new no-click mock probes directly exercise it. Real XLSX parsing is not implemented in this artifact. Backend validation/integration and hosted behavior were not changed or verified. Shared backend/checklist changes from other work were preserved.


## Post-review hook triage

The subsequent Settings hook exposed inherited sub-11px help/error styling inside the new column editor and tight mobile swatch padding. A narrow follow-up in settings-pastels.css raises column-editor labels/help/errors/selected-color text to 12px, gives all swatches 8px padding and replaces the fixed five-column mobile grid with 84px-minimum wrapping tiles. Older Settings typography remains outside scope; no new detector ignores were added. CSS brace/whitespace checks passed. The 9.1 review and its manifest refer to the preceding snapshot; this small CSS-only follow-up has not received a new independent or browser review.
