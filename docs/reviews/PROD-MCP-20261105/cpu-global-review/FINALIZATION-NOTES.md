# Finalization notes

The first manifest-generation attempt failed before producing a formal review JSON because the reviewer helper passed an absolute evidence directory to the repository's canonical relative-path validator. It raised `ReviewError: noncanonical path: /Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard/docs/reviews/PROD-MCP-20261105/cpu-global-review/evidence`. This was a review-harness path bug, not a product/test failure. Both helper scripts were corrected to derive repository-relative paths. The subsequent formal record and two validator checks passed. No failed review round or failed product test was overwritten.

An early message proposed tentative scores before the sanitized build receipt was available. The reviewer immediately withdrew that premature proposal, retained `incomplete`/unscored status, and did not generate an approval until the actual11:59Z sanitized build receipt was read and independently checked against actual bundle bytes and wire-guard results. Final judgment follows the complete inspected evidence.

The frozen record's completed time is12:05Z. Its start uses the first preserved planning-snapshot timestamp, rather than inventing an exact delegation time. The validator receipt and this note are intentionally outside the frozen scope; no frozen evidence was changed after formal generation.
