# Flowboard independent audit — 2026-10-30

**Target:** `chore/baseline-2026-10-28` at `371cc9f31dd605ddead4eda743c2d26e12c07fca`. **Overall:** findings remain; this audit does not approve production readiness.

## Top risks

1. **Images are not durable.** Worker code defaults to a per-isolate in-memory map, but records attachment metadata in PostgreSQL. A fresh isolate cannot retrieve the bytes. Fix durable storage before image uploads are treated as available (critical, confirmed).
2. **A small XLSX can inflate beyond the parser cap before rejection.** A 20,516-byte workbook member expanded to 20 MiB plus one byte and was rejected only after decompression. Move the cap into the decompressor and authorize before parsing (high, confirmed).
3. **Database isolation is still an acknowledged open item.** The checked-in security roadmap says the runtime uses one broad database role with no RLS. We could not query the real UAT role, so Deployment must verify and split runtime/migration permissions (medium, plausible).
4. **Invitation limits do not follow the account or project.** The current limit is keyed by source IP; different IPs create independent counters. UAT did return 429 on the 11th auth-start request, but that does not prove per-inviter protection (medium, confirmed implementation gap).
5. **The lockfile has unresolved security advisories.** npm reports one high and one moderate production-tree advisory, and five total including development tooling. This audit did not demonstrate that an attacker can reach those build-time paths (medium, confirmed advisories, plausible exploitability).

Additional findings: the card API accepts a Viewer as an assignee despite the documented role rule (medium, confirmed); project links can pair a workspace with a project from another workspace at the database layer (low, confirmed), and the effective global 1 MiB body cap is lower than documented upload limits (low, confirmed).

## What blocks production

Do not treat image attachment as production-ready until storage is durable and verified across Worker isolates. Fix the XLSX decompression behavior before accepting user workbooks. Resolve the vulnerable dependency tree and verify actual UAT runtime database permissions before production exposure. Add per-inviter/project invitation controls. The complete route-by-role authorization matrix is generated but its 930 actor/route cells were not executed; S2 is not complete.

## Verification performed

On a disposable PostgreSQL 17.11 container at port 55257, the corrected full test run passed **533 API tests and 54 contract tests, with zero skipped**. Root and web typechecks passed. UAT received 21 unauthenticated GET requests only; 10 sign-in-start requests returned 302 and the 11th returned 429. No production environment, authenticated UAT state, or real credential was used. See `coverage.md`, `needs-owner.md`, `manifest.json`, and `raw/` for limits and evidence.

## Finding counts

- Critical: **1**
- High: **1**
- Medium: **4**
- Low: **2**

This is a security audit, not a backend review-gate score. No score was assigned.
