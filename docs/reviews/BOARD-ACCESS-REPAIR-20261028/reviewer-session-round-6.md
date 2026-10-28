# Independent board access acceptance review — round 6

## Actions

Verdict: **fail**. BAR6-01, BAR6-02 and BAR6-03 group four confirmed mounted read paths that return private data after committed access removal. No application source, maintained tests, contracts, migrations or frozen criteria were edited by this reviewer. Earlier failed records remain preserved.

Independent `npm run check` completed exit 0: typecheck, Node compilation, Worker dry-run build, **364 API tests and 41 contract tests**, zero skipped. Independent race probes completed exit 0 by asserting the defects; successful reproduction does not constitute acceptance.

## Independence and exact target

Reviewer actor `/root/backend_gate_round6`, session `orchestration-task:/root/backend_gate_round6`, was freshly dispatched and did not implement this target. Builder actor `/root`, session `parent-chat-current-turn:/root`. Inherited model is Codex GPT-6 family; exact variant and opaque provider session ID unavailable. Task identifiers name actual orchestration roles. This review follows directed repair authorization, not an automatic score retry.

The source/configuration/requirements inventory covers 132 files captured before checks. The final record includes that inventory, real command logs, the independent probe source, and this report. Parent confirmed the source findings and began directed repair before JSON finalization. The routes/projects.ts bytes already differ; this historical failed record deliberately retains the captured pre-repair source hashes. Current-byte validator mismatch is expected and does not authorize current code. The JSON's manifest identifies the exact target; later repair invalidates this failed target, which can never approve a handoff.

## Reproduction method

`reviewer-probes-round-6.ts` creates a random schema in the authorized disposable `flowboard_access_test` database on 127.0.0.1:55479, applies all real migrations and seeds synthetic sessions, actors, project, board and grant. Every authorization change uses a real mounted HTTP handler and commits before the pending reader resumes. A wrapper pauses only before dispatch of a selected later SQL statement, exposing the normal asynchronous interval after earlier authorization. It forwards unchanged SQL and parameters to real PostgreSQL, never substitutes results, roles, permissions or HTTP decisions. Assertions independently query committed grant state where appropriate. Each fresh request after removal returns 404, contrasting with the pending request's 200. Cleanup drops the random schema, closes pools and clears global pool state.

The first probe attempt had an invalid synthetic card fixture missing required state and stopped before exercising application behavior. The fixture was corrected to `active` and the complete probe rerun exited 0. This was an independent evidence fixture correction, not an application/test repair. The initial sandbox suite could not connect (EPERM); its separate log is not acceptance evidence. The authorized rerun completed exit 0.

## BAR6-01 — high — board people picker returns identities after grant removal

Mounted GET `/api/v1/projects/p/people?boardId=b&purpose=mention` authorizes project membership using a pool (routes/projects.ts:351-369). `getProjectPeople` reads board ownership and active grants into `boardEligibleIds` (adapters/rbac.ts:452-472), then separately loads project identities (475 onward). There is no transaction-held actor/grant guard or final authorization.

Pause before the `WITH project_context AS` query after eligible IDs were captured. Submit mounted DELETE `/api/v1/boards/b/grants/:actorId` as Owner with the real access revision; assert 200 and zero current grants for actor. Resume the picker. It returns 200, Owner and removed actor identities, with the removed actor still marked assignable/mentionable. Fresh identical read returns 404.

Impact: a revoked board actor receives board-specific identity eligibility after committed revocation. This contradicts mandatory current board-derived read filtering. It does not expose a board title in this probe, but the picker itself is a board-derived private read and its cached assignment permissions are incorrect.

Fix direction: transact the route, lock current project authority and the selected board grant with `lockBoardAccess` before loading candidates, and retain through response assembly. Locking only project membership does not protect against board grant removal. Add a maintained mounted revocation regression for the picker.

## BAR6-02 — high — project people and directory leak after membership removal

Mounted GET `/api/v1/projects/:id/people` caches `resolveProjectRole` before a later identity query (routes/projects.ts:351-371), without a current actor predicate in the query. Mounted GET `/api/v1/projects/:id/members` calls `getProjectMembers` with a pool (routes/projects.ts:328-338); the adapter caches ownership/membership at adapters/projects.ts:355-384, then fetches member and Owner identities/emails at 386-424.

Independently exercise both mounted paths. Pause the people CTE or directory membership query after authorization. Submit mounted DELETE project membership as Owner, wait for HTTP 200, resume the reader. Both return 200 after removal; directory includes the Owner's synthetic email. Both fresh reads return 404.

Impact: a revoked project actor can recover current private identities and email. These are adjacent project-authorization paths in the declared RBAC review scope. No unauthorized write is alleged.

Fix direction: hold the workspace ownership and actor membership guards across data selection, or evaluate actor authority in the same data statement. Reuse one project permission primitive and add maintained mounted tests for both aliases, including Owner transfer and membership removal.

## BAR6-03 — high — workspace project list caches Owner across transfer

Mounted GET `/api/v1/workspaces/w/projects` reaches `getWorkspaceProjects`. adapters/projects.ts:66-74 resolves and caches `isOwner`, then lines 98-105 select projects using only workspace ID, with no current owner predicate or permission lock.

Pause before the Owner branch project SELECT. Submit mounted POST `/api/v1/workspaces/w/transfer-ownership` with the current version; wait for HTTP 200. Resume list: former Owner with no project membership receives 200 and `Private Project`. A fresh identical list returns 404.

Impact: ownership transfer does not revoke this in-flight reader's access to private project identifiers/names. Although this is project rather than board data, the explicit project-only boundary and scoped RBAC acceptance require the adjacent path to fail closed.

Fix direction: use a single current-owner-or-active-membership query, or hold a workspace ownership guard through listing; avoid cached Owner branches. Add a maintained mounted ownership-transfer regression for workspace listing as well as existing board-list and summary regressions.

## Repaired and adjacent paths reviewed

BAR5-01 access-summary now uses a transaction and `lockProjectBoardReadScope` through `getProjectAccessSummary`; the maintained ownership-transfer regression runs in the independent full suite. Board listing uses the same scope guard. The binary image route reapplies current role/state after storage and holds final board/current-card guards. No new image finding is alleged.

The mounted card reader performs a final current board permission query after counts and identity enrichment; this defeats straightforward grant-removal/owner-transfer intervals before delivery. Mounted comment list holds `lockBoardAccess` throughout later comment, mention and identity queries. Board snapshots, search/My Tasks, project activity/inbox, image metadata, imports and Trash were traced to their mounted transaction/current authority mechanisms and relevant full-suite tests. Shared write-grant and receipt helpers reauthorize and retain current ownership/membership/grant guards. Board-grant administration is Owner-only; missing schema does not authorize a project-only fallback. Node and Worker wiring share mounted handlers and PostgreSQL pool setup. This read-through and passing suite are evidence of checked paths, not exhaustive race proof for every branch.

Known limitations: per parent direction, further adversarial probes stopped once the grouped mandatory blockers were demonstrated. This round does not approve unprobed state transitions or all adjacent writes. A new round must review the repaired full affected surface, including card/comment readers, rather than treating this report's absence of further findings as proof. No dependency-advisory lookup, hosted deployment, live-user data, Hyperdrive/R2 service validation or performance claim.

## Why and options

If Sam loses a board grant while the people picker is loading, the picker must not still tell Sam who can work on that board. A permission guard gives read and revocation a definite order: either read finishes while authorized or it observes removal. A short database transaction costs a little locking; a carefully written single query is another option. Saving an earlier permission result across later queries leaves the gap demonstrated here.

## Evidence and limits

The complete suite independently passed locally; it did not contain these four mounted regressions. Probe logs show real committed removal followed by private 200 responses, and fresh requests denied. Scope digests detect changed bytes but cannot prove identity or complete coverage; Architect must inspect the findings and their counterevidence independently. This local failed record is not hosted, UI or integration acceptance.

## Next / your input

Keep Task1 and matching handoffs open. Parent independently inspected and confirmed the source paths and began directed repair. Freeze a new exact target after directed repair and maintained regression tests; do not overwrite this failed round. No action needed from the user for preserving this record.
