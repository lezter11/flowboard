# Rollout banner and production retry implementation plan

**Goal:** Show an accessible update banner during the reviewed production rollout, clear it afterward, and promote the approved hostedMCP/sampleprompt/CPUrepair.

**Architecture:** Globalclientbanner follows smallsame-originstaticbooleanstatus; no newAPI/DB/vendordependency. Identicalreviewedapplication with active/inactive deploymentconfigurationvariants. Architect coordinates sourceidentity/reviews/operations; UIbuilder ownsfrontend; independentreviewer ownsapproval.

**Spec:** [PLAN.md](PLAN.md). **Stack:** existingReact/Next15staticexport/CloudflarePages, existingWorker/Hono/PostgreSQL backendunchanged.

- [x] Record Owner UATreport, exactbackuppermission and requestedbanner; do not repeatapprovalorclaimunspecifiedsteps.
- [x] Freeze scope/acceptance before implementation; parallelUIbuilder and readonlyoperationspreflight assigned.
- [x] Implement/freeze8UIpaths, fixedcopy/staticstatus/visiblepoll/referrer-cookie omission and matchedlayoutoffsets. Builder264-filemanifest ef376 unchanged.
- [x] Verifybrowser12/12includingactualdrawers320/640short;350webtests/type0/sanitizedstaticbuild0. Independent350+12+6actualPagesASSETSChrome checks pass. Reflowequivalent200percent and syntheticvisibilityadapter limitations explicit.
- [x] Rootsource/diff/screenshots inspection plus350webtests/type0/isolatedsanitizedstaticbuildround2pass withheldsourceunchanged; failedisolatedbuildfixture TSresolution preserved. IndependentactualstatusGET/HEAD/missingquery/cache/APIfastpath pass.
- [x] Fresh scopedindependentreview9.04/1231files/11criteria, allfloors/no blockers/rootvalidatorPASS.
- [x] Composedindependentglobal8.945/100IDs/168criteria/1242files; rootvalidatorpass; newownerphase98Backend/74UI/98localIntegration,1570refs/17changedCSSrefs/270newroles/270preservedsnapshots. Independentpostconsumeauditpass,46fulltestrows preserved; notblankethostedacceptance.
- [x] Commit/pushD6 and passsingleCI42173052691 all22steps; no speculativeActionsloop.
- [x] Prepare/rehashexactcleanartifacts and4statusvariants158files; onlystatusdiffersperenv, actual4sharedstagerlibfilespreserved. IndependentartifactauditPASS; operatorfix/failure preserved.
- [x] DeployUATD6Pages,18smokePASS,actualsame-documentbannerretetPASSafterpreserveddeadlinefailure,exactoffflag/noStore;90secAPI12ok/0CPU/0exceptions plus prior900sec/Cron andOwnerreport explicitlyseparate.
- [x] Freshprodanchors/cacheoff/readonlyledger27 checks; exactapprovedOct29delete10→9preservingothers, freshbr-misty-band-a141u8yh ready/full/no-compute; no migration/restore.
- [x] UploadWorkercc432/Pages8d2active,exact9BCbody/D6source/correctprodprivatebindings; previousrollbackanchors756fd/876e preserved.
- [x] Complete900.001sec/15ok/2scheduled/0CPU/0exceptions/0HTTP5xx; oneexactknownidlePGlabel retainedasneeds-inspection withscopedArchitectdisposition and unresolvedfollowup.
- [x] PublishfinalPagesd050inactive; realprodChromeactive→inactive/sameDocument/cleanup/0credentialheaders/errors; exactflagfalse/noStore andpayloadrehash; postreadonlyledger27pass. Ownerprodtestdeferred.
- [x] Prepare final production guide, evidence, independent release audit and unchanged-runtime metadata promotion bundle.
- [x] Confirm final Git main/uat refs: both verified at `6f303964fa95889221ada80b1f7451dc4c01de37` after atomic publication, exit 0. See `final-push.json`. Application source remains D6; metadata-only closure uses `[skip ci]` and needs no duplicate CI.

**Risks/review focus:** HTML/reacthydration; viewportanchoredheaders/rail/drawers; racingpolls/unmount; malformed/oversized/stalledstatus; stalecacheonflagclear; oldopenclientswithoutcomponent; inactivefiledeploymentfailure; helperreceiptuncertainty; stalebackup/changedNeonancestry; APIresource regression. Statuswarningisnotanauthorizationormaintenancelock.
