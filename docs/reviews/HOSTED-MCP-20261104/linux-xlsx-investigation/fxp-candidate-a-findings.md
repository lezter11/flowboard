# Diagnostic A: named-entity predicate without regex matching

**Result:** the unchanged full Worker + PostgreSQL fixture fails its maximum-description assertion on baseline77 under controlled0.75CPU pressure. Diagnostic A passes the same fixture in **5/5 fresh processes**, with every original assertion retained. Main application source, lockfile and installed dependencies remain unchanged. This is an ESM-only private-package prototype, **not** a packaging decision, product repair, independent acceptance or native GitHub x64 result.

## Actions and exact target

Diagnostic A combines the previously measured two native application scans with a private copy of fast-xml-parser5.11.2. Its sole package change is inside `validateAmpersand` in `src/validator.js`: replace the named-reference character's `xmlData[i].match(/\w/)` with an ASCII `charCodeAt` predicate. The maintained validator, its named-reference20character rule, numeric-reference function, XML grammar checks and ordered parser remain present. All application upload/expanded/row/cell/XML/time limits remain unchanged, including the1000ms parser budget.

The package copy retains the upstream MIT license. Exactly one copied file differs; CJS `lib/fxp.cjs` is unchanged and receives **no** performance claim. Full package hashes and exact one-hunk change are in `fxp-candidate-a-manifest.json` and `fxp-candidate-a.patch`; license is `fxp-MIT-LICENSE.txt`.

- Upstream ESM validator SHA256: `e818788b069429443a97756a4c458999d6751461c4ef41c7bfe1cc58bd70dde4`.
- Patched ESM validator SHA256: `bab5db1b0627f8d402d343fb9f9e711d0582f8426bf6925295252866ceffa4d8`.
- Native-scan application clone SHA256: `185d0f47bd7bac63e97529e376d4eba687d31826c9d35cd9ea4439d25690b96d`; original import-xml SHA256 remains `dd9b5c7f1abbc1a4e366dbe7cc17d5a8a32de6a5aeb6e7beae2c439154e11fdc`.

`fxp-control.mjs` mounts the original Linux dependency volumes read-only for both targets. Only candidate containers receive the private package as a read-only overlay. `fxp-baseline-entrypoint-proof.log` verifies the untouched Linux validator hash; `fxp-candidate-a-entrypoint-proof.log` verifies the patched hash, actual Node ESM resolution to `src/fxp.js` and identical exported/direct `validate` function identity. Bundling the actual `runtime/worker.ts` entry records ESM `src/validator.js` as input, excludes CJS `lib/fxp.cjs`, and verifies the expected predicate in the generated named-reference helper. The original full test is separately bundled/executed by Wrangler and actual workerd.

## Why and equivalence

The unchanged maximum workbook contains four million `&amp;` references. The upstream named-entity loop calls `.match(/\w/)` for each reference character, producing substantial regex and possible match-allocation cost. Diagnostic A replaces only that boolean test. The exact upstream regex is non-Unicode and case-sensitive, so its word set is precisely ASCII letters, digits and underscore. `xmlData[i]` and `charCodeAt(i)` inspect the same UTF-16 code unit. Every surrogate or non-ASCII letter remains false. The loop bounds, semicolon handling, count mutation and `count < 20` condition do not change; numeric references take the same earlier branch and byte-identical function.

Before timing, `fxp-candidate-a-equivalence.mjs` compared every65,536 UTF-16 code-unit boolean and286 actual validator results/error objects. It includes malformed references, punctuation, whitespace, non-ASCII/surrogate text, text/attribute contexts,20versus21character names and numeric cases. All pass; the numeric helper is byte-identical. This finite evidence supports the source-level argument; it is not proof of every XML input.

After timing, the existing combined parser suites run against the actual application clone plus private package overlay: **122/122 pass**, zero skipped, exit0 (`fxp-candidate-a-parser-regressions.log`).

## Actual Linux results

Same archived revision77a9fbb, Node24.15.0, workerd1.20261102.1, PostgreSQL17.11, Linux ARM64,0.75CPU quota and1GiB whole-container memory limit. Each full sample uses a fresh Node/workerd process and unique database schema. The exact200×20,000ampersand workbook,51,109compressed bytes and all descriptions remain unchanged.

| Full original fixture | Exit | Maximum HTTP preview time |
|---|---:|---:|
| Unchanged baseline |1|422 `PARSE_BUDGET_EXCEEDED`, same line162 assertion |
| Candidate A1 |0|1038.89ms |
| Candidate A2 |0|985.55ms |
| Candidate A3 |0|1140.54ms |
| Candidate A4 |0|958.77ms |
| Candidate A5 |0|972.39ms |

Every passing sample retains exact blank-template bytes, genuine200row preview and atomic commit, three hostile XML rejections, subsequent isolate usability, literal entity-like text, all200maximum-length descriptions, and remaining normal API controls. No assertions, validation or limits were relaxed. HTTP time includes database staging and response work and must **not** be compared directly to the1000ms parser-only budget.

A separate matched parser-only pair at the same quota preserves actual budget checks:

- Baseline cold parse fails at1160ms; instrumented baseline fails at1168ms. Validator445ms, scalar/declaration146ms, structural50ms, ordered parse195ms, conversion260ms.
- Candidate A cold maximum-only parse passes at959ms. Warm instrumented parse passes at620ms: validator67ms, scalar/declaration16ms, structural<5ms, ordered parse203ms, conversion218ms.

The reduced validator cost confirms the measured mechanism. The cold maximum-only sample has only41ms margin under this severe quota; five finite full-fixture passes do not establish universal CPU/load headroom. The earlier two-scan-only prototype's2/5pass and3/5failure result remains preserved and must not be relabelled as fixed.

Complete logs: `linux-fxp-a-series.log`, `linux-fxp-{baseline,candidate-a}-quota-075-*.log`, and `fxp-{baseline,candidate-a}-stage-quota-075.log`. `fxp-candidate-a-results.json` includes exact log hashes, all sample outcomes, whole-fixture cgroup quota/CPU/throttling/peak-memory records, parser stages and actual workerd-child CPU ticks. Cgroup counters cover the whole fixture, not just parsing; neither those values nor child RSS establish deployed Worker CPU/heap limits. The isolated parser-stage harness's public metadata lookup was blocked (`EAI_AGAIN`) under `--network none`.

## Next / your input

The performance mechanism is supported and Diagnostic A survives the requested five full-fixture samples. Architect must separately decide how an upstream-compatible optimization could be maintained and verified across actual build/package entrypoints; this investigation authorizes no vendoring, postinstall mechanism or dependency change. Independent security/supply-chain assessment, product implementation, fresh full validation/review and eventual exact-candidate Linux CI remain separate steps. All own test processes are idle. Disposable PostgreSQL and Linux volumes remain available for reuse. No GitHub Actions, push, cloud mutation or deployment was performed. No user action needed for this diagnostic handoff.
