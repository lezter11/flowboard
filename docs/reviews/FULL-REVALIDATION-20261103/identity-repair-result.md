# Bounded identity repair: builder handoff

## Actions

Implemented the version 2 frozen criteria in `identity-repair-criteria.json`. This is local implementation evidence, with no score, approval or feature-closure claim.

Changed only these owned source/test paths:

- `apps/api/src/adapters/members.ts`
- `apps/api/src/http/routes/members.ts`
- `apps/api/src/adapters/notifications.ts`
- `apps/api/test/identity-repair.test.ts`
- `apps/api/test/rbac-advanced.test.ts`

- Both member endpoints acquire the project quota before authorization/target/receipt locks. Current actor and protected target checks happen before replay. Reactivation respects effective request limits, active seats excluding Owner and pending seat reservations.
- Archived projects block role changes and reinstatement while preserving pure authorized removal and its replay. Active mixed role/removal commands remain supported.
- PATCH removal shares DELETE invitation invalidation and activity behavior. Existing membership trigger clears board grants. Failed activity insertion rolls the member/invitation/receipt transaction back.
- Terminal exhausted invitation retries discard raw token, recipient and template/body fields.

## Why and options

A seat reservation is a promise that a pending invite can join later. For example, four seated teammates plus one pending invite fills a five-person project; reactivating an old removed person must not silently create a sixth obligation. The same project advisory lock makes invitation and reinstatement operations wait their turn, then count current state. This trades some parallelism inside one project for a simple, correct limit; separate projects remain independent.

A retry receipt now retains one safe internal `state` marker: `member_access_removed` or `member_role_or_access_changed`. This distinguishes an originally pure revocation from a mixed role-change/removal after the target already has its new role. The marker never appears in public responses. Legacy receipts with no classification still replay in active projects, but ambiguous archived replay is refused. This preserves the existing active mixed command; rejecting all mixed commands would have changed the API unnecessarily.

The old authority race test paused after acquiring the project quota and awaited an Owner request requiring that same lock. That impossible schedule now pauses Manager before acquisition, lets Owner promotion win on another connection, then verifies Manager receives 403 and target remains active Manager. Failure cleanup always releases its barrier. The existing writer-before-revoker and revoker-before-writer cases remain.

## Evidence and limits

| Check | Actual result |
|---|---|
| Original new regression baseline | 4 passed, 7 failed, exit 1 |
| Additional mixed/legacy replay baseline | 0 passed, 2 failed, exit 1 |
| Final nearest API/Node/actual local workerd suite | 126 passed, 0 failed, 0 skipped, exit 0 |
| Final new bounded regressions | 16 passed, 0 failed, 0 skipped, exit 0 |
| Contracts suite | 117 passed, 0 failed, 0 skipped, exit 0 |
| Root typecheck | Exit 0 |
| Owned diff whitespace check | Exit 0 |

The 126-test run included the first 13 new cases; three additional cases were run in the final 16-test file. Counts are separate runs and are not added together. Environment: Node 24.15.0, root-provisioned disposable PostgreSQL 17.11 on loopback 55931, synthetic `flowboard_harness` database, temporary HOME, no live mail/OAuth/cloud/deployment. New regression cases migrate and remove their own generated schemas.

The paired `identity-repair-result.json` records exact commands (connection secret omitted), log hashes, bounded file hashes, limits and the complete failure history. Preserve `raw/identity-repair-red-sandbox-refusal.log`, both red runs, earlier typecheck failures and the initial 124-pass/2-fail targeted run. The initial failure was an old incompatible race schedule, followed by a hung child because its barrier was not released on failure; only that test child was terminated. The corrected suite passes.

Passing logs: `raw/identity-repair-targeted-final.log`, `raw/identity-repair-new-regressions-final.log`, `raw/identity-repair-contracts.log`, `raw/identity-repair-typecheck-final.log`.

## Next / your input

Root must finish invitation accept/archive and leave-lock coordination, all other discovery repairs, full API/access-database and build checks, and a fresh independent full-target review before any affected feature closes. Architect owns review handoffs/checklist/OpenAPI and feature-definition reconciliation. Inviter-visible delivery state, invitation-history bounds and directory email policy remain outside this bounded patch.

No user action needed for this patch. No commits, pushes or deployment occurred. Authorized direct UAT remains after all-feature closure and release lock; no dev or production changes.
