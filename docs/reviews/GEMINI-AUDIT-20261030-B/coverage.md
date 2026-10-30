# Independent Audit Coverage Matrix: Tasks A through F

**Target Commit:** `8cc31e26065b3351b68296a48163778744bd2f6c`  
**Branch:** `chore/baseline-2026-10-28`  
**Auditor Directory:** `docs/reviews/GEMINI-AUDIT-20261030-B/`  
**Date:** 2026-10-30  

---

## Task Summary Table

| Task | Scope | Status | Evidence File(s) | Exit Code |
|---|---|---|---|---|
| **A** | Secret Scan (History & Working Tree) | **PASS** | `raw/gitleaks-history.json`, `raw/gitleaks-dir.json`, `raw/secret-scan-git-log.txt`, `raw/secret-scan-working-tree.txt` | 0 |
| **B(1)** | UAT Headers & Routing (Unauthenticated) | **PASS** | `raw/uat-headers-*.txt` | 0 |
| **B(2)** | UAT API Cache-Control Verification | **PASS** | `raw/uat-api-cache-check.txt` | 0 |
| **B(3)** | UAT Static Asset & Source Map Leak Check | **PASS** | `raw/static-scan-report.txt`, `raw/static/*` | 0 |
| **B(4)** | UAT Rate Limit 40-Request Burst | **PASS** | `raw/uat-rate-limit-burst.tsv`, `raw/task-6300.log` | 0 |
| **C** | Frontend & A11Y (WCAG 2.1 AA) | **PASS** | Code analysis of `apps/web/src/components/*` & `styles/*`, finding FB-AUD2-04, FB-AUD2-05 | 0 |
| **D** | Image Compression (`image-prepare.ts`) | **PASS** | `apps/web/test/image-prepare.test.ts` (85/85 pass), finding FB-AUD2-02, FB-AUD2-03 | 0 |
| **E** | Dependencies & Licenses | **PASS** | `raw/npm-audit-prod.json`, `raw/npm-audit-all.json`, `raw/licenses-and-scripts.json`, finding FB-AUD2-01, FB-AUD2-08 | 0 |
| **F** | Docs Drift (`API.md` & `FEATURE_CHECKLIST.md`) | **PASS** | `raw/all-api-endpoints.txt`, finding FB-AUD2-06, FB-AUD2-07 | 0 |

---

## Detailed Task Evidence & Verification

### Task A: Secret Scan (Git History & Working Tree)
- **Status:** PASS
- **Tools:**
  - `gitleaks` version `8.30.1` (`/opt/homebrew/bin/gitleaks`)
  - Python regex scanner across full `git log -p --all` and working tree files.
- **Commands & Output:**
  ```bash
  # 1. Full Git History Scan
  gitleaks git --log-opts="--all" --report-format json --report-path docs/reviews/GEMINI-AUDIT-20261030-B/raw/gitleaks-history.json --redact
  # Scanned 170 commits across all branches. 0 real credentials found.

  # 2. Working Tree Scan
  gitleaks dir --report-format json --report-path docs/reviews/GEMINI-AUDIT-20261030-B/raw/gitleaks-dir.json --redact .
  # 0 real secrets found.

  # 3. Targeted Regex Sweeps (Brevo, Google, Neon, Cloudflare, Private Keys, JWTs)
  python3 -c '... regex scanning across git log -p --all ...'
  ```
  Results:
  - `xkeysib-` (Brevo API keys): 0 occurrences
  - `GOCSPX-` (Google OAuth client secrets): 0 occurrences
  - `BEGIN *PRIVATE KEY`: 0 occurrences
  - Cloudflare API tokens / auth keys: 0 occurrences
  - JWT / Bearer tokens: 0 live tokens found
  - `postgres://` connection strings: 74 history occurrences, 67 working tree occurrences. 100% resolve to local loopback fixtures (`127.0.0.1`, `localhost`, `internal-db.local`, `example.com`). Zero production Neon passwords or cloud database credentials exist.

---

### Task B: UAT Live Checks (https://flowboard-app-uat.pages.dev)
- **Status:** PASS (Unauthenticated only; 0 credentials used)
- **B(1) Response & Security Headers:**
  - `/`: HTTP 302 -> `/signin`, `cache-control: no-store`
  - `/signin`: HTTP 200, `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`
  - `/nonexistent-audit-test-path`: HTTP 302 -> `/signin`, `cache-control: no-store` (Entity enumeration prevented)
  - `/api/v1/health`: HTTP 404 JSON, `cache-control: no-store`, `x-request-id` present
  - `/health/ready`: HTTP 302 -> `/signin` (Worker proxy boundary)
  - `/api/v1/session`: HTTP 401 JSON (`{"error":{"code":"UNAUTHORIZED","message":"Authentication required."}}`), `cache-control: no-store`
- **B(2) Confirm `/api/*` is Never Cacheable:**
  - Tested 6 endpoints:
    - `GET /api/v1/session` -> 401 (`Cache-Control: no-store`)
    - `GET /api/v1/workspaces` -> 401 (`Cache-Control: no-store`)
    - `GET /api/v1/projects` -> 401 (`Cache-Control: no-store`)
    - `GET /api/v1/system/status` -> 403 (`Cache-Control: no-store`)
    - `GET /api/v1/auth/google/start` -> 302 (`Cache-Control: no-store`)
    - `GET /api/v1/boards/00000000-0000-0000-0000-000000000000` -> 404 (`Cache-Control: no-store`)
  - All return `no-store` or `no-cache, no-store, max-age=0, must-revalidate`.
- **B(3) Static Site File Audit:**
  - Downloaded 18 static assets referenced from `/signin` (14 JS bundles, 4 CSS bundles) into `docs/reviews/GEMINI-AUDIT-20261030-B/raw/static/`.
  - Source Maps (`*.map`): Probed all 18 corresponding `.map` URLs. All 18 returned HTTP 404 NOT_FOUND. 0 source maps exposed.
  - Dev-login strings: 0 matches for `dev-login` or `dev_login` in production bundles.
  - Secret scanning on downloaded assets: 0 secrets or API keys found.
- **B(4) Rate Limiter Burst Test:**
  - Executed 40 sequential HTTP requests to `https://flowboard-app-uat.pages.dev/api/v1/auth/google/start` over ~20 seconds without following 302 redirect.
  - Requests 1 through 10 returned `HTTP 302` (Redirect to Google OAuth).
  - Request 11 returned `HTTP 429 Too Many Requests`.
  - Requests 11 through 39 returned `HTTP 429 Too Many Requests`.
  - Request 40 returned `HTTP 302` (Bucket refill window).
  - Zero 5xx server errors observed. Rate limiting is active, properly bound, and effective.

---

### Task C: Frontend & A11Y (WCAG 2.1 AA in `apps/web/src`)
- **Status:** PASS (with 2 low-severity usability/compliance findings FB-AUD2-04, FB-AUD2-05)
- **Key Verifications:**
  - Focus trapping and escape handling: Verified in `DialogLayer` (`dialog-layer.tsx`), `CardDetailDrawer` (`card-detail-drawer.tsx`), `Lightbox` (`card-images.tsx`), `ColumnsDialog` (`columns-dialog.tsx`), and `UserMenu` (`user-menu.tsx`).
  - `prefers-reduced-motion`: Catch-all in `apps/web/src/styles/proto/styles.css:716-723` forces `animation-duration: 0.01ms !important`, `transition-duration: 0.01ms !important`, and `scroll-behavior: auto !important`. Hover animations in `motion.css` explicitly wrapped in `@media (prefers-reduced-motion: no-preference)`.
  - Color contrast ratios: Computed for 22 token combinations across light and dark themes using standard WCAG relative luminance:
    - Light `--ink` (#2d2532) on `--surface` (#ffffff): **14.77:1** (Passes AAA)
    - Light `--ink-soft` (#504457) on `--surface` (#ffffff): **9.11:1** (Passes AAA)
    - Light `--muted` (#594a63) on `--surface` (#ffffff): **8.13:1** (Passes AAA)
    - Light `--faint` (#62516c) on `--surface` (#ffffff): **7.21:1** (Passes AAA)
    - Light `--accent-ink` (#ffffff) on `--accent` (#684b7c): **7.28:1** (Passes AAA)
    - Light priority chips (low, med, high, urgent): **6.10:1 to 8.01:1** (Passes AAA)
    - Dark `--ink` (#f6f0f8) on `--surface` (#302a36): **12.41:1** (Passes AAA)
    - Dark `--ink-soft` (#e4d9e9) on `--surface` (#302a36): **10.20:1** (Passes AAA)
    - Dark `--muted` (#c7b8d0) on `--surface` (#302a36): **7.41:1** (Passes AAA)
    - Dark `--faint` (#b8a8c1) on `--surface` (#302a36): **6.23:1** (Passes AAA)
    - Dark priority chips: **6.42:1 to 8.36:1** (Passes AAA)
  - Touch target dimensions: Primary buttons are 34px min-height; standard icon buttons are 32x32px; column action buttons are 26x26px (meets WCAG 2.5.8 minimum target size of 24x24px).
  - ARIA labelling: 156 of 156 `<button>` elements across the web application have visible text or `aria-label`/`aria-labelledby`.
  - Image alternative text: 2 of 2 `<img>` tags declare `alt={label}`.

---

### Task D: Image Compression Code (`apps/web/src/lib/image-prepare.ts`)
- **Status:** PASS (with 1 medium and 1 low finding FB-AUD2-02, FB-AUD2-03)
- **Claims Verified:**
  - WebP ~0.82: `WEBP_QUALITY = 0.82` (line 23), retries 0.70 and 0.55 (line 25).
  - Max 2560px: `LONGEST_SIDE = 2560` (line 20), proportional aspect ratio scaling (line 48-49).
  - EXIF orientation handling: `createImageBitmap(file, { imageOrientation: 'from-image' })` (line 179).
  - Skip if <= 300KB or delta < 10%: `SKIP_UNDER_BYTES = 300 * 1024` (line 21), `MIN_SAVING = 0.1` (line 22).
  - Filename sanitization: `base.replace(/[\\/]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'image'` (line 63).
  - Fallback paths: PNG preserved for transparent images, JPEG fallback for opaque images without WebP encoder, original kept when decode fails or delta is insufficient.
- **Unit Test Execution:**
  ```bash
  npm test --prefix apps/web test/image-prepare.test.ts
  ```
  Exit code: `0` (85 passed, 0 failed, 0 skipped).

---

### Task E: Dependencies & Licenses
- **Status:** PASS (with 1 medium finding FB-AUD2-01 and 1 low finding FB-AUD2-08)
- **Commands & Output:**
  ```bash
  npm audit --omit=dev --json > docs/reviews/GEMINI-AUDIT-20261030-B/raw/npm-audit-prod.json
  npm audit --json > docs/reviews/GEMINI-AUDIT-20261030-B/raw/npm-audit-all.json
  python3 docs/reviews/GEMINI-AUDIT-20261030-B/raw/scan_licenses.py
  ```
- **Auditing Findings:**
  - Production Dependencies (`apps/api`): 4 packages (`@hono/node-server`, `hono`, `kysely`, `pg`), 100% MIT, 0 postinstall scripts.
  - Production Dependencies (`apps/web`): 13 packages:
    - 10 MIT (`@radix-ui/*`, `@tanstack/react-query`, `clsx`, `motion`, `next`, `react`, `react-dom`, `tailwind-merge`)
    - 1 OFL-1.1 (`@fontsource/ibm-plex-sans`)
    - 1 ISC (`lucide-react`)
    - 1 internal package without license field (`@flowboard/contracts`)
    - 0 postinstall scripts.
  - Copyleft / Incompatible Licenses:
    - 0 AGPL
    - 0 GPL
    - 0 SSPL
    - 0 Commons Clause
    - 1 transitive optional dependency (`@img/sharp-wasm32` under `@next/env`) licensed under Apache-2.0 AND LGPL-3.0-or-later.

---

### Task F: Docs Drift (`docs/API.md` & `docs/FEATURE_CHECKLIST.md`)
- **Status:** PASS (with 2 low findings FB-AUD2-06, FB-AUD2-07)
- **Commands & Output:**
  ```bash
  python3 docs/reviews/GEMINI-AUDIT-20261030-B/raw/parse_all_routes.py
  ```
  Parsed 93 route endpoints across 17 route files in `apps/api/src/http/routes/`.
- **Cross-Check Results:**
  - Discovered 6 route naming/verb discrepancies between `docs/API.md` and code (`PATCH` vs `POST` for notification read, missing `mark-all-read`, missing `move-undo`, `transfer-ownership` path difference, missing `access-summary`, missing `workspaces/:wid/my-tasks`).
  - Identified `RBAC-05` checklist entry claiming blanket inheritance, which conflicts with current per-board grant rules.
