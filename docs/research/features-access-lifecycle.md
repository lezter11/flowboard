# Flowboard feature checklist: access and lifecycle

Date: 2026-10-26. Status: product research and proposed backend acceptance criteria; no feature is implemented or verified.

## Source of truth and plain-English model

**Confirmed by the latest user instruction:** one account owner manages multiple projects; invited people can access only their specifically granted project; the owner can inspect the whole card history and see who created, moved, commented on, or changed a card; deleted cards can be restored for 24 hours; cards can have image/reference attachments; provide an Excel template/import; and the board supports draggable cards, a detail popup, title, due date, assignees, comments, save and delete.

The earlier [PRD](../../PRD.md) says workspace membership grants access to all projects. That rule is superseded for this feature: workspace ownership/admin is for managing the container, while project access is separately granted. An account is a person’s sign-in identity; a workspace is the owner’s project container; a project grant is the key that lets a person see one project. For example, if Priya owns a workspace with Projects A and B and invites Sam to A, Sam must not discover B by URL, search, export, attachment link or API call.

**Proposed defaults below are not user-approved requirements.** They turn the request into reviewable behavior. A project grant is inherited by every board/card inside that project. A workspace owner can manage every project and see its histories. People invited to someone else’s workspace have no special rights in their own workspace: roles are scoped to that workspace/project. Do not add public projects, shareable invite links, custom roles, project administrators, or cross-project guests in the first release.

## Candidate feature checklist

IDs are stable planning candidates, not delivery checkboxes. “Release 1” is the proposed first usable slice; it requires review against scope, capacity, and the canonical API before implementation.

| ID | Feature and proposed behavior | Scope |
|---|---|---|
| F-ACC-01 | One person can create/own a workspace and manage multiple projects. A person may also accept grants in other workspaces using the same account. | R1 |
| F-ACC-02 | Workspace/project switcher shows only workspaces and projects the signed-in person can access. Non-granted project IDs return the same not-found response as unknown IDs. | R1 |
| F-PRJ-01 | Owner creates, renames, archives and lists projects. Project archive hides it from normal board lists but retains history/data for owner recovery. | R1 |
| F-INV-01 | Owner invites by exact email to one project with role, expiry, inviter and status. Acceptance requires a verified matching email and signed-in account; token is single-use, revocable, expiring and stored hashed. | R1 |
| F-INV-02 | Pending invite can be resent (rotate token), revoked, or accepted once. Duplicate active invite for the same email/project is reused or replaced, never multiplied. | R1 |
| F-INV-03 | Board invite action, if shown, creates a project grant because boards inherit project access. It must say “Project access” and disclose that all boards/cards in that project become visible. No board-only access in R1. | R1 |
| F-RBAC-01 | Project roles: `project_editor` may read, create/edit/move/delete/restore cards, comment and attach; `project_viewer` may read cards/history/attachments only. Owner has both plus project and membership administration. | R1 |
| F-RBAC-02 | Only workspace owner manages projects, invites, grants, workspace settings, owner transfer and account-level deletion. Do not infer workspace-wide access from being a project editor or owner of a different workspace. | R1 |
| F-RBAC-03 | Owner can grant/revoke a person’s project access. Revocation blocks the next API request and file download, including open sessions, history, exports and idempotency replay. Preserve their historical actor identity. | R1 |
| F-RBAC-04 | A person who owns a different workspace is still only the role granted here. An owner cannot remove/demote them from their other workspace; roles never transfer across tenant boundaries. | R1 |
| F-CARD-01 | Board columns and draggable cards support click/tap and keyboard move alternatives. Save title, date-only due date, assignees, description, comments and order through canonical server responses. | R1 |
| F-CARD-02 | Card detail opens in an accessible dialog/drawer with stable link, loading/error/forbidden states, unsaved-draft warning, and save/delete actions. | R1 |
| F-HIST-01 | Append history for create, field changes (with changed field and safe before/after), move (from/to), comment add/edit/delete, assignment, attachment add/remove, import, trash, restore and relevant access changes. Record actor ID, display identity snapshot, server timestamp and card/project IDs. | R1 |
| F-HIST-02 | History is append-only to application users. Card history is visible to project members and the workspace owner; workspace access history is owner-only. No “edit history” API. | R1 |
| F-DEL-01 | Delete means soft-delete/trash. Card leaves active board/count/search but retains its content, comments, history and attachment records for restore. Record `deleted_at`, `deleted_by`, `purge_at=deleted_at+24h` from server time. | R1 |
| F-DEL-02 | Restore is permitted only while server time is strictly earlier than `purge_at`; at/after the boundary it returns a stable expired response. Restore returns to original column and nearest surviving original neighbors; if column is gone/archived, use an explicit valid destination chosen by owner/editor. | R1 |
| F-DEL-03 | Physical purge is asynchronous after the deadline. The request path enforces the exact 24-hour boundary even if a cleanup job is late. Purge removes file objects and card content only after a committed state transition; retry safely after partial object-store failure. | R1 |
| F-ATT-01 | Detail supports image upload plus reference URL attachment. Uploads are private, project-authorized on every fetch, size/type bounded, MIME checked from content, and delivered by short-lived signed URL or authenticated proxy. | R1 |
| F-ATT-02 | Removing an attachment records actor/history and schedules object deletion; trash/restore preserves it during the 24-hour restore window. Block cross-project object IDs and guessed URLs. | R1 |
| F-IMP-01 | Downloadable `.xlsx` template documents supported columns, required title/status, allowed values, date format and examples. Import `.xlsx`; optionally accept CSV generated by Excel if low-cost. | R1 |
| F-IMP-02 | Preview validates rows before commit: map columns, show row errors, resolve status to project columns and assignee email to active project grants. Never silently create users or grant access from spreadsheet data. | R1 |
| F-IMP-03 | Import is a bounded, idempotent batch with actor, project, file fingerprint, row outcomes and one history event per created/changed card. Default all-or-nothing for the bounded batch; user may edit errors and retry. No partial success hidden behind a success toast. | R1 |
| F-LATER-01 | Workspace admins, multiple owners, nested roles, public/share-link access, per-board guests, granular custom permissions, bulk export, email notifications, arbitrary files, versioned file history and import of comments/history. | Later review |

## Permission matrix (proposed)

| Action | Workspace owner | Project editor | Project viewer | No project grant |
|---|---:|---:|---:|---:|
| List/manage workspace and all projects | Yes | No | No | No |
| Read granted project boards/cards/history | Yes | Yes | Yes | No |
| Invite/revoke project access | Yes | No | No | No |
| Create/edit/move cards, comment, attach | Yes | Yes | No | No |
| Trash/restore cards before deadline | Yes | Yes | No | No |
| Read/download project attachments | Yes | Yes | Yes | No |
| Read workspace access/audit history | Yes | No | No | No |

Use the role at the narrowest useful level: project access is explicit and inherited downward. This gives a simple rule that is easy to explain and enforce. Fine-grained board grants are more flexible, but add confusing exceptions and make search, imports, attachments and history harder to secure; defer until a concrete customer needs them.

## Key flow outcomes and failure/abuse cases

| Flow | Expected outcome and important failures |
|---|---|
| Create project → invite editor/viewer → accept | Project appears only for owner and granted person. Expired/revoked/wrong-email/replayed invite fails without granting access; resend invalidates old token. |
| Open another project by guessed URL/API ID | Same not-found response as unknown object; do not leak project name, owner, counts or existence. Check search, pagination, caches and idempotency replay too. |
| Revoke a current editor | Commit revocation atomically; next request and attachment fetch fail. Open page may show stale content until next request, so private responses must not be shared-cacheable. |
| Move/edit/comment card concurrently with revoke | Authorization and mutation serialize on the project grant. If revoke commits first, write fails; if write commits first, it is recorded and then grant is revoked. No “revoked but late write” window. |
| Delete → restore / expiry | Restore is allowed before cutoff and preserves comments/history/files. At or after cutoff it fails even if purge job has not run. Two restore requests yield one restore; restore-vs-purge yields one winner. |
| Upload/remove/trash attachment | Reject oversized, spoofed MIME, unsupported, malformed and cross-project objects. Retry does not duplicate references. Removal/purge retries cannot delete an object still referenced by another record. |
| Excel import | Reject malformed workbook, formula-only/oversized rows, unknown columns/status/assignees, duplicate rows and over-limit batches with row/column explanations. Preview has no writes; retry after lost response does not duplicate cards. |
| Owner removal / project transfer | There is exactly one workspace owner initially. Owner cannot remove or demote self without a successful atomic transfer to an eligible active account; reject deleting the last owner. |

## Backend acceptance requirements before build is called complete

- [ ] Global account identity is separate from workspace ownership, project grants and board data. Every query/write/download derives actor from verified session; never trust client-supplied owner/workspace IDs.
- [ ] Every project, board, card, comment, history row, invite, import batch and attachment has tenant/project ancestry enforced by authorization and database relationships. Cross-project IDs are rejected consistently, including nested ID substitution.
- [ ] Grant check, version/state change, history row, idempotency receipt and any durable outbox entry commit in one PostgreSQL transaction. For revocation races, use a documented lock order and transaction test.
- [ ] Owner administration checks active ownership on every request. Last-owner protection and transfer are transactional; an owner invited into another project gains only that explicit grant there.
- [ ] Invite tokens are random, hashed at rest, scoped to one project/email/role, expiry-checked on server, single-use, revocable and safe against resend/accept races. Do not expose tokens in logs or analytics.
- [ ] History includes actor, timestamp, action, resource, changed fields and necessary before/after values; comments and attachments use tombstones/redaction rules rather than erasing required audit facts. Paginate history and preserve historical display identity after revocation/account disable.
- [ ] Trash stores prior column and ordering anchors; all normal reads exclude trashed rows. Restore and expiry compete via conditional state/version transition; accepted restore is auditable and has a new version.
- [ ] Purge job selects only due, still-trashed rows; DB state transition is idempotent. Object deletion is durable/retryable and never happens before the restore cutoff. Measure and alert on purge backlog.
- [ ] Attachment metadata and object key are unguessable; authorization occurs before issuing signed URLs. Validate bytes, size, count and image decoding; define orphan cleanup and a safe allowed URL scheme list (`https` only; reject private-network destinations if server fetch is ever added).
- [ ] Import preview and commit share one validator. Bound compressed/uncompressed size, row count, cell length and parsing time; reject macros/external links/formula evaluation. Use idempotency key + payload hash; report per-row outcome without partial hidden commit.
- [ ] Tests use at least two workspaces, multiple projects, owner/editor/viewer, an owner invited elsewhere, revoked user, guessed IDs, duplicate/replayed requests, exact 24-hour boundary with fake server clock, concurrent restore/purge and upload/import failure injection.
- [ ] Acceptance includes a non-owner who can read only their granted project, owner access to full card history, restored card after refresh with comments/images intact, permanent unavailability after cutoff, and failed import with no partial cards.

## Research and interpretation

These product docs are inspiration for visible behavior, not authority for Flowboard requirements. Azure Boards separates project-level groups/permissions and distinguishes deleting/restoring from permanent deletion; its recycle bin does not auto-expire, so Flowboard’s 24-hour cutoff is the user’s choice, not copied behavior. Trello supports board guests separate from workspace membership, card comments/activity and private attachment access; Flowboard intentionally chooses simpler project-level inheritance. Linear documents restricted team/guest access and preserves historical identity for suspended users; this supports treating access and historical authorship as separate records. Microsoft now recommends CSV for bulk work instead of its legacy Excel add-in, so keep the template spreadsheet-friendly and avoid coupling to the retired integration.

- [Azure Boards permissions and board access](https://learn.microsoft.com/en-us/azure/devops/boards/get-started/permissions-access-boards?view=azure-devops)
- [Azure Boards project-level permissions](https://learn.microsoft.com/en-us/azure/devops/organizations/security/change-project-level-permissions?view=azure-devops)
- [Azure Boards delete and restore](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/remove-delete-work-items?view=azure-devops)
- [Azure Boards Excel/CSV bulk guidance](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/office/bulk-add-modify-work-items-excel?view=azure-devops)
- [Azure Boards work-item history and attachments](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/about-work-items?view=azure-devops)
- [Trello board guests and membership](https://support.atlassian.com/trello/docs/adding-people-to-a-board/)
- [Trello card comments and activity](https://support.atlassian.com/trello/docs/commenting-on-cards/)
- [Trello attachment access](https://support.atlassian.com/trello/docs/adding-attachments-to-cards/)
- [Linear member roles and guest access](https://linear.app/docs/members-roles)
- [Linear invite flow](https://linear.app/docs/invite-members)
- [Linear issue activity](https://linear.app/docs/my-issues)

## Teaching note: soft delete and history

Soft delete means a card is hidden from the board while its row and related records remain available for recovery. For Flowboard, that makes the 24-hour restore promise practical: a trash action records who deleted it, and restore can bring back the same comments and image references. The cost is storage and cleanup complexity, so a scheduled purge must finish later and retry safely. Immediate hard deletion is simpler, but cannot satisfy recovery; a full event-sourced system can reconstruct states, but is much more machinery than this product needs. A normal relational card plus append-only activity rows gives the needed history without making every read rebuild the card from events.
