# Excel card import: proposed v1

Status: research and recommendation, not an accepted API or implementation. Scope: a downloadable workbook users can adapt, upload, review, and confirm to create cards in one already-selected project and board. The workbook is data; the user selects the destination in Flowboard. Do not let workbook content pick a workspace or grant access.

## Recommendation

Ship a create-only import first. Require an `External ID` column that identifies each row within the chosen board. Persist it with the created card under a unique `(board_id, external_id)` constraint. Re-importing the same workbook then reports existing rows as skipped/already imported rather than creating duplicates. Reusing an ID with changed values should be a conflict, not an implicit update. Editing imported cards remains an ordinary card edit.

Importing is a bulk version of “create card”: a spreadsheet row becomes a normal Flowboard card with the same validation, permissions, and history. It must not be a privileged shortcut around those rules. A small v1 batch should be validated as a whole and committed atomically after explicit confirmation. This avoids a board with only half of a planned import. If measurements later show batch duration or size makes a single transaction unsafe, add resumable chunks with a visible per-row receipt; do not silently switch semantics.

## Workbook contract

One sheet named `Cards`, with one header row and one card per non-empty row. Header spelling is exact; reject duplicate, missing-required, or unknown headers with an actionable message. Ignore fully blank trailing rows. The template should include a short `Instructions` sheet and example rows that are clearly marked as examples and excluded by default (or removed before upload).

| Column | Required | Meaning and accepted values |
|---|---:|---|
| `External ID` | yes | Stable user-chosen row key, stored as text; unique in this board. Example `OPS-001`. |
| `Title` | yes | Trimmed plain text, 1–200 characters. |
| `Description` | no | Plain text, at most the current API limit of 20,000 characters. |
| `Priority` | no | `none`, `low`, `medium`, `high`, `urgent`; blank means `none`. |
| `Due Date` | no | Real Excel date cell or strict ISO text `YYYY-MM-DD`; blank means no due date. |
| `Assignees` | no | One or more account emails separated by semicolons; each must resolve to an active member with access to the selected project. Blank means unassigned. |
| `Status` | no | Target board column label, matched after trim and case-insensitive comparison; blank means the board's first `todo` category column. |

Example rows (IDs are shown quoted to emphasize text values; Excel stores them as text, not numbers):

| External ID | Title | Description | Priority | Due Date | Assignees | Status |
|---|---|---|---|---|---|---|
| `OPS-001` | Replace loading spinner | Keep reduced-motion behavior. | high | `2026-11-05` | `sam@example.com;lee@example.com` | In progress |
| `OPS-002` | Review empty state copy |  | medium |  |  | Not started |

Do not import comments, mentions, images, arbitrary URLs, attachment links, or membership invitations in v1. Comments need author identity and mention validation; images need a separate upload and storage lifecycle. A spreadsheet URL is untrusted text and must never trigger server-side fetching (which could reach internal services or private network addresses). Attach images after cards exist unless that becomes an explicitly approved scope.

Labels are not in the current card/API contract. Leave them out unless the product contract adds labels before implementation; do not quietly store them inside descriptions or invent a catch-all field. Delete/restore is likewise a separate card lifecycle, not an import action.

## Import flow

1. User downloads the template, edits it in Excel, then chooses a project and board in Flowboard before uploading `.xlsx`. A later CSV path may accept UTF-8 CSV with a documented header/quoting contract.
2. Server checks the actor's access and role for the selected project and board, enforces file and workbook limits, parses without evaluating formulas, and snapshots the authorized destination columns and eligible project members. Workspace membership alone must not grant access to a restricted project.
3. Dry-run validates every row and shows total rows, valid new cards, duplicate IDs already imported, and row/column errors. Preview includes title, status, priority, due date, assignees, and a description excerpt. No writes occur at this stage. Do not silently drop unknown columns, statuses, emails, or malformed rows.
4. User corrects the workbook and reruns validation, or explicitly confirms a preview. Confirmation is bound to the actor, selected board, file digest, validated row set, and short expiry. Recheck membership, role, board, columns, and member eligibility at commit; if these changed, require a new preview. Confirmation is a distinct user action from upload.
5. Commit all valid new rows in one bounded transaction using the normal card invariants and an idempotency receipt. If the atomic batch fails, create no cards and return a safe failure report. A retry with the same intent must not duplicate cards. Cancel before commit discards the preview; cancellation after commit starts is not promised.
6. Show a downloadable, privacy-safe result report with row number, outcome,
   and concise validation reason. Avoid putting descriptions, email lists, or full uploaded content into logs. Clear temporary upload/preview data on completion, expiry, cancellation, and failure; retain only the import receipt and provenance needed to explain what was created.

This preview is useful because it lets a user catch “In progress” misspelled as “In-Progress” before 200 cards appear. Its tradeoff is extra parsing and a short-lived preview record; for a small team, that cost is modest compared with repairing accidental cards. A direct one-click import is simpler but offers no chance to review identity or status mapping.

## Validation and safety

- Reject macro-enabled and legacy formats (`.xlsm`, `.xlsb`, `.xls`, `.xltm`, etc.); accept only the expected `.xlsx` package and verify its actual package type, not just the filename. Limit compressed and expanded size, worksheet count, row count, column count, cell length, and parse time. Starting proposals: 5 MiB upload, 1,000 data rows, 7 columns, one `Cards` sheet, and 20,000 characters per description. These are initial product caps, not measured performance limits; tune after representative tests.
- Reject cells containing formulas, external workbook links, macros, embedded objects, or unexpected workbook parts. Read only literal cell values. In particular, do not use cached formula results: they can be stale and formula evaluation can reference other cells or workbooks. Preserve ordinary literal text exactly after documented trimming/normalization; `=not a formula` entered as a literal string should remain text. For a CSV path, parse as text, never execute formulas, and do not echo untrusted strings into spreadsheet output without CSV-injection-safe escaping.
- Preserve Unicode (names, emoji, non-Latin text) end to end. CSV, if enabled, is UTF-8; support quoted commas, quotes, and line breaks according to standard CSV parsing. Do not split a row on commas manually.
- External ID must be a non-empty text value. Avoid Excel numeric coercion that drops leading zeros or rounds long identifiers. Validate uniqueness within the upload before preview, then enforce it again in the database to cover two simultaneous imports. Show duplicate row numbers. Existing ID with same row intent is already imported; same ID with changed row content is a conflict.
- Dates are date-only values, not timestamps. Excel stores dates as serial numbers and supports both 1900 and 1904 date systems, which differ by 1,462 days. Use workbook date-system metadata for genuine date cells and convert to a validated Gregorian `YYYY-MM-DD`; reject ambiguous date text such as `11/05/26`. Do not infer dates from display strings or browser timezone.
- Priority and status must match enumerated values after documented normalization. Status maps only to a column on the selected board. Never create columns or map unknown status to a guessed default. All assignee emails must resolve unambiguously to active members eligible for the selected project; report unresolved/duplicate emails. Never invite users or grant project roles from an import.
- Text fields are plain text and rendered with normal UI escaping. No HTML interpretation. Do not create mentions from `@name` text.
- API authorization remains project scoped on every preview and commit, with workspace membership also checked as required by the existing contract. Revalidate project access and editor role on confirmation; fail if access was revoked or the selected board/project relationship changed. Revalidate cross-resource IDs server-side.

## Proposed endpoint shape

Keep this a feature-level proposal until Architect updates the shared API contract. Possible sequence:

- `POST /projects/{projectId}/boards/{boardId}/card-imports/preview` with the upload; returns `importId`, expiry, row counts, mapped preview, and errors.
- `POST /card-imports/{importId}/commit` with `Idempotency-Key` and the preview digest/version; returns created card IDs and row outcomes.
- `DELETE /card-imports/{importId}` discards a pending preview.

The user-selected project/board in the route is authority-checked; a file may not override it. A small synchronous request is the simplest initial shape. Introduce a worker/job only if bounded real-world workbook tests show that validation or commit cannot finish inside the normal request deadline. This keeps deployment simple while leaving room for a durable job later.

## Template readiness criteria

The downloadable workbook is ready for handoff when it:

1. Has the exact seven headers above on `Cards`, plus concise `Instructions`.
2. Marks `External ID` as text and provides readable examples for priority, status, multiple assignees, and a date-only due date.
3. Explains blank defaults, active-member email requirement, selected-board status labels, stable unique IDs, and create-only/re-import behavior.
4. Contains no macros, external links, formulas, embedded objects, or personal data; example rows are unmistakably non-production samples.
5. Opens in current Excel and LibreOffice without repair prompts, and preserves text/date values after save/reopen. This is a proposed check, not yet run.

## Evidence and limits

Azure Boards officially requires `Work Item Type` and `Title` for new CSV work items, excludes IDs for new items, limits a batch to 1,000, and presents an unsaved review step before saving. It also warns that fields and identity validation vary by project configuration. Jira's CSV importer maps header columns to fields, requires a `Summary` column, supports quoted multiline fields, and presents field/value mapping. These mature flows support a preview and explicit mapping step; Flowboard's External ID is an intentional product-specific idempotency key, not a claim that either product uses this exact rule.

Excel's date serials are workbook-system dependent. In Flowboard's API, `dueDate` is a date-only Gregorian string; spreadsheet conversion must end at that same boundary. Microsoft documents `.xlsx` as macro-free by format and `.xlsm` as macro-enabled. Formulas and external workbook links can reference external content, while OWASP documents CSV formula injection. Therefore the importer should parse inert literal values and reject executable workbook features; no spreadsheet expression is needed to create a card.

No import code, API endpoint, limits benchmark, or user acceptance has been completed by this research note. Batch caps, route names, receipt persistence, preview retention, and the exact parser/library are proposals for Architect and Backend to review against the chosen stack. The current PRD/API describe workspace-wide access and do not yet define project-level access or a project-member directory; the newer project-only access scope must be added to shared contracts before implementation. This note scopes import authorization and assignee resolution to the selected project without inventing the missing role matrix.

## Primary references

- [Azure Boards: Export, update, and import bulk work items with CSV files](https://learn.microsoft.com/en-us/azure/devops/boards/queries/import-work-items-from-csv?view=azure-devops)
- [Azure Boards: Add or modify work items in bulk using Excel](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/office/bulk-add-modify-work-items-excel?tabs=agile-process&view=azure-devops)
- [Jira Cloud: Import data from a CSV file](https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/)
- [Jira Cloud: Create issues using the CSV importer](https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/)
- [Microsoft Support: Date systems in Excel](https://support.microsoft.com/en-us/excel/date-systems-in-excel)
- [Microsoft Learn: Excel file extensions and macro support](https://learn.microsoft.com/en-us/office/compatibility/xml-file-name-extension-reference-for-office)
- [Microsoft Learn: Spreadsheet formulas in Open XML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas)
- [OWASP: CSV Injection](https://community.owasp.org/attacks/CSV_Injection)
- [OWASP: File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Flowboard API contract](../API.md) and [Flowboard PRD](../../PRD.md)
