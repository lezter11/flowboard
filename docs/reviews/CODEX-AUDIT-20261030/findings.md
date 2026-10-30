# Findings

Target: `chore/baseline-2026-10-28` at `371cc9f31dd605ddead4eda743c2d26e12c07fca`. The probes use synthetic data and, where applicable, only the disposable PostgreSQL container recorded in `manifest.json`.

## Critical

### FB-AUD-01 | critical | `apps/api/src/adapters/storage.ts:50`; `apps/api/src/runtime/worker.ts:7-10,30-35`

**What is wrong:** The active object-storage driver defaults to a process-local `Map`. The Worker binding type and request initialization contain no R2 bucket or durable storage adapter, and no runtime call installs another driver. Image bytes are therefore isolate-local, while image metadata is stored in PostgreSQL. A fresh Worker isolate cannot read bytes finalized by an earlier isolate. A card can retain an image record whose actual content has disappeared. This is data loss for a feature the API exposes.

**Exact reproduction:** `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/storage-isolate-repro.mjs` writes three synthetic bytes through the module's default driver, starts a separate Node worker isolate importing the same source module, and reads `null` there (exit 0). The upload adapter calls this driver for staged and permanent objects at `apps/api/src/adapters/images.ts:294-298,443-459`; the final metadata insert follows at lines 461-471. This is an isolate-boundary reproduction of the storage implementation; a signed-in UAT upload was not attempted.

**Suggested fix:** Implement and inject a durable private object-store adapter (R2 is the current Cloudflare choice), fail startup if production storage is absent, and verify upload/finalize/read/delete across separate Worker isolates with metadata consistency and cleanup tests before offering image uploads.

**Confidence:** confirmed for the deployed Worker source shape; deployed UAT object behavior not exercised with a signed-in account.

## High

### FB-AUD-02 | high | `apps/api/src/services/excel-parser.ts:160-188`; `apps/api/src/adapters/imports.ts:167-170`

**What is wrong:** The XLSX parser calls `inflateRawSync` without an output cap, then compares the already allocated output length to the 20 MiB aggregate limit. A tiny compressed member can consume more than the limit in Worker memory before rejection. The import adapter parses the workbook before checking whether the target board exists or whether the actor has a grant, so every authenticated caller can reach this expensive step with a guessed board ID.

**Exact reproduction:** Run `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/xlsx-inflate-repro.mjs` (exit 0). A 20,516-byte ZIP member expands to 20,971,521 bytes against the 20,971,520-byte maximum; the parser reports `PAYLOAD_TOO_LARGE` only after inflate. The probe measured a 41,951,245-byte increase in Node's externally allocated memory for this small case. It does not attempt a larger payload or a UAT upload.

**Suggested fix:** Pass the remaining aggregate budget as the decompressor's hard output limit; reject declared-size and per-entry/aggregate overages before inflation; cap CPU/work per entry; and check board existence and authorization before parsing. Add Worker-runtime tests for compressed and shared-string abuse.

**Confidence:** confirmed.

## Medium

### FB-AUD-03 | medium | `apps/api/src/adapters/cards.ts:158-174`; `docs/API.md:59`

**What is wrong:** Card assignment validation accepts any active project member with a grant, including a `viewer`. The API and feature spec say assignees are active owners, managers, or members. The separate people-picker test excludes Viewers, but the mutation validator does not.

**Exact reproduction:** `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/viewer-assignee-repro.mjs` on disposable PostgreSQL creates an owner, a Viewer with an active board grant, and a card; an owner PATCH assigns that Viewer. The mounted API returns `200` and `viewerAssigned: true` (exit 0).

**Suggested fix:** Require an active `manager` or `member` role in assignment validation (plus the workspace owner), and add a mounted PostgreSQL regression asserting a Viewer assignment is rejected without changing the card or activity.

**Confidence:** confirmed.

### FB-AUD-04 | medium | `package-lock.json:3762-3814,4791,4920`; `apps/web/package.json:22`

**What is wrong:** `npm audit --omit=dev` reports 2 production-tree advisories (1 moderate, 1 high). The lock includes `next@15.5.28` and its nested `postcss@8.4.31`; npm reports PostCSS source-map path traversal/file disclosure advisories through `GHSA-fxqj-rqcc-2cmp` and related advisories. The full audit reports 5 total (3 moderate, 2 high), including `wrangler@4.152.0`, `miniflare@5.20261019.2-beta`, and `undici@7.29.1`; npm reports multiple high Undici advisories. The audit does not prove an attacker-controlled stylesheet reaches the build or that a vulnerable dev-tool path is exposed in production.

**Exact reproduction:** `npm audit --omit=dev --json` exits 1 with the production counts above; `npm audit --json` exits 1 with the full counts. `npm ls next postcss wrangler undici miniflare --all` exits 0 and confirms the installed versions. Sanitized raw output is in `raw/npm-audit-production.json`, `raw/npm-audit-all.json`, and `raw/npm-ls.log`.

**Suggested fix:** Update to patched compatible releases where available; review Next's major-version remediation before adopting it, and update Wrangler/Miniflare/Undici as a tested group. Re-run both audit modes and the complete tests/build after dependency changes.

**Confidence:** confirmed advisories and locked versions; exploitability in the static-export/deployment pipeline is plausible, not demonstrated.

### FB-AUD-05 | medium | `apps/api/src/services/rate-limit.ts:26-31,47-64,71-78`

**What is wrong:** Invitation creation has a 10-per-minute counter keyed only by client IP. There is no independent inviter or project bucket. A logged-in inviter distributing requests across source IPs gets independent buckets, so the documented abuse case—one account/project issuing many invitations—is not bounded by identity or project.

**Exact reproduction:** `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/invite-rate-limit-key.mjs` shows the invitation route selects only the `invite` bucket and two source IPs map to two separate counter keys (exit 0). UAT auth-rate-limit probing separately returned ten `302` responses then `429` on request 11. No signed-in UAT invitations were created.

**Suggested fix:** Keep IP limits, and add counters keyed by authenticated inviter and project (with an account-wide ceiling), with safe handling for shared/NAT IPs and a documented recovery path.

**Confidence:** confirmed implementation gap; distributed-source abuse impact is plausible.

### FB-AUD-06 | medium | `docs/SECURITY_ROADMAP.md:20,29-31`

**What is wrong:** The security roadmap records the database boundary as “one broad database role” with no PostgreSQL row-level security and leaves S3 least-privilege roles open. That means the database is not an independent containment boundary if an application defect or injection is found. The actual UAT runtime role was not queried, so this is a repository-recorded, not live-verified, finding.

**Exact reproduction:** The repository's current security-state table identifies the broad role and S3 as open. To verify UAT, Deployment must run `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;` using the actual Worker runtime connection, and verify it cannot create/alter/drop application tables. That query was not run because this audit has no authorized UAT database credentials.

**Suggested fix:** Separate migration and runtime roles, grant runtime only required DML/sequence access, and add an integration test that runs migrations with the migration role but runs the API suite with the restricted runtime role. Decide and document whether RLS is an additional wall.

**Confidence:** plausible for the deployed role; confirmed as an open risk in the checked-in roadmap.

## Low

### FB-AUD-07 | low | `database/migrations/0014_project_brief_links.sql:9-18`

**What is wrong:** `project_links.workspace_id` and `project_id` each have a foreign key, but there is no composite relationship requiring the project to belong to that workspace. The database accepts a link row that names Workspace A and a project in Workspace B. This is a referential-integrity gap; the ordinary API path appears to derive both identifiers from the project, and no direct tenant exposure was demonstrated.

**Exact reproduction:** `raw/project-links-fk-repro.txt` records a transaction that creates two workspaces, a project in the second workspace, inserts a link pairing the first workspace with that project, selects the mismatched pair, and rolls back. The SQL command exits 0.

**Suggested fix:** Add a unique `(workspace_id, id)` key on projects if needed, then make `project_links(workspace_id, project_id)` reference that composite key. Add a migration test proving the mismatched insert is rejected.

**Confidence:** confirmed.

### FB-AUD-08 | low | `apps/api/src/http/app.ts:121-122`; `apps/api/src/http/middleware/limits.ts:5`

**What is wrong:** The Worker uses the app's default 1 MiB request-body cap for every endpoint. The product docs specify XLSX uploads up to 5 MiB and images up to 10 MiB. As configured, a valid image or workbook larger than 1 MiB is rejected before its route can apply its own type/size validation. This is an effective-cap mismatch, not a security bypass.

**Exact reproduction:** `node --experimental-strip-types docs/reviews/CODEX-AUDIT-20261030/probes/import-body-cap.mjs` sends a synthetic 1,048,577-byte body to the import route and receives `413 PAYLOAD_TOO_LARGE` (exit 0), before authentication or parser logic. Route/default configuration is not overridden in `apps/api/src/runtime/worker.ts:30-32`.

**Suggested fix:** Decide whether the intended product cap is 1 MiB or the documented 5/10 MiB. If keeping the documented caps, configure a bounded route-aware limit for imports/images and keep smaller defaults elsewhere; add tests at exact boundary and in the Worker runtime.

**Confidence:** confirmed.
