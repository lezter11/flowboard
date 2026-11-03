# Candidate feature inventory — hosted acceptance pending

This inventory describes implemented source in the repaired candidate. It is not a release approval or a claim that all 98 features are closed. The generated [feature checklist](../../FEATURE_CHECKLIST.md) is the per-ID status authority; exact independent review records and hosted observations must supply its evidence. Deployment identifiers will be recorded separately when deployment actually occurs.

| Area | Implemented candidate behavior | Important boundary |
| --- | --- | --- |
| Account | Google sign-in integration, session/logout, confirmed display name and personal last location | Real Google sign-in and hosted cookies need UAT acceptance |
| Projects and access | Multiple projects, scoped membership, Owner/Manager administration, explicit board grants, project settings and archive/reopen | Membership alone grants no board; only Owner administers board grants; full People directory is Owner/Manager only |
| Boards | Create/edit/archive/reopen, default board, customizable column names/order/colors, bounded snapshots and pagination | Nonempty or retained-reference columns cannot be silently deleted; version conflicts protect newer changes |
| Cards | Quick/full creation, details drawer/deep link, title/description/priority/date, multiple eligible assignees, drag and explicit keyboard/pointer Move, Undo | Current access and expected versions apply; filtered movement uses canonical server order |
| Discussion | Paginated comments, own editing, authorized moderation/deletion, structured teammate mentions and separate drafts | A typed name alone does not notify; copied private text is removed after access refusal while own unsent drafts and uncertain original requests retain protection |
| Activity and inbox | Card/project/Owner activity feeds, safe field/assignment/movement details, mention inbox and read markers | Current visibility is rechecked; referenced people do not expose a directory or email addresses |
| Images | Private staged upload, validation/finalization, browser conversion, gallery/lightbox/removal and cleanup | Up to10images/card; PNG and supported JPEG inputs; browser converts CMYK. Real R2/Images binding, durable bytes and hosted resource limits remain UAT checks |
| Trash | Owner/Manager card deletion, restore strictly before24hours, retained placement, explicit replacement destination and purge | Cleanup delay never extends restore time; contention may give a retryable503 with no partial losing effect |
| Excel | Download template, bounded XLSX upload, field validation, status mapping, preview/commit, durable duplicate markers and minimal retained receipts | Create-only import; malformed source and repeated workbook IDs cannot be hidden by earlier markers; no guessed dates or numeric external IDs |
| Discovery | Selected-project My Tasks, due/priority filters, paginated search, navigation and safe empty/error/revoked states | No cross-project combined task view; loaded-only client search is labelled |
| MCP | Local stdio tools to list projects/boards/columns, search cards and create cards through scoped personal tokens | Five tools; no card-update tool or remote MCP URL. Identical create retries use the same operation ID/input within a seven-day credential namespace |

## Company integration and MCP updates

The existing card-create HTTPS endpoint is available to explicitly permitted personal tokens. A dedicated company installation API with OAuth client credentials, board-bound machine grants, durable external issue identity and controlled updates is still planned. It must not be described as shipped. [Requirements and tradeoffs](../../decisions/2026-11-03-integration-destination-and-machine-identity.md) separate the human-backed MCP principal from a company's machine principal.

## Hosted acceptance after approved deployment

Use synthetic UAT projects and actors. Verify Google sign-in/sign-out, Owner/Manager/Member/Viewer and removed-user behavior, scoped boards and directory refusals, create/edit/move/reload, mention inbox, private image delivery after access removal, trash/restore, Excel preview/commit/invalid-batch refusal, invitation delivery/retry and scheduled cleanup. Record actual deployed SHA, Worker version and Pages deployment. Do not use local synthetic sessions as evidence of real Google or hosted storage/mail acceptance.

The [MCP test guide](MCP-UAT-TESTING.md) supplies local host setup, token handling, exact destination discovery, create/replay/conflict and permission/revocation cases. It remains deployment pending until the reviewed build is actually promoted.
