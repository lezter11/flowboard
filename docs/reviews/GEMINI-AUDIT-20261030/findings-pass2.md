# Findings (Pass 2)

Target commit: `36dfb3a4172ca5cc910c6c6503b4efd641031e35` on branch `chore/baseline-2026-10-28`.
Review scope: Independent re-verification of FB-AUD-01 through FB-AUD-08, completion of deferred audit areas (C, D, E, H, J), execution of the 930-cell route authorization matrix, and attack analysis of new code introduced between `6e15bd0` and `36dfb3a`.
Execution environment: Isolated disposable PostgreSQL 17 container on port 55633, database `flowboard_harness` and `flowboard_access_test`.

---

## 1. Re-Verification of Previous Audit Findings (FB-AUD-01 to FB-AUD-08)

### FB-AUD-01 | critical | `apps/api/src/adapters/storage.ts` & `apps/api/src/runtime/worker.ts`
- **Previous Finding:** Image storage defaulted to a process-local `MemoryStorageDriver` Map without durable R2 storage binding, causing cross-isolate data loss.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `79995e9`, `36dfb3a`).
- **Evidence & Probes:**
  - `apps/api/src/adapters/storage.ts` now provides `R2StorageDriver` over Cloudflare R2 bucket binding `IMAGES`.
  - Default storage driver is `null`. `getStorageDriver()` fails closed by throwing `HttpError(503, 'CONFIG_ERROR', 'Image storage is not configured for this deployment.')` before any database staging row is written.
  - All 10 image routes (`/api/v1/cards/:cardId/image-uploads`, `/content`, `/finalize`, etc.) enforce `requireImageStorage` middleware.
  - Executing `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/storage-isolate-repro.mjs` against `36dfb3a` confirms immediate `503 CONFIG_ERROR` thrown when no bucket is bound (exit code 1, zero silent fallback to memory).
  - Integration suite `apps/api/test/b7-image-storage-r2.test.ts` executes 244 lines of tests verifying cross-isolate upload, finalize, delivery, and deletion.

### FB-AUD-02 | high | `apps/api/src/services/excel-parser.ts` & `apps/api/src/adapters/imports.ts`
- **Previous Finding:** XLSX decompression called `inflateRawSync` without an output cap, allowing zip bomb allocation in Worker memory; parser ran before checking board existence and caller grants.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `d201c9f`).
- **Evidence & Probes:**
  - `apps/api/src/services/excel-parser.ts:169-188` calculates `remainingBudget = MAX_EXPANDED_BYTES - totalExpandedBytes` and verifies `uncompressedSize > remainingBudget` before decompression. It passes `{ maxOutputLength: remainingBudget }` directly to `zlib.inflateRawSync`.
  - `apps/api/src/adapters/imports.ts:170-220` introduces `assertImportAccessBeforeParse`, performing a lock-free board existence and authorization check before any decompression starts.
  - Executing `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/xlsx-inflate-repro.mjs` demonstrates that a compressed zip member with declared uncompressed size over 20 MiB is rejected immediately with only 40 bytes external memory delta (previously 41,951,245 bytes allocated).

### FB-AUD-03 | medium | `apps/api/src/adapters/cards.ts`
- **Previous Finding:** Card assignment validation accepted `viewer` role with a board grant, contradicting `docs/FEATURE_SPEC.md`.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `41e18ae`).
- **Evidence & Probes:**
  - `apps/api/src/adapters/cards.ts:162-175` restricts valid card assignees strictly to active workspace owner, managers, or members holding a board grant (`role !== 'viewer'`).
  - Executing `FLOWBOARD_AUDIT_DATABASE_URL=... node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/viewer-assignee-repro.mjs` against `36dfb3a` returns `status: 422, viewerAssigned: false, errorCode: "VALIDATION_ERROR"`. In Pass 1 this returned `status: 200, viewerAssigned: true`.

### FB-AUD-04 | medium | `package-lock.json`
- **Previous Finding:** `npm audit --omit=dev` reported 2 production advisories (1 moderate, 1 high) from nested `postcss@8.4.31` in `next@15.5.28`.
- **Pass 2 Status:** **OPEN / ACCEPTED RISK** (Documented in `docs/UAT_DEPLOY.md`).
- **Evidence & Probes:**
  - `npm audit --omit=dev --json` on `36dfb3a` confirms 2 advisories in `postcss` (`GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849`). Full `npm audit --json` reports 5 advisories (including dev tools `wrangler`, `miniflare`, `undici`).
  - Upgrading requires `next@16.4.3`, a major semver breaking change. Deployment evaluated candidate branches in `docs/UAT_DEPLOY.md` (D-12); acceptance is frozen pending Next 16 regression verification.

### FB-AUD-05 | medium | `apps/api/src/adapters/rate-limit-postgres.ts`
- **Previous Finding:** Invitation rate limits had only client IP counters (10/min), allowing authenticated callers to bypass rate limits by rotating source IPs.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `3efe6ec`).
- **Evidence & Probes:**
  - `apps/api/src/adapters/rate-limit-postgres.ts:78-106` implements `consumeInvitationScopeLimits`, checking four distinct rate buckets within the invitation database transaction:
    - `invite-inviter`: 20 / minute
    - `invite-inviter-hour`: 200 / hour
    - `invite-project`: 30 / minute
    - `invite-project-hour`: 300 / hour
  - Rate limits execute inside the transaction after grant verification; failing checks rollback atomically and fail closed with 429 or 503. Verified in `apps/api/test/b7-invite-scope-limits.test.ts`.

### FB-AUD-06 | medium | `docs/SECURITY_ROADMAP.md` & `docs/UAT_DEPLOY.md`
- **Previous Finding:** Database boundary relied on a broad database role (`neondb_owner`) without PostgreSQL Row-Level Security (RLS) or least-privilege runtime role separation.
- **Pass 2 Status:** **DOCUMENTED / ACCEPTED KNOWN RISK** (Documented in `docs/UAT_DEPLOY.md` D-12).
- **Evidence & Probes:**
  - Deployment confirmed on UAT: `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;` returns `neondb_owner`, `rolcreatedb = true, rolcreaterole = true`.
  - Documented as an accepted risk for Beta; migration vs runtime role separation is scheduled prior to public production release.

### FB-AUD-07 | low | `database/migrations/0015_project_links_workspace_fk.sql`
- **Previous Finding:** `project_links.workspace_id` and `project_id` foreign keys were independent, allowing links pairing Workspace A with Project B.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `d932a04`).
- **Evidence & Probes:**
  - Migration 0015 adds composite foreign key:
    `ALTER TABLE project_links ADD CONSTRAINT project_links_project_workspace_fk FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE RESTRICT;`
  - Probed directly on disposable PostgreSQL: an insert pairing a project in Workspace B with Workspace A throws `ERROR: insert or update on table "project_links" violates foreign key constraint "project_links_project_workspace_fk"` (`SQLSTATE 23503`).

### FB-AUD-08 | low | `apps/api/src/http/middleware/limits.ts` & `apps/api/src/http/routes/google-auth.ts`
- **Previous Finding:** Global 1 MiB body cap rejected valid 5 MiB XLSX workbooks and 10 MiB image uploads before route validation; Google token exchange logged full provider error body.
- **Pass 2 Status:** **VERIFIED FIXED** (Commit `38a9e3f`).
- **Evidence & Probes:**
  - `routeBodyLimitMiddleware` enforces route-aware limits: 1 MiB default, 5 MiB + 64 KiB envelope for authenticated XLSX imports, and 10 MiB + 64 KiB envelope for authenticated image uploads. Anonymous callers stay at 1 MiB.
  - `apps/api/src/http/routes/google-auth.ts:156-161` cancels provider body stream without reading, logging only `{ event: 'google_token_exchange_failed', status }`.

---

## 2. New Findings from Second Pass Audit

### FB-AUD-09 | low | `packages/contracts/src/images.ts:16-21`; `apps/api/src/adapters/images.ts:302,461`
- **What is wrong:** `createImageUploadInputSchema` validates `filename` with `.min(1).max(255)`, but does not forbid path separator characters (`/`, `\`) or relative directory sequences (`../`). Storage keys are assembled as `staging/${upload.id}/${upload.filename}` and `images/${upload.project_id}/${upload.card_id}/${imageId}/${upload.filename}`. While Cloudflare R2 treats object keys as flat keys, arbitrary `/` characters in user filenames create unexpected prefix directory hierarchies in the storage bucket.
- **Exact reproduction:** Calling `POST /api/v1/cards/:cardId/image-uploads` with `{"filename": "subfolder/image.png", ...}` succeeds with 201 and creates an R2 object key containing unnormalized subpaths. The web client sanitizes filenames in `apps/web/src/lib/image-prepare.ts:63` (`replace(/[\\/]/g, '_')`), but direct API clients bypass client-side stripping.
- **Suggested fix:** Add regex validation to `createImageUploadInputSchema.filename`:
  `.regex(/^[^/\\:\0-\x1f]+$/, 'Filename must not contain path separators or control characters')`.
- **Confidence:** Confirmed code behavior; low impact because Cloudflare R2 bucket security prevents escaping bucket boundaries.

### FB-AUD-10 | low | `apps/api/src/http/middleware/limits.ts:17-25`
- **What is wrong:** `bodyLimitFor` determines whether to grant the 5 MiB or 10 MiB body cap based solely on regex pattern matching on the incoming `Cookie` header (`/(^|;\s*)(flowboard_session|session)=/`). An unauthenticated attacker who sends `Cookie: session=bogus` receives the expanded 10 MiB request limit on `/api/v1/image-uploads/:uploadId/content` before authentication runs and rejects the request.
- **Exact reproduction:** Sending a 2 MiB request body to `PUT /api/v1/image-uploads/:uploadId/content` with `Cookie: session=x` passes the body cap and receives `401 UNAUTHORIZED` rather than `413 PAYLOAD_TOO_LARGE`.
- **Suggested fix:** Accept as documented design tradeoff: body cap middleware runs in streaming mode prior to buffering or database access to prevent CPU/memory exhaustion on unauthorized calls.

### FB-AUD-11 | low | `apps/api/src/adapters/invitations.ts:206`; `apps/api/src/adapters/invitation-delivery.ts:68-73`
- **What is wrong:** When an invitation is delivered or permanently failed, `settle()` executes `payload = (payload - 'token') || jsonb_build_object('providerMessageId', $3::text)`. This successfully deletes the raw invitation link token from the outbox table. However, `email`, `inviterName`, and `projectName` remain indefinitely in `outbox.payload`.
- **Exact reproduction:** Querying `SELECT payload FROM outbox WHERE event_type = 'invitation.created' AND status = 'delivered'` confirms `token` is deleted, but `email` remains stored.
- **Suggested fix:** Add a scheduled retention cleanup job that purges settled outbox rows (`status IN ('delivered', 'failed')`) older than 30 days to adhere to data minimization and GDPR compliance.

---

## 3. Findings Summary Table

| Finding ID | Severity | Area | Status at `36dfb3a` | Description |
|---|---|---|---|---|
| **FB-AUD-01** | Critical | Storage / R2 | **Verified Fixed** | Durable R2 driver implemented; fails closed with 503 without bucket |
| **FB-AUD-02** | High | Input Parsers | **Verified Fixed** | `inflateRawSync` bounded with `maxOutputLength`; pre-parse grant fence |
| **FB-AUD-03** | Medium | RBAC / Cards | **Verified Fixed** | Viewers strictly rejected as card assignees with 422 |
| **FB-AUD-04** | Medium | Dependencies | **Open / Accepted** | `postcss` advisories in `next@15.5.28`; Next 16 upgrade candidate under test |
| **FB-AUD-05** | Medium | Abuse / Limits | **Verified Fixed** | Per-inviter and per-project transactional rate limits enforced |
| **FB-AUD-06** | Medium | Database Boundary | **Open / Accepted** | UAT runtime role uses `neondb_owner`; role separation planned for launch |
| **FB-AUD-07** | Low | Data Integrity | **Verified Fixed** | Migration 0015 enforces composite foreign key on `project_links` |
| **FB-AUD-08** | Low | Limits / Logs | **Verified Fixed** | Route-aware body caps (1/5/10MB); Google token exchange body omitted |
| **FB-AUD-09** | Low | Images / R2 | **New (Low)** | Contract filename schema does not forbid path separators `/` or `\` |
| **FB-AUD-10** | Low | Middleware | **New (Low)** | Dummy cookie header grants expanded 10MB body cap prior to 401 auth |
| **FB-AUD-11** | Low | Privacy / Outbox | **New (Low)** | Settled outbox rows retain recipient email metadata after token drop |
