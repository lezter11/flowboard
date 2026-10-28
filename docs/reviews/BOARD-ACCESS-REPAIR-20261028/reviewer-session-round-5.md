# Independent board access acceptance review — round 5

## Actions

Verdict: **fail**, unrounded weighted score **8.105/10**. BAR5-01 is a confirmed mandatory blocker: mounted project access-summary exposes a hidden board count after committed ownership transfer. Parent independently inspected the route/helper and confirmed the finding. No application source, maintained tests, contracts, migrations or frozen criteria were edited by this reviewer.

Independent `npm run check` completed exit 0: typecheck, Node compilation, Worker dry-run build, **363 API tests and 41 contract tests**, zero skipped. Additional independent probes exited 0 by asserting repaired image behavior and the newly reproduced defect; reproduction success is not application acceptance.

## Independence and exact target

Reviewer actor `/root/backend_gate_round5`, session `orchestration-task:/root/backend_gate_round5`, is a freshly dispatched reviewer subagent that did not implement this target. Builder actor `/root`, session `parent-chat-current-turn:/root`. Inherited model is Codex GPT-6 family; exact variant and opaque provider session ID unavailable. Task identifiers name actual orchestration roles. This review followed directed repair authorization after previous failed rounds.

The source/configuration/requirements inventory covers 132 files and was captured before additional probes in this reviewer turn. Compared with round 4, only images.ts route and board-access.test.ts had changed at that time. Parent began its next directed repair before final JSON creation: current adapters/rbac.ts and routes/projects.ts no longer match this review. The record intentionally hashes the captured pre-repair source inventory for historical failed evidence, plus newly generated reviewer evidence/logs. It is not approval of the changed checkout. Validator current-byte mismatch is expected, in addition to the fail verdict. All earlier failed rounds remain unchanged. Record timestamps describe final preparation; commands ran earlier in this same reviewer turn.

## BAR5-01 — high — access-summary leaks board count after committed ownership transfer

Mounted GET /api/v1/projects/:projectId/access-summary calls getProjectAccessSummary with a pool and no transaction-held permission guard (routes/projects.ts:374-384 in captured target). adapters/rbac.ts:706-725 resolves actorRole before its count query, then supplies cached actorRole === 'owner' as a boolean bypassing board-grant filtering. There is no final current ownership/project-membership check before returning boardCount and cached Owner identity.

Reproduction in reviewer-probes-round-5.ts/log creates a fresh random schema in authorized disposable PostgreSQL, applies real migrations and seeds synthetic actors/project/board. A separate real connection holds ACCESS EXCLUSIVE on boards. Start mounted access-summary as Owner and wait through pg_stat_activity until its count query blocks, after resolveProjectRole returned Owner. Submit mounted POST /workspaces/w/transfer-ownership; assert HTTP 200 and independently verify workspaces.owner_id is the next Owner before releasing the relation lock. The pending access-summary returns HTTP 200, actor.role=owner, boardCount=1. The same actor's fresh request returns 404. No SQL result, authentication result or application decision was mocked.

Impact: a revoked former Owner without project membership/board grants receives the current hidden-board count, contradicting mandatory current authorization and non-enumeration. The relation lock exposes a genuine separate-statement interleaving; it does not fabricate a permission result. This is the access-revocation class fixed for board listing in round 3, still reachable through a summary alias. Stale project/owner/member metadata also returns; boardCount alone establishes this task's blocker.

Counterevidence: fresh requests correctly deny the former Owner, and sequential non-Owner counts apply explicit grants. Board listing holds lockProjectBoardReadScope and its maintained transfer regression passes. That boundary was absent from access-summary. No unauthorized write or hosted exposure is alleged.

Suggested repair: evaluate summary under current project-board read scope held through selection/response assembly, or an equivalent single-statement authority predicate without a cached Owner bypass. Preserve a maintained mounted ownership-transfer race and inspect similar summary/count aliases.

## Repaired and adjacent paths

BAR4-01 independently resolves on both mounted image content and thumbnail. Reviewer delays real MemoryStorageDriver.get containing synthetic bytes, commits mounted Manager-to-Member demotion, independently checks stored role, releases storage and asserts 404 with no private bytes. Fresh reads also return 404. getImageForDelivery re-applies lockBoardAccess and current active/trashed state after storage; FOR SHARE guards current membership, grant and card state at that final decision. Maintained regression additionally covers a card becoming trashed during storage.

Reviewed context includes createApp mounts, Node/Worker pool ownership, shared grant/replay boundaries, board/image readers, final card board reauthorization, transaction-wrapped activity/notification readers, summary/count aliases, grant-administration authority, migration 0007/0008 ancestry/no-backfill constraints and mounted board-access tests. Independent complete suite exercises roles, missing/revoked/sibling grants, reads/writes/replay, search/My Tasks, imports, Trash, activity/inbox and local workerd. Manifest inclusion does not mean every branch received exhaustive inspection.

## Why and options

A count is private data too. If Sam transfers ownership and has no project membership, Sam must not learn how many boards the next Owner has. Holding a permission guard while reading gives transfer and read a definite order. This costs a short database transaction; a single query can also work if it evaluates full authority with its count. An earlier Owner flag carried into a later query has neither protection.

## Evidence and limits

Only local synthetic PostgreSQL on 127.0.0.1:55479, isolated flowboard_harness/flowboard_access_test, was used. Initial sandbox suite could not connect (EPERM); reviewer-sandbox-attempt-round-5.log is not accepted evidence. Authorized escalated rerun completed exit 0 and has a separate log. Probe schema dropped in finally, pools closed and storage reset. Pre-repair source inventory is preserved exactly. No deployment, live-user data, hosted Hyperdrive/R2 validation, benchmark or dependency-advisory assurance. Exhaustive adversarial review stopped after a confirmed mandatory blocker; missing review cannot count as acceptance.

## Next / your input

Keep Task1 and matching backend handoffs open. Parent independently confirmed BAR5-01 and started directed repair. Freeze a new target for fresh review after repair; this historical fail cannot approve the current checkout, UI/integration or unrelated historical feature groups. No action needed from the user for this record.
