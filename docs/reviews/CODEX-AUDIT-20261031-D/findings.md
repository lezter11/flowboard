# Findings

Target: `99ae250d1c1f6fddf7747bd5676a7234abf72a11`. Findings are ordered by severity. Reproductions used only synthetic local accounts and disposable PostgreSQL unless stated otherwise.

## High

### FB-R4-01 | high | `apps/api/src/http/routes/workspaces.ts:258-372` | Ownership transfer remains enabled and bypasses target-user quotas

**What is wrong:** Round 4 requires `transfer-ownership` to be disabled. The route is still mounted and updates `workspaces.owner_id` after checking only that the caller owns the workspace and the target user exists. It takes no per-user quota lock and does not verify the target's owned-project count. An Owner can therefore transfer a workspace to an arbitrary existing account; that account can receive more than three active owned projects and gain Owner access to the workspace's projects. The existing API test confirms that a target with no workspace membership can receive ownership.

**Exact reproduction:** On a disposable DB, create an owner, a separate target that is not a workspace member, and an owned workspace. As the owner, send `POST /api/v1/workspaces/{workspaceId}/transfer-ownership` with a valid owner session, a fresh `Idempotency-Key`, and `{"targetUserId":"<target-user-id>","expectedVersion":2}`. The response is `200`, and its `data.ownerId` is the target ID. A separate disposable-DB reproduction set the target to three active owned projects first; the transfer still returned `200` and the target count became four (`raw/transfer-quota-bypass.log`). The existing `ACC-07` integration test also does a transfer and passed (7/7 tests); see `raw/acc-lifecycle.log`, with the relevant test at `apps/api/test/acc-lifecycle.test.ts:280-323`.

**Suggested fix:** Disable the route with `404` for every caller, including an Owner, as the Round 4 scope requires. If ownership transfer is later re-enabled, require explicit target consent and serialize both users' quota checks under sorted user quota locks; refuse transfers that exceed the target's active or total limits.

**Confidence:** confirmed.

## Medium

### FB-R4-02 | medium | `package-lock.json:4021` | Production dependency tree contains a high-severity PostCSS advisory

**What is wrong:** `npm audit --omit=dev --json` reports two production-tree advisories: `postcss` high and `next` moderate. The all-dependency audit reports five total (two high, three moderate), including `undici` high. The lockfile therefore does not clear a clean dependency review. The PostCSS advisories cover unsafe CSS serialization and attacker-controlled source-map loading; the practical exposure depends on the build inputs and tool path, which were not exercised here.

**Exact reproduction:** In the frozen worktree after `npm ci --ignore-scripts`, run `npm audit --omit=dev --json` (exit 1) and `npm audit --json` (exit 1). Redacted-by-omission reports are in `raw/npm-audit-prod.json` and `raw/npm-audit-all.json`.

**Suggested fix:** Review the upstream advisories and update to supported patched versions, then rerun both audits and the static build. Avoid an unreviewed major Next upgrade; validate export behavior and supported runtime compatibility.

**Confidence:** confirmed.

## Low

### FB-R4-03 | low | `apps/web/src/lib/active-project.ts:22-24` | Shared-project pages can show the user's own workspace name

**What is wrong:** When the active project belongs to a workspace the user does not own, `useActiveProject` falls back to the first workspace the user owns. The top bar displays that workspace name as the breadcrumb for the active shared project. This mislabels the team context and may confuse users about which workspace owns the project. It does not grant API access.

**Exact reproduction:** Sign in as a user who owns project A and has been invited to project B in another owner's workspace. Open project B. Since `ownedWorkspaces.find(...)` returns no match, the fallback selects the first owned workspace; `topbar.tsx` displays its name.

**Suggested fix:** Do not substitute an unrelated owned workspace. Use a neutral product-level label or obtain the actual project workspace display label only if the access policy permits it.

**Confidence:** confirmed by source trace; signed-in browser confirmation not run.

## Attempts that did not complete or did not confirm a finding

- The first `npm test` invocation exited before tests because the clean worktree had no installed dependencies. After `npm ci --ignore-scripts`, the full suite was started against the disposable database but interrupted before completion; no full API count is claimed.
- The first route-list generator had a tuple-unpack error; the corrected generator found 95 routes and the prior 93-route matrix had no missing route.
- The first quota-transfer fixture did not create a workspace for its synthetic target, so PostgreSQL rejected a project insert with a not-null violation. The corrected fixture created that workspace and reproduced a successful transfer from a target count of 3 to 4.
- Three anonymous requests to an initially guessed Worker hostname failed DNS. The documented UAT Worker hostname was then used for the successful readiness/session/project checks. No UAT account or data was used.
- Gitleaks reported 249 redacted generic-key matches in the checkout and history. The values were not individually triaged; this audit does not treat the scan as proof of a real credential or as a clean scan.
