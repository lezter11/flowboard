# Conditional dependency optimization assessment — read-only, no approval

Product source and installed dependencies remain unchanged. This assessment concerns only private candidate A and possible packaging if its measured performance and correctness justify a bounded repair. The scanner-only prototype remains semantically promising but its2/5 success at0.75CPU was not robust performance closure.

## Source/security boundary

Installed fast-xml-parser5.11.2 uses XMLValidator's named-reference loop at src/validator.js463–480. The sole candidate hunk replaces String.match(/\w/) truthiness with a predicate over charCodeAt(i):48–57,65–90,95,97–122. The old regex has neither Unicode nor ignore-case flags, and indexed string access supplies one UTF16 code unit; those ASCII ranges are exactly its word-character set. Loop bounds ensure the indexed unit exists. The count<20 expression, semicolon handling, return index, invalid-reference branch and byte-identical numeric-reference function remain unchanged. This preserves20/21-character boundary behavior and line/column accounting rather than masking entities or bypassing XMLValidator.

The manifest records upstream validator SHAe818788b069429443a97756a4c458999d6751461c4ef41c7bfe1cc58bd70dde4 and candidate bab5db1b0627f8d402d343fb9f9e711d0582f8426bf6925295252866ceffa4d8. Exactly one dependency file differs in the private copy, with the full package MIT license retained. This reviewer found no concrete semantic/security counterexample in that hunk. Transport's exhaustive65536-code-unit and286 actual validator/error-object comparisons are supporting evidence, not approval of an unmeasured performance claim. No additional CPU tests are run by this reviewer alongside timed experiments.

## Conditional option comparison

| Choice | Useful property | Cost/risk | Required before acceptance |
|---|---|---|---|
| Deterministic pinned local patch | Smallest source delta; retains the existing validator/parser grammar and existing application adapter | Every install/build must apply and verify it; upstream releases need re-review; ESM/CJS distributions can silently diverge | Exact package version/lock integrity/upstream file hash, exact one-hunk patch and expected output hash; hard failure on drift; Node and actual Worker entrypoint/bundle proof; unchanged-cap differential/mounted tests and actual headroom |
| Maintained SAX-style parser with an adapter | May reduce repeated scans/intermediate trees and enforce limits while consuming events | Replaces a much larger behavior surface; namespaces, duplicate attributes, entity/CDATA ordering, scalar/encoding handling, parser errors and resource counters need new equivalence evidence | Primary-source maintenance/runtime/license review, broad grammar/security corpus, full literal text fidelity, exact resource/time guards and actual Node/workerd/database acceptance before replacing the current path |

If candidate A is measurably robust, the minimal pinned patch is the narrower repair to evaluate first. This is a conditional scope recommendation; no dependency mutation, product fix, library selection or numerical score is approved. If it does not provide adequate measured headroom, do not accumulate patches or change budgets to force acceptance; evaluate the larger parser option with its actual adapter criteria and evidence.

## Fail-closed patch requirements

- Preserve the original npm lock version/tarball integrity and record the local modification separately: upstream source hash, exact reviewed diff, patched hash, license/copyright and removal/update rationale. An advisory report for the upstream version does not independently audit the local modification.
- Apply only to the expected package/version/file and only from the exact upstream hash. Accept an already-patched hash idempotently if explicitly designed; every other state fails. Do not use fuzzy matching, ignored patch failures, download a replacement script at install time or silently fall back to unpatched execution.
- Verification must run before every supported test/build/release path, including clean/offline installs with --ignore-scripts. A postinstall hook alone is insufficient. Keep application runtime free of filesystem/hash checks that would break Worker portability; enforce the invariant during preparation/build and test the resulting actual artifact.
- Package exports route ESM import to src/fxp.js and require to lib/fxp.cjs. Candidate A intentionally changes only ESM src/validator.js. Current actual Worker bundle selects that ESM validator; Node and esbuild resolution/hash proof must remain explicit. Do not claim CJS performance changed. If a supported path resolves the unpatched CJS distribution, either fail the build or govern/test that path separately; never rely on a broad patched-package label.
- Bind patch/apply/verify scripts, package/export metadata, native dependency source/output hashes, license and actual bundle evidence into the next review target. Clean Linux CI and clean release builds must demonstrate the same applied patch before upload. Owner/evidence bindings must follow the new accepted target rather than reusing the old local score.

## SAX adapter equivalence surface

A SAX implementation would need to preserve the current conservative raw '<' markup limit (including literals inside comments/CDATA/invalid attributes), UTF16 segment accounting, node/depth/text caps and one-second total parse budget. Event counts alone cannot substitute for those existing source limits. It must preserve fatal UTF8/16 decoding/declarations, namespace resolution/rebinding and duplicate expanded attributes, exactly-once decoding of literal entity-like text, CDATA/text concatenation order, formula/macro/relationship/package rejection and source-row/date behavior. The existing package/access/receipt/database transaction is retained. A maintained library name is not evidence that this adapter is equivalent or faster.

## Evidence status

Private one-hunk source/manifest/license and read-only entrypoint proofs are available under linux-xlsx-investigation. Transport owns the active baseline/candidate0.75CPU mounted original-fixture samples. Absolute ARM64-container timings are not native CIx64 capacity evidence. No hosted job, product/dependency change, relaxed fixture/limit, formal new review cycle or deployment approval is performed here.
