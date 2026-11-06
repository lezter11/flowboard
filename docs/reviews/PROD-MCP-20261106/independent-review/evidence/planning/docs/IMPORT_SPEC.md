# Excel import contract v1

Status: specified, not implemented. Feature IDs IMP-01 through IMP-11. Product/permission authority: [FEATURE_SPEC.md](FEATURE_SPEC.md). Owner or project manager may import. No spreadsheet can create a workspace/project/board/person or change membership.

## Workbook supplied now

[Flowboard Excel template](../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx). Cards is the only data sheet. It starts blank, with 200 formatted rows and a priority dropdown. Instructions contains field help and clearly separate examples. Extra blank rows are ignored; the number of nonempty rows is limited to 200.

| Header | Required | Validation and blank behavior |
|---|---|---|
| External ID | Yes | Text, trimmed 1–64 characters, Unicode normalized, unique within the selected board; preserve leading zeros. Numeric IDs are rejected with format-as-text guidance. |
| Title | Yes | Trimmed plain text, 1–200 characters. |
| Description | No | Plain text ≤20,000 characters; blank becomes empty description. |
| Priority | No | none/low/medium/high/urgent after trim/case normalization; blank becomes none. |
| Due Date | No | Genuine Excel date respecting workbook date system or strict YYYY-MM-DD text; blank becomes null. Validate real Gregorian day. |
| Assignees | No | Semicolon-separated verified account emails resolved to active owner/manager/member eligible for the selected project; blank is unassigned. Reject unknown/ambiguous/ineligible addresses and deduplicate repeated resolved people. |
| Status | No | Exact board column label after trim/case normalization, or an explicit preview mapping to one existing column; blank uses the user's explicitly selected active default column. Never create or guess a column. |

Required headers are External ID and Title; the official template includes all seven. Missing optional headers use their blank defaults, but duplicate/unknown headers are errors requiring correction (no silent ignore). Only Cards and optional Instructions worksheets are allowed in v1. Header row is row 1; no merged table cells. Fully blank rows are ignored anywhere; a nonempty row missing required fields is an error.

Template contains no formulas. Accept only macro-free `.xlsx` actual package type; reject XLS/XLSM/XLSB, formulas in Cards, macros, embedded OLE/images, external workbook links and unexpected executable package parts. Instructions text/examples are never imported. Read literal values; do not evaluate expressions or use cached formula results. Literal strings beginning with formula-like characters remain text; reports must escape them when exported to Excel/CSV.

Excel dates use 1900 or 1904 systems. Honor workbook metadata; reject the fictitious 1900-02-29 serial day and out-of-range/ambiguous date values. A number without date-cell semantics is not automatically a deadline. Normalize to a date-only API value without local-midnight timezone conversion.

## Destination, permissions and privacy

Destination is selected in the app: project, board, default active column. Verify parent ancestry and active owner/manager project permission at upload, preview read, commit, report read and retry replay. A user's own workspace ownership does not grant rights in another owner's workspace. Assignee lookup uses verified private account-email mapping server-side; ordinary people responses do not expose a global email directory.

No comments, mentions, dates of creation/history, images, attachment URLs or member invitations are imported in v1. Add image references after card creation. A URL or at-name string is ordinary text and never triggers a fetch or mention notification. Existing importer data is private to owner/project managers; avoid logging workbook bodies, email lists or descriptions.

## Workflow and state machine

1. Download template; populate Cards; choose target in Flowboard.
2. Upload: validate signature and limits, persist a private short-lived import session, queue bounded validation if parsing cannot safely fit the HTTP runtime.
3. States: uploaded → validating → ready or invalid. Poll status with a bounded cursor for preview rows. Invalid reports row number/field/reason; no cards have been created.
4. Ready preview shows destination, resolved columns/assignees, new/already-imported/conflicting counts and a digest. User may explicitly map a source status label to an existing column and revalidate. Other unsupported headers require fixing the file, not arbitrary field remapping in v1.
5. Commit requires zero invalid/conflict rows, current preview digest and explicit user confirmation. State becomes committing → committed or failed. Recheck project role, project/board active state, structure version, column IDs and assignee eligibility; changed inputs return 409 PREVIEW_STALE and require revalidation.
6. Commit all NEW cards in one bounded PostgreSQL transaction with versions, per-card activity/provenance and batch receipt. Existing unchanged rows skip. Any failing condition rolls back all new rows. Parsing, uploads and external calls never occur while holding the transaction lock.
7. Response/report shows created/skipped/conflicting row counts, card IDs and safe row messages. Lost-response replay returns the same batch outcome; UI fetches authorized current card state.
8. Cancel is allowed before committing. Once transaction execution starts, cancellation cannot promise rollback; show the actual final result. Preview expires 30 minutes after validation. Expiry, cancellation, completion and terminal failure schedule temporary raw-file/preview-content cleanup, normally within an hour; delayed cleanup never extends commit eligibility. Receipt/provenance remains minimal.

Preview may create temporary import-session rows/object bytes; “dry run” means no domain cards/users/grants changed. This distinction must appear in tests and UI wording.

## Duplicate and retry semantics

External ID is user-chosen source identity, not the internal card ID or HTTP idempotency key. Normalize deterministically; compare case-sensitively after Unicode normalization/trim. Unique key: workspace/project/board/external-ID identity. A separate Idempotency-Key identifies the confirmation request and prevents duplicate batch effects.

Retain the original normalized row hash and source-to-card mapping. Same External ID + same ORIGINAL normalized row payload means already imported, even if a teammate later edited the created card. Same External ID + changed row payload is a conflict and never silently edits an existing card. Two simultaneous imports compete through the same unique constraint, with a clear retry/preview outcome and no partial commit.

Trashed/purged source cards remain reserved by minimal duplicate markers. Re-upload must not resurrect content or extend a restore deadline. Display already imported/deleted without leaking unavailable content; a genuinely new task requires a new External ID. Minimize any personal information stored in keys/markers and document retention before production.

## Initial proposed bounds and compatibility gate

200 nonempty rows; seven supported columns; ≤5 MiB upload; ≤20 MiB expanded XML; ≤2 sheets; shared cell/string limits; explicit parser CPU/memory/time limit; ≤20 assignees/card. These are application proposals, not measured safe capacities. Tests include ZIP expansion bombs, malformed XML, fake file type, mixed Unicode, empty rows, repeated keys, long text, semicolons, both date systems, invalid dates, changed grants and a failure at the final inserted row.

The parser/library and Worker-vs-Node validation adapter must pass the actual runtime budget before deployment. Use supported maintained versions and never evaluate workbook expressions. If the atomic commit or parser exceeds bounds, lower the documented cap or use a bounded durable validation job; resumable partial card commits require a separate product decision.

## Acceptance and handoff

Use the actual supplied workbook in import integration tests. Verify blank template creates zero cards, two example rows intentionally copied into Cards create two valid synthetic tasks, leading-zero ID survives, status mapping is explicit, unknown assignee blocks commit, reupload does not duplicate, changed ID payload conflicts, and revoked manager cannot commit an earlier preview. Prove the 24-hour trash behavior cannot be bypassed through import.

Template export/reimport/XML inspection is artifact verification only; it is not a tested importer. Backend evidence must include actual PostgreSQL transaction/retry tests and parser/runtime limits. UI evidence must exercise real preview/confirm/error/report flows with its handed-off backend contract.

Research and official references: [Excel import research](research/features-excel-import.md).


## Frontend priority requirement — 2026-10-27

User-directed UI rule: every new card must explicitly carry Low, Medium, High or Urgent. The local HTML sample preview now marks blank/none/unknown priority as blocking and retains the chosen row priority on local creation. This is frontend-only; the optional Priority table above, current XLSX template and backend parser contract remain historical/current server behavior pending a coordinated revision. The artifact still does not parse uploaded XLSX files, so this is not evidence that real imports enforce the new requirement.
