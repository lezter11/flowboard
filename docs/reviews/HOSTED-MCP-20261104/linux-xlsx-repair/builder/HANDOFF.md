# Builder handoff: Linux XLSX repair

**Actions.** Implemented the selected bounded repair and installation/build verification. No dependency version changed. Main source and the actual Linux product stage are held; independent whole-application review is pending. No push, hosted Actions run or deployment was performed.

The native scalar/markup scans preserve XML1.0 scalar ranges, UTF-16 segment units, shared markup mutation/error order and all original limits. Two tiny licensed ESM dependency backports replace named-reference regex matching with the same ASCII predicate and copy plain text through the next literal delimiter. The maintained validator/parser and1000ms budget remain present. `apps/api/scripts/dependency-patches.mjs` binds exact5.11.2 metadata, lock integrity/tarball, ESM entry, license, tracked patch hashes and original→patched file hashes; explicit apply is idempotent, rejects unknown states before writing, and can complete recognized interrupted states. Verification is read-only. Worker-map verification requires both exact patched source contents and excludes parser CJS. CJS receives no performance claim.

**Why and options.** A Flowboard description with20,000ampersands occupies100,000XML characters. The unchanged200row workbook expands to20,073,937worksheet bytes despite a51,109byte upload. The measured repair removes repeated character-level work while keeping every value and tag position. Raising the time budget or reducing the fixture was excluded. A backport adds maintenance work; any version/provenance/entrypoint change must stop and trigger reassessment/removal, as documented in the vendor README.

**Evidence and limits.**

- Main apply/verify receipts: `main-apply.json`, `main-verify.json`. Required ESM validator SHA `bab5db1b0627f8d402d343fb9f9e711d0582f8426bf6925295252866ceffa4d8`; ordered parser SHA `72f43cb7527e0575d3ae5024efd64c184bc31f93a2c1cafc7f62b7cc3b77f9f0`.
- Initial helper fixture tests12/12, including idempotent timestamps, partial state, unknown later bytes/no preceding write, version/integrity/entry/license/patch drift, symlink refusal, offline ignore-scripts CLI and Worker-map negatives. Initial red and all repair attempts are preserved. CLI fixture tests caught and corrected macOS path-alias entry detection. Tests use their own temporary packages and never mutate installed files.
- Product focused tests140/140, zero skips: helper tests,4230 actual installed/upstream output+Symbol-metadata+callback comparisons, frozen fixture hashes, native scalar/UTF8/UTF16/segment/shared-budget boundaries and unchanged parser security suites. Baseline copies are reconstructed with verified original hashes in temporary directories; no behavior/resolver hooks.
- Root typecheck exit0, including the final canonicalization target (`typecheck-canonicalization-final.log`). API TypeScript+Wrangler dry-run build+map verification exit0 (`api-build-worker-map-verified.log`). Original unsupported sourcemap-flag attempt and unrelated SDK null-source scope mismatch remain recorded. Final build uses the original plain dry-run behavior; null source content is permitted only for unrelated modules, while both required parser targets must contain exact verified strings.
- Actual **public-product** Linux focused140/140 plus five fresh original complete workerd+PostgreSQL pressure fixtures5/5, all zero skip/exit0 (`product-linux-focused-series.log` and individual logs). Maximum HTTP previews900.48,963.43,779.52,849.54,803.67ms include staging/response work, not parser-only CPU. All original exact-template/200row/atomic-commit/hostile-rejection/post-rejection/full-text/API assertions remain unchanged. Dependency volumes were copied from untouched upstream volumes, then patched using the actual public helper; there is no private package overlay or resolver hook in these runs.
- Diagnostic baseline failures, two-scans-only2/5 and A tight cold959ms remain evidence in the sibling investigation directory. Diagnostic B cold parser655ms/warm565ms at0.75CPU is attributed as prototype evidence; actual-product tests above are separate. Finite ARM64 Docker samples do not establish GitHub x64 equivalence, arbitrary-load headroom or deployed Worker CPU/heap behavior.
- Supplied template SHA256 `35d2ef558be10f0528f366de7e48338f8395198eaba80dd428d7e5c21d91acd4`; maximum legal fixture SHA256 `81c0f2c107b307dc1ffc1ac1ea3a802bb4e50e155797fa4a63f7c13258956b2b`. Both are frozen in the vendor manifest and checked by product tests.

## Source and stage hold

`held-source.json` records the12builder-owned source/test/vendor files and current digest `aa09049ed8d21a8a2815a06e4fd9cf6b4e59efad332aa1ac9f91bf093290876d`. The actual Linux product stage has624selected functional files, current digest `079a15bae16808c602d82631a8a280262c1c8582133eca8e4de8eedf5d34cf7d`, recorded in `product-linux-source-manifest.json`. Every stage file was compared to live current source at hold. Root-owned hooks/lock/release changes remain Architect-owned and require the complete independent manifest; this bounded manifest is not that approval.

A confirmed pre-freeze checker defect was repaired with Architect authorization: canonicalization now includes sourceRoot-relative file paths, strips query/fragment suffixes and checks percent-decoded package/CJS names. Malformed/nested encodings and unsupported URI/network roots fail closed. Wrangler's known absolute virtual Node builtins remain supported. Target identities still require exact unescaped canonical package paths and patched content hashes. Final affected helper tests **13/13**, actual545-source Worker-map verification and root typecheck exit0 (`patch-helper-canonicalization-green.log`, `worker-map-canonicalization-verified.json`, `typecheck-canonicalization-final.log`).

`canonicalization-continuity.json` proves exactly two files changed after the140+5product samples: the build-time helper and its isolated test. All622other functional files, runtime parser/backport bytes, fixtures and budgets are identical. Those runtime pressure samples retain their original source attribution; they were not falsely relabelled as a rerun of the new helper test. Original stage/manifests remain preserved as `source-product` and `*-pre-canonicalization.json`. The current stage is `source-product-canonical`. The full independent API run will exercise the new13case helper suite as part of the actual current test command.

## Safe reviewer execution and ownership

All builder processes are idle. **No whole API test has been launched by this builder.** Architect assigned the reviewer the single required actual API command in Linux, not a duplicate Mac run.

From repository root:

```sh
node docs/reviews/HOSTED-MCP-20261104/linux-xlsx-repair/builder/product-linux-control.mjs api
```

This executes actual`npm test --workspace @flowboard/api` inside official Node24.15.0 Linux ARM64 (`node:24.15.0-bookworm-slim`, manifest digest `sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`),2CPU, isolated network and own disposable PostgreSQL17.11. The unchanged full API script includes patch verification before MCP build. Application source and dependencies mount read-only; generated MCP/API build outputs have separate volumes. The controller supplies synthetic database URLs in process environment without printing values.

Private configuration location: `/var/folders/jr/scqd6q3j7nggl004yfg9_vsh0000gn/T/flowboard-linux-xlsx-OjWZdf/private-config.json` (0600; **do not print contents**). Its path-only pointer is in `../linux-xlsx-investigation/private-config-location.txt`. Current product source is the sibling `source-product-canonical` directory, not previous product `source-product`, original77 `source`, or prototype `source-candidate`.

Reviewer now owns these disposable resources for the gate:

- PostgreSQL container `flowboard-xlsx-pg-20261104`, internal network `flowboard-xlsx-internal-20261104`. Node shares its namespace,127.0.0.1:5432. No public host port exists. PostgreSQL image is pinned to existing17.11digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
- Dedicated actual API databases `flowboard_harness`, `flowboard_access_test`, `flowboard_identity_extra_test`, `flowboard_import_test`; additional unused UI/MCP databases exist. Builder tests used/dropped unique schemas only; these public schemas have not been reset or used for other work. Reviewer may independently inspect/reset only these owned disposable databases after freezing its target.
- Product dependency volumes `flowboard-xlsx-product-deps-20261104` plus`-api`, `-web`, `-contracts`, `-mcp`, `-mcp-dist`, `-api-build`. Upstream baseline volumes`flowboard-xlsx-mounted-deps-20261104*` and original77archive remain unchanged; do not repurpose or overwrite them.

Do **not** rerun`prepare-product-linux.mjs` or controller`setup` after freeze; they would replace stage/state. Reviewer may redirect controller stdout to its own evidence directory. No credentials, HOME, ignored env files or`.git` are copied/mounted into the public product stage.

**Next / your input.** Independent reviewer rechecks the canonicalization repair, freezes the complete target, executes the one full API gate and remaining required commands, and reviews full current acceptance continuity. Builder does not assign a score or close the task. No user action needed.
