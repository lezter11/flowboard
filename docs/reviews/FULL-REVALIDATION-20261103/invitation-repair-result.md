# Invitation lifecycle, delivery visibility and bounded history: builder handoff

## Actions

Implemented the pre-frozen `invitation-race-criteria.json` and `invitation-list-criteria.json`. Local evidence is ready; no score, independent approval or feature closure is claimed.

- Acceptance now holds a project lifecycle lock through grant/receipt commit. Both archive-first and acceptance-first orderings are exercised with distinct real PostgreSQL connections and observed waits. Accepted receipt replay rechecks current lifecycle and membership.
- Leave acquires project quota before member/receipt locks, checks current ownership/self membership before replay, preserves archived leave and prevents Owner/unrelated-user leave.
- The acceptance adapter no longer commits its caller's transaction on expiry. The HTTP route owns the intentional expired-status commit, preserving existing API behavior without committing unrelated direct-caller work.
- History is bounded and exposes safe latest delivery status. Terminal outbox receipts retain only a real same-project/workspace invitation ID and optional provider ID; tokens, recipient/template/body/name fields are removed. Unknown/foreign associations are discarded, and old erased associations show `unknown`.
- Migration `database/migrations/0022_invitation_history_indexes.sql` adds history-order and delivery-association indexes. Root synchronized embedded SQL; exact filesystem/embedded parity passed.

Owned source/test files:

- `apps/api/src/adapters/invitations.ts`
- `apps/api/src/http/routes/invitations.ts`
- `apps/api/src/adapters/invitation-delivery.ts`
- `apps/api/src/adapters/notifications.ts`
- `packages/contracts/src/invitations.ts`
- `apps/api/test/invitation-repair.test.ts`
- `apps/api/test/acc-lifecycle.test.ts`
- `apps/api/test/uat-immediate-invite-send.test.ts`
- `database/migrations/0022_invitation_history_indexes.sql`

## Why and options

A lifecycle lock makes archive and acceptance take turns. If archive wins, the invitation cannot create membership afterward; if acceptance already holds the lock, it finishes before archive. Merely reading `archived=false` would allow archive to commit between the check and the grant.

Pagination remembers the last creation timestamp and invitation ID instead of counting rows to skip. This keeps equal timestamps deterministic and avoids duplicates when newer invitations appear. Cursors are signed and bound to actor/project/filter/current authority/lifecycle, with no production signing fallback. A page uses one SQL statement and at most 101 invitation rows, with an indexed lookup of the latest delivery attempt for each. This avoids one application request/query per row; it does not prove production latency.

Retaining the opaque invitation ID is the smallest safe association for delivery visibility. Older receipts already erased that association and cannot be reconstructed honestly, so they show unknown. A new dedicated association column/migration would be broader than needed.

## Evidence and limits

| Check | Actual result |
|---|---|
| New failing baseline | 0 passed, 9 failed, exit1 |
| Final nearest legacy/API/Node/actual local workerd run | 151 passed, 0 failed, 0 skipped, exit0 |
| Final new isolated invitation regressions | 12 passed, 0 failed, 0 skipped, exit0 |
| Contracts | 117 passed, 0 failed, 0 skipped, exit0 |
| Root typecheck | Exit0 |
| Migration0022 exact embedded parity | Pass |
| Owned diff whitespace | Pass |

The 151-test run included the first 11 new cases. A final expiry/latest-attempt case and populated query-plan fixture were checked in the 12-case new-only run; counts are separate. Preserve the earlier 149-pass/2-fail nearest run: its single failing legacy mail subtest and parent suite expected the superseded provider-only receipt. The corrected assertion allowlists exactly the trusted association and provider ID, with content/token privacy retained.

New cases use explicit pools and fresh schemas in `flowboard_identity_extra_test` on disposable loopback55931. Legacy suites used the root-reserved `flowboard_harness` sequentially; that primary database is now released. Node24.15.0 and PostgreSQL17.11; temporary HOME and synthetic provider adapters only. No real OAuth, email, cloud or hosted verification.

`raw/invitation-query-plan-populated.json` records one history/delivery application statement over 105 synthetic invitations and 105 associated outbox records. PostgreSQL used `idx_project_invitations_history` and `idx_outbox_invitation_delivery`; the outer read was capped at 101. This is one local EXPLAIN ANALYZE observation, not a production benchmark or zero-downtime migration claim. `raw/invitation-repair-targeted-final.log`, `raw/invitation-repair-new-final.log`, `raw/invitation-repair-contracts.log` and `raw/invitation-repair-typecheck-final.log` retain passing evidence. The paired JSON stores log/source hashes, exact command shapes and failure history.

## Backend contract for UI

`GET /api/v1/projects/:projectId/invitations?limit=50&cursor=...&status=pending`

- Optional query: limit1..100 (default50), cursor, status pending/accepted/revoked/expired.
- Existing envelope stays `{data:Invitation[],nextCursor:string|null}`; old array-unwrapping code can still consume the first page.
- List rows add optional `delivery:{status:'pending'|'retrying'|'delivered'|'failed'|'unknown',canRetry:boolean}`.
- `canRetry` means failed delivery, pending/unexpired invitation, active project and role eligibility to resend. Rate, quota or provider errors can still reject a request.
- Invalid query422; stale/tampered/wrong-scope cursor409 `STALE_CURSOR`; Member/Viewer403; outsider/revoked404. Cursor creation/verification needs existing `CURSOR_SECRET` of at least32 UTF8 bytes; missing configuration returns503.
- Mutation request bodies and invitation status enum remain unchanged. New delivery fields contain no provider error/message/recipient/body/token; the existing authorized invitation email field is unchanged.

## Next / your input

Architect/UI must wire nextCursor, delivery-state/retry presentation and global OpenAPI; role-owned acceptance records still need independent full-target review. Final API checks must set `FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL` to the isolated local identity database to avoid explicit skips. Root must run full final checks/build and freeze the complete reachable source manifest.

Hosted OAuth, real email delivery, deployed migrations and signed-in browser acceptance remain **UAT pending** after local gates and authorized direct UAT deployment. No dev or production stage, commit, push or deployment occurred. No user action needed for this bounded handoff.
