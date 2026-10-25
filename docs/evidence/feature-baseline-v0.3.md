# Feature baseline and Excel artifact verification

Date: 2026-10-26. Scope: research/specification/template only, not application feature verification.

## Observed checks

- Three requested research agents used GPT-6 Luna and produced access/lifecycle, board workflow and Excel import reports. Canonical v0.3 docs reconcile their alternatives.
- User explicitly chose Owner and Project Manager administration. Project-only visibility replaces prior workspace-wide visibility.
- `python3 scripts/render_feature_checklist.py` generates 98 unique feature rows from docs/features.tsv. Dependency graph was checked as acyclic; all referenced dependency IDs exist.
- Six root docs and feature/API/import/handoff documents have valid local file-link targets. Inline/fenced code examples are excluded from link detection. Original three visual reference hashes still match the manifest.
- Excel authored/exported/reimported with the bundled artifact tool. Visual inspection covered blank Cards, field instructions and examples. Blank Cards contains only the exact seven headers; priority list validation and frozen panes are in exported XML. The example due date exports as a typed numeric date. No formulas, macro payloads, external workbook links or embedded objects found in the XLSX package.
- Verification record for the artifact: outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/template-verification.json. No native Excel/LibreOffice launch was performed. No importer or card-creation claim follows from these checks.

## Handoff state

Backend received the v0.3 docs and authorization for FND-01 only: minimal local Node/Worker/PostgreSQL query/rollback harness and coordinated root tooling. It reported Docker available and is working in its separate chat. This document does not pre-mark FND-01 complete. Runtime evidence must be recorded by Backend and reviewed through docs/handoffs.

UI acknowledged the scope and remains read-only pending its feature handoffs. Its review identified project-people, Trash/deadline/destination and upload/import progress shapes; API v0.3 now specifies these at feature-contract level, to become validated shared schemas in FND-02.

All 98 product delivery items were initially unchecked; no schema/template/research output is treated as delivered application functionality. Keep this evidence separate from the historical 11 SQLite prototype tests and the 50 engineering-controls checklist.
