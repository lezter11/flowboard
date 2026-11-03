# Independent image preflight — diagnostics, no approval

Reviewer: independent_image_security; did not implement source. Scope: mounted image routes, validator/JPEG entropy, full Node/Worker drivers, verification tickets, admission and resource lifetimes, storage effects, trash/purge reachability. Source/tests read-only; only this new evidence directory is authored. All PostgreSQL probes used disposable random schemas in the authorized local `flowboard_import_test` database on55931, synthetic identities and image bytes, and local workerd/R2. No hosted calls, deployment, score or feature closure.

`selected-before.json` records the initial21-file selected inventory. `selected-checkpoint.json` records drift in JPEG/adapter/Node runtime during diagnostic work. This selected scope is not a complete frozen review manifest. Parser differential separately hashes its three target files before/after and confirms stability. Full formal review remains pending a complete held manifest and required checks.

## P1 — failed finalization commit loses retry source and leaves an untracked object

Location: `apps/api/src/adapters/images.ts:553-558` (initial selected source, image adapter SHA256 ec52c41ba4d78c06df84a9e00b37f7ee15b9e91baaf7eb19e1845f5dacc73c7c; checkpoint0f30478ddd0929250c0c64e222d3d3affa6dc6d3eaf696d4fc4f9b249ac0ae8d retained same offending storage effects).

Finalization writes a newly randomized permanent key and deletes the only staging key before committing the image/upload/receipt transaction. An actual PostgreSQL deferred INSERT constraint trigger forces COMMIT failure after these external effects. Mounted stage201/content200/finalize500 leaves card_images0, pending_storage_deletions0, upload content_received, original staging key missing and one permanent object. Retry400 CONTENT_MISSING. Expiring the upload and invoking both normal cleanup jobs leaves that object, because no durable record knows its random key.

Evidence: `finalize-commit-probe-v2.mjs`, `finalize-commit-probe-v2.log` (exit0). First attempt `finalize-commit-probe-authorized.log` hit an accidental cross-operation idempotency key collision and did not exercise commit failure; it is preserved, not evidence for this finding. Sandbox-denied attempt was before schema creation.

Impact: retry failure and permanent private orphan contrary to ATT06/recovery and finalization atomicity. No disclosure or unauthorized caller is demonstrated. Counterevidence: ordinary finalization works; image deletion correctly queues external cleanup only after committed DB effects. Root has independently inspected and is reproducing before implementing a bounded fix.

## P2 — expiry cleanup breaks terminal finalized state and same-key retries

Location: image adapter `cleanupOrphanUploads` predicate selecting `expires_at < NOW()` regardless of finalized state, and its state CASE that changes finalized to expired; `prepareImageVerification` before mounted finalization receipt replay.

Mounted finalize200/repeat200; then advance only that synthetic upload expiry to the past and invoke normal cleanup. Row becomes expired while retaining finalized_image_id and its permanent gallery image. Exact original finalization key still has one active receipt, but endpoint returns400 UPLOAD_EXPIRED before it can replay. This contradicts documented finalization retry idempotency and terminal finalized behavior. No duplicate/permanent-image loss is demonstrated.

Evidence: `finalize-expiry-replay-probe-v2.mjs`, `.log` (exit0). v1 used a new replay key and is preserved as a diagnostic, not same-key proof.

## P1 — local Worker accepts warning-recovered malformed PNG pixels

Location: `apps/api/src/services/image-validator.ts:parsePngDimensions` validates PNG CRC/header/container but does not establish exact inflated image-data stream; `apps/api/src/services/image-verifier-worker.ts:verify` fully drains a provider result but has no warning visibility. The Node Sharp driver rejects decode warnings, while local Images recovers them silently.

From a genuine3×2 PNG, preserve correct chunk checksums and create three invalid IDAT streams: extra decompressed pixel bytes; junk after the zlib stream; a concatenated second zlib stream. Actual mounted workerd with current private local R2 yields PUT200/finalize200/private GET200 with exact original malformed SHA for each. Node strict full native driver returns MALFORMED_IMAGE for each. Genuine original passes; truncated decompressed pixel bytes and bad Adler checksum both422 on Worker, showing this is a recovery-boundary gap, not universal verifier bypass.

Evidence: `png-stream-probe.mjs/.log` (direct native6cases); `png-stream-workerd-probe.mjs/.log` (mounted content); `png-stream-workerd-probe-v2.mjs/.log` (mounted finalize/private exact hash), all exit0. These probes log observations and do not assert that acceptance is correct. This is a mandatory corruption-rejection failure, with no demonstrated code execution/exfiltration. Hosted Images behavior remains unverified. Root Architect must independently check attack and counterevidence before formal confirmation/closure.

## Rejected candidate and bounded parser evidence

An apparent image-delete-versus-card-trash race from the adapter's unlocked card-state read is ruled out for mounted routes: `checkOrReplayProjectWriteReceipt` takes writable project/board locks first, so trash and removal serialize. Do not report this as a confirmed race.

`jpeg-differential.mjs/.log` runs1120 seeded small-corpus entropy-bit and spectral-header mutations. Both accept564; both reject167; ours rejects/oracle accepts389; ours accepts/oracle rejects0. Before/after parser SHA256 c165fd13f3b67b0563f931393d8e3a48b9c9ce335caf22bed179d3c13dac123d; validator b41ef8046a0f8beb055c401d98564bebb3311f81dd8d771b96ca7adb94a70320; native driver80c1f2f8206311dd50fcaf88ef20f1b855c56a770b637547a9d10b48ee06f02d. This sample is no universal JPEG conformance proof. Header mutations deliberately include unsupported/invalid spectral combinations; oracle-only acceptance is not by itself a genuine-codec false positive.

The source proof examined canonical Huffman bounded16-bit decode; all-one code reservation; stuffing/marker exhaustion; bounded component physical-block mapping; progressive approximation sequence/presence flags; first/refinement EOB runs and32-block prefix count boundaries; padding/restart alignment and cyclic order; bounded fuel/memory and cooperative yields. No new JPEG checker defect was reproduced in this preflight. Positive max/corpus/runtime gate logs are builder evidence until independently rerun against a held complete manifest.

## Why and options

A database rollback only undoes database rows. For a Flowboard attachment, deleting the upload bytes before the database commits cannot be undone by ROLLBACK. Root's proposed DB-only promotion of the existing private immutable key can remove that external side effect; lifecycle cleanup must then treat a live card_images reference as authoritative and never queue it for deletion. Hosted bucket prefix expiration rules must not expire promoted `staging/` keys.

A full decoder can recover a visibly viewable picture from malformed bytes. Successful output alone therefore does not prove strict original-stream validity. Keep separate rejection tests for recoverable corruption in every supported format and runtime; do not infer PNG strictness from the JPEG checker.

## Evidence limits and next

No formal score or immutable approval. Source drift invalidates any prospective approval. Dependency advisory status was not checked online. Hosted CPU/memory/provider/private-bucket policy and real UAT identity are pending. Root owns repair; reviewer will inspect held changed scope and run fresh failure/recovery regressions. No end-user action needed for these diagnostic findings.

Additional diagnostic: `png-deflate-stream-options.mjs/.log` measures actual local workerd native `DecompressionStream('deflate')` on the six tiny zlib streams. It rejects trailing compressed junk, concatenated second stream and bad Adler; original inflates26bytes, extra pixel stream30bytes and truncated pixel stream25bytes are valid zlib and succeed. Therefore decompression strictness alone is insufficient: exact PNG scanline/Adam7-pass size must complement it. This is a bounded feasibility probe, not an app fix, full PNG proof or resource benchmark.
