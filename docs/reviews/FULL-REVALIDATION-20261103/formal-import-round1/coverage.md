# IMP-01–11 independent source acceptance review, round1

Verdict: **FAIL**. Source target611files/digest`27db43d94d3a45bfea41b6d8e3cffba3e07bb6118e0c0b08437ab5b7c011910b`. No application, configuration, criteria or original test/fixture edits. This record is preserved even after repair.

## Scope and exact evidence

The mounted route aliases in`apps/api/src/http/routes/imports.ts`call the reviewed adapter`apps/api/src/adapters/imports.ts`. Reachable dependencies traced include app-wide body/origin/auth/rate/deadline middleware, current Owner/Manager board/project access, membership/board-grant locks, writable project/board locks, receipt authorization/replay, activity/outbox writes, cleanup/purge, migrations0021/0025and embedded migration usage. Parser/template/contracts and the Next import screen, API client mapping conversion, retained confirmation commands, pagination/feed generation, actor attribution and CSV download were read. The directly reviewed files and all611held source bytes are bound by the source verification JSON files.

The root's`raw/final-local-gates-1/commands.json`reports14required commands exit0, source unchanged. I inspected it and its recorded counts: API1579/1579; contracts126/126; web317/317; MCP17/17; artifact1/1; each0fail/0skip. These are **root/builder commands, not mine**, and do not override independent adversarial failures. The separately delegated foundation executor has not supplied its complete14fresh logs before this failed round ended. Therefore I do not claim independent full-suite execution. The root browser results cover board/card/comment/People paths; they do not prove every import UI flow. Historical product-browser screenshots/logs are not revived as current independent acceptance.

My commands:

1. Python full611file hash and map-digest comparison: everyfile matched; before/after JSON retained.
2. `python3 docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/build-probes.py`:9genuine-template-derived ZIPs; all memberCRC checks pass.
3. `NODE_ENV=test FLOWBOARD_IMPORT_TEST_DATABASE_URL=postgresql://flowboard_harness:flowboard_local_only@127.0.0.1:55931/flowboard_import_test node --test docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/mounted-probes.test.ts`: initial sandbox attemptEPERM(exit1)preserved; permitted retry exit0,1observation test pass/0fail/0skip,9recorded mounted probes.
4. `python3 docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/build-followup-probes.py`:6additional CRC-valid ZIPs with unique source IDs.
5. `NODE_ENV=test FLOWBOARD_IMPORT_TEST_DATABASE_URL=postgresql://flowboard_harness:flowboard_local_only@127.0.0.1:55931/flowboard_import_test node --test docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/followup-probes.test.ts`: exit0,1observation test pass/0fail/0skip,6recorded mounted probes. Both tests created/dropped only a random owned schema through lifecycleFixture; no shared table resets or fence bypass.

The two passing observation tests are **not acceptance passes**: they intentionally record returned HTTP/database values. Of15case observations, baseline control/formula/XXEcontrols behave as expected; the follow-up proves mandatory failures below. The first rich-run probe hit an expected duplicate conflict after a previous test committed the sameID; the unique-ID follow-up removes that confound and proves committed truncation. No benchmark is claimed.

## Per-feature coverage

| ID | Source/evidence checked | Acceptance outcome |
|---|---|---|
| IMP-01 | Embedded official workbook bytes, template route auth, bothruntime test source and root requiredAPI log | Source/recorded local evidence support correct versioned blank template; independent14suite/browser acceptance remains pending |
| IMP-02 | assertImportAccessBeforeParse, lockBoardAccess, manager requirement, caller-selected default column and current role/grant rechecks | Bound target and role boundary traced; known local mounted auth/grant regressions in required suite, no new bypass confirmed |
| IMP-03 | All ZIP/XML parsing,5MiB/20MiB/200row/10000cell/1000msbounds, formula/XXEguards, real adverse packages | **FAIL**: UTF16formula detection bypass, forbidden actualpackage/media/externalrel acceptance |
| IMP-04 | Exact headers, literal conversion, description/title/status/priority/email/date validations, persisted normalized fields | **FAIL**: double entity decoding and rich inline run truncation; invalid scalar yields500 |
| IMP-05 | Counts/outcomes/digests, explicit mapping entries and Maplookup, preview DB writes without domaincards, cursor generation | **FAIL**: UTF16nonempty workbook silently becomes valid0row preview; malformed representations are not explicit errors |
| IMP-06 | Recipient locks before board, rowhash/context digest/version/default, markers reserved before effects, all cards/activity/receipt in one transaction | Strong existing mounted separate-connection and final-row-rollback regression evidence; wrong parsed literals nevertheless commit, so end-to-end acceptance fails |
| IMP-07 | Board/external-IDunique marker, original hashes vs later card edits, nullablecard tombstone, identical/different separately accepted previews | Durable reservation and rollback paths traced; root existing concurrency tests pass. Literal normalization defect can alias original input identities/hashes; full independent rerun pending |
| IMP-08 | Date1900/1904style detection/strictGregorian, semicolondedupe, recipient projectrole+boardgrant intersections and lock winners | Existing mounted negative/date/grant tests inspected; no new date/grant defect confirmed. Singlequote/UTF16XMLcompatibility remains parser issue |
| IMP-09 | CSV formula-prefix protection, report access private/no-cache, per-rowcardIDs, UIcardhref/APIbytes | CSV controls traced, no fetch/evaluation. Full independent current importbrowser flow not completed; report preserves already-corrupted input from parser |
| IMP-10 | Cancel/expiryredaction,30mineligibility, scheduled bounded SKIPLOCKEDcleanup, purge copies and committed-state prohibition | Existing mounted sweep/upgrade/scheduled tests inspected. Hostedcron remainsUATpending; no local new cancellation invariant defect confirmed |
| IMP-11 | card_created+card_import_committedactivity, persisted uploader and confirmerfacts, safeHistoricalPersonDisplay, migration25index, receipt replay | Source/requiredsuite support safe provenance/atomicity; minimalreceiptUIaftercleanup has an unvalidated accessibility candidate described below |

## Confirmed blockers and counterevidence

See`findings.json`for exact line ranges, fixturepaths, reproduction, expected/actual and fixes. Mandatory source policies are`docs/IMPORT_SPEC.md:19,21,54,60–62`and frozen criteriaIMP03–05plus import-repair-1firstcriterion. The root independently accepted the literaltext/codepoint paths as compelling; package findings are stated as rejection-policy failures, never remote-codeexecution orSSRF.

- Literal`Literal &#x41; and &#65;`is correctly encoded as`Literal &amp;#x41; and &amp;#65;`in XML, but preview/commit/database persist`Literal A and A`.
- Legal inline richtext runs`First `and`Second`become committed title`First`.
- UTF16worksheet with valid1row becomes201ready/count0and200committed/count0. The same encoding hides a formula from the formula guard, with the samefalse-success result. No expression is evaluated; the defect is unsafe acceptance plus lost rows.
- MacroEnabledactualcontenttype, an externalworkbookrelationship and embeddedimage parts bypass rejection. ActualPNG/drawing variant commits200. The ordinaryUTF8formula andXXEvariants correctly422, and advertised blacklistfilename patterns are rejected; those defenses do not cover the supplied counterexamples.
- An out-of-rangeXMLnumericentity throws uncaughtRangeError, yielding500rather than a bounded422invalid-workbook response.
- MergedCardsdata is accepted and committed despite the explicitnomergedtablecells rule.

## Rejected or deferred candidates

1. No remote fetch or formula execution is demonstrated. Parser treats the provided externalURL as bytes and never calls network APIs. These are mandatorypackageacceptance failures, not claimedSSRF/RCE.
2. Originalrich-inline-text.xlsxwasconfounded by duplicateIDafter anothercommit. UniqueIDretest confirms loss independently and removes that candidateconfound.
3. NumericGeneralcellsare explicitly invalid rather than silently inferred dates; authenticdate-style conversion is present. No new defect asserted for fractional serials, which normaldate-only Exceltruncation can reasonably support.
4. Reservedprototypekeys useMapand explicitmappingEntries. UIAPIclient converts record mappings; existing dedicated mounted tests protect these cases. No prototypepollution finding.
5. Commit by anothercurrentManager is deliberate persistedconfirmerattribution, not impersonation of uploader; digestbinds originaluploader pluscurrentauthorizedtarget. No sameactor-only restriction is inferred.
6. The cleanup intentionally removes retained titles; an emptytitlelink in the receiptUIaftercleanup may render no usablelabel, but I did not run the currentbrowseraftercleanup, so this is an unconfirmedfollow-up, not a scoredblocker.
7. Legal singlequotedworkbookattributes return422EMPTY_WORKBOOK. This is compatibilityevidence, included withinXMLrepresentationfix recommendations; no distinct securityexploit is asserted.
8. No dependencyadvisorysearch was performed because this review is offline/local and no network was authorized. Dependencyvulnerabilitystatus isunverified, notdeclaredclean.

## Decision in simple English

If a teammate types`&#65;`as ordinary cardtext in Excel, Flowboardmust preserve those characters. DecodingXMLtwicechanges the taskbefore the transaction begins. A transaction can make everywrite succeedtogether while still savingthewrongdata. Existing locking/receiptwork is useful, but cannotrepairthat earlierparsingloss. A standards-aware boundedXMLreader or a strictvalidated supportedXMLsubset can fit; whichever ischosenmust preservealltext or rejectunsupportedrepresentations safely, thenrerun the15adversarialcases through actualroutes andPG.

Next: builderfixes allmandatorydefects on a newheldmanifest; freshindependentreviewreruns affectedparser/API/UIand all14requiredcommands. NoUATdeploymentapprovalfromthisround. No useractionneeded.
