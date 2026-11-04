# Bounded ESM performance backport

The application pins fast-xml-parser5.11.2. Two small ESM hot-path changes preserve its parser/validator behavior while reducing the measured cost of the unchanged200-row maximum-description import:

- `validator.patch.json`: replace non-Unicode, case-sensitive `/\w/` matching in named references with the same ASCII letters/digits/underscore predicate. Numeric references and the20character boundary stay unchanged.
- `ordered-text.patch.json`: accumulate plain text through the next literal`<` with a string slice. The outer branch has no other per-character effects. `i=end-1` lets the loop increment process the next tag at its original normalized UTF-16 index. Callbacks, entities, CDATA/PI/comments, stop-node readers and metadata code remain untouched.

`manifest.json` binds the exact npm version/tarball/integrity, package metadata, ESM entry, MIT license, original and patched file SHA256, and the tracked patch JSON hashes. It also freezes the supplied workbook and unchanged200×20,000escaped-ampersand fixture. The full upstream MIT license is retained in `MIT-LICENSE.txt`; the original package LICENSE is verified. Provenance is the exact lockfile tarball, whose upstream repository is https://github.com/NaturalIntelligence/fast-xml-parser.

Run `node apps/api/scripts/dependency-patches.mjs --apply` explicitly after an ignore-scripts/offline install. Normal root postinstall invokes the same operation. Application testing/build/typechecking uses `--verify`; Worker builds also use `--verify-worker <worker.js.map>`. Unknown version, provenance, source or patch bytes fail before mutation. Known interrupted states can be completed, and already-patched files are not rewritten. Nothing patches code during a request, fetches network data or runs external commands.

Scope is **ESM only**. Node must resolve `src/fxp.js`; Worker source maps must contain both exact patched sources and no parser CJS module. `lib/fxp.cjs` remains upstream and is outside this acceleration claim. This is a maintained local backport, not a claim that npm supplied these modified bytes.

On any dependency/version/lock-integrity/ESM-entry change, stop and reassess both hunks against upstream source, the4230 output/metadata/callback comparisons, malformed/entity/Unicode/resource tests and actual Worker boundary fixture. Do not simply update hashes to bypass a failure. Remove the backport after an independently reviewed upstream version supplies equivalent behavior/performance and the same regression/runtime gates pass. Controlled ARM64 CPU-pressure results are local evidence, not GitHub x64 or deployed capacity proof.
