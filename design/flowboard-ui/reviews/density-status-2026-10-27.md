# Density, image preferences and status colors — Luna source audit

Date: 2026-10-27. Architect/integration owner: parent agent. Implementation: `/root/workspace_layout_luna` (workspace.css) and `/root/card_density_colors_luna` (styles.css, detail.css, card-variants.css), both GPT-6 Luna. Independent read-only reviewer: `/root/density_review_luna`, GPT-6 Luna. Parent owns integration, display-preference logic, fixtures, documentation and checks.

## Result

Corrected provisional source-only score: **8.7/10**, strictly above 8.5, no source blocker found. Rendered four-card-row capacity and composer geometry are not established by this score.

The initial 9.0 estimate is withdrawn: the reviewer incorrectly cited a comment/thread-composer style in detail.css as evidence of board composer separation, and referred to four-column capacity. The architect requested reinspection. Correct evidence is workspace.css: the column scroller has a 12px gap/inset, and the card list and quick-add wrapper do not flex-shrink. The board has five columns; the requested density target is four card rows. After correction and expanded mocked behavior probes, the reviewer confirmed 8.7 with the rendering limitation retained.

| Category | Score |
|---|---:|
| Status strip width and responsive behavior | 1.35 / 1.50 |
| Composer separation and scrolling | 1.45 / 1.50 |
| Default-off image preference and persistence | 1.45 / 1.50 |
| Card density and readability | 1.00 / 1.50 |
| Semantic colors and Blocked consistency | 1.85 / 2.00 |
| Keyboard, Move, filters, List and fullscreen preservation | 1.25 / 1.50 |
| Documentation and evidence | 0.35 / 0.50 |

## Source checks

- Current HTML nesting, unique IDs, script syntax and whitespace checks pass.
- Parsed-current-HTML Node VM executes data, board, dialogs and workspace startup. Default-off thumbnail DOM, opt-in/out storage, both card styles, List omission, Viewer preference without mutation rights and retained image arrays pass.
- Five-column data, Blocked active semantics, actual Blocked Move/Undo, Move-dialog destination, Add card filter reset/composer/submit/Undo pass in the isolated synthetic VM.
- Display popup Escape closes it and returns focus to the gear. Existing card-open/native keyboard, filter, List, role and fullscreen state probes also pass.
- Generated composer markup is parsed as a quick-add form outside the preceding card, with card-list and quick-add wrappers as column-body siblings.
- Eight light/dark priority text pairs calculate at least 6.10:1. Tested light foregrounds on the canvas and pastel columns calculate at least 5.75:1.
- Design detector returns no new findings with existing scoped exceptions; no new ignore rule was added.

## Limits

The VM uses mocked DOM geometry/browser APIs. It does not verify actual CSS layout, four visible rows, pointer drag, native fullscreen permissions, screen-reader output or device rendering. Cards retain natural height and may grow with long titles, wrapped metadata, coarse-pointer controls or enabled previews. Existing columns with fewer than four records are not padded with invented cards. This is design-artifact evidence, not production integration or a backend review gate.

## Reviewed source snapshot

| File | SHA-256 |
|---|---|
| `index.html` | `a4da3843d8d90e9735161c379e21b7761b2001ddffa3944b810a0cd8ee23c271` |
| `board.js` | `29bc6ab7bf35b503bf7b8cec71d08975298358a864486815d560b88d23ce5857` |
| `data.js` | `f9785ee6f4d3db22f86de025d16d6fcf7756e3cdfb79c444479d2cdb4179826d` |
| `dialogs.js` | `d136e9c9ed3713f06023f5fb13a82e8b3742a85935aea597410b357ab29acdae` |
| `styles.css` | `616fa495e378ba7a89c222300125cb51d0ac0b38db516c9ad1c5837dfeb646b8` |
| `detail.css` | `3796e10903de935aae65966a2cdc219f42e5b310660d7f46d56e205763faa4c7` |
| `card-variants.css` | `d56f16c7297de638a97b2ba78400429efede9e3a06d4af626033e0cf08985da5` |
| `workspace.css` | `af4d5e28afe29218ed8d3bb6e7906af9c7730b6a96be3a88a7e8709efbb64364` |
