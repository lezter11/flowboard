# Stage 2 repair acceptance criteria — round 1

Date: 2026-10-26 (Asia/Kolkata). Status: frozen before implementation.

## Scope

Repair the shared Stage 2 idempotent write/replay path for BRD-01–07, CRD-01–11, COM-01–06 and DEL-01–08. Preserve prior failed reviews and handoffs. This round targets current authorization at replay time and private response retention in receipts. It does not claim to repair ordering/cursor behavior, archive/lifecycle guards, purge/cleanup, restore re-anchoring or mention-offset validation; those remain explicit blockers for later bounded rounds.

## Acceptance statements

1. Each mounted project-scoped mutation route resolves the resource's canonical project and, inside the same database transaction, verifies and locks the actor's current project grant before looking up or returning an idempotency replay.
2. The minimum role used before replay is at least as restrictive as the operation's normal authorization. Role loss or removal produces the same private 404/403 behavior as a new command. A grant change racing the command is serialized by the existing grant lock protocol.
3. An authorized lost-response retry with the same key and request still resolves to the original logical operation without creating another card, comment, event or notification. A different command with the same key retains 409 IDEMPOTENCY_CONFLICT behavior.
4. Persistent receipt JSON contains no card title/description, comment text, notification text, or other private resource body. It records only the minimum outcome needed to identify the operation, with all necessary lookups authorized on replay.
5. A replay for a resource that has since been deleted, trashed, purged, or otherwise become inaccessible does not disclose its old body. The response follows current endpoint privacy/lifecycle semantics.
6. Regression tests exercise mounted HTTP routes against PostgreSQL, including allowed replay after a lost response, replay after access removal/demotion, same-key concurrency, collision, and receipt inspection for body retention.

## Required checks and reviewer gate

- `npm run check` against a disposable PostgreSQL database on the final target.
- Focused mounted-handler tests for every changed replay family and affected endpoint.
- Fresh independent read-only review of the exact changed source manifest, including the shared receipt helper, all callers, auth/role locking and relevant migrations/contracts/tests.
- Pass only if the review has no blockers, every category minimum, and unrounded weighted score strictly greater than 8.5. Failed review history remains preserved.

## Known exclusions

The round 1 audit findings for broken comment cursors; board/project archive writes; deleting comments on trashed cards; notification/outbox body cleanup; real purge worker/fencing; restore placement; movement/rank edges; viewer/assignee visibility; and mention offsets remain open unless directly required to implement this slice. No handoff is eligible to become verified until all mandatory findings for its feature are fixed and independently reviewed.
