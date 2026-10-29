# Scope B Audit Report: Unreviewed Operational & Frontend Surfaces

**Review Date**: 2026-10-29  
**Review Target**: Commit `6e15bd0`  
**Reviewer**: `independent-reviewer-gemini` (Model: `gemini-2.5-pro`)  
**Status**: Comprehensive Independent Audit (Scope B, Items 1–13)

---

### Audit Item 1: Pages Function Proxy (`apps/web/functions/`)
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - `apps/web/functions/api/[[path]].ts`: Implements same-origin proxy over Cloudflare service binding (`env.API.fetch()`) with fallback to `env.API_ORIGIN`.
  - **Header Forwarding**: Preserves client request headers intact; explicitly attaches `Cache-Control: no-store` to the downstream response to prevent edge caching of private API data.
  - **Cookie Handling**: Passes `Set-Cookie` intact from Worker to client; enables `SameSite=Lax` cookies on the same domain.
  - **Redirect Handling**: Specifies `{ redirect: 'manual' }` to pass 302 redirects (such as Google OAuth flow) directly back to the user's browser instead of following them inside the proxy isolate.
  - **X-Forwarded-* Injection**: Cloudflare Workers runtime constructs isolate-level Request objects; `apps/api` never reads `X-Forwarded-*` headers, eliminating spoofing risks.
  - **Redirect Safety (`boards/[id].ts` & `projects/[id].ts`)**: Constructs target URL with `new URL('/board', context.request.url)` and calls `target.searchParams.set('id', params.id)`. The parameter is strictly constrained to the query string, eliminating any open redirect vulnerability.

---

### Audit Item 2: Frontend Security (`apps/web/src/`)
- **Verdict**: **PASS WITH RECOMMENDATION (LOW)**
- **Evidence & Mechanics**:
  - **XSS & Content Rendering**: All card titles, descriptions, comments, and imported spreadsheet data are rendered via standard React JSX expressions (`{card.title}`), which natively escape HTML entities.
  - **`dangerouslySetInnerHTML` Inspection**: Exactly two occurrences exist in the codebase:
    1. `apps/web/src/app/layout.tsx:27`: Inline script reading `localStorage.getItem('flowboard-ui-theme')` to apply dark mode before hydration without flash. Contains zero user-controlled input.
    2. `apps/web/src/components/ui/icon.tsx:12`: Injects static, hardcoded SVG sprite symbols (`<defs>${SPRITE_SYMBOLS}</defs>`). Zero dynamic user input.
  - **Invitation Token Handling**: In `apps/web/src/components/invitation/accept-screen.tsx`, the token is read once from the query parameter on mount, immediately stripped from the address bar and browser history via `window.history.replaceState()`, and kept strictly in a React `useRef` in memory. It is never logged or written to storage.
  - **Web Storage & Privacy**: Verification confirms all board caching in `sessionStorage` has been eliminated. `localStorage` is strictly restricted to theme selection (`flowboard-ui-theme`). On logout, `apps/web/src/lib/session.tsx` explicitly purges all keys from `sessionStorage`.
  - **Development Sign-in Elimination**: `apps/web/src/app/signin/page.tsx` gates dev-login behind `const DEV_LOGIN = process.env.NODE_ENV !== 'production';`. In production static builds (`npm run build:web`), `process.env.NODE_ENV` is inlined as `"production"`. Grep verification of `.next` static chunks confirmed that development sign-in code and strings are completely dead-code eliminated from production output.
  - **Recommendation (Low Severity)**: `apps/web/public/` currently lacks a `_headers` file. Cloudflare Pages does not attach `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, or `X-Frame-Options: DENY` by default. Recommend adding `public/_headers` before GA.

---

### Audit Item 3: XLSX Parser Safety (`apps/api/src/services/excel-parser.ts`)
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Decompression Bomb Protection**: Enforces strict bounds: `MAX_COMPRESSED_BYTES = 5 * 1024 * 1024` (5 MiB), `MAX_EXPANDED_BYTES = 20 * 1024 * 1024` (20 MiB), and `totalEntries <= 100`. Decompression tracks cumulative bytes and aborts immediately if limits are exceeded.
  - **Row & Data Bounds**: Imposes `MAX_IMPORT_ROWS = 200`. Excess rows trigger validation rejection.
  - **XXE Injection**: Enforces `assertNoXXE()` on `xl/sharedStrings.xml` and worksheet XML, rejecting `<!DOCTYPE` and `<!ENTITY` declarations with `422 UNPROCESSABLE_ENTITY`.
  - **Formula Injection**: Cell values are parsed as inert strings. Note: if an Excel/CSV export feature is built in the future, cell values starting with `=`, `+`, `-`, or `@` must be escaped with a leading quote to protect client spreadsheet software.

---

### Audit Item 4: Image Upload Path (`apps/api/src/services/image-validator.ts` & `routes/images.ts`)
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Content-Type Sniffing**: Inspects magic bytes for PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), WebP (`RIFF....WEBP`), and GIF (`GIF87a`/`GIF89a`). Disallows SVG or executable formats.
  - **Polyglot & Script Defense**: Scans buffer slices for markup snippets (`<svg`, `<?xml`, `<html`, `<script`, `javascript:`, `onload=`, `onerror=`) to block HTML/SVG polyglots disguised as raster images.
  - **Size & Dimension Limits**: `MAX_IMAGE_BYTE_LENGTH = 10 MiB`, `MAX_IMAGE_DIMENSION = 8192px`, and `MAX_IMAGE_MEGAPIXELS = 20 MP`.
  - **Private Delivery Authorization**: `GET /api/v1/images/:imageId/content` is protected by `authMiddleware` and invokes `getImageForDelivery()`, verifying that the requesting user possesses active board read access before streaming bytes. Sets `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
  - **Storage Cleanup**: Durable cleanup keys are persisted to `pending_storage_deletions` (Migration 0006) and safely reclaimed by scheduled background workers.

---

### Audit Item 5: Database Migrations 0001 to 0010
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Non-Destructive Schema**: Inspected SQL files `0001` through `0010`. Zero occurrences of `DROP TABLE`, `TRUNCATE`, `RENAME`, or `ALTER TABLE ... DROP COLUMN`. The only deletion statement is inside the `0007` trigger body (cascading board grant deletion when project membership is removed).
  - **Migration 0009 Backfill Safety**: Adds `key_prefix` to projects (defaults to `'PRJ'`) and `card_number` to cards. Uses `ROW_NUMBER() OVER (ORDER BY created_at, id)` to assign numbers in creation order, resets `card_key_seq` past `MAX(card_number)`, and sets `NOT NULL` only after rows are backfilled. Tested and verified in `migration-0009-backfill.test.ts`.
  - **Migration 0010 Additive Column Tone**: Adds nullable `tone` column to `columns` with a `CHECK` constraint against the 10 approved prototype pastel names. Safe against existing data.

---

### Audit Item 6: Rate Limiting & Abuse Protection
- **Verdict**: **PASS FOR BETA WITH OPERATIONAL FINDING (MEDIUM)**
- **Evidence & Mechanics**:
  - **Existing Protections**: Implements `bodyLimitMiddleware` (1 MiB default limit, returning `413 PAYLOAD_TOO_LARGE`) and `deadlineMiddleware` (5s default, 25s worker timeout).
  - **Finding**: The application layer lacks IP-based or user-based token bucket rate limiting on sensitive mutation endpoints (`/api/v1/auth/google`, `/api/v1/invitations`, `/api/v1/cards/:id/comments`).
  - **Beta Mitigation**: Cloudflare WAF Rate Limiting rules should be enabled at the edge for production:
    - 10 requests / minute on `/api/v1/auth/google/*`.
    - 60 requests / minute on `/api/v1/*` state-changing methods (`POST`, `PUT`, `DELETE`).

---

### Audit Item 7: Performance & Query Patterns
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Board Snapshot Scalability**: `getBoardSnapshot` executes ~7 database queries inside a single `REPEATABLE READ` transaction: board metadata, columns list, active counts (`GROUP BY col.id`), matching counts, bounded cards per column (limit 15), and distinct assignees. Zero N+1 query patterns.
  - **Database Index Coverage**: Inspected indexes: `idx_cards_column_pos` (`cards(column_id, position)`), `board_grants(board_id, user_id)`, `idx_comments_card_created` (`comments(card_id, created_at)`), and `cards_card_number_key` (`cards(card_number)`).
  - **Known Scope Boundary**: Per-column pagination (P-011) is deferred to future milestones; current snapshot limit of 15 cards per column prevents unbounded payload bloat.

---

### Audit Item 8: Background Tasks & Cron Workers
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Trash Purge Job (`purgeExpiredTrash`)**: Runs on `*/5 * * * *`. Selects soft-deleted cards past the 24-hour retention window using `LIMIT 50 FOR UPDATE SKIP LOCKED`. Non-blocking under concurrent executions.
  - **Outbox Lease (`processOutboxLease`)**: Employs expiring leases (`lease_until = NOW() + INTERVAL '2 minutes'`) to guarantee that crashing workers do not permanently abandon notifications.
  - **Privacy**: Logging is sanitized; error handlers log correlation IDs without printing personal card content or email addresses.

---

### Audit Item 9: Accessibility (WCAG 2.1 AA)
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Keyboard Movement Alternative**: While cards support drag-and-drop, every card retains a dedicated move button (`aria-label={`Move card: ${card.title}`}`) opening `MoveDialog`. `MoveDialog` provides keyboard radio buttons, focus trapping, and clear submit/cancel actions.
  - **Semantic Elements**: Card titles are wrapped in semantic `<h3><button>` elements; dates use `<time dateTime="...">`; badges use accessible labels.
  - **Screen Reader Support**: Hidden accessibility text is provided for count indicators (`<span className="sr-only">Comments: </span>`).
  - **Motion Sensitivity**: Transitions honor `prefers-reduced-motion` settings.

---

### Audit Item 10: Dependencies & Supply Chain
- **Verdict**: **PASS WITH OPERATIONAL FINDINGS (LOW)**
- **Evidence & Mechanics**:
  - **Licensing Audit**: All direct dependencies across `apps/api`, `apps/web`, and `packages/contracts` use permissive MIT or Apache 2.0 licenses (`hono`, `pg`, `kysely`, `@radix-ui/*`, `@tanstack/react-query`, `zod`, `lucide-react`, `motion`, `next`). Zero AGPL or Commons Clause packages exist in dependencies.
  - **`npm audit` Findings**:
    1. `postcss <=8.5.22` (High): Transitive build-time dependency in Next.js. Non-exploitable in static export runtime.
    2. `undici 7.0.0 - 7.30.0` (High): Transitive dependency in local development tools (`miniflare`/`wrangler`). Not bundled into production Worker runtime.
    3. `zod <4.6.6` (High): Memory exhaustion vulnerability on oversized constrained collections. Mitigated by `bodyLimitMiddleware` (1 MiB payload limit) and strict array size bounds (`max(20)` on assignees).

---

### Audit Item 11: Specification & Contract Drift
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - Verified route schemas in `packages/contracts/src` against route handlers in `apps/api/src/http/routes`.
  - All status codes, idempotency headers, and error shapes conform to `docs/API.md`.
  - `docs/FEATURE_CHECKLIST.md` accurately preserves 0 verified backend features pending independent review closure.

---

### Audit Item 12: Observability & Information Leakage
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - **Central Error Handler**: `errorHandler` in `apps/api/src/http/middleware/error-handler.ts` catches unhandled exceptions and outputs `{ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', requestId } }`. Stack traces, connection strings, and SQL queries are never disclosed.
  - **Deadlock Handling**: PostgreSQL serialization/deadlock codes (`40P01`, `40001`) are caught and mapped to HTTP `503 SERVICE_UNAVAILABLE` with a `Retry-After: 1` header.
  - **Probe Hygiene**: `GET /health/ready` returns `{ data: { status: 'ready' } }` or `503 DATABASE_UNAVAILABLE`. Zero version numbers or environment secrets are exposed.

---

### Audit Item 13: Test Quality & Safety Fences
- **Verdict**: **PASS**
- **Evidence & Mechanics**:
  - Full suite execution on disposable PostgreSQL 17 on `127.0.0.1:55488` completed with **450 passed, 0 skipped, 0 failed** (`reviewer-complete-suite.log`).
  - Gated tests correctly verify safety fences (`localhost` and `/flowboard_access_test` DB name), preventing accidental execution against shared databases.
  - Forced concurrency probe (`probe-concurrency-and-deadlocks.ts`) verified that lock ordering in comments and imports resolves the deadlocks identified in R3.
