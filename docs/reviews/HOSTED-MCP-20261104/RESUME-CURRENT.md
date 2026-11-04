# Hosted connector — active continuation

2026-11-04. User resumed full build/review/UAT; the old22minute limit is no longer active. Production is excluded. Workspace branch `codex/hosted-mcp-browser-signin`, prior local checkpoint `b78f21836d29daf814a2999a22acd34db5680875`. Existing live UAT remains `d1c81f42fe306c352c9cb10f04883e251ead58bd` until explicitly promoted.

## Implemented and held

Backend OAuth/transport/API passed phase-only independent review9.1 and root validator. That record is historical after subsequent API safe-next/Google edits; final complete acceptance is required. UI consent `/connect`, personal Settings→Connections for all roles, canonical metadata/servicebinding proxy and safe Google continuation are implemented. Builder web343/APIresume7/typecheck/production20page export pass. Actual Chrome24/24 passed with no source/console/network/privacy errors, then the HUI13 fixture alone changed to a100character unbroken app name for the final independent run. Stable browser runner SHA `c3c4246e5f2898f6426218cb0beb562789833f8cca07bf46efa1e8c042ad8c25`. All product/test source is held.

## Final gate in progress

Main independent reviewer `/root/hosted_mcp_security_review` owns final-preparation/ and a fresh six-DB disposable PostgreSQL17.11 container. First final attempt was invalidated when the independent Pages probe needed harness corrections (not product edits); preserve it. The complete17commands must run against a new frozen target after the final probe hold. This includes original14commands, stable hosted browser24cases, actual compiled Pages6checks, and production Worker guard/rate-limit probe. All98baseline backend records are stale; final omnibus review must honestly cover102original+24backend+15UI statements and bind current source. Do not clone old scores or run old hardcoded phase revalidation.

Independent Pages reviewer `/root/hosted_mcp_ui_review` final harness SHA `fcdbcd784e1b8065bba5da03868af6c6313908359cf4998739dec33aa6293122`. Diagnostic6/6passed, no source drift/DBI/O, actualChrome effective noReferrer proof. It will repeat on the fresh gate's rebuilt static out. Two failed harness attempts preserved. Agent scripts and product source must remain held during checks.

## Release safeguards and remaining steps

1. Finish17commands and both independent source reports; validate final review record, then truthfully refresh98Backend/74requiredUI/98localIntegration handoffs and regenerate checklist.
2. Commit a clean reviewed candidate; push authorized UAT source and wait green Linux CI. Existing GitHub workflow verifies only, never deploys.
3. Clean detached candidate + installed exact lock. Explicit `NODE_ENV=production` builds, no testDB/NEXT_PUBLIC environment. Never deploy earlier test-mode Worker bundle. Probe production-only guards before upload.
4. Release helpers in release-preparation/ were prepared and primary-reviewed only. Use current explicit-production prepare-artifacts revision; old preparation manifests are historical for changed helper. Refresh approved encrypted external UAT backup, verify, apply ONLY reviewed0027 after exact identity/ledger1–26 checks. No secrets/dump/key/raw provider error output.
5. Deploy Worker ONLY `--env uat` and Pages ONLY project `flowboard-app-uat`, branchmain within that UAT project. Record artifact/version/rollback IDs, bounded anonymous smoke and actual hosted cases separately.
6. Publish colleague-friendly URL/Google/project consent guide. Real Google/Claude and long-duration refresh acceptance remain distinct from synthetic evidence. Stop only owned Docker/processes; report safe laptop closure.

Known UAT identities/old versions and prepared commands are in release-preparation/RELEASE-PLAN.md. CLI access was reverified; production untouched. Preserve preexisting untracked FULL-REVALIDATION-20261103/CI-PORTABILITY folders. No commit/push/deployment of the new feature has occurred yet.

## Latest gate update — 2026-11-04

- Initial final attempt invalidated by reviewer Pages-harness repairs (not product changes), preserved.
-615target: fullAPI1907/1907 passed, ROOT typecheck failed on Google test tuple inference. UI repaired only test with readonly tuples and all6builderchecks passed.
-616target: failfast11checks passed (root/webTS, contracts137, web343, MCP, builds/artifact/OpenAPI/parity), then `npm run test:mcp-integration` failed before probes because `apps/web/functions/api/[[path]].ts` imports `pages-api-proxy` without `.ts` under nativeNode24. FullAPI/browser/prodartifact later steps not run on616.
-UI builder is repairing bounded explicit `.ts` helper imports and running actual native MCP integration plus quick gates on own disposablePG before new hold. Main reviewer retains failed targets and will report retry/escalation count. Do not bypass the gate.
-Supplemental actual NameStep probe3/3 passed on615. Parameterized v2 source heldSHA124b9ea8a43c00db332308de041c5fb0bfc86956fe683871611f2ce6075ffe11; after newfreeze use FLOWBOARD_UI_REVIEW_SOURCE_MANIFEST +FLOWBOARD_UI_REVIEW_PAGES_STAGE to rerun on current target. Independent compiledPages6/6 passed prior targets and repeats after each current rebuild.
-Root prepared detached build worktree `/private/tmp/flowboard-hosted-release-prepared-20261104` atb78. Sanitized offline `npm ci --include=dev --ignore-scripts` installed329packages; native esbuild/Next/Wrangler/workerd/sharp verified. Root lockfile matches. Must checkout exact reviewed finalcommit and reverifylock before clean artifacts.
-Current Pages project has NO Git integration; GitHub pushes only verify. CanonicaloldUAT deployment remains4dbcd83f/d1c81f4. Manual UAT uploads required afterCIgreen.
-User just asked ETA; answered35–50minutes IF nextgate passes: local10–15, Linux10–15, backup/deploy/smoke5–10, then owner realGoogle/Claude test. No timing guarantee and no new UAT deployment yet.
