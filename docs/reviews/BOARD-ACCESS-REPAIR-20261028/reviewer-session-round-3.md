# Independent board access acceptance review — round 3

## Actions

Verdict: **fail**. The reviewer independently ran `npm run check`: exit 0, 360 API tests and 41 contract tests passed, zero skipped. Two additional mounted-handler probes nevertheless reproduced private-data delivery after authority removal committed. No production source, existing tests, frozen criteria, or builder logs were edited. Only new reviewer evidence in this directory was authored.

## Independence and target

Reviewer actor: `/root/backend_final_gate`, a newly dispatched reviewer subagent that did not implement the target. Reviewer session identifier: `orchestration-task:/root/backend_final_gate`. Builder actor: `/root`; builder session identifier: `parent-chat-current-turn:/root`. Neither opaque provider session ID nor the precise inherited model variant is exposed in this agent context. These identifiers describe actual orchestration roles, not invented provider UUIDs. The model is the inherited Codex GPT-6 family; exact variant unavailable. Parent confirmed the source and supplied complete-suite.log remained frozen. The final JSON includes the complete recursive source/test/migration/contract manifest plus configuration, requirements, review criteria and evidence. Record timestamps describe evidence-record preparation; command execution occurred earlier in this reviewer turn.

## Evidence and limits

Independent command environment: disposable PostgreSQL 17 at 127.0.0.1:55479, databases flowboard_harness and flowboard_access_test, synthetic users flowboard_harness and flowboard_test. The full suite used exactly the builder-confirmed isolated local URLs and ran typecheck, Node build, Worker dry-run build, API tests including local workerd, and contract tests. See reviewer-complete-suite-round-3.log. Initial sandbox run could not connect to localhost; the authorized escalated rerun completed exit 0. The probe fixture initially lacked required timestamps; it was corrected in reviewer-only evidence, then the final probe completed exit 0. Probe exit 0 means its assertions reproduced the vulnerabilities, not that the application passed acceptance.

### BAR3-01 — high — board list uses obsolete Owner authority

Source: apps/api/src/adapters/boards.ts:225-258; mounted GET route apps/api/src/http/routes/boards.ts:111-120. `listProjectBoards` resolves project role once using a pool, then branches to the Owner query. That query selects every active board without current ownership, active project membership or board-grant predicates. There is no surrounding transaction or workspace ownership lock.

Reproduction: seed a workspace Owner with no project membership/grant. On a separate PostgreSQL connection, hold `LOCK TABLE boards IN ACCESS EXCLUSIVE MODE`. Start the mounted GET /projects/p/boards as that Owner and verify its final boards SELECT is blocked using pg_stat_activity/pg_blocking_pids. Commit mounted POST /workspaces/w/transfer-ownership to another actor. Verify owner_id changed, then release the table lock. The pending GET returns HTTP 200 with board ID `b` and `Private Board Name`. A fresh GET from the former Owner returns 404. The private SELECT runs under the earlier cached role after ownership transfer has committed.

Impact: former Owners can obtain board IDs, names, versions and timestamps in an in-flight request after losing all authority. This directly violates current-access and non-enumeration mandatory criteria.

Counterevidence: sequential requests correctly return 404; board snapshots now hold workspace/grant locks, but the list route uses a different unprotected adapter. This is not an authorization mock: both read and ownership-transfer endpoints are mounted handlers and the synchronization is a real database lock.

Suggested repair: make board listings use one transaction-held workspace/membership/grant scope (including the implicit Owner branch), or an equivalent current-authority query with a defined consistent read boundary. Add the mounted ownership-transfer race to the maintained tests.

### BAR3-02 — high — trashed image list retains obsolete Manager role

Source: apps/api/src/adapters/images.ts:656-679; mounted GET route apps/api/src/http/routes/images.ts:260-282. The image list caches Manager role, checks that cached role for a trashed card, then fetches images. Its final `requireImageBoardAccess` verifies membership/grant but does not enforce the current Manager requirement for Trash; its returned role is discarded.

Reproduction: seed a Manager with a board grant, a trashed card and an image. Hold `LOCK TABLE card_images IN ACCESS EXCLUSIVE MODE` on another connection. Start mounted GET /cards/card/images and wait until the image SELECT blocks. Commit mounted PATCH /projects/p/members/:manager to role member, preserving active membership and board grant; verify role changed. Release the table lock. Pending GET returns HTTP 200 with `private-trash-image.png`, image/card IDs and totalCount 1. Fresh GET returns 404.

Impact: a demoted Member can receive restricted Trash image metadata despite the role change committing before the image query completes. The content/thumbnail path has the same cached-role and discarded-final-role pattern at images.ts:707-736, but byte delivery was not independently reproduced in this pass; do not describe that extension as confirmed runtime proof.

Counterevidence: active-board access remains valid after demotion, and the final grant check still passes by design. The failing property is the stronger Trash role requirement. New Trash-page demotion tests protect the Trash route only; they do not protect image endpoints. The probe uses real PostgreSQL and mounted read/demotion routes.

Suggested repair: serialize the full image read with the current workspace/membership/grant authority and apply Trash role/card-state checks within the same read transaction. Alternatively revalidate all relevant role/state predicates immediately before delivery under a consistent boundary. Cover list/content/thumbnail and owner transfer/demotion cases with maintained mounted tests.

## Other reviewed evidence and rejected candidates

- Prior BAR2-01 snapshot defect: source now begins a transaction and calls lockBoardAccess before payload queries; new mounted snapshot race passed in the independently rerun suite.
- Prior BAR2-02 malformed outbox scope: comment/card query binds project and workspace to the outbox row and live comment; the new malformed cross-project outbox test passed. This resolves that specific demonstrated path.
- Source traces included mounted routes from createApp, Node/Worker entry points and pool lifetime, Owner-only grant mutations, grant revisions, project-removal trigger, board snapshots/columns/archive/reopen, card search/My Tasks, comments, activity, inbox, image read/write families, import and Trash paths. Exact full source is inventoried even where this bounded pass did not fully re-probe every branch.
- Search/My Tasks now freeze and apply the locked board-ID set; off-page counts, two-board My Tasks, placement, Trash grant removal and Trash role-demotion cases all passed the independent full suite.
- PostgreSQL composite foreign keys reject mismatched board/project/workspace/card ancestry. Migration absence and legacy activity cases are exercised by the maintained suite. No fallback permission was inferred merely from a draft helper filename.
- A candidate based only on a delay after a final standalone permission query was not promoted to a separate finding: concurrency guarantees need a defined read boundary. The two reported probes instead expose stale decisions across actual subsequent data operations and omit an entire required current-role predicate.

No hosted deployment, live-user data, R2 behavior, production Hyperdrive behavior, performance benchmark or online dependency-advisory audit was performed. This is a local bounded acceptance failure, not a claim of complete security audit coverage. Review stopped after substantiated mandatory blockers at the Architect's request; remaining independent adversarial matrix coverage is incomplete. Architect was notified and asked to independently inspect the two paths before treating them as confirmed for closure decisions. No fourth review was initiated.

## Why and options

A permission check can become stale while a request waits for its data. For example, someone may open a board list just as ownership transfers. A transaction-held lock makes these operations take a clear order: either the old Owner's authorized read finishes first, or the transfer wins and the read is denied. The cost is brief waiting and careful lock ordering. Rechecking only board membership is insufficient when viewing Trash also requires Manager authority.

## Next / your input

Keep Task1 open. Preserve this failed round. Architect chooses the explicitly authorized repair scope and subsequent independent review; do not hand off this target as approved. No production deployment is authorized by this record.
