> Historical container-only phase. Current full-verifier source/results and mandatory maximum blocker are recorded in `image-full-verifier-handoff.md/json`; this earlier green result is not current ATT02 approval.

# Image integrity builder handoff

**Actions** — Added bounded PNG/JPEG/WebP container-envelope checks and typed422 for malformed old staged-object finalization. Genuine fixtures replace header-only legacy fixtures. No runtime dependency, shared contract, route authority, deployment or commit changed. Exact source hashes/commands are in `image-integrity-handoff.json`.

**Why and options** — A Flowboard gallery must not save a PNG that contains only a dimension header. The new checks require actual image-data sections, bounded lengths and a complete supported container; old staging bytes are checked again before attachment effects. Parsing input offsets avoids allocating an expanded20MP pixel buffer in the Worker. Full pixel decoding/re-encoding is a stronger alternative and needs an agreed portable bounded design.

**Evidence and limits** — Final installed Node24.15.0 / Wrangler4.156.2 / Miniflare5.20261102.0-beta / Undici7.30.1:8/8 focused tests,37/37 nearest existing tests,0 skipped, typecheck exit0. Actual local workerd/R2 + real PostgreSQL tested15 malformed containers and8 genuine variants, including animated WebP. Every1345 truncated prefixes of the small genuine fixture set fail with typed validation errors. Ten static fixtures were independently pixel-decoded offline. Prior failures and the legacy MyTasks400→422 fixture correction remain recorded.

**Critical residual** — `raw/image-entropy-boundary.json` shows a67-byte valid-CRC PNG with invalid DEFLATE accepted by the container validator and rejected by libvips. This repair does not prove compressed pixel-stream decodability. See `image-integrity-scope.md`; if full decodability is mandatory, ATT-02 remains open. Hosted storage durability, browser rendering, maximum-payload/load and final frozen target remain unverified here.

**Next / your input** — Parent runs the complete local gate and fresh independent review, explicitly resolves the fidelity boundary, then UAT-only acceptance. Primary/access databases are released. No user action needed from this builder handoff.
