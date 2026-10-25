# Historical D1 prototype verification

Date: 2026-10-26 (Asia/Kolkata).

Command: `python3 scripts/check_schema.py` from the project root. Result: 11 tests passed against an in-memory Python SQLite database using database/prototypes/d1/migrations/0001_initial.sql using only synthetic records. No network or live database writes. Includes actor-global receipt uniqueness before workspace membership exists.

Covered: cross-workspace/project/board references; assignee membership and uniqueness; comment mention scope and offset ordering; title/priority/version/date-shape constraints; populated-column foreign-key protection; activity board scope; notification deduplication; idempotency receipt uniqueness; at-most-one active owner; valid CAS then stale CAS; full rollback after later constraint failure; revoked membership in the write guard; foreign-key consistency.

Not verified: deployed D1 `batch()`/`changes()` behavior, simultaneous Worker requests, application authorization, actual calendar date validation, mention Unicode boundaries, session/OAuth/CSRF, exactly-one owner throughout transfer, API idempotent replay semantics, outbox dispatcher/retries, UI behavior, accessibility, GitHub/Cloudflare account access or deployment. Those require the implementation and integration phase. The starter schema cannot enforce active membership or authorization on every table by itself.

All archived cards still reference columns. Empty-column deletion therefore means no cards, including archived cards. A future column migration command must move archived cards too. No destructive cascades or cleanup jobs have been implemented.

## Architecture/document checks, 2026-10-26

The v0.2 selected PostgreSQL stack has no runtime tests or migration yet. Original SQLite checks remain isolated historical prototype evidence. Verified six required root document files, exactly 50 unique ordered checklist IDs, 25+25 research-item coverage, three reference checksums, and all local Markdown file-link targets. No remote source-link reachability or Markdown renderer conformance is claimed by that local check.

GitHub metadata read succeeded for the supplied public repo; connector push permission is false. Terminal gh auth status reported invalid credentials. Cloudflare account/tools, GitHub push and deployments remain unverified.

## Feature specification and template v0.3

See [feature-baseline evidence](evidence/feature-baseline-v0.3.md) for the 98-item catalogue/dependency/link/reference checks and actual XLSX export/reimport/XML/visual checks. These do not verify application or import behavior. Backend has been authorized to start FND-01 local selected-runtime testing; its separate handoff/evidence record determines completion. Do not carry the old no-implementation checkpoint forward as a claim that the active task has made no changes.
