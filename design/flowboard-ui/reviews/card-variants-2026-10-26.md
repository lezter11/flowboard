# Card variants — independent source review

Date: 2026-10-26. Reviewer: `/root/board_ui_score_audit` (read-only subagent; no implementation edits). Scope: the local HTML design artifact. This is a source assessment, not a browser-rendered visual score or a production feature handoff.

## Acceptance

Two distinct, clean card designs using Palette 1; existing card fields and operations; keyboard/touch access; coherent List view, filters, roles and URL state; bounded motion with reduced-motion/transparency fallbacks. Score must be strictly above 8.5/10 with no source blocker.

| Round | Score | Outcome |
|---|---:|---|
| 1 | 8.5/10 | Failed: the card-body button role and title-only accessible name masked sibling content from assistive technology. |
| 2 | 9.35/10 | Passed source review after using a native title button and exposing description, signals, images and footer as semantic sibling content. |

## Final rubric

| Category | Score |
|---|---:|
| Distinct card versions | 1.90 / 2.00 |
| Hierarchy and real fields | 1.45 / 1.50 |
| Mechanics, roles, filters and List mode | 1.95 / 2.00 |
| Brand, material and accessibility | 1.35 / 1.50 |
| Responsive layout and touch | 1.35 / 1.50 |
| Motion and fallbacks | 0.90 / 1.00 |
| Evidence and scope honesty | 0.45 / 0.50 |

## Evidence and limits

- JavaScript syntax, HTML nesting/unique IDs, JSON parsing and whitespace checks pass.
- Node VM probes execute the actual board startup against a mock DOM derived from index.html. Both styles show matching card IDs and counts; URL state, filters, List switching and role restrictions pass.
- Native title click and passive-body pointer click pass the title control as the focus-return target; Move delegates separately. The keyboard handler does not cancel native Enter activation.
- Calculated opaque content and priority text samples have a minimum contrast of 5.94:1. Removed the old completed-date opacity reduction (4.39:1 on white) from board cards.
- Visual density, actual device contrast, backdrop-filter rendering, drag/touch behavior and animation performance remain unverified in a browser. Source review does not establish accessibility conformance.

## Reviewed source snapshot

| File | SHA-256 |
|---|---|
| `index.html` | `b915c88ec1b79b556be236898bd03c79f8b696dddd5b10b7cc3d6937d7b1d44f` |
| `board.js` | `9d3b9a0152591b51dc5b43e99c5784b111d17e6365c792545e4bfac6619cf66e` |
| `styles.css` | `f698aaf142b67ac4bf276c0c56b520e0780e0c6afbb20d1a80494904a7578cd7` |
| `detail.css` | `9ed894182c0c3ea14d474e21ccb6ae4285cb061ff18334e594093ff149bc3eda` |
| `card-variants.css` | `7261f250557251e6a82a7c5526b4a96a545fe0f786d07334d87994f92d6ae559` |
