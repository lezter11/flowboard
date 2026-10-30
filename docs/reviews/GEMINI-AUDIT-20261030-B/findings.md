# Independent Security & Quality Audit Findings: Flowboard

**Target Commit:** `8cc31e26065b3351b68296a48163778744bd2f6c`  
**Branch:** `chore/baseline-2026-10-28`  
**Review Directory:** `docs/reviews/GEMINI-AUDIT-20261030-B/`  
**Date:** 2026-10-30  

---

## 1. Summary of Findings

| ID | Severity | File:Line | Title | Confidence |
|---|---|---|---|---|
| FB-AUD2-01 | Medium | `apps/web/package.json` (via `node_modules/postcss`) | PostCSS High Severity Vulnerability in Production Dependencies (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849) | Confirmed |
| FB-AUD2-02 | Medium | `apps/web/src/lib/image-prepare.ts:180-188` | Client-Side Image Prep: Main Thread CPU & Memory Saturation in `hasAlpha` on 2560x2560 Opaque Images | Confirmed |
| FB-AUD2-03 | Low | `apps/web/src/lib/image-prepare.ts:179` | Client-Side Image Prep: Multi-Frame Animated WebP Silently Stripped to Single Static Frame | Confirmed |
| FB-AUD2-04 | Low | `apps/web/src/components/board/card-detail-drawer.tsx:59-64` | A11Y (WCAG 2.4.3): Keyboard Focus Loss to `document.body` on Direct URL Card Drawer Dismissal | Confirmed |
| FB-AUD2-05 | Low | `apps/web/src/components/ui/dialog-layer.tsx:51-55` | A11Y (WCAG 2.4.3): Background DOM Trees Not Marked `inert` During Modal Dialog Display | Confirmed |
| FB-AUD2-06 | Low | `docs/API.md:38,112` vs `apps/api/src/http/routes/` | Documentation Drift: HTTP Verb and Route Path Mismatches Across API Specification and Code | Confirmed |
| FB-AUD2-07 | Low | `docs/FEATURE_CHECKLIST.md:63` | Documentation Drift: RBAC-05 Checklist Claims Blanket Inheritance Superseded by Per-Board Grants | Confirmed |
| FB-AUD2-08 | Low | `packages/contracts/package.json` | Internal Package `@flowboard/contracts` Lacks Explicit `license` Field | Confirmed |

---

## 2. Detailed Findings

### FB-AUD2-01 | Medium | `apps/web/package.json` (via `node_modules/postcss`)
- **What is wrong:**  
  `npm audit --omit=dev` flags 2 production vulnerabilities in the Next.js dependency tree (`postcss` <= 8.5.17 / 8.5.22). Specifically, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, and GHSA-r28c-9q8g-f849 involve path traversal in previous source map auto-loading (`sourceMappingURL`), leading to arbitrary file disclosure and arbitrary `.map` file reads with a CVSS score of 7.5 (High).
- **Exact reproduction:**  
  Run command:
  ```bash
  npm audit --omit=dev --json
  ```
  Exit code: `1`  
  Output excerpt from `docs/reviews/GEMINI-AUDIT-20261030-B/raw/npm-audit-prod.json`:
  ```json
  "vulnerabilities": {
    "next": { "severity": "moderate", "via": ["postcss"] },
    "postcss": { "severity": "high", "via": [
      { "title": "PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL)", "severity": "high", "cwe": ["CWE-22"], "cvss": { "score": 7.5 }, "range": "<=8.5.17" }
    ]}
  }
  ```
- **Suggested fix:**  
  Add an `overrides` or `resolutions` entry in root `package.json` pinning `"postcss": "^8.5.23"` or upgrade `next` to the latest patch release where PostCSS is updated.
- **Confidence:** Confirmed.

---

### FB-AUD2-02 | Medium | `apps/web/src/lib/image-prepare.ts:180-188`
- **What is wrong:**  
  When testing whether an uploaded image contains transparent pixels (`hasAlpha`), `image-prepare.ts` draws the bitmap onto a full-scale canvas at `plan.width` and `plan.height` (up to 2560x2560) and reads the entire RGBA buffer using `ctx.getImageData()`. For a 2560x2560 image, this allocates a 26.2 MB `Uint8ClampedArray` (6,553,600 pixels * 4 bytes). If the image is an opaque photo (e.g. exported from a phone as PNG without alpha), the condition `data[i]! < 255` is never satisfied. The loop `for (let i = 3; i < data.length; i += 4)` executes 6,553,600 sequential iterations synchronously on the main JavaScript thread. On mobile devices or low-power laptops, this causes noticeable main thread freezing and frame drops.
- **Exact reproduction:**  
  Inspect `apps/web/src/lib/image-prepare.ts` lines 180-188:
  ```typescript
  async hasAlpha(bitmap, width, height) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return false;
    ctx.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
    return false;
  }
  ```
  For `width = 2560, height = 2560`, `data.length = 26,214,400`. For opaque pixels, the loop checks all 6,553,600 alpha bytes.
- **Suggested fix:**  
  Downscale the canvas used for alpha detection to a maximum thumbnail size of 256x256 pixels:
  ```typescript
  const sampleWidth = Math.min(width, 256);
  const sampleHeight = Math.min(height, 256);
  const canvas = makeCanvas(sampleWidth, sampleHeight);
  // ...
  ctx.drawImage(bitmap as ImageBitmap, 0, 0, sampleWidth, sampleHeight);
  ```
  Checking transparency on a 256x256 sample reduces memory from 26.2 MB to 262 KB and loops at most 65,536 times, preventing main thread stalls while accurately detecting alpha channels.
- **Confidence:** Confirmed.

---

### FB-AUD2-03 | Low | `apps/web/src/lib/image-prepare.ts:179`
- **What is wrong:**  
  `browserEnv.decode` uses `createImageBitmap(file, { imageOrientation: 'from-image' })`. By W3C specification, `createImageBitmap` of an animated image (such as an animated WebP) extracts only the first frame. When the file is re-encoded to WebP at quality 0.82, the animation is silently discarded, replacing the user's multi-frame animation with a static image.
- **Exact reproduction:**  
  Inspect `image-prepare.ts:179`:
  ```typescript
  decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' })
  ```
  Because canvas 2D draw and `convertToBlob` encode a static image, passing an animated WebP file discards all subsequent animation frames without an error or prompt.
- **Suggested fix:**  
  In `readDimensions` or `prepareImage`, detect the WebP `ANIM` chunk (`kind === 'VP8X'` with the animation flag bit set `b[20] & 0x02`). When animation is detected, skip re-encoding and return `{ action: 'original' }` (or refuse if > 10 MiB) so user animations remain intact.
- **Confidence:** Confirmed.

---

### FB-AUD2-04 | Low | `apps/web/src/components/board/card-detail-drawer.tsx:59-64`
- **What is wrong:**  
  Under WCAG 2.1 AA Success Criterion 2.4.3 (Focus Order), dismissing a modal drawer or dialog must return keyboard focus to the triggering element or an appropriate logical landmark. While `board-view.tsx` records `returnFocus.current = trigger;` when opening a card by clicking a card button, if a user opens a card directly via deep link (`/board?card=<uuid>`) or if the trigger DOM node is replaced/unmounted during background board refreshes, closing the drawer causes focus to drop onto `document.body`.
- **Exact reproduction:**  
  1. Open a board with a card query parameter: `/board?card=<valid-card-id>`.
  2. The drawer opens on initial render; `returnFocus.current` in `board-view.tsx` remains `null`.
  3. Press Escape or click the close button.
  4. Notice `target?.focus()` in `closeCard` does not execute because `target` is null; keyboard focus resets to `document.body`.
- **Suggested fix:**  
  In `closeCard` (`board-view.tsx:347-349`), add a fallback selector to restore focus to the card button on the board:
  ```typescript
  const target = returnFocus.current ?? (cardId ? document.querySelector<HTMLElement>(`[data-card-id="${cardId}"] .card-open`) : null);
  requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
  ```
- **Confidence:** Confirmed.

---

### FB-AUD2-05 | Low | `apps/web/src/components/ui/dialog-layer.tsx:51-55`
- **What is wrong:**  
  Under WCAG 2.1 AA SC 2.4.3 and WAI-ARIA Dialog Modal Pattern, a modal dialog (`aria-modal="true"`) must prevent screen reader users from navigating into background content. `DialogLayer` traps Tab/Shift+Tab keyboard events while focus is inside the dialog, but it does not mark sibling trees (`<main>`, `#rail`, `#topbar`) with `inert` or `aria-hidden="true"`. Assistive technologies using virtual browse mode (e.g. VoiceOver rotor, NVDA virtual cursor) can read past the modal into the underlying page DOM.
- **Exact reproduction:**  
  Inspect the DOM generated when `DialogLayer` is rendered in `apps/web/src/components/ui/dialog-layer.tsx`:
  ```tsx
  <div className="dialog-layer" ref={layerRef} ...>
    <div className={`dialog${className ? ` ${className}` : ''}`} role={role} aria-modal="true" ...>
  ```
  Notice that `#rail`, `#topbar`, and the background `<main>` elements remain fully interactive in the accessibility tree without `inert` or `aria-hidden="true"`.
- **Suggested fix:**  
  When `DialogLayer` is active, apply `document.querySelectorAll('main, aside, header').forEach(el => el.setAttribute('inert', ''))` or use the native HTML `<dialog>` element with `.showModal()`.
- **Confidence:** Confirmed.

---

### FB-AUD2-06 | Low | `docs/API.md:38,112` vs `apps/api/src/http/routes/`
- **What is wrong:**  
  Documentation drift between `docs/API.md` and the live routes in `apps/api/src/http/routes/`:
  1. `docs/API.md:112` documents `POST /notifications/:id/read`, but code implements `PATCH /api/v1/notifications/:id/read` (`notifications.ts:44`).
  2. `POST /api/v1/notifications/mark-all-read` (`notifications.ts:60`) is implemented but completely omitted from `docs/API.md`.
  3. `POST /api/v1/cards/:cardId/move-undo` (`cards.ts:285`) is implemented as a dedicated endpoint, but is not documented in `docs/API.md`.
  4. `docs/API.md:38` specifies `POST /workspaces/:wid/transfer-owner`, but code implements `POST /api/v1/workspaces/:workspaceId/transfer-ownership` (`workspaces.ts:259`).
  5. `GET /api/v1/projects/:projectId/access-summary` (`projects.ts:486`) is implemented but absent from `docs/API.md`.
  6. `GET /api/v1/workspaces/:workspaceId/my-tasks` (`cards.ts:473`) is implemented but not documented in `docs/API.md:97` (which only specifies `GET /me/tasks?projectId=:id`).
- **Exact reproduction:**  
  Run route parser:
  ```bash
  python3 docs/reviews/GEMINI-AUDIT-20261030-B/raw/parse_all_routes.py
  ```
  Examine diff against `docs/API.md` tables.
- **Suggested fix:**  
  Update `docs/API.md` to reflect the correct HTTP verbs (`PATCH /notifications/:id/read`), exact endpoint paths (`transfer-ownership`, `move-undo`, `access-summary`), and missing endpoints (`mark-all-read`, `my-tasks`).
- **Confidence:** Confirmed.

---

### FB-AUD2-07 | Low | `docs/FEATURE_CHECKLIST.md:63`
- **What is wrong:**  
  In `docs/FEATURE_CHECKLIST.md` line 63, `RBAC-05` is marked `[x]` (Backend verified) with the description:
  `"Board invitation action explicitly grants project access to all its boards; no hidden board-only permission exception exists."`
  This statement is obsolete and directly contradicts the project's current architecture and UI rules (`AGENTS.md`, `docs/API.md:19`, and `apps/web/src/components/ui/invite-dialog.tsx:108`), which state:
  `"Project access is not board access. After they accept, give them boards under People > Board access. Until then they see no boards."`
- **Exact reproduction:**  
  Inspect `docs/FEATURE_CHECKLIST.md` line 63 vs `docs/API.md` line 19 and `invite-dialog.tsx` line 108.
- **Suggested fix:**  
  Update `docs/features.tsv` to describe the per-board grant model and re-render `FEATURE_CHECKLIST.md`.
- **Confidence:** Confirmed.

---

### FB-AUD2-08 | Low | `packages/contracts/package.json`
- **What is wrong:**  
  `packages/contracts/package.json` does not declare a `"license"` field, causing automated dependency and license auditing tools to flag it as `UNKNOWN`.
- **Exact reproduction:**  
  Run command:
  ```bash
  python3 docs/reviews/GEMINI-AUDIT-20261030-B/raw/scan_licenses.py
  ```
  Output:
  ```
  @flowboard/contracts@0.3.0 -> UNKNOWN [FLAGGED]
  ```
- **Suggested fix:**  
  Add `"license": "UNLICENSED"` or `"license": "MIT"` to `packages/contracts/package.json`.
- **Confidence:** Confirmed.

---

## 3. What Was Tried That Did Not Work
1. **Trufflehog Secret Scanner:** `trufflehog` command was not installed in the local environment (`zsh: command not found`). Replaced with installed `gitleaks` version `8.30.1` (`/opt/homebrew/bin/gitleaks`) plus custom Python regex scanning across `git log -p --all` and the entire working tree.
2. **Global Gitleaks Directory Scan:** Running `gitleaks dir .` without path filtering scanned over 293 MB including local `node_modules` and fixture directories, generating 253 generic API key warnings (all sha256 git commit hashes or synthetic test UUIDs). Verified via Python parser that zero production secrets exist.
3. **Naïve API Route Regex:** A simple regex matching `app.get` or `router.get` missed route definitions named `sessionRoutes.get` or `cardsRoutes.post`. Wrote `parse_all_routes.py` with mount mappings from `apps/api/src/http/app.ts` to discover all 93 mounted and unmounted endpoints.
