# Image write admission — builder handoff

Status: bounded implementation evidence; **not independent review, task closure, full image approval or UAT approval**. Criteria were recorded in `criteria/image-admission.json` before implementation. JPEG CPU/provider acceptance is the separate lifecycle agent's work.

## Actions

Added a single process/isolate image-write lease shared across `createApp` instances. Actual session authentication precedes admission and body consumption. Content PUT and finalize POST acquire it before Hono's body buffer. Busy requests receive `503 SERVICE_UNAVAILABLE`, `Retry-After: 1`; they do not queue a retained body. Image staging, status, cancellation, deletion and private delivery are excluded.

Selected write bodies are read under an actual-byte cap and five-second read deadline. A forged small `Content-Length` cannot bypass the cap. Slow/aborted input is cancelled; an uncooperative cancellation retains capacity until it actually settles. Over-cap stays413. The existing full image digest/container/authority checks still run after the bounded read.

`retainImageWork()` returns an idempotent release callback; `assertImageWorkActive()` refuses resumed work after response completion/disconnect. The lifecycle agent wired whole preflight, actual verifier promises and the actual content/finalize handler lifetime to these hooks. The lease remains occupied through real settlement even when the response timeout wins `Promise.race`.

The first real workerd probe exposed an additional defect: the caller received504, but releasing the provider did not recover capacity because the original request context/cleanup had ended. This also reproduced with the real ExecutionContext passed. The middleware now registers its completion with `ctx.waitUntil`; `onImageWorkLifetime` lets the Worker defer pool closure until retained handler work settles. The lifecycle agent wired that production Worker cleanup. The same actual-workerd probe now passes.

Image content/finalize HTTP budget is10s; explicit test `deadlineMs` remains the fallback override unless `imageDeadlineMs` is supplied. Ordinary Node5s and existing Worker25s budgets remain as before. Worker explicitly selects image10s. The JPEG criteria v5 fixes the separate checker3s/whole-verification8s bounds; neither this handoff nor the8 passing admission tests approve the JPEG implementation.

## Why and options

One image may be large enough that several simultaneous buffers and JPEG validation bitsets exceed a small Worker isolate's memory. This gate permits one image write per isolate, returning a retryable refusal to overlap. A semaphore with a queue would retain more request bodies; a durable external upload/decoder service could increase throughput but introduces infrastructure and is outside this bounded repair. This is deliberately a memory/correctness tradeoff, not a throughput improvement claim.

An HTTP timeout only ends waiting for a result; it does not prove the decoder, storage request or database cleanup stopped. Retaining the real work prevents a timed-out image from continuing while another large image is admitted.

## Evidence and limits

Disposable PostgreSQL: `flowboard-full-revalidation-20261103`, `postgres:17.11-alpine`, image `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`, loopback55931, database `flowboard_import_test`, per-test random schemas removed by fixture cleanup. Credentials used are existing synthetic local-only test values. No deployed calls or live credentials.

Final command: `NODE_ENV=test WRANGLER_SEND_METRICS=false FLOWBOARD_IMPORT_TEST_DATABASE_URL=<synthetic-loopback55931-import-URL> node --test --test-concurrency=1 apps/api/test/image-admission.test.ts apps/api/test/image-admission-worker.test.ts`.

- `raw/image-admission-red.log`: exit1, 0/2 before repair. Real concurrent second request entered and waited instead of refusing; the bounded barrier failed. These are behavioral failures, not missing-helper compile assertions.
- `raw/image-admission-green-initial.log`: exit1,4/5 after first admission code; non-cancellable provider retention still failed before the lifecycle hooks landed.
- `raw/image-admission-worker.log`: exit1,0/1, initial workerd probe lacked explicit context. Not sufficient alone to claim production-context behavior.
- `raw/image-admission-worker-context-red.log`: exit1,0/1, real ExecutionContext passed; post-timeout provider release still left retry503.
- `raw/image-admission-worker-context-green-attempt.log`: exit1,0/1 due to an overly short80ms setup/stage test deadline. This was a harness setup failure, retained transparently. Setup/recovery now use normal5000ms, only deliberate held content uses250ms.
- `raw/image-admission-worker-context-green-2.log`: exit0,1/1 actual workerd recovery passes.
- `raw/image-admission-final-3.log`: exit0, **8/8**,0 skipped/cancelled/failed. Seven mounted Node groups plus one actual workerd group. Includes cross-app overlap with zero second-body pulls; stage/status/cancel availability; actual provider pending after504; unchanged staging after late completion; same-upload retry200; invalid-cookie401/no pulls; forged Content-Length413; body timeout/cancel; retained uncooperative cancellation; separate ordinary/image deadlines.
- `raw/image-admission-typecheck-final-3.log`: `npx tsc --noEmit`, exit0. `git diff --check`, exit0.

The probe uses the actual app, auth, routes and PostgreSQL with an intentionally delayed synthetic verifier; it does not claim a real Cloudflare Images cancellation SLA. It follows the production per-request app/pool/ExecutionContext lifecycle. The independent image integrity harness separately exercises the production Worker/provider/R2 entry point. No exact peak RSS, Cloudflare free-plan CPU, hosted concurrency, deployed Google/R2/mail or final whole-product approval is claimed.

If a provider or stream cancellation truly never settles, the isolate stays unavailable for image writes rather than admitting accumulating buffers. Cloudflare may terminate retained work after its platform lifetime; hosted behavior and recovery remain UAT acceptance. Authenticated users still receive project/upload write authorization in preflight after the bounded body read; this slice does not introduce an early per-board authorization query or change existing transactional reauthorization.

## Next

Root freezes the complete source/dependency manifest, reruns whole gates and assigns a fresh independent reviewer. Final hosted image resource/binding behavior remains UAT pending. No user action is needed for this local slice.
