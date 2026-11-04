# Read-only Linux XLSX timing investigation

**Status: diagnosis and diagnostic patch proposal; no product source edits, acceptance approval, push, hosted rerun or deployment.** Published target `77a9fbbef35d5a0e3be72fc7c390b46972718f89` remains unchanged. Investigation owner: `/root/hosted_mcp_transport_design`.

## Actions

The exact CI failure is reproduced through the original complete `apps/api/test/import-worker-template.test.ts` in actual Linux workerd plus isolated PostgreSQL, under a deliberately constrained0.75CPU quota: HTTP422 `PARSE_BUDGET_EXCEEDED` at line162. This establishes resource sensitivity of the existing one-second parser clock. It does **not** identify GitHub's native x64 CPU/load conditions or reproduce its hardware.

The two safe native-scan candidates improve measured time, but their0.75CPU five-run result is **2 passes /3 failures**. They are not a reliable repair at that pressure level. All failed attempts and samples remain preserved.

The original fixture is unchanged:200rows ×20,000 ampersands, inline strings,51,109compressed bytes; worksheet XML20,073,937bytes; fixture SHA256 `81c0f2c107b307dc1ffc1ac1ea3a802bb4e50e155797fa4a63f7c13258956b2b`. All compressed/expanded/XML/row/cell/time limits, maintained XML validator/parser, original assertion strength and transaction behavior remain intact.

## Evidence and timing

Runtime: Node24.15.0, Linux ARM64 on Docker Desktop; official image `node:24.15.0-bookworm-slim` manifest digest `sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`. Installed workerd1.20261102.1, Wrangler4.156.2, fast-xml-parser5.11.2; package-lock unchanged. Linux dependency setup completed `npm ci --ignore-scripts`328packages exit0 and unchanged MCP TypeScript build exit0. Archive source mounts are read-only, with separate Linux dependency/dist volumes. A separate private archive clone changes only `import-xml.ts`'s two scan implementations;614 selected functional files compared, exactly one changed. Original and candidate hashes plus exact patch are in `mounted-candidate-delta.json`, `mounted-candidate.patch` and `archive-comparison.json`.

Full original Worker test, fresh Node/workerd process and unique PostgreSQL schema per sample:

| CPU quota | Original77 result / max HTTP preview ms | Two-scan diagnostic result / max HTTP preview ms |
|---|---|---|
|2CPU, paired sample1|pass /851.11|pass /776.33|
|2CPU, paired sample2|pass /808.96|pass /771.89|
|1.25CPU|pass /1160.70|pass /860.30|
|0.75CPU, sample1|**fail /422 at line162**|pass /1318.40|
|0.75CPU, candidate samples2–5|not repeated|**fail, fail, pass1402.98, fail**|

HTTP preview time includes database staging and response work; it is **not** parser-only CPU or the1000ms budget. Entire-test CI5401.56ms likewise is not the failed parse duration. Every passing full sample retains exact blank-template bytes, genuine200row preview+atomic commit, all three hostile rejections followed by usable-isolate checks, literal text, all200complete maximum descriptions, and subsequent API controls.

`linux-mounted-*.log` contains complete original test outputs/exits.0.75CPU logs additionally retain `cpu.max=75000 100000`, before/after `cpu.stat` and `memory.peak`. The baseline was throttled45of49periods; candidate samples were similarly heavily throttled. These counters cover the **whole Node test plus workerd processes**, excluding PostgreSQL's separate cgroup, and cannot be relabelled as max-parse CPU. Peak memory is likewise whole-fixture/container memory, not deployed Worker heap.

### Pure parser measurements

- macOS Node production648–703ms; macOS actual workerd640–680ms.
- Linux Node2CPU production848–853ms; Linux workerd2CPU production775–880ms.
- Linux workerd2CPU cold maximum800ms; original parser-input sequence(blank→200ordinary→threehostiles→literal→max)946ms. The full database-backed test is separately measured above; the parser-only sequence does not pretend to commit cards.
- Typical Linux workerd worksheet stage timings: scalar/declaration77–87ms, structural scan22–25ms, maintained validator323–354ms, ordered parse133–146ms, entity/tree conversion116–124ms. Combined native-scan diagnostic625–640ms; corresponding stages about14ms scalar and<5ms structural. Validator/ordered parser remain unchanged and dominate the remaining cost.
- `linux-node.cpuprofile` and its corrected ID-map summary cover four complete Node parser calls plus fixture generation/module loading. Sampled time includes `validateAmpersand`, its `/\w/` regular expression and garbage collection. This is a **Node** CPU profile, not a workerd child profile. Separate Linux workerd `/proc` tick snapshots/cgroup records are in `linux-workerd-candidates.log` and `linux-workerd-child-cpu-summary.json`; they distinguish actual workerd child CPU from Node harness CPU.

The oldd1c81f4 change removes application decoder callbacks only. Source still invokes one explicit FXP validator then one ordered parser. The validator's `validateAmpersand` matches each reference character; four million `&amp;` references produce roughly16million `.match(/\w/)` calls. The ordered parser separately concatenates text character by character. The application scalar and markup loops add two more complete20MB JavaScript scans. This measured repeated work plus GC/throttling explains the demonstrated resource sensitivity. Exact GitHub preemption/GC distribution remains unknown.

## Why and options

A Flowboard description containing20,000 ampersands occupies100,000 XML characters. Two hundred such descriptions force several passes over20MB despite a51KB upload. The relevant distinction is expanded work, not upload size.

The bounded proposal changes only the application's two preflight scans:

1. Replace `for...of`/`codePointAt` scalar validation with a native Unicode-mode negated character class for exactly the same XML1.0 union:9,10,13;20–D7FF;E000–FFFD;10000–10FFFF. Unicode mode treats valid surrogate pairs as a single code point, just as `for...of`; lone surrogates remain outside the allowed class. U+FFFE/U+FFFF remain rejected. Fatal byte decoding and declaration checks still precede it.
2. Use native `indexOf('<')` to locate every literal markup delimiter. Between consecutive delimiters, index distance minus one is exactly the old segment's UTF-16 code-unit count, including text in comments/CDATA/attributes. Check the leading/intermediate gap **before** incrementing the shared markup counter; an oversized gap therefore leaves the counter exactly as the original early throw did. Increment/check on every literal`<`, and check the trailing gap. Boundaries remain strict`>` at655,360segment units and50,000markup delimiters. All ordering relative to scalar, XXE, validator, parser and budget checks remains unchanged.

Correctness evidence: all1,114,112code points,5,000random UTF-16 strings and4,052structural/budget-edge comparisons agree; unchanged existing parser suites run against diagnostic clones122/122pass, zero skip. These are supporting finite checks, not a replacement for the reasoning above or independent review. The independent reviewer separately completed 138 direct actual-helper edge comparisons, all passing, with unchanged source hashes: `../independent-backend-review/ci-diagnosis/scanner-equivalence-result.json`. These cover fatal UTF8/UTF16LE/BE, surrogate/scalar boundaries, literal delimiters, shared budget mutation, segment units and deterministic checkpoint/error precedence. This focused equivalence result is not whole-feature acceptance.

This narrow optimization preserves the maintained validator and parser. Raising the1000ms budget, reducing the legal workbook, skipping validation or changing atomicity would alter acceptance and is excluded. Further validator/parser acceleration would require a separately reviewed design; these measurements do not authorize it. The two-scan proposal alone has not demonstrated robust headroom under the0.75CPU pressure condition.

## Reproduction and resource ownership

Current resources belong only to this investigation:

- `flowboard-xlsx-pg-20261104`: PostgreSQL17.11 image pinned to existing digest; disposable `flowboard_import_test`, user`flowboard_harness`.
- `flowboard-xlsx-internal-20261104`: internal Docker network, no external route. Node test containers share this container's namespace and use127.0.0.1:5432. Docker29 suppresses published ports for this internal network; **no host-loopback port was published or invented**.
- `flowboard-xlsx-mounted-deps-20261104` plus per-workspace and MCP-dist volumes; initial parser-only `flowboard-xlsx-linux-deps-20261104` contains pinned native esbuild/workerd binaries.
- Synthetic password/URLs are held only in a unique private temporary0600JSON file; `private-config-location.txt` stores its path, no credential. Git archive excludes ignored workspace secrets and`.git`. No credentials or HOME were mounted into Linux containers.

Reuse the already-prepared resources without another package install:

```sh
node docs/reviews/HOSTED-MCP-20261104/linux-xlsx-investigation/mounted-control.mjs baseline
node docs/reviews/HOSTED-MCP-20261104/linux-xlsx-investigation/mounted-control.mjs candidate
XLSX_DIAGNOSTIC_CPU_QUOTA=0.75 node docs/reviews/HOSTED-MCP-20261104/linux-xlsx-investigation/run-mounted-pair.mjs new-label
```

Every test container uses`--rm`; PostgreSQL and dependency volumes remain idle for Architect/reviewer reuse. Initial failed setup attempts remain recorded: absent Docker daemon; slim image missing CA bundle; internal network not publishing a port; nested npm workspace directories and MCP-bin chmod requiring their own writable volumes. They are not feature-test failures and are not relabelled passing. A streamed archive replaced an initial too-small diagnostic capture buffer; product source was never altered.

## Next / your input

Architect should decide whether the equivalence-preserving scan improvement is sufficient for a bounded product repair or whether more parser work is required. The current0.75CPU candidate failures remain open counterevidence. Product source, fresh review target and one eventual exact-candidate Linux CI remain separate future steps. No user action needed for this investigation.
