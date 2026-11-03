# Outer-cell XML repair acceptance, frozen before implementation

2026-11-03. Sensitive untrusted workbook boundary. Scope: parser/XML helper, import parser/mounted/Worker tests and support only. Prior import-xml-repair and formal review records remain unchanged. Builder cannot approve closure. Root owns cleaned-receipt/API-contract/UI and project lifecycle repairs.

1. Reproduce unchanged CRC-valid reviewer XLSX fixtures str-cell-inline-child, foreign-cell-value and mixed-value-inline before source edits; preserve actual silent text loss evidence and failing new assertions.
2. Every Cards cell must have only its supported representation: inlineStr permits at most one same-namespace is child and no v; other supported types permit at most one same-namespace v and no is. Reject any unknown/foreign child, foreign f/v/is, multiple values, mixed inline/value data and non-whitespace direct cell text with controlled422 before any import/domain write. Real spreadsheet formula cells remain formula-rejected. Existing numeric/date/shared-string validation remains.
3. Preserve legal empty/style cells, inline/shared rich text, CDATA, namespace prefixes, UTF8/16, leading-zero identities, description whitespace, official blank/filled workbooks and three original binary fixtures unchanged. Unsupported representations must reject rather than disappear.
4. New parser matrix covers each supported cell type and each disallowed child/mixed-text case, including UTF16. Actual mounted PostgreSQL55931 random owned schemas prove original3fixtures plus extended malformed cells return422 and leave cards/imports/import_rows/markers/activity/receipts at0; positive control still201.
5. Existing40parser checks, mounted import regression suite, actual workerd200row atomiccommit/200maximum-length descriptions/resource rejection tests, typecheck and API build pass on held new source. No cap/requirement reduction, adapter/contract/UI edit, independent self-review score, hosted claim or UAT closure.

Commands/results and held source hashes will be recorded separately. Final fresh reviewer remains root-owned after all round2 defects are collected.
