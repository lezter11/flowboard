# Local synthetic browser product diagnostic

Actions: **11 specifically asserted flow groups passed across runs04–07.** The exact genuine workbook regression from run03 was repaired by root and passed again in run06. No formal feature score or approval is assigned. [Machine-readable results](browser-product-result.json) retain API method/path/status ledgers and selected source hashes.

Why and options: real browser actions were checked against the running Next UI, Hono API and disposable PostgreSQL, so a visible success also had a corresponding server or database observation. For example, an import preview can show a card without creating it: the test checked zero cards before confirmation and exactly one afterward. Mocked UI responses alone could not establish that distinction. Synthetic local storage and identities keep the work bounded; they cannot establish hosted-provider behavior.

Evidence and limits: isolated native Chrome156.0.8078.74 with pinned Playwright1.64.1, explicit test mode, stripped environment, loopback-only service targets, fresh synthetic schemas and external browser HTTP blocking. No user profile, real email provider, token-link navigation or UAT/cloud activity was used. Normal runs stopped their servers and dropped their own schemas. Run03 crashed in the invitation interceptor; its orphan server and schema were identified and cleaned separately in [cleanup evidence](raw/browser-product-03-cleanup.json).

| Asserted flow group | Actual assertions and observations | Primary evidence |
|---|---|---|
| Private image upload and removal | File chosen; create201, content PUT200, finalize200; gallery/private authenticated blob and lightbox visible; anonymous content401; removal200 and tile disappears; unsaved description/date remain while database description is unchanged. | [run04](raw/browser-product-04/result.json), [viewer](raw/browser-product-04/private-lightbox.png) |
| Genuine official Excel import | Exact original failing package reused; initial unknown Status blocks; explicit mapping200, commit200, one card, leading-zero external ID0001, created-card link opens drawer and CSV prefixes formula-like literal with apostrophe. | [run06](raw/browser-product-06/result.json), [preview](raw/browser-product-06/import-preview-summary.json), [receipt](raw/browser-product-06/import-receipt.png), [safe CSV](raw/browser-product-06/safe-report.csv) |
| Project and board creation | Closing/reopening retains project-name draft; project201, board201, one matching database board and five active default columns. | [run04](raw/browser-product-04/result.json) |
| Column lifecycle | Add201, rename PATCH200, reorder POST200 and delete200 through UI; removed column absent in UI and active database rows. Intermediate reordered position was not separately asserted. | [run04](raw/browser-product-04/result.json) |
| Mention and recipient inbox | Owner chooses actual Member from partial-name mention picker; comment201; recipient notification row exists and Member inbox displays mention. | [run05](raw/browser-product-05/result.json) |
| Selected-project My Tasks and Owner activity |61 assigned tasks across two same-project boards load with one continuation. Assigned other-project sentinel stays excluded, then appears after project switch. Owner selects workspace activity scope and server card filter returns200. | [run06](raw/browser-product-06/result.json), [activity](raw/browser-product-06/workspace-activity.png) |
| Invitation retry/history | Successful first reply deliberately lost; original-key retry returns same invitation; one database row, honest unknown/queued delivery, revoke200 and revoked history. Provider remains unconfigured. No link screenshots. | [run04](raw/browser-product-04/result.json) |
| Live board revocation | Owner revokes Member grant through People; DELETE200; already-open Member board/card/images subsequently return404 and private description disappears. | [run05](raw/browser-product-05/result.json) |
| Settings/lifecycle/native traversal | Project and board settings PATCH200 with project database check; board archive/reopen200 and project archive/reopen200; full AddCard title/urgent draft survives native Back/Forward, creates zero cards. | [run05](raw/browser-product-05/result.json) |
| Import content retention | Actual cleanup service with injected +31-minute clock redacts temporary row title/description/external ID/errors and preview digest; committed receipt still opens; created domain card remains. This does not test scheduling. | [run06](raw/browser-product-06/result.json) |
| Downloaded private-image revocation | Member sees downloaded tile and open lightbox; Owner revokes board grant through UI; cached image, open viewer and private description disappear on polling. | [run07](raw/browser-product-07/result.json), [revoked screen](raw/browser-product-07/revoked-private-content.png) |

## Preserved genuine workbook failure and repair

[Original filled package](raw/browser-product-03/official-filled.xlsx) and [run06 reused package](raw/browser-product-06/official-filled.xlsx) are byte-for-byte identical; SHA-256 `31895c2e9576a5e4e4bb8e0f5e65081b4d90400c0b2a03879d90291e83c4dd36`. Python standard-library ZIP checks pass all entry CRCs. It retains a blank self-closing F2 Assignees cell immediately before populated G2 Status `Prototype Review`.

Before repair, upload201 produced ready/new and Status:null: [observed preview](raw/browser-product-03/import-preview-summary.json). The parser cell regular expression consumed the empty F2 and the following G2 together. Root repaired the parser; this tester made no application edit. After repair, the exact bytes produce invalid/UNRECOGNIZED_STATUS, require explicit mapping and successfully commit one card. Run04's expanded-empty-cell workaround remains preserved and is superseded by the original-package run06.

## Harness attempts and remaining limits

- Run01: sandbox loopback EPERM, zero product assertions.
- Run02: initial response-code, selector and fixture-SQL assumptions plus omitted synthetic cursor key. These are harness failures; the separate workbook bug was reproduced in03.
- Run03: useful partial assertions and genuine workbook failure, followed by an invitation interception `Route already handled` crash. Partial checkpoint/log retained; exact own-resource cleanup recorded.
- Run04: six passing groups; full-name mention-picker and asynchronous checkbox assumptions corrected and passed in05. A click followed by its actual API response is appropriate for an asynchronously controlled checkbox.
- Runs05,06,07: all requested selected groups passed. [Probe source](probes/browser-product-main.mjs) is reusable; runs05–07 also preserve their exact probe-source snapshots. Early probe revisions evolved while diagnosing the harness and do not have immutable script snapshots.

These are11 grouped local synthetic diagnostics, not all98-feature or74-UI acceptance. Selected product source hashes did not change inside complete passing runs, but targets differ across runs and do not constitute the complete immutable review manifest. A fresh frozen independent review must still cover the full target. Image storage is in memory; hosted Google identity, R2 durability/policies, email delivery, scheduler operation and UAT remain unverified. External-origin ledgers are empty with external browser HTTP blocked; no general machine-egress claim follows. No cookies, bearers, invitation tokens, storage snapshots or raw request/error bodies were saved.

Next / your input: root can freeze the full source, rerun this probe against that target, perform independent acceptance and only then consider UAT. Ports44931/44932 are released. No action needed from the user for this diagnostic.
