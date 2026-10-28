# Proposed card movement controls — 27 October 2026

Status: proposal, not an implemented or verified API contract. The owner requested restrictions on who may move cards between board columns, while retaining their other permissions such as commenting. Settings currently shows this capability as unavailable.

## Intended behavior

An owner can restrict a movement such as **In progress → Completed** for selected people, while allowing others to move through all columns. Policies are scoped to one board and refer to stable column and user IDs. A project membership or board grant remains a separate prerequisite: a movement permission must never grant access to an otherwise inaccessible board. Comment permission remains independent of movement permission.

The UI needs to express directed source-to-destination restrictions as well as convenient restrictions on all moves into a destination, and identify people with unrestricted movement. These are proposed interaction semantics, not an approved precedence model. Before implementation, agree how individual exceptions interact with a destination-wide restriction, whether same-column reorder is covered, and who besides the owner may administer these rules.

## Backend and integration requirements

- Define defaults, policy precedence, management authority, identities, versioning and error responses in an Architect-owned contract; incorporate the separately pending board-grant authorization cutover.
- Persist board-scoped rules and audit changes. Validate project, board, columns and members under the same transaction/locking and revocation guarantees as the write.
- Enforce the policy for every route that can change a card's column, including card updates, move, undo, imports, restore or any alternate path as applicable. Prevent a client from bypassing the rule; retain drafts and give a clear error when a move is rejected.
- Cover owner, authorized and denied members, unchanged comment access, different boards/projects, policy edits concurrent with movement, stale revisions, deleted columns and bypass attempts with mounted-handler and selected-database tests.
- Run the repository's independent backend review gate before the UI handoff and live integration. Browser-only disabled controls are not authorization.
