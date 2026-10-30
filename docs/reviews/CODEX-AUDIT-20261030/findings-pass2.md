# Findings — independent pass 2

**Target:** `chore/baseline-2026-10-28` at `36dfb3a4172ca5cc910c6c6503b4efd641031e35`.

This pass rechecked all eight findings from the first review. Six are fixed in this commit; two remain open. One new medium finding was confirmed. Findings below are current at the frozen target. A source fix or local test does not establish hosted R2, UAT role grants, or production behavior.

## Current findings

### FB-AUD-04 | medium | `package-lock.json` (locked dependency tree); `apps/web/package.json`

**What is wrong:** The target lockfile still has two production dependency advisories: Next.js (moderate) and PostCSS (high). The full tree has five total: three moderate and two high, additionally including Miniflare, Undici, and Wrangler. `npm audit --omit=dev --json` exited 1 (1 moderate, 1 high); `npm audit --json` exited 1 (3 moderate, 2 high). The audit establishes vulnerable locked ranges, not a reachable exploit in the static-export pipeline.

**Exact reproduction:** From the frozen target snapshot, run `npm audit --omit=dev --json` and `npm audit --json`. Sanitized npm JSON is in `raw/npm-audit-prod-pass2.json` and `raw/npm-audit-all-pass2.json`.

**Suggested fix:** Update the affected dependencies to patched compatible versions and re-run the target’s complete tests, static build, and both audit modes.

**Confidence:** confirmed advisories and locked versions; exploitability in this deployment is not demonstrated.

### FB-AUD-06 | medium | `docs/SECURITY_ROADMAP.md:20,29-31`

**What is wrong:** The checked-in security state still describes the database as using one broad application role with no RLS. The roadmap leaves separate least-privilege runtime/migration roles open. A database boundary would limit damage from an application authorization defect or injection, but its current UAT role was not inspected in this audit.

**Exact reproduction:** Read the security-state row and S3 milestone in the target roadmap. The recommended live check—query the actual Worker database role’s attributes and prove it cannot alter schema—was not run because this audit had no authorized UAT database credentials.

**Suggested fix:** Use separate migration and runtime roles; grant runtime only required data operations; record the RLS decision; verify the deployed Worker connection with the restricted role.

**Confidence:** confirmed as an open repository risk; deployed UAT role remains unverified.

### FB-AUD-09 | medium | `apps/api/src/adapters/invitation-delivery.ts:65-70`

**What is wrong:** Successful invitation delivery removes the raw token but retains the invitee email and template source fields (`projectName`, `inviterName`, role, and expiry) in the delivered outbox payload. The literal rendered HTML/text body is not stored, but these fields preserve the recipient and enough message content to reconstruct it. Delivered outbox rows are not scrubbed to a minimal receipt.

**Exact reproduction:** `probes/outbox-privacy-pass2.mjs` inserts a synthetic pending invitation row, calls the actual delivery adapter with a fake successful mailer, and reads the row after commit (exit 0). It reports `tokenRetained:false`, `recipientRetained:true`, `bodyMarkerRetained:true`. The same probe captures console output and confirms the token, recipient, and body marker are absent from logs.

**Suggested fix:** On successful send, replace the payload with only a minimal delivery receipt, such as the provider message ID and non-sensitive event identifiers. Keep recipient/template values only while delivery retries require them; add a retention rule for settled rows.

**Confidence:** confirmed against the target adapter and disposable PostgreSQL.

## First-pass findings rechecked

| Finding | Result at `36dfb3a` | Evidence |
|---|---|---|
| FB-AUD-01 — Worker-local image storage | **Fixed in source; hosted R2 not verified.** R2 binding is injected per request/scheduled run; no-binding path fails closed. | `probes/storage-isolate-repro.mjs`; target test `b7-image-storage-r2.test.ts` (6/6 passed in full suite, including separate Worker fetches over a shared fake bucket). |
| FB-AUD-02 — XLSX inflate and authorization before parse | **Fixed.** Decompression has an output cap and unauthorized/unknown-board imports stop before parsing. | `probes/xlsx-inflate-repro.mjs` rejected a 20 MiB + 1 byte expansion with a 40-byte external-memory delta; target `b7-xlsx-budget.test.ts` 13/13 passed. |
| FB-AUD-03 — Viewer assignment | **Fixed.** Mounted PATCH rejected Viewer assignment with 422 and left card/activity unchanged. | `probes/viewer-assignee-repro.mjs`; target `b7-assignee-roles.test.ts` 4/4 passed. |
| FB-AUD-04 — dependency advisories | **Not fixed.** Counts and commands are above. | npm audit raw JSON. |
| FB-AUD-05 — invitation limits by IP only | **Fixed.** Counters now include inviter and project minute/hour scopes; tests rotate client IPs and verify shared project ceilings. | Target `b7-invite-scope-limits.test.ts` 8/8 passed. |
| FB-AUD-06 — broad database role | **Still open in the roadmap; live UAT role not verified.** | `docs/SECURITY_ROADMAP.md` target lines above. |
| FB-AUD-07 — project link workspace/project mismatch | **Fixed.** Migration 0015 adds the composite relationship; mismatched insert is refused. | Target `b7-migration-0015.test.ts` 3/3 passed. |
| FB-AUD-08 — upload body-cap mismatch | **Fixed.** Signed-in XLSX and image routes use route-aware 5 MiB and 10 MiB caps; other and anonymous requests keep 1 MiB. | Target `b7-body-caps.test.ts` 11/11 passed, including boundary and one-byte-over cases. |

## What did not reproduce

- The fake R2 test showed different driver instances can read the same object store. It does not establish the configuration, privacy policy, or durability of the deployed Cloudflare bucket.
- Simultaneous acceptance of the same invitation token returned one 200 and one `INVALID_INVITATION`; the invitation ended accepted with one active membership.
- A forced race held image finalization inside storage while the card-delete route started. Both requests returned 200, the card ended trashed, and the image row/object remained for the card’s 24-hour restore lifecycle. This tested card trash, not a separate simultaneous explicit image-removal request.
- Two concurrent commits against one ready import both returned committed status, but only one card was created.
- The invitation email probe found no synthetic token, recipient, or message marker in captured logs. The outbox persistence issue above remains confirmed.
- The 930-cell matrix found no cross-project data in the tested fixture. Its empty-body write calls frequently stopped at 400/422 validation, so those cells do not prove every write authorization branch.
