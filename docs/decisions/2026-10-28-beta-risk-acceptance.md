# Beta risk acceptance for board-access review — 2026-10-28

Status: accepted by the user in chat on 2026-10-28. This is a user-directed risk acceptance for a first beta. It is **not** a pass of BACKEND_REVIEW_GATE.md.

## Evidence

- Delta review of RBAC-01..05 and BRD-01: round 1 (Opus 5.5) 8.175 fail; round 2 (Haiku 5.5) 8.175 fail; round 3 (Haiku 5.5, frozen `3e11ab8`) 8.175 fail. Security met its minimum (9.0) in round 3; correctness, integrity and tests were below theirs. Records: `docs/reviews/BOARD-ACCESS-DELTA-20261028*/`. The three-failed-round stop rule was reached.
- After round 3, Backend fixed the blocking findings in `e548d0c`, `53f1d1f` and `36276eb`. Architect re-ran typecheck and the API suite on that commit: 308 passed, 0 failed, 13 skipped of 321. No independent reviewer has seen the fixes. They are self-verified.
- The checker still reports REVIEW REQUIRED for these features. The generated checklist is not edited.

## Accepted for the beta

Fixed but unreviewed: R3-01 (comment edit/delete lock order), R3-02 (double import commit), R3-03 (replay-after-revocation tests), R3-05/R3-06 (stale comments).

Open and accepted by id:

- R3-07: `CURSOR_SECRET` must be set in every deployed environment, or `GET /boards/:id/access` returns 503. Deployment must set it before release.
- R3-08, R3-14: anonymous or ungranted callers can tell some existing IDs from missing ones; IDs are random UUIDs.
- R3-09: one in-flight card/image read can complete after a concurrent revocation.
- R3-10: session IDs are stored as raw bearer tokens (hash them after beta).
- R3-11: Google sign-in overwrites display name and creates a personal workspace for every first login.
- R3-12: localhost origins are trusted by the Origin check in every runtime (allowed by criterion 8).
- R3-13: a local-only database password string is committed in `apps/api/wrangler.jsonc`.
- R3-04: the interleaving test is randomized, not forced.

## Conditions and exit

- Beta only. Not general availability. Re-review with an independent reviewer (stronger model preferred) before calling these features verified.
- Beta-ready also needs UAT sign-in through the same-origin proxy, the production runbook (`docs/RELEASE_BETA.md`), and a Neon backup before migrating.
- Reconsider immediately on any report of data leak, data loss or revoked access still working.
