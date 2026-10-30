# Independent Security & Quality Audit: Executive Summary

**Target Commit:** `8cc31e26065b3351b68296a48163778744bd2f6c`  
**Branch:** `chore/baseline-2026-10-28`  
**Audit Directory:** `docs/reviews/GEMINI-AUDIT-20261030-B/`  
**Target Environment:** `https://flowboard-app-uat.pages.dev`  
**Date:** 2026-10-30  

---

## 1. Executive Summary

An independent security, quality, and compliance audit was performed against the frozen Flowboard codebase at commit `8cc31e2` and its deployed unauthenticated UAT instance. The audit covered secret scanning across all git history, live network and header inspection, WCAG 2.1 AA accessibility compliance, client-side image optimization, dependency licensing, and documentation synchronization.

### Key Results
- **Secret Scanning (Clean):** Full repository history (170 commits across all branches) and the entire working tree were scanned using `gitleaks` v8.30.1 and custom regex scripts for Google OAuth secrets, Brevo API keys, Cloudflare tokens, private keys, and Neon database passwords. **Zero credentials or production secrets exist in the repository.** All detected connection strings point strictly to loopback/local test fixtures.
- **UAT Infrastructure & Edge Security (Passing):** Live probes against `https://flowboard-app-uat.pages.dev` confirm that unauthenticated routes enforce strict Content Security Policy (`frame-ancestors 'none'`), framing prevention (`X-Frame-Options: DENY`), MIME nosniffing, and entity enumeration protection (302 redirects to `/signin`). Every tested `/api/*` endpoint returned `Cache-Control: no-store`. All 18 production JavaScript and CSS bundles were inspected; zero source maps (`*.map`), dev-login bypasses, or embedded keys exist.
- **Rate Limiting (Verified):** A 40-request burst test on `/api/v1/auth/google/start` showed rate limiting kicking in cleanly at request 11 with HTTP 429 (`Too Many Requests`), generating zero 5xx server errors.
- **Accessibility & Frontend Quality (WCAG 2.1 AA):** All 22 CSS color token pairs in both light and dark themes exceed a 6.0:1 contrast ratio, surpassing the 4.5:1 WCAG AA threshold. All 156 button elements have explicit accessible labels or visible text. Motion effects respect `prefers-reduced-motion`.
- **Client-Side Image Pipeline (Verified):** WebP 0.82 compression, 2560px capping, EXIF orientation correction, and 10% delta / 300KB skip thresholds were confirmed in code and validated with 85/85 passing unit tests.
- **Dependency Licenses (Compliant):** All 17 production dependencies across `apps/api` and `apps/web` use permissive open-source licenses (MIT, ISC, OFL-1.1). Zero AGPL, GPL, SSPL, or Commons Clause dependencies exist, and zero packages execute postinstall scripts.

---

## 2. Top 5 Risks

1. **Unverified Third-Party Mailer Configuration on UAT/Prod:**  
   Outbound invitation delivery relies on the Brevo API key configured as a Cloudflare Worker secret. Because transaction commits succeed fail-soft without blocking on email delivery, an absent or invalid Brevo key will cause invitations to queue in the outbox without notifying the inviter in the UI.
2. **PostCSS Upstream Vulnerability in Next.js Toolchain (GHSA-6g55-p6wh-862q):**  
   `npm audit --omit=dev` identified that Next.js brings in `postcss` <= 8.5.17, which contains a high-severity path traversal issue (CVSS 7.5) in source map comment parsing. While Flowboard disables source maps in production static exports, the package should be overridden.
3. **Main-Thread CPU Saturation in `hasAlpha` on 2560x2560 Opaque Images:**  
   Checking for transparency on full-resolution photos before upload allocates a 26.2 MB buffer and runs 6.5 million iterations on the main JavaScript thread, risking UI jank or brief freezes on low-power mobile browsers.
4. **Cloudflare Worker R2 Binding (`IMAGES`) Operational Dependency:**  
   The image upload and retrieval pipeline requires the private R2 bucket to be bound to the Worker environment as `IMAGES`. If this binding is missing in the Cloudflare deployment settings, image endpoints return HTTP 503 `CONFIG_ERROR`.
5. **Documentation Inconsistency Regarding Board Grants:**  
   `docs/FEATURE_CHECKLIST.md` marks `RBAC-05` as verified based on the historical prototype's blanket project-level inheritance, whereas current application code and UI enforce separate per-board access grants administered via `/people`.

---

## 3. Beta Blockers for 10 People

**Current Status:** **ZERO (0) critical or high-severity code blockers.**  
The application architecture, access controls, CSRF protections, and session isolation are sound for a 10-person beta.

**Single Required Gate:**
- **Owner Authenticated Smoke Test:** Performed by the project owner using real Google credentials on `https://flowboard-app-uat.pages.dev` to verify OAuth sign-in, Brevo email receipt, and per-board access isolation following the steps in [`needs-owner.md`](needs-owner.md).

---

## 4. Non-Blocking Deferred Items

The following quality improvements and doc synchronizations can be addressed post-beta without impacting user security:

1. **Next.js / PostCSS Dependency Update:**  
   Add `"overrides": { "postcss": "^8.5.23" }` in the root `package.json` to resolve GHSA-6g55-p6wh-862q.
2. **Image Preparation Alpha Sampling Optimization:**  
   Update `hasAlpha` in `apps/web/src/lib/image-prepare.ts` to sample a downscaled 256x256 thumbnail, reducing memory consumption by 99% and preventing main-thread stalls.
3. **Animated WebP Preservation:**  
   Check the WebP `ANIM` header chunk to skip re-encoding for animated files so animations are not flattened to a single static frame.
4. **Keyboard Focus Fallback on Deep-Link Drawer Dismissal:**  
   In `board-view.tsx`, fallback to focusing `[data-card-id="..."] .card-open` when closing a card drawer opened directly via URL query parameter.
5. **Modal Background Inert Tagging:**  
   Enhance `DialogLayer` to apply `inert` to background containers (`main`, `#rail`, `#topbar`) during active modal dialogs.
6. **API Specification Synchronization:**  
   Update `docs/API.md` and `docs/features.tsv` to align with the actual HTTP verbs and paths (`PATCH /notifications/:id/read`, `mark-all-read`, `move-undo`, `access-summary`).
