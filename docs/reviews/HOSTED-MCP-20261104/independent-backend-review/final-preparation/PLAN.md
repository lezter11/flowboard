# Final local feature review preparation — not acceptance

## Actions

Read the current feature definitions, all98 backend/UI/integration handoffs, their original eight review/criteria groups, the previous per-ID source inventories and owner-phase binding script. Preserved a read-only moving-target inventory in `original-98-staleness.json`, its concise counts in `staleness-summary.json`, and tracked/new source paths in `delta-paths.json`. No role-owned handoff or checklist was changed.

All98 original backend approvals are stale on the current candidate because their manifests include changed shared app/auth/card/activity/Worker/migration/contracts/tooling files. This is an evidence-binding result, not a finding that98 implementations are broken.

| Prior review group | Existing IDs |
|---|---:|
| Foundation |4|
| Account |7|
| Projects/access/invitations |18|
| Boards |8|
| Cards/comments |18|
| Images/trash |15|
| Activity/discovery/UX |17|
| Import |11|

The original groups all require the **same14 exact commands**. Their mandatory statements deduplicate to102:98 feature acceptance statements and four shared authority/transaction/review/phase rules. Every original feature statement still exactly matches `docs/features.tsv`; no requirement mismatch was found. There are74 UI-required features and98 integration records.

At the first preparation snapshot, the old per-ID UI source/test hashes had not changed, but this does not establish global frontend continuity: the new connector pages and pending shared sign-in/session/navigation/Pages changes are outside those old lists. Recompute the per-ID and shared-delta map after final hold. Do not copy the old claim that the entire frontend/browser harness is unchanged.

## Why and options

Recommended: one honest current-candidate review with featureIds containing the original98 plus HOSTED-MCP, the union of all original acceptance statements, the24 hosted backend statements and all15 HUI statements. `final-criteria.preparation.json` currently contains those141 mandatory statements. The original14 commands can run once on one held candidate and their actual evidence can be mapped to every applicable group/ID; eight duplicated full runs add no independent coverage. A reviewer can instead issue eight fresh group judgments if that is necessary to explain different risks. Either way, old scores are historical; derive new judgments and deductions from current source/evidence rather than cloning ratings or simply replacing digests.

For each original ID, record its exact acceptance, dependency chain, relevant unchanged source/test hashes, changed shared paths, applicable newly executed test/browser evidence and any retained older extra-probe evidence with its real executor/date. Source continuity plus fresh shared-path regression/browser proof can support unchanged implementation; it cannot substitute for missing acceptance or turn a historical probe into a new execution. Any uncovered mandatory ID remains open even when a global suite passes.

The previous `owner-phase-revalidation/revalidate.py` is hardcoded to d1c81f4, an older CI run and a whole-frontend-no-diff assertion. It must not be run as-is or copied with only a new SHA. A new owner-phase process must assert the new candidate/CI/logs/feature map before writing anything, preserve starting records, and keep local versus hosted acceptance explicit.

## Final source and evidence scope

Freeze source only after UI and API safe-next/Google work and independent UI findings are resolved. Review actual changed shared paths against d1c81f4, plus every newly reachable module. Include complete source/test directories rather than a fixed old file list that misses new files:

- API app, middleware, hosted OAuth/transport/private identity, safe-next/Google callbacks, card/receipt/activity authority, Node/Worker entry points, pool lifetime and scheduled retention.
- All affected contracts/OpenAPI definitions and generated document, migration0027 and embedded parity, MCP client/factory/CLI and package/build configuration.
- Consent/Connections/sign-in/name/session/navigation/request/error handling, Pages middleware and exact well-known/API/static routes, static export configuration/assets and corresponding unit/integration/browser tests.
- Root/workspace package lock/configuration, CI workflow, relevant test/runtime/build scripts, fixed final criteria, reviewer identity, logs/browser reports/screenshots, source-before/after manifests and artifact/provenance metadata.
- Check PRD/architecture/design/API/engineering-checklist claims for consistency. Keep mutable progress/task checkboxes and generated checklist/handoffs outside the acceptance manifest; reference stable contract files or preserved documentation snapshots so later bookkeeping does not create a self-hashing cycle.

Do not include role-owned handoff JSON inside the source-review manifest: their backendReviewSHA256 must reference the resulting record, which would otherwise create a circular digest. Scope exclusion here is explicit bookkeeping separation, not omission of delivery source.

## Required execution after hold

Run the14 original exact commands preserved in the preparation criteria, plus the stable `npm run test:hosted-mcp-browser`, independent compiled Pages runtime probe and production Worker artifact probe. The prepared criteria now contain17 commands and the original141 statements. No prepared/disabled exit0 is a pass. Require a real result report, all required HUI case coverage, no unexpected console/page/network/diagnostic leakage, correct source bindings and completed cleanup. Inspect final case-by-case coverage rather than equating a script exit with all15 HUI statements.

`run-final-gate.mjs prepare` has created a dedicated loopback-only PostgreSQL17.11 container with six databases and no host volumes; no acceptance checks ran. The private0600 file remains outside review evidence and is deleted at cleanup. The current run's `harness.json` records the image identity and dynamic port. Source and criteria remain unfrozen until Architect's explicit hold.

After that hold, write `final-criteria.json` with status `frozen` and no pending required commands, then use `run-final-gate.mjs freeze`. This hashes complete product directories, canonical claim documents, CI, final criteria and the independent harnesses. It also verifies the actual successful advisory evidence matches the frozen lockfile. Run `build-web` first in explicit production mode without database/test/provider/public overrides, retaining an artifact manifest for `apps/web/out`. Notify the independent UI reviewer to copy that exact static export, then execute `run` for the other15 local commands while the reviewer runs the16th compiled Pages command separately. `collect-pages <actual-result-path>` may close the17-command execution inventory only after its actual checks/cleanup pass and the full before/after source inventory is unchanged. A test or generated tracked-file mutation stops the run; no automatic source restoration conceals it.

The production Worker probe loads the original built bundle with Wrangler `no_bundle:true`, hashes it, and uses actual workerd plus its own real PostgreSQL schema. Wire checks require dev-login404 with no cookie or identity and six anonymous DCR attempts yielding201/201/201/201/201/429 with the real stored counter. A runtime `NODE_ENV:test` binding deliberately attempts to undo production mode. The compiled origin helper is tested separately through a byte-prefix-identical copy with only an appended export; original/shim hashes and the exact delta are recorded, and that shim is never a deployment artifact. This separately labelled check must refuse the explicit loopback test override. The probe is prepared and syntax-checked, not executed or accepted. Its supported override can bind the later clean release bundle to a known digest and rerun the same negative assertions before upload.

The stable hosted browser harness currently clears rate counters once before each sequential case, through its own guarded loopback `/flowboard_ui_test` random schema pool. The reset occurs outside every case task and does not weaken a rate-limit attack within a case. It supports independent UI scenarios only; real limiter acceptance remains in backend tests and the required production-bundle probe.

The new hosted UI runner must prove actual built static Pages behavior, exact well-known metadata with no sign-in redirect, canonical service-binding forwarding, Google-safe-next with explicitly synthetic provider exchange, approve/deny/expiry/session switch/latest paged CSRF, role restrictions, truthful persistence, own disconnect and protocol refusal afterward. Native Node and workerd/backend behavior and legacy PAT/stdio remain required alongside browser evidence.

Complete current Linux CI on the exact candidate/source and inspect all required step outcomes and non-skipped command counts. Bind any evidence-only later commit through an explicit zero-delivery-source-diff proof; never label a different workflow SHA as if it were tested. Current dependency advisory evidence is applicable only if its recorded lockfile hash matches; otherwise rerun it. Advisory success is not a proof of no dependency flaws.

Use a separate disposable PostgreSQL server for the complete API suite because migration tests reset their own public schema. The earlier review containers63931/65469 are removed. A fresh dynamic loopback-only server with guarded databases, no host volumes, recorded image/port and cleanup avoids shared55931 mutation. Include flowboard_ui_test and flowboard_mcp_probe in addition to the four API guard databases for the complete14-command run. Coordinate fixed browser ports and schemas with the UI reviewer; no duplicate or colliding full runs.

## Binding and closure order

1. Freeze current source/criteria, execute and inspect the final tests/CI/browser evidence, resolve findings and independently judge every mandatory criterion.
2. Generate a new source/evidence manifest and independent record with the unchanged six rubric weights/floors and score strictly above8.5, no blockers and no mandatory gaps. It may cover all98 plus HOSTED-MCP only when each ID is genuinely accounted for.
3. Role owners write fresh per-ID applicability evidence and backend handoffs referencing that passing record. UI owner binds the exact review-file SHA256 and fresh evidence hashes; integration owner additionally binds each current UI-handoff file hash. Preserve old records and historical probe provenance.
4. Validate every original feature/dependency and new connector acceptance. Only then regenerate the checklist and require98 backend,74 UI and98 local integration completions, plus explicit connector completion. A green record alone does not silently update those phase bindings.
5. Only after the accepted local release gate may the separately authorized UAT deployment proceed. Real Google/Claude/deployed Cloudflare/Neon/Hyperdrive/R2/schedule acceptance remains UAT-pending until actually observed. This follows the preserved original release-sequence clarification and does not claim production approval.

## Evidence and limits

This directory is preparation while UI is moving. No new whole-feature score, passing review, source hold, test run or all98 closure is asserted here. The earlier HMCP-05 API record remains a historical passing API baseline for the moment UI began; affected safe-next/Google/source changes require the planned fresh review. Existing approval artifacts are not edited.

## Next / your input

Architect supplies the stable enabled hosted-browser command and final source hold, plus the new UI review evidence. Then finalize the criteria before the final run and perform the review above. No user action is needed for preparation.
