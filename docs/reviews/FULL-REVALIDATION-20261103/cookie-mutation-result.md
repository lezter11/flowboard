# Cookie resource-mutation isolation evidence — not approval

## Actions

Added only `apps/api/test/cookie-mutation-matrix.test.ts`, `apps/api/test/support/cookie-mutation-fixture.ts` and this slice’s criteria/evidence. Criteria were frozen before probe code in `criteria/cookie-mutation-matrix.json`. No runtime, shared-contract, OpenAPI or UI edit belongs to this slice.

The generated selection equals the actual mounted/OpenAPI inventory (103 methods/paths): 48 resource-ID/body-selected writes, including both import aliases. Of those, 47 live operations have genuine successful controls and one transfer operation deliberately returns retired410. Full per-operation factories, setup proof, controls and classifications are in `cookie-mutation-result.json`; sanitized individual cells are in `raw/cookie-mutation-typed.json`.

## Why and options

A foreign-resource404 alone could hide an invalid request. Each operation therefore uses a fresh migrated schema, real tenant-B resources, current shared-schema-valid input and a successful authorized command after its denial checks. Four active tenant-A roles first prove access to their own granted board, then target unrelated B. Board-derived operations also exercise B Manager/Member/Viewer without the target board grant. Owner inheritance is retained; a Manager with no old-board grants can create a board and receives its creator grant. Member, rather than Owner, supplies the valid leave control.

Real mounted preparation creates prior move state for undo, uploads PNG content before full Sharp finalize, and parses actual XLSX previews before both aliases’ mapping/commit/cancel commands. Reopen cases seed existing archived flags directly; reopen itself and its current-version command are mounted. No external mail/provider is configured.

## Evidence and limits

Final command: sanitized `env -i` with synthetic HOME/test mode/cursor secret and `FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL` pointing only to loopback `flowboard_identity_extra_test`, then `node --test --test-concurrency=1 apps/api/test/cookie-mutation-matrix.test.ts`. See the exact non-secret command structure in JSON.

- **55/55 tests, 0 failed, 0 skipped, exit0**, 45.09 seconds. Log: `raw/cookie-mutation-typed.log`.
- **348 cells = 295 denials + 53 successful controls**. Denials: 192 four-role foreign cells (including four deliberate retired410), 96 same-project grantless cells, six protected role-target cells, one Owner retired410.
- All denial checks preserve hashes of every application table, every sequence state, and both storage mutation counters; no data envelope or private fixture marker. Evidence never serializes cookies, request headers, tokens or successful credential responses.
- Additional protections cover Manager peer demotion/removal, appointing another Manager, own-role change and Member/Viewer administration; each has a matching Owner success control.
- Initial run: 49 pass/6 fail including the parent failure. Five additional PATCH fixtures omitted required `status` and returned422. Those are test errors, retained in `raw/cookie-mutation-first.*`, not authorization evidence or product defects. Corrected fixtures now explicitly validate the shared schema before dispatch. All 48 generated operation cases already passed in that run.
- Latest `npm run typecheck` exits1 only for another owner’s two duplicate `contentType` properties in `apps/api/test/jpeg-entropy.test.ts:18,52`. Owned files have no remaining type errors. Parent was notified. Log: `raw/cookie-mutation-typecheck-latest.log`.

No new runtime defect was confirmed. This is a separate bounded matrix from the earlier465-cell authentication/read matrix, not all possible role/state combinations. Forty-six GET operations and nine non-resource mutations are classified outside selection. Prior matrix adds23 private reads but does not prove all four roles on all reads. Caller profile/name/logout/devlogin, own-project creation, mark-all-read, unscoped retired workspace creation and admin migration do not accept a foreign resource ID. Invitation acceptance remains a token-identity workflow covered by `invitation-repair.test.ts:78-151` and existing `inv01-inv03.test.ts`; no tokens are persisted here. Explicit Owner-target/concurrent role protection remains in `identity-repair.test.ts:172` and `rbac-advanced.test.ts:668`, with their separate existing evidence.

No fresh privilege race, every allowed role/state/replay combination, actual storage durability, provider or hosted acceptance is claimed. The global target remains mutable while JPEG/browser work finishes. The bounded fingerprints in JSON identify handoff bytes, not a final release manifest or independent review approval.

## Next / your input

No product decision needed. Parent owns the JPEG typecheck correction, final full-suite/frozen-manifest gates and fresh independent review. This agent is idle after handoff. Only disposable identity-extra schemas were used and cleaned up; primary/access databases were never used or reserved. No cloud/deployment/commit/score/approval action occurred.
