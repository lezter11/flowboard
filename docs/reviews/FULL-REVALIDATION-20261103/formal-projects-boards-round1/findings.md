# Independent projects / boards review round 1 — interim

Source under review: 611-file manifest digest `27db43d94d3a45bfea41b6d8e3cffba3e07bb6118e0c0b08437ab5b7c011910b`. All listed bytes matched before inspection (source-check-before.json).

## PB-01 — Member/Viewer can enumerate the unscoped project People identities

**Mandatory/privacy blocker under PRJ-05 / RBAC-04.** `apps/api/src/http/routes/projects.ts:480` authorizes project membership, and line509 defaults to `display` without requiring Owner/Manager or a board scope. `apps/api/src/adapters/rbac.ts:550` treats absent board scope as eligible, and line574 returns every active project identity for display.

Reproduction actually executed by this independent reviewer: create isolated synthetic lifecycle schema, delete every board grant for Member, GET `/api/v1/projects/prj/members` returns403, GET `/api/v1/projects/prj/people` returns200 and all four project actors with IDs, names, avatar fields, project roles and eligibility flags. See unscoped-people-probe.test.ts and unscoped-people-probe.log. Custom test exits1 at its privacy assertion. No hosted or real-user records used.

Impact: a project Member/Viewer bypasses the latest Owner/Manager full directory restriction with the older display endpoint, even without any board access. Only explicitly authorized board-scoped assignee/mention picker identity sets were preserved by the new requirement.

Counterevidence: no emails are returned here. `/members` correctly returns403; the existing People policy suite verifies that endpoint and authorized scoped pickers and passes. That does not cover this alternate unscoped enumeration.

Repair: enforce the current directory policy for unscoped/default display before querying identities, and keep legitimate assignee/mention operations dependent on an authorized board/card. Explicit display with a board scope also needs a deliberate effective-access filter if retained. Add direct Member/Viewer no-board and zero-grant regressions; then rerun on a new frozen target. Do not weaken the acceptance criterion to make this route pass.

## Executed verification so far

- invitation-repair.test.ts:12 tests passed, exit0 (invitation-independent-escalated.log). Initial sandbox connection EPERM attempt is separately preserved; it is an environment failure, not an app defect.
- boards-lifecycle-repair.test.ts plus people-directory-policy.test.ts:19 tests passed, exit0 (boards-people-independent.log). Includes soft retirement/history, bounded placement, actor/access revision cursors, archive administration, direct-SQL deadlock/REPEATABLE READ backstops, archive OCC/replay, People demotion interleavings.
- New unscoped People adversarial probe:1 test failed, exit1, confirmed above.

## Status and limits

Review is not passing. Full required-command results and final immutable evidence manifest are pending. Other project/board source paths are being inspected; no comprehensive UI/browser or hosted/integrated closure is claimed. Formal scores/record will bind the final declared target when supplied. Shared independently executed mandatory logs will be identified as executed by their separate reviewer, never presented as this reviewer's own command executions.
