# Backend token repair handoff

Implementation handoff only. No independent approval or hosted verification is claimed.

- A global explicit-bearer middleware now checks a six-operation capability allowlist before any public/UI handler. Invalid Authorization fails with 401 and cannot inherit a cookie. Nonallowlisted methods/paths fail with 403. Route middleware repeats the policy for independently mounted route modules. Bearer responses, including errors, have `Cache-Control: no-store`.
- Resource ancestry is resolved from canonical board/card rows before comparing a bound project. Existing human membership and board-grant checks still run. The full board snapshot is PAT-denied even with every scope.
- `GET /api/v1/boards/:boardId/metadata` returns only `data.id`, `name`, `structureVersion` and explicit column `{id,name,category,position}` objects. A shared board lock keeps the column set and structural revision coherent during assembly; cards/counts are never queried.
- Restricted project discovery passes the project predicate to SQL before paging. Scope-mismatched cursors are rejected. Cookie project pagination retains its previous envelope and cursor shape.
- Issuance through the session route and local-only CLI shares the same transaction, Owner inheritance/current membership guards and per-user advisory issuance lock. Default expiry is 30 days, maximum 365; at most 20 nonrevoked, nonexpired credentials per user. The active-token list is bounded to 100 rows (new issuance normally keeps it at 20 or fewer). Raw bearer values are returned once, with hashes stored instead. Passing a `ClientBase` to the adapter requires a caller-owned transaction; all public issuance paths pass a Pool and the adapter owns its transaction.
- `lockPersonalAccessToken(client,{tokenId,userId,projectId,requiredScope})` must be called inside the card-create transaction before receipt replay and other authorization locks. It holds a token `FOR SHARE` lock until the caller commits/rolls back, so revoke's UPDATE serializes with the write. Main owns that integration and its concurrency probes.
- Removed the unawaited `last_used_at` UPDATE during authentication. `lastUsedAt` remains nullable historical metadata; it is not a current usage metric. No background query is left running after an authentication check.

Local evidence (disposable PostgreSQL 17.11-alpine, localhost port 55923, synthetic harness only):

- `node --test-concurrency=1 --test apps/api/test/tokens.test.ts apps/api/test/token-boundaries.test.ts` exited 0: 23 passed, 0 failed/skipped. The inventory generated 97 denied method/path probes from 103 actual mounted routes, plus six explicit allowed capabilities. Log: `raw/backend-token-tests.log`.
- `npm test --workspace @flowboard/contracts` exited 0: 117 passed, 0 failed/skipped. Log: `raw/backend-token-contracts.log`.
- Latest direct root `tsc --noEmit` exited 0. Root tooling now includes the MCP project separately.

The targeted API log predates final metadata-lock/cache-header assertions and main's remaining card changes. Re-run the complete frozen API/contract suite before review; these earlier logs alone cannot approve the assembled target. No cloud action, real credential, push or commit was performed by this implementer.
