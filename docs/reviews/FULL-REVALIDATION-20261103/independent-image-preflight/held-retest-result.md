# Independent held-source image repair retest

Verdict: the four reproduced local defects are no longer observed in the bounded rechecks below. This is not a complete backend review, score, feature closure or hosted acceptance.

Reviewer independent_image_security did not implement the source. Read-only target:52selected application/runtime/contracts/migration/test files in `held-retest-before.json`; `held-retest-after.json` reports zero changes across the run. Image adapter SHA256:03644c0bbd6ab66e6fcdcb6978db3a0bbe76089783b629fa349e85f35660bf0e. The full formal target and required whole-suite checks remain with root.

## Actions and evidence

| Previously reproduced defect | Independent held-source result | Evidence |
|---|---|---|
| Finalize commit failure deleted retry source and orphaned a new object | Forced real PostgreSQL COMMIT failure500 now retains one original staging object and content_received row; retry200. Finalize promotes that same known key, without a storage copy/delete. | `held-finalize-commit.log` |
| Expiry cleanup broke finalized state and receipt replay | Finalized state survives expiry cleanup; exact original key with an active receipt returns200. | `held-finalize-expiry-replay.log` |
| Same-statement cleanup reference snapshot deleted just-finalized bytes | Exact unchanged generic ID-projection race probe now produces finalize200/cleanup1/live image1, with live object present and storage count1. | `cleanup-snapshot-race-v2.mjs`, `held-cleanup-snapshot-race.log` |
| Worker saved malformed PNG zlib/pixel-length cases | Actual local workerd: genuine original PUT200/finalize200/private GET200 exact source hash. Extra pixels, truncated pixels, trailing compressed junk, second concatenated stream and bad Adler all422. | `held-png-stream-workerd.log` |

Each observational probe exits0; `assert-held-retests.mjs` checks the expected outcome fields and exits0 (`held-assertions.log`). Independent command `NODE_ENV=test FLOWBOARD_IMPORT_TEST_DATABASE_URL=<authorized loopback synthetic database> node --test --test-concurrency=1 apps/api/test/image-storage-atomicity.test.ts` exits0,8pass/0fail/0skip (`held-atomicity-suite.log`). Its real separate-connection cases also cover cancellation COMMIT rollback, durable failed object deletion, legacy separate staging keys and migration0026 healing terminal state exactly once. Every schema was random and disposable; no hosted/user data was used.

The same snapshot race probe SHA256690b7f64fad68a8ba785c348aa142bf39a6a682a54931c88b4d0ad89d20da80f is preserved across old red (`cleanup-snapshot-race-v2-red.log`) and new green. Its volatile identity function changes only statement scheduling around the actual upload ID projection. It does not fabricate an EXISTS result or change the selection predicate.

## Why and options

Keeping one private object and changing only its database reference makes failed finalization recoverable: a Flowboard photo either gains its committed image row or remains the same known retry input. Cleanup first locks uploads, then reads live image keys in a fresh statement. That prevents an old query snapshot from deciding a newly saved photo is an orphan. Cancellation records retryable deletion intent with its state change, then deletes storage only after commit.

PNG streaming validation adds exact native-inflate and row/pass/filter checks without collecting the full canvas; full external/native decoding remains required. Palette-index opaque-black recovery is an explicitly allowed native behavior in the current bounded acceptance policy, not a promise of universal original-file PNG semantic conformance. See `png-palette-probe.log` and the policy adjudication in `followup-status.md`.

## Evidence limits and next

All old red evidence and initial findings are retained. The target changed between diagnosis and repair, so no old approval is reused. This selected52-file manifest is not the complete reachable-source formal manifest. JPEG parser1120mutation diagnostic and PNG12test independent rerun are separate bounded evidence, not universal codec proofs. No online dependency-advisory audit, full current API/contracts/web/MCP suite, browser acceptance, hosted CPU/memory/provider/private-bucket verification or production approval is claimed.

Root reports an enabled UAT `staging/`24h object-expiry rule. Promoted keys retaining that prefix require removing the rule and verifying the live lifecycle policy at UAT deployment before traffic; preserve multipart-abort policy. That concrete cloud change is pending, not fixed by these local tests. No cloud mutation was performed by this reviewer.

Root can proceed to the comprehensive local gate and full immutable manifest, followed by formal independent review. No user action needed for this bounded retest.
