# Active CPU repair checkpoint

## Superseding checkpoint — 2026-11-05,13:05UTC

CompletedUATobserver:900.001sec/14ok/1scheduledok/0CPU/0exceptions/0HTTP5xx/1exactbaselineidlePGlabel; strictneeds-inspection retained; cleanuptrue, unifiedsession94375finished. Noauthtraffic; productionpromotionheld. NewexactOct29backupdeletionquestionpending; noapprovalattested/deletionexecuted. Current finalsummary/checklist `cpu-release-f32eafa/SUMMARY.md`. All earlier in-flight observer numbers below are historical. Laptop can close while inputgates pending; Docker off.

Current tested source is **f32eafae0f59bf1601d4a84e2a0e3208ae9db4bc**, pushed to remoteuat. One exact-candidate CI42027312917 completed all22steps successfully: API1966/1966, mounted/nativeMCP22/22groups, hostedbrowser24/24, legacybrowser14assertions+2observations. Local8groups, independentrouter62tests and fresh local browser suites passed; scopedreview9.09/global-localreview8.92 accepted and role handoffs regenerated with provenance retained. OwnedPGcontainer/privatefixture removed; DockerDesktop OFF. No further localDBtests pending.

Clean detached source `/private/tmp/flowboard-cpu-release-f32eafa`; stagedPages `/private/tmp/flowboard-cpu-uat-pages-f32eafa` and `/private/tmp/flowboard-cpu-prod-pages-f32eafa`. Exact reviewed WorkerbodySHA9bc6986e15691ad32aaf67b8490bf4dadcba01c769add4a0c42281beb4f1204d. UAT now deployed Worker **a3d243dd-7f80-447d-908b-1af466c1f46f**, Pages **549e766e-2c4f-4b3d-adbb-633384381347**, dirtyfalse/sourcef32/API→flowboard-api-uat; actual fetched Worker matches. Anonymoussmoke17/17,17requests. Receipts/checklist in `cpu-release-f32eafa/`.

Approvedredactedobserver unifiedsession94375, targetuat/versiona3d243dd, labelf32eafa-uat, started12:49:55UTC/900seconds. Interim13ok/0CPU/0exception/1knownidlePGlabel, no authenticated traffic yet. Final/progress files `cpu-observer-uat-f32eafa-uat*.json`. Do not claim completedhealthy from interim or exit0; exact knownbaselinewarning staysneedsinspection with explicitArchitectdisposition separate. Owner was invited to exercise UATsignedin; productiontest deferred by Owner. No actualGoogle/Claude acceptance can be inferred.

Production remains rolledback: Worker756fdc6e / Pages876eacf4/source3a82b24. Ledger27 retained: NEVER rerun migrations20–27. Retry requires UATrepresentativeCPUgate and freshbackupdisposition. Fresh12:52UTC readonlyNeoninventory10branches/21600sPITR. Currentproductionbackup br-fancy-dream-a15hpqam is10:57schema19/pre-later-writes; runbookrequiresfreshschema27snapshot beforeeverydeploy. PriorpermissionwasONLYalreadydeletedOct28UATbackup. Oldest remaining eligibleUATsnapshot inventory candidate br-damp-poetry-a1gfbcvn / uat-backup-2026-10-29-d6 has0children, itsownidlecompute ep-bold-hill-a1mlmaly; **NOTauthorizedfor deletion**. Independent operations disposition in `operations-review/release-check/code-only-retry-backup-disposition.md`. Do not copy productiondata locally or changepaidsettings.

The remaining earlier body below is historical first-checkpoint detail, superseded by this block and current receipts.

User authorized production promotion and specifically approved deleting only old UAT backup br-lingering-field-a1hfhs5o. That deletion and fresh production backup br-fancy-dream-a15hpqam succeeded. Migrations20–27 were applied successfully; ledger27 remains after code rollback. Do not rerun migrations or restore data.

Application40e51e1 was briefly deployed, exact bytes/Pages metadata verified and public17/17smoke passed. Sustained observation then captured16exceededCpu/41exceptionentries. **Production is restored to Worker756fdc6e / rollbackdeployment85a8828e and Pages876eacf4/source3a82b24**; postrollbackhealth2/2 passes. Gitmain was not promoted. UAT remains40e51e1 with the prompt help. CurrentrootGitHEAD54585ab is the previous docs checkpoint; the new incident/repair records are not committed yet.

## Held product repair

Backend builder `/root/cpu_router_builder` (fresh GPT6.1Sol/medium) changed only apps/api/src/http/app.ts and new apps/api/test/router-boundaries.test.ts. Main request-local Hono app now explicitly uses supported TrieRouter; no global app/pool cache or auth/SQL/limit changes. Buildersourcehashes cba985234856c3187a1a512afca6f2eec30c545d968b5b115785f8c4a497a471 and96d951e977ccb0a919170e1db023322cd620058df2027c32b80d34e0e339c016. Source is held.

Root preimplementation acceptance: CPU-REPAIR-PLAN.md. Node profile oldcurrentrouter hotspot and supportedTrie improvement; rejectedLinearRouter120realtrailingslashdifferences (original135includes15keyorderartifacts retained). Exactprofiling evidence: operations-review/release-check/performance/README.md, actuallocalworkerd corroboration performance-investigation/RESULT.md. These do not prove sole hosted cause or actualCloudflareCPUmeter compliance. UAT direct-DB control also records handled idlePGerror; do not blame production pooler as the cause. Account defaultusage_modelstandard read; billing/subscription permissions unavailable, paidsettings unchanged.

## Current local run

Root launched `local-cpu-gates.mjs tests`, unifiedsession90957, logs/results under cpu-local-gates/. It serializes8groups: newrouterboundaries, typecheck,contracts,OpenAPI/migrationparity,MCP/package,fullAPI,nativeMCP,build. First5passed; newmountedboundaries **40/40 zero skips**. FullAPI is still running as of this checkpoint; do not claim its count yet. Sourcebefore/after JSON detects mutations.

Dedicated Docker PG17.11 container `flowboard-cpu-20261105-77809`, id2af1f84c587f5b6f4ad956560ddc7375b4a9f7f7da63418d98e1c2c7a7ac953d, loopback**60488**,256MiB/1CPU/nohostvolumes, pinnedCIimage. Sixsynthetic DBs. Private fixture URL/password file `/private/tmp/flowboard-cpu-gate-private.json`0600; never print it or copy it intoGit. Docker was explicitly restarted only for these tests. Stop ownedcontainer/removeprivatefixture after reviewer tests, and stopDesktop if no unrelatedcontainers exist.

Fresh independent reviewer `/root/cpu_router_independent_review` (fresh GPT6.1Sol/high), output cpu-router-review/, is read-only on held product source. They independently verified2400route+1183decoded+20280additional matcher cases,649mountedstatus/body/headers,64concurrent2app pool/limit/requestID isolation with0differences/leaks. They are waiting for the fixture to become idle after rootfullgates, then need serial targetedDBtests and quiet CPUbenchmark. Notify them explicitly when root8groups finish. Do not run destructive DBchecks concurrently.

Scope of review is localCPUrepair; they will deliver formal >8.5/floors/blockers/validator record plus99featureapplicability/provenance. They explicitly will not silently revive99oldapprovals;157originalcriteria need reassessment with preserved-versus-fresh evidence before claiming global closure. Root proposed freshMac hostedbrowser24 after current8groups, then final exactcandidateCI supplies Linux24/web344/API. Mutableoperator docs README/PROGRESS/TASKS/flowBoardTasks are excluded from the held reviewer manifest; snapshots of necessaryplanninginputs are owned by reviewer.

## Next

1. Finish rootlocal8groups; inspect actualexit/counts/sourcechanges. If failed diagnosewithoutrelaxinglimits, retainlogs.
2. Release fixture to reviewer for targetedindependentDBtests; allow quiet CPUremeasure. Run freshlocalhostedbrowser24 on UI DB after serializedbackendchecks, if needed forglobalcriteria evidence.
3. Finish fresh independent localreview and original99criteria applicability/reassessment truthfully. No scoretuning/oldexecutionrelabelling.
4. Commit only reviewed CPUrepair/evidence and push once to remoteuat for required CI. GitHubactiveaccount is damaged-goods-admin; use saved lezter11 token only in childenv for this repo (do not changeglobalactiveaccount or printtoken). Priorhelper push process in transcript demonstrated safeprocessscopedGH_TOKEN + `git -c credential.helper= -c credential.helper='!gh auth git-credential'`.
5. Clean detached artifacts, UAT upload and representative bounded cloudCPU observation (not just publichealth); request owner signed-in help without credentials. Newobserver should save only fixedendpointfamilies/outcomes/safeexceptioncategories/numericCPUifprovided, no rawURLs/query/headers/messages. Rootcallssofar40publicrequests forfailedattempt (UAT19/production21); allmanagementtail/metadataexcluded. Keep newcandidate ledger explicit and bounded.
6. Reattemptproduction only after runtime acceptance and currentbackup/rollback checks. CurrentNeonbranchquota again full after freshbackup; before a later freshbranch create, explicitownerpermission is required to delete any differentbackup. Existingapproval was ONLY the alreadydeleted Oct28UATsnapshot. Do not reuse that as permission to delete another snapshot or copy privateproductiondata locally. No paidplan change authorized.

## Observer hygiene

All owned firstattempt tail/diagnostic processes finished/closed. Mainmonitor stopped789.105s withSIGINT/exit130/cleanuptrue, failurekept. First0.508sstartupfailure, rawsamplingflagfix andnewclassifier evidence retained. Wrangler supports `WRANGLER_WRITE_LOGS=false`; tailmust use directwrangler-dist/cli.js to avoid orphanwrapperchildren. Omit --sampling-rate1 (invalid). Installedpg-pool emits poolerror after removingbadidleclient; does not establish harmlessness orsoleCPUcause. Original strictmonitor remains needs-inspection, not rewritten green. Productionownerasyncquestion frombefore rollback is stale; user was told to pause. Owner results must be checked against actual deployedversion.
