# Coverage and Verification Evidence (Pass 2)

Target commit: `36dfb3a4172ca5cc910c6c6503b4efd641031e35`, branch `chore/baseline-2026-10-28`.
PostgreSQL test container: `postgres:17-alpine` on port 55633, databases `flowboard_harness` and `flowboard_access_test`.
Test Suite Result: **744 passed, 0 skipped, 0 failed** (644 `@flowboard/api`, 100 `@flowboard/contracts`). Root & Web TypeScript compilation: **Clean (exit code 0)**.

---

## 1. 930-Cell Route Authorization Matrix Execution

The full 930-cell route authorization matrix was live executed against the mounted Hono application connected to the disposable PostgreSQL database. The matrix pairs all 93 mounted route declarations with 10 identity cases:
- `unauthenticated`: Request with no session cookie.
- `stranger`: Authenticated user with no relationship to the workspace or project.
- `other_project_member`: Member of a sibling/foreign project in the same or foreign workspace.
- `same_project_no_board_grant`: Project member with no grant on the target board.
- `viewer`: Project member with `viewer` role and a board grant.
- `member`: Project member with `member` role and a board grant.
- `manager`: Project member with `manager` role and a board grant.
- `owner`: Workspace owner.
- `revoked_member`: Formerly active member whose membership was set to `removed`.
- `foreign_or_guessed_id`: Authenticated user accessing random nonexistent UUIDs.

### Summary Statistics of 930-Cell Execution:
- **Total Cells Evaluated:** 930
- **401 UNAUTHORIZED:** 164 cells (consistently returned on all authenticated endpoints when session cookie is absent)
- **403 FORBIDDEN:** 73 cells (enforced on role-insufficient actions, viewers attempting mutations, CSRF origin rejections, system routes without secret)
- **404 NOT_FOUND:** 281 cells (consistently returned to strangers, outsiders, revoked members, and nonexistent foreign IDs)
- **200 / 201 / 204 OK:** 184 cells (legitimate authorized operations for Owner, Manager, Member, Viewer)
- **302 FOUND:** 20 cells (OAuth entry routes redirecting to Google identity provider)
- **400 / 422 / 409 Client Rejections:** 208 cells (schema validations, missing query parameters, idempotency or OCC conflict checks)
- **500 INTERNAL SERVER ERROR:** 0 cells
- **Data Leaks on Unauthorized Cells:** 0 cells (all 401/403/404 rejections returned standardized, non-disclosing error envelopes)

---

## 2. Deep Dive: Deferred Audit Areas

### Area C: Sessions, Cookies, CSRF, and Safe-Next — **PASS**
- **Session Token Hashing (`R3-10`):**
  - Session tokens generated as 32-byte cryptographically secure random bytes (64-character hex strings).
  - Browser cookie holds raw token; database `sessions.id` stores `sha256(rawToken)`.
  - Database dumps/reads reveal only irreversible SHA-256 hashes; bearer token cannot be derived.
- **Cookie Security:**
  - `SameSite=Lax`, `HttpOnly`, `Path=/`, and conditional `Secure` flag enabled for non-localhost origins.
- **CSRF & Origin Verification:**
  - `apps/api/src/http/middleware/origin.ts` intercepts all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) carrying a session cookie.
  - Matches `Origin` and `Referer` against request host and configured `CORS_ORIGIN` allowlist.
  - Rejects cross-origin mismatches with `403 FORBIDDEN: Cross-site request rejected.`
  - Checks browser-sent `Sec-Fetch-Site`; blocks `cross-site` and `same-site` when headers are omitted.
- **Safe-Next Parameter Validation:**
  - `apps/api/src/http/safe-next.ts` sanitizes the `?next=` return path after Google OAuth.
  - Limits length to 300 characters; strictly enforces character regex `/^\/[A-Za-z0-9_/-]*$/` on path and `/^[A-Za-z0-9_=&.-]*$/` on query string.
  - Forbids scheme-relative `//` URLs, control characters, backslashes, dots, percent-encoded bytes, and requires matching a fixed allowlist of frontend application routes (`/projects`, `/board`, `/inbox`, etc.). Defaults safely to `/projects`.

### Area D: Pages Function Proxy and Edge Headers — **PASS**
- **Service Binding Proxy (`apps/web/functions/api/[[path]].ts`):**
  - Uses direct Cloudflare Workers service binding (`env.API.fetch`).
  - Request uses `redirect: 'manual'` so redirect headers (`Location`) are returned directly to the browser instead of being followed inside the edge proxy.
  - Enforces `response.headers.set('Cache-Control', 'no-store')` on every proxied API response to prevent edge or intermediary caching.
- **Edge Routing & Auth Pre-check (`apps/web/functions/_middleware.ts`):**
  - Intercepts page requests before HTML is served. Unauthenticated visitors are redirected to `/signin` without revealing board or project existence.
  - Redirect responses enforce `Cache-Control: no-store`.
- **Security Headers (`apps/web/public/_headers`):**
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Area E: Frontend Security, Rendering & Storage Keys — **PASS**
- **Frontend XSS Vectors:**
  - Source audit of `apps/web/src/` identified zero application-authored `dangerouslySetInnerHTML` with user input. Only static compile-time constants are injected (`THEME_BOOT_SCRIPT`, `RAIL_BOOT_SCRIPT`, SVG sprite defs).
  - Card titles, descriptions, and comments are rendered as native React JSX elements with automatic string escaping.
  - Image Gallery & Lightbox (`apps/web/src/components/board/card-images.tsx`): Images are downloaded through the authenticated API (`api.fetchImageBlob`) and exposed as scoped `blob:` URLs via `URL.createObjectURL()`, then revoked on unmount via `URL.revokeObjectURL()`. Rendered strictly via `<img src={url} alt={label} />`.
  - Pinned Links (`apps/web/src/components/project/brief-card.tsx`): URL is validated on server and client to be strict `https://` with no username/password. Rendered as `<a className="ov-link" href={link.url} target="_blank" rel="noopener noreferrer">`.
  - Mentions Rendering: Comment spans are parsed via `segments()` and rendered into `<mark className="mention">{part.text}</mark>` with React JSX text escaping.
- **Browser Storage Keys:**
  - Audited `sessionStorage` and `localStorage` usage across `apps/web/src/`.
  - The previous `sessionStorage` board caching issue has been completely excised: `sessionStorage` is never written in source and is explicitly wiped on logout (`session.tsx:37-40`).
  - `localStorage` is restricted to user UI settings (`flowboard-ui-theme`, `flowboard-rail-mini`, and sidebar group collapse state). Zero tokens, cards, or user PII are written to storage.

### Area H: Concurrency, Lock Ordering & Race Invariants — **PASS**
- **Invitation Acceptance Concurrency:**
  - `apps/api/src/adapters/invitations.ts:306,368` acquires `FOR UPDATE` locks on both `project_invitations` and `project_memberships`. Concurrent accept requests serialize on the invitation row lock; the second request encounters `status !== 'pending'` and receives `400 INVALID_INVITATION`.
- **Image Finalize vs Delete / Trash Purge:**
  - `apps/api/src/adapters/images.ts:407` locks the card row `FOR UPDATE` during upload finalization. If the card is trashed concurrently, `card.state !== 'active'` aborts finalization with `409 CARD_TRASHED`.
  - Image deletion (`deleteCardImage`) executes within a transaction that registers the deletion in `pending_storage_deletions` and removes the database record before touching object storage. The storage deletion (`deleteStorageAfterCommit`) is executed post-commit; if the Worker crashes or R2 times out, the key remains recorded in `pending_storage_deletions` for automatic retry by scheduled maintenance.
- **Double Import Commit Serialization:**
  - `apps/api/src/adapters/imports.ts:856-865` acquires board and import row locks (`FOR UPDATE`). The first request transitions state to `committing` and `committed`. A simultaneous duplicate request receives `409 COMMIT_IN_PROGRESS` or gracefully receives the idempotent status.

### Area J: Logging, Observability & Privacy — **PASS**
- **Brevo Mailer (`apps/api/src/services/mailer.ts`):**
  - Transactional email dispatch never logs the recipient address, message body, API key, or provider response payload.
  - Failures log only generic internal reason codes (`network`, `brevo_http_429`, `brevo_http_500`).
- **Outbox Email Delivery (`apps/api/src/adapters/invitation-delivery.ts`):**
  - Invitation token is kept in `outbox.payload` only while pending. Upon successful delivery or permanent failure, `settle()` updates the record with `payload = (payload - 'token')`, permanently removing the invitation token from PostgreSQL.
  - Superseded invitations update older pending outbox rows with `payload = (payload - 'token') || '{"superseded":true}'::jsonb`.
  - No invitation tokens or email bodies appear in server stdout/stderr logs.

---

## 3. Attack Surface Analysis on New Code Since Previous Audit

1. **Cloudflare R2 Storage Driver & Image Routes:**
   - Evaluated MIME validation, authenticated streaming, thumbnail caching, and private key isolation.
   - Identified low finding FB-AUD-09 regarding unescaped path separator characters in filenames.
2. **`cleanupOrphanUploads` & Staged-Upload Quota Cap:**
   - Under card `FOR UPDATE` lock, `createImageUpload` sums both finalized images and active staged uploads:
     `COUNT(card_images) + COUNT(active card_image_uploads) <= 10`.
   - Prevents storage exhaustion and card attachment quota circumvention.
   - `cleanupOrphanUploads` queries `staging_cleaned = FALSE` using `FOR UPDATE SKIP LOCKED`, queues keys into `pending_storage_deletions`, sets `staging_cleaned = TRUE`, and executes storage deletes post-commit.
3. **Mentions Architecture & Notification Privacy:**
   - Mention spans are validated against UTF-16 code unit offsets (`0 <= start < end <= body.length`).
   - `validateMentions` asserts that mentioned users hold active board grants. Refusals return uniform `422 VALIDATION_ERROR` without leaking whether the user exists.
   - Notifications re-authorize board access at query time: if a user loses a board grant, notifications referencing that board are filtered out dynamically from their inbox, preventing snippet and title leakage.
4. **`PATCH /api/v1/session/profile`:**
   - Strictly validates `updateProfileInputSchema`: accepts only `displayName` (1-80 characters, no control characters).
   - Rejects unknown fields (`avatarUrl`, `email`, `role`) with 422.
   - Google login preserves edited names using `COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name)`.
5. **Body-Cap Middleware (`routeBodyLimitMiddleware`):**
   - Implements route-aware caps: 1 MiB default, 5 MiB + 64 KiB for imports, 10 MiB + 64 KiB for image uploads.
   - Identified low finding FB-AUD-10 regarding dummy session cookie header bypass.
6. **Migration 0015 (`0015_project_links_workspace_fk.sql`):**
   - Verified idempotent DDL via PostgreSQL exception handling.
   - Composite foreign key constraint `(project_id, workspace_id)` enforces strict tenant referential integrity.
