# Boards lifecycle builder handoff

**Actions** — Soft retirement, bounded placement/pages, scoped archived discovery, archive/reopen OCC and page metadata are implemented under the frozen v2 criterion. Source hashes and exact command results are in `boards-lifecycle-handoff.json`. No feature is gate-approved by this handoff.

**Why and options** — A column named Done can be removed after its cards leave the 24-hour restore window. Its old identity remains attached to historical cards/imports; adding Done again creates a new identity. Physical deletion would break these facts. New active cards cannot target retired columns. Board locking serializes normal mutations; raw SQL must obey board-before-column order or gets 55P03, and stale repeatable-read retirement fails 40001.

Move first/last/before/after now reads at most the needed neighbors rather than every card. Choice pages remain bounded and opaque cursors carry current actor/access/version/filter scope. Archived discovery is explicit `includeArchived=true` for current Owner/Manager sessions and current grants only; PAT administration remains denied. Archive/reopen `expectedVersion` means **snapshotVersion**. Exact retries retain the original version/body/key and replay after authority checks; a fresh stale command fails 409.

**Evidence and limits** — 45/45 focused repair tests, including actual local workerd; 83/83 nearby existing mounted PostgreSQL tests; 0 skipped; typecheck exit 0. Initial failing probes and unsafe initial migration trigger bytes are preserved. The SQL reference scan/classification documents active versus historical use. Filesystem0024 is stable; root owns final embedded synchronization/parity. A single 527.55ms local workerd 200-row import observation is diagnostic, not hosted performance evidence.

**Next** — Root freezes the complete multi-owner target and runs the full local gate, fresh independent review, then UAT-only deployment and hosted checks. ATT02 integrity repair follows in this builder stream. QRY03/COM03/NTF03/AUD validation and UI requirements remain owned by their current streams; no self-score, commit or deployment.
