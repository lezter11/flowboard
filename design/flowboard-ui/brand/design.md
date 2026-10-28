# Flowboard brand design guide

Status: The sign-in page is locked for this design iteration with Palette 1 and IBM Plex Sans. The Flowboard wordmark and name in the sign-in heading use a palette-derived text gradient; no icon mark is part of the current lockup. Product-wide rollout and final logo approval are still under review. Updated 2026-10-26.

This guide records Flowboard-created brand decisions and working assets. Source reference images and their catalogue remain in [docs/references](../../../docs/references/README.md).

## Brand direction

Aim for a calm, supportive workspace that makes project tracking feel manageable. Use soft color fields for atmosphere and category cues, with stronger text and action colors for clear hierarchy. Warm pastels can add personality; keep large reading areas neutral and avoid relying on color alone to explain status.

The color-emotion literature reports associations, not guaranteed emotional effects in a product interface. A systematic review found positive, lower-arousal associations for blue, green, blue-green and white; pink had positive associations, while orange and yellow were more associated with higher-arousal positive emotions. Treat these findings as a direction for exploration and judge the palette in context. [Systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12325498/)

## Palette comparison

These three options remain available for comparison on the sign-in preview using `screens/signin.html?palette=2` or `screens/signin.html?palette=3`; add `&theme=light` or `&theme=dark` to force a theme. Version 1 is selected for the sign-in preview and board artifact. The selected version is available at `screens/signin.html?palette=1`. Without `theme`, the preview follows the system preference.

| Version | User-supplied colors | Light action | Dark action | Light / dark backdrop gradient |
|---|---|---|---|---|
| 1. Thistle, petal, and sky | `#CDB4DB`, `#FFC8DD`, `#FFAFCC`, `#BDE0FE`, `#A2D2FF` | Derived plum `#715087` with white text | Thistle `#CDB4DB` with ink `#302638` | `#CDB4DB → #FFC8DD → #BDE0FE → #A2D2FF` / `#4C3D5D → #62384C → #2D4358` |
| 2. Alabaster, peach, and mauve | `#D8E2DC`, `#FFE5D9`, `#FFCAD4`, `#F4ACB7`, `#9D8189` | Derived mauve `#795B65` with white text | Cherry blossom `#F4ACB7` with ink `#352228` | `#D8E2DC → #FFE5D9 → #FFCAD4 → #F4ACB7` / `#29312D → #3E302B → #422A32` |
| 3. Pink, cyan, and berry | `#F2C4EE`, `#C5E3F1`, `#990554`, `#0FA2C7` | Berry `#990554` with white text | Pink `#F2C4EE` with ink `#322234` | `#F2C4EE → #E6D5EC → #C5E3F1` / `#3B2940 → #382A3C → #223640` |

Versions 1 and 2 use derived, darker light-mode action colors because their supplied shades are pastels. Version 3 uses its supplied berry shade for the light action; cyan is a supporting accent, not white-text button color. Use the gradients behind the board preview, keep task cards on solid surfaces, and separate columns with headings and dividers. The screenshot informs Version 3's color balance only; the Flowboard wordmark remains original.

Calculated contrast for body text / supporting text / action labels: Version 1 light `13.65:1 / 6.93:1 / 6.56:1`, dark `15.80:1 / 10.49:1 / 7.63:1`; Version 2 light `13.51:1 / 7.15:1 / 6.00:1`, dark `15.09:1 / 10.15:1 / 8.10:1`; Version 3 light `13.88:1 / 7.27:1 / 8.39:1`, dark `15.60:1 / 10.20:1 / 9.83:1`. These sample text pairs exceed WCAG AA's 4.5:1 normal-text minimum; the rest of each screen still needs full contrast review. [WCAG 2.2](https://www.w3.org/TR/wcag/#contrast-minimum)

## Task semantics, updated 2026-10-27

These user-selected semantic colors supplement Palette 1. Priority names remain visible, so color is not the only signal.

| Priority | Light text / surface | Dark text / surface |
|---|---|---|
| High | `#8A3434` / `#FCE9E7` | `#F0AAA3` / `#492E2C` |
| Urgent | `#762323` / `#F7DDDA` | `#FFC1B7` / `#542723` |
| Medium | `#285D86` / `#E5F1FB` | `#B9DFFF` / `#263B48` |
| Low | `#285C43` / `#E5F3EA` | `#AFE0C2` / `#263D32` |

Column surfaces: In progress `#DCEEFA` / `#253845`; Testing `#EDF0F3` / `#30353D`; Blocked `#F8E4E1` / `#452B2A` (light / dark). Light supporting text is strengthened to `#594A63`, with quiet metadata `#62516C`, to remain readable against the pastel canvas.

## Typography

IBM Plex Sans is selected for the sign-in preview, loaded from [Google Fonts](https://fonts.google.com/specimen/IBM+Plex+Sans) at weights 400, 500, 600 and 700. The board artifact still uses its Inter-first stack until the product-wide rollout is planned. IBM Plex Sans is IBM's type family designed for its global technology brand; its varied weights let the UI use one family across headings and body copy. [IBM Design Language](https://www.ibm.com/design/language/typography/typeface/)

Proposed sign-in scale:

| Element | Size |
|---|---:|
| H1 | 36–40px |
| H2 | 22–24px |
| H3 | 16px |
| Body | 16px |
| Supporting text | 14px |

Use a restrained weight range and keep body line height around 1.5. Review the sign-in page and a dense board together before rolling the family into the rest of the product.

## Logo and assets

The sign-in preview uses palette-derived gradient lettering for the “Flowboard” wordmark and the Flowboard name in the heading (“Sign in with Flowboard”); it does not include an icon or monogram. Palette 1 uses `#523766 → #762E53 → #244C69` in light mode and `#E6D7F0 → #FFD0E0 → #CDE8FF` in dark mode. These shades are derived from the palette colors so the name remains readable on the pastel backgrounds. New Flowboard-created logo concepts, exports, and illustrations belong under `assets/`. Do not copy source reference images into this folder; keep them in the reference catalogue.

The board artifact uses the five supplied Palette 1 colors directly in its Flowboard wordmark, placed on a dark plum backing for legibility. This board treatment is a design-artifact choice; it does not approve a final production logo.

- `assets/logos/`: editable logo masters and exported SVG/PNG variants.
- `assets/fonts/`: self-hosted font files selected for Flowboard, with their license/source notes. The current sign-in preview loads IBM Plex Sans from Google Fonts; no font binary is checked in yet.
- `assets/illustrations/`: created artwork used by Flowboard screens.

Record for each accepted asset its source, format, intended use, and light/dark variants when applicable. Keep draft concepts clearly named as drafts until approved.

## Decision log

- 2026-10-26: Added two board-card comparisons, Focus and Soft glass. Both use Palette 1 with contrast-safe text. The second uses an opaque pearly content surface and a small frosted action tray; neither is approved as the final card style. See the root [design direction](../../../DESIGN.md) for anatomy and accessibility rules.

- 2026-10-26: Replaced the rejected Rosewater + Apricot trial with three user-provided palette comparisons; selected Version 1 for the sign-in preview.
- 2026-10-26: Integrated Palette 1 colors into the “Flowboard” wordmark; no icon mark is used in the sign-in lockup. Final logo approval remains open.


### Column palette extension — 27 October 2026

Completed stays pastel green (`#B8F2C8` swatch and distribution; `#EAF6ED` / `#223B2C` column surfaces). Testing is now cool grey (`#D5DCE4` swatch, `#EDF0F3` / `#30353D` surfaces). The pastel-only column picker also offers Rose `#F0B9CA`, Mint `#B7DEC9`, Peach `#F5C7A8`, Butter `#F0D98C` and Lilac `#D7C6EA`. Dark mode adapts the reading surfaces while retaining recognizable pastel swatches. Status names and priority labels remain visible; color alone never carries the meaning. User-defined column names remain independent of their chosen pastel.
