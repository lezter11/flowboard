# Flowboard working checklist

Updated 2026-11-04. **Current phase: local repair and review passed; exact-candidate CI and UAT deployment next.** This sequence complements [TASKS.md](TASKS.md), the 98 product definitions in [features.tsv](docs/features.tsv) and their [generated checklist](docs/FEATURE_CHECKLIST.md).

## Current release checklist

- [x] Implement hosted browser sign-in, project consent and personal Connections UI. The existing five tools remain discovery, search and card creation.
- [x] Repair the original Linux XLSX failure while retaining the 1,000 ms budget, original workbook and security assertions.
- [x] Pass the independent full Linux API suite: **1,926/1,926**, no failures or skips, on the held source. Earlier environment failures are preserved.
- [x] Pass the other 16 local checks and compiled Pages checks: hosted browser **24/24**, compiled Pages **6/6**, source unchanged.
- [x] Finish the complete 19-command gate. The final exact Linux composite exited 0 after explicit scratch setup corrections; failed attempts remain preserved.
- [x] Receive and validate the fresh independent **8.935** review, then refresh all 98 local role handoffs and the generated checklist. The earlier 8.965 review is historical.
- [ ] Commit the reviewed candidate and push **once to `uat`**; wait for required GitHub CI to pass. Do not push a second branch and create duplicate CI runs.
- [ ] Build clean production artifacts, verify dependency provenance, refresh the approved encrypted UAT backup and apply only reviewed migration 0027.
- [ ] Upload exact UAT Worker and Pages artifacts; verify deployed identity, hashes and bounded anonymous probes.
- [ ] Complete real Google/Claude and signed-in product acceptance with the owner. Local synthetic checks do not close hosted acceptance.

Current source and logs: [active checkpoint](docs/reviews/HOSTED-MCP-20261104/RESUME-CURRENT.md), [frozen repair criteria](docs/reviews/HOSTED-MCP-20261104/linux-xlsx-repair/CRITERIA.md), [strategic plan](docs/HOSTED_MCP_PLAN.md) and [connector contracts](docs/HOSTED_MCP_SPEC.md). The old 22-minute checkpoint is historical; the user resumed the full task.

**Live UAT remains `d1c81f4`.** No new backup, migration 0027 or connector deployment has occurred. Docker is stopped after completed local verification. This Mac is still needed for the remaining release commands; announce safe laptop closure after release work is complete. Production is excluded.

## Earlier release: live deployment position

- Completed: physical organization, all14Linux gates, current independent/owner98Backend/74UI/98localIntegration, encrypted backup, UAT migrations1–26 and exact image-retention rule correction.
- Current: Worker and Pages deployed exactd1c81f4; independent anonymous smoke15/15 passed. The upload network issue was resolved with IPv4-first Node DNS.
- Next: execute signed-in product/Claude tests in [UAT_TESTING.md](docs/UAT_TESTING.md). [Saved checkpoint](docs/reviews/FULL-REVALIDATION-20261104/CHECKPOINT.md).
- Laptop: **safe to close**. Hosted UAT stays available; local Claude MCP needs this Mac awake.

## Rules for completing a task

Work on the first ready unchecked item. Parallelize independent work with explicit file ownership; Architect coordinates shared contracts and evidence generation. Record **ID · exact source/manifest · changes · commands/exits · evidence · independent verdict · limits** when an item completes.

Backend closure follows [BACKEND_REVIEW_GATE.md](BACKEND_REVIEW_GATE.md): independent reviewer, score strictly above 8.5, category minimums, no blockers and passing required checks. Preserve failed rounds; follow the three-failure escalation rule. Never clone old ratings onto new source. Implementation, local verification and hosted acceptance are separate states.

Release order for this task is **local gates → direct UAT deployment → hosted acceptance**, per the user. There is no dev stage; production is excluded. Keep secrets/backup data/keys outside Git and output. Preserve unrelated work and frozen evidence. Use Docker only for necessary disposable local checks, including the Linux repair; stop owned resources afterward. Routine remote CI does not require Docker on this Mac.

## Existing UAT baseline facts

| Item | Observed / recorded state |
|---|---|
| Active source | Candidate `d1c81f42fe306c352c9cb10f04883e251ead58bd`, `codex/mcp-uat-hardening`, published to GitHub `uat`; organization/evidence documents remain uncommitted |
| Added folders | Main checkout and archived MCP/Gemini HEADs are ancestors of active source. No missing commits need merging. [Map](docs/PROJECT_MAP.md), [MCP provenance](docs/MCP_PROVENANCE.md). |
| Initial Linux failure | Eleven test fixture errors used Mac-only `/private/tmp`. Seven test/support portability/cutoff repairs are committed at `bf047e0`; CI is not thereby proven green. |
| Resolved pre-repair CI failure | [Run 41685962254](https://github.com/lezter11/flowboard/actions/runs/41685962254), [import-worker-template.test.ts:162](apps/api/test/import-worker-template.test.ts#L162): 422 `PARSE_BUDGET_EXCEEDED`, expected 201. The broad blank-template test title is misleading: this assertion exercises **200 legal rows × 20,000 escaped ampersands per description**, near 20 MiB expanded XML. Root cause is unproven. This pass inspected source and supplied failure, without fetching a fresh CI run. |
| Historical acceptance | `c1ccbf8` passed 14 local commands and 98 Backend / 74 required UI / 98 local integration bindings. [Historical gate](docs/reviews/FULL-REVALIDATION-20261103/LOCAL-RELEASE-GATE.json). Changed tests require current-source approval. |
| Current product checklist | 98 total; after current independent review and owner phase revalidation the generated checklist reports Backend98 / requiredUI74 / localIntegrated98. Hosted acceptance remains pending. Do not manually edit generated boxes. |
| UAT | Current UAT ledger26 confirmed: reviewed0020–0026 applied. Exact unsafe staging expiry rule removed; multipart-abort604800 retained. Worker/Pages deployed exactd1c81f4; independent anonymous smoke15/15passed. Signed-in acceptance pending. [Prior release state](docs/reviews/FULL-REVALIDATION-20261103/UAT-RELEASE-c1ccbf8/deployment-state.json). |
| Backup / Docker | User-approved encrypted local UAT backup exists outside Git; refresh before migration. Flowboard review container was stopped; no Docker changes in this pass. |

## Phase 1 — understand and organize

- [x] **ORG-01 — Inventory the four task-relevant worktrees.** Owner: Architect + survey agents. Verify paths, branches, HEADs, ancestry and local changes; avoid private configuration. [Before/after inventory](docs/project-organization/2026-11-04-inventory.json).
- [x] **ORG-02 — Explain inherited MCP implementation.** Owner: provenance agent + Architect. Trace original commits into active `packages/mcp`; document retained tools, repairs and future capabilities. [Provenance](docs/MCP_PROVENANCE.md).
- [x] **ORG-03 — Repair moved-worktree registrations.** Owner: Architect. Point Git at the existing nested folders; verify unchanged branches/HEADs/source and clean nested checkouts. Preserve temporary audit registrations. No pruning, physical moves, deletions or merges. Evidence: inventory command result and registry snapshots.
- [x] **ORG-04 — Organize navigation and reconcile status.** Owner: Architect + documentation reviewer. Provide this checklist, README, project map and editor workspace; correct stale current-status wording in TASKS/PROGRESS. Preserve source and frozen evidence paths. Validate links, JSON, whitespace and application/database/package/script hashes. [Verification](docs/project-organization/2026-11-04-verification.json).

- [x] **ORG-05 — Physically separate historical checkouts and provide a human document shelf.** Both old worktrees moved with Git into main `archive/worktrees`; the empty old contracts directory was preserved under `archive/retired-layout`. Main `project-docs` has 14 numbered links to current documents. Eight reversible Finder visibility flags reduce root clutter while canonical paths remain intact. Verified 5,491 tracked paths with zero content mismatches; historical worktrees stay clean. [Move/undo journal](docs/project-organization/2026-11-04-restructure.json).

## Phase 2 — fix CI

**Current execution:** three-file decoder repair `d1c81f4` passed complete [Linux CI run41777804549](https://github.com/lezter11/flowboard/actions/runs/41777804549). Eight fresh independent reviews pass for all98 IDs; owner acceptance verified1570per-IDsource/testhashes,98Backend/74UI/98localIntegration. [Owner phase evidence](docs/reviews/FULL-REVALIDATION-20261104/owner-phase-revalidation/summary.json). Existing parser limits are unchanged. [Builder evidence](docs/reviews/FULL-REVALIDATION-20261104/ci-xlsx-repair/handoff.md). These are focused test counts, not totals to add together or full-feature closure.

- [x] **CI-01 — Preserve and reproduce the Linux XLSX failure.** Owner: Backend. Depends on ORG-04. Capture full CI logs and exact target; reproduce the maximum-length case through real workerd on Linux. Measure decompression, XML validation/entity decoding, allocation and elapsed-budget checks. Distinguish CPU work, scheduling and other hypotheses before selecting a fix. When needed use disposable PostgreSQL on a free port, synthetic data, recorded image/port and command exits. No hosted database for tests.
- [x] **CI-02 — Implement the smallest proven repair.** Owner: Backend; Architect coordinates shared changes. Depends on CI-01. Freeze criteria first. The legal workbook must retain all rows/text and pass; malformed/oversized/deep/expanding XML must remain bounded and rejected. Preserve blank-template and atomic import behavior. Do not simply raise budgets, remove the boundary fixture or weaken assertions/security limits. Improve misleading test naming/diagnostics where appropriate. Keep failing-before/passing-after evidence and failed attempts.
- [x] **CI-03 — Run focused runtime and neighboring regressions.** Owner: Backend + independent verifier. Depends on CI-02. Exercise import/Worker/security/lifecycle accepted and rejected boundaries, temp-path portability and isolate usability after rejection. Record actual counts, unexplained skips and exits. Wall-clock timing is not a hosted CPU/memory benchmark.
- [x] **CI-04 — Complete every required candidate check on Linux.** Owner: Architect/CI. Depends on CI-03. Run all 14 required commands from the release plan/workflow against one exact candidate; record source/artifact hashes, CI links and exits. Steps skipped after earlier failures remain unverified. Publish through the authorized UAT branch/release process when needed; publishing code is separate from deployment.

## Phase 3 — independent review and evidence closure

- [x] **REV-01 — Freeze and independently review the repaired candidate.** Owner: Architect + reviewers who did not build the relevant changes. Depends on CI-04. Review the changed harness and complete reachable functionality using unchanged criteria/category floors. Issue actual current-target records; preserve attribution for historical probes. Require strictly >8.5, no blockers and passing required checks. Preserve failed rounds and obey escalation limits.
- [x] **REV-02 — Rebind role-owned evidence and regenerate product status.** Owner: Backend/UI/Architect for their handoffs. Depends on REV-01. Validate matching manifests and review paths with repository tools; regenerate from all 98 stable IDs. Inspect generated changes. Every locally closed feature needs applicable evidence; provider/hosted cases stay UAT pending. Do not copy historical ratings to manufacture approvals.

## Phase 4 — UAT preparation and deployment

- [x] **UAT-01 — Verify destinations and rebuild exact approved source.** Owner: release. Depends on REV-02. Recheck GitHub/Cloudflare/Neon resource identities without printing credentials. Capture existing deployed UAT artifacts before replacement. Build a clean named commit and bind artifact hashes; previous c1 artifacts are not automatically new-commit artifacts. Worker target: `--env uat`. Pages project: `flowboard-app-uat`, canonical `main` branch within that UAT project. Never use bare Worker deployment: its top-level target is production.
- [x] **UAT-02 — Refresh and verify the encrypted UAT backup.** Owner: release. Depends on UAT-01. Reuse the user's approved local encrypted-backup method; keep data and key outside Git/output. Verify archive integrity/authenticated decryption and record whether an actual restore ran. Refresh immediately before migration; old verification does not establish a current snapshot.
- [x] **UAT-03 — Apply only reviewed missing UAT migrations.** Owner: Backend/release. Depends on UAT-02. Verify UAT Neon branch/database and actual migration ledger, inspect compatibility and recovery steps, apply only reviewed missing migrations (last recorded: 20–26), then verify ledger and exits. Local migration filenames do not establish hosted state.
- [x] **UAT-04 — Correct the exact unsafe UAT image lifecycle rule.** Owner: release. Depends on UAT-01; may prepare alongside UAT-02. Capture before/after on `flowboard-images-uat`; remove only the `staging/` delete-after-86,400-seconds rule, preserving the 604,800-second multipart-abort policy. Finalized images retain staged keys, so the old rule could delete valid images. Complete and verify before new Worker traffic. No production storage changes.
- [x] **UAT-05 — Deploy reviewed Worker and Pages artifacts.** Owner: release. Depends on UAT-03 and UAT-04. Record commit, artifact hashes, Worker version, Pages deployment and runtime configuration. Run bounded health/proxy/session-boundary checks; record rollback steps. Upload success is deployment evidence, not complete hosted acceptance. Production stays untouched.

## Phase 5 — hosted acceptance and handoff

- [ ] **HOST-01 — Test core product behavior on the new UAT build.** Owner: Architect + owner/tester for real-provider cases. Depends on UAT-05. Use synthetic projects/actors. Cover real Google/session/logout; Owner/Manager/Member/Viewer and project/board-grant isolation; invitations/delivery/retry; create/self-assign/edit/move/reload; mentions/inbox/People privacy; private-image access/revocation/durability; 24-hour trash/restore and scheduled cleanup; import preview/commit/rejections. Record pass/fail/not-run, deployment IDs and role context. Time-dependent cases stay pending until observed.
- [ ] **HOST-02 — Test MCP end to end from Claude.** Owner: tester + Architect. Depends on UAT-05; parallel with HOST-01 on separate fixtures. Update [MCP testing guide](docs/reviews/FULL-REVALIDATION-20261103/MCP-UAT-TESTING.md) for the exact new build. Cover five tools/paging; explicit project/board/column selection; required scopes/current access; wrong-project denial; PAT denial from session/profile/credential administration; identical-operation one-card replay; changed-input conflict; lost-response retry after process restart; membership/board-grant removal and token revocation. Resolve uncertain creates before rotation: seven-day receipts are credential-scoped and do not carry across credentials. Never paste tokens into chat or commit them.
- [ ] **HOST-03 — Close supported acceptance and publish the handoff.** Owner: Architect. Depends on HOST-01 and HOST-02. Update actual hosted evidence, feature inventory and testing instructions; leave failures/not-run cases open. Link exact deployment/review records. Explain what shipped, risks and owner actions. [Existing inventory](docs/reviews/FULL-REVALIDATION-20261103/IMPLEMENTED-FEATURES-UAT.md) describes a candidate, not proof of deployed acceptance.

## Separate future work — not shipped or part of the CI fix

- [ ] **NEXT-API — Company machine-to-machine integration.** Specify installation identity, OAuth client-credentials/token lifecycle, least-privilege project/board grants, rotation/revocation, permanent external-issue identity, create/update/retry semantics, rate limits and audit provenance. Example: one fleet compliance incident becomes one card even after a retry or credential rotation. Start from [the integration decision](docs/decisions/2026-11-03-integration-destination-and-machine-identity.md); independently review before closure.
- [ ] **NEXT-MCP — Existing-card update / remote transport, if selected.** Current MCP is local stdio discovery/search/create only. Specify update/version conflicts and remote MCP authentication separately; ordinary API edit routes do not imply MCP update support.
- [ ] **NEXT-ORG — Additional cleanup after ownership review.** Historical worktrees and the empty contracts directory have been physically archived (ORG-05). Further consolidation is deferred. Check references, local edits and evidence dependencies before individual archive/cache/log/worktree removal proposals. Use Git worktree operations, not ordinary duplicate-folder deletion. No bulk deletion, evidence moves or branch removal is implied by the completed navigation work.

## Next task

Complete the unchecked current-release items above. Earlier release tables below describe the already deployed `d1c81f4` baseline and are not approval of the new connector.

## GitHub Actions budget — user instruction, 2026-11-04

The user reports a 2,000-minute monthly free Actions allowance and asks us to conserve it. Do not use hosted full CI as a debugging loop. Reproduce/prove repairs locally on Linux, including the original failing boundary case and neighboring security checks, then trigger the required final candidate CI. Avoid intermediate pushes/workflow dispatches that waste minutes; do not bypass a required release gate to save quota. Current remaining account allowance was not queried. Existing workflow concurrency cancels superseded runs.

Historical trigger: candidate `77a9fbb` failed GitHub run `41844757342` in 1 of 1,907 API tests: maximum legal escaped descriptions exceeded the unchanged 1,000 ms parse budget. The bounded local repair is tracked above. Do not remove the fixture, increase security limits, reuse the historical score or bypass required CI to save quota. The remaining account allowance has not been queried.
