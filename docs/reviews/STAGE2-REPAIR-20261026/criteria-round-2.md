# Stage 2 repair acceptance criteria — round 2

Date: 2026-10-26 (Asia/Kolkata). Frozen before round-2 implementation.

## Scope

Fix archived-context write behavior across card, comment, and card-trash mutations; make comment receipt replay use the same operation-level authority/lifecycle checks as a new request; and implement stable comments pagination. This round does not claim to fix card neighbor/rank semantics, board-card cursor binding, purge/cleanup, notification/activity body retention, trash pagination, restore placement, overdue filtering, or mention span validation.

## Acceptance statements

1. A project or board marked archived is read-only for card create/update/move, comment post/edit/delete, and card delete. The server checks archive state within the write transaction and serializes against a concurrent archive transition using row locks. Responses use the documented `409 READ_ONLY_CONTEXT` behavior and do not leave partial writes/events/receipts.
2. Comment delete replay checks the actor's current role against the original action: author requires current member-or-higher access; non-author moderation requires current manager-or-owner access. A manager demoted to member cannot replay a prior moderation success; an authorized author retry remains idempotent.
3. Comment post replay checks the parent card's current state before receipt lookup. A same-key retry after the parent was trashed/purged follows current `CARD_IS_TRASHED`/private not-found behavior and never returns a stale success outcome.
4. Comment pages use deterministic ascending `(created_at,id)` keyset pagination scoped to one card. Page two has no overlap with page one; malformed, unknown, or wrong-card cursors fail safely. Inserts between pages do not duplicate already-returned rows.
5. Real mounted-route PostgreSQL tests prove each above behavior, and all changed paths retain authorized same-key idempotency and rollback safety.

## Required checks and gate

- `npm run check` against a disposable PostgreSQL database on the final target.
- Focused BRD, CRD, COM, and DEL PostgreSQL route suites; include new negative and replay coverage.
- Fresh independent review of the exact source manifest; all category minimums, no blockers, and unrounded weighted score strictly above 8.5 are required before any handoff is verified.

## Error and lock interpretation

Archived project or board context produces a stable conflict with reason/context identifying the read-only boundary to an already-authorized actor. Missing/inaccessible resources remain private 404s. The archive-state lock is short-lived and performs no external work; it prevents a write from committing on the stale assumption that the board/project is still active.
