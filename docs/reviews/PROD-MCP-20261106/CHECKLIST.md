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
- [ ] Commit reviewedcandidate; oneexactfinalGitHubCI run only; no speculativeActionsloop.
- [ ] Preparecleanexactartifacts and explicitactive/inactive statusoverlays/manifests; onlystatusobjectdiffers betweenreadyPagesvariants; no ignoredsecrets.
- [ ] DeployexactUAT candidateafterCI; boundedstaticsmoke/status/banner/runtimeverification; recordOwnerreportedpriorUATacceptance separately.
- [ ] Freshpreproductiontarget/version/config/Neonledger27 check. Run onlyexactapproveddelete aftergates withreviewedhelper; preservebefore/afterbranch/endpointssets andreceipt. Freshdatabearingno-computeproductionbranchsnapshot; no migrations or restore.
- [ ] UploadexactWorker andbanner-activePages, verifydeployedbytes/config/source/status. RecordpreviousrollbackIDs.
- [ ] Complete15-minuteactualproductionobservation; CPU/uncaught/newerror/jobfailures triggercodefirstrollback. KnownidlePGbaselinewarning remainsopenwithcountandexplicitdisposition, neverrewritestrictreportgreen.
- [ ] Publishsame-reviewedPagesvariantwithstatusinactive; verifycanonicalstatusoff and unchangedapplicationassetbytes; productionOwnerGoogle/Clauderemainsdeferred.
- [ ] PromoteGitmainandpublish evidence/checkpointwithoutduplicateCI; updateguide/currentoperator docs andfinaluserresult/limits.

**Risks/review focus:** HTML/reacthydration; viewportanchoredheaders/rail/drawers; racingpolls/unmount; malformed/oversized/stalledstatus; stalecacheonflagclear; oldopenclientswithoutcomponent; inactivefiledeploymentfailure; helperreceiptuncertainty; stalebackup/changedNeonancestry; APIresource regression. Statuswarningisnotanauthorizationormaintenancelock.
