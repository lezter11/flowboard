# Repaired release checklist — f32eafa

Source: `f32eafae0f59bf1601d4a84e2a0e3208ae9db4bc`. This is a new candidate after the failed and rolled-back 40e51e1 production attempt. Historical failed observations remain preserved.

- [x] Local source/tests/build/artifact gates and new independent reviews. Scoped score9.09; global local reassessment8.92. See sibling `cpu-router-review/` and `cpu-global-review/`; these are local approvals, not hosted acceptance.
- [x] Exact candidate pushed to `uat`, one required CI run42027312917: all22steps success, API1966/1966; nativeMCP22/22groups. `ci-result.json`, `ci-test-counts.txt`, `ci-browser-counts.json` preserve real hosted-CI test counts.
- [x] Clean detached checkout and exact no-bundle upload proof. WorkerSHA256 `9bc6986e15691ad32aaf67b8490bf4dadcba01c769add4a0c42281beb4f1204d`; default/UAT artifacts equal the wire-probed production build.
- [x] UAT Worker `a3d243dd-7f80-447d-908b-1af466c1f46f`100%; Pages `549e766e-2c4f-4b3d-adbb-633384381347`, sourcef32eafa/dirtyfalse, API service `flowboard-api-uat`. Fetched Worker hash matches. `uat-provider-proof.json`.
- [x] Bounded UAT anonymous smoke17/17,17requests, no credentials or record writes. `uat-smoke.json`.
- [x] Complete900.001-second UAT runtime window and one scheduled invocation:14outcomeok/0CPU/0exceptions/0reportedjobfailures; cleanuptrue. Strict reportneeds-inspection because one known idlePGlabel.
- [ ] Observe representative signed-in UAT browser/MCP traffic; no authenticated activity occurred in this window.
- [x] Record scoped Architect disposition in SUMMARY.md: exactknownbaselineidlePGwarning1, unresolved/notclaimedharmless; strictneeds-inspection retained. Anonymous/scheduled CPU slice observed withoutresourcefailure; overallruntimegateheld forauth.
- [ ] Fresh schema27 production backup immediately before retry. Quota currently10branches; fresh inventory in `neon-backup-inventory.json`. Prior deletion permission applied only to the already-deleted Oct28UATbackup. No other deletion or local production data copy is authorized. Owner exception, if any, must be explicit.
- [ ] Production code-only retry after the above gates. Ledger27 already applied; DO NOT rerun migration20–27 or restore data. Record previous Worker/Pages IDs and use reviewed artifacts.
- [ ] Exact deployed production byte/config/source proof, bounded smoke and15-minute runtime observation; code-first rollback on failure.
- [ ] Promote GitHub main with evidence after acceptance, conserving Actions minutes; tested application source remainsf32eafa.
- [ ] Real production Google/Claude signed-in acceptance. Owner explicitly deferred this test; never infer it from anonymous smoke or unrelated traffic.

The production stable rollback remains Worker756fdc6e-34f9-4ea8-88cc-59f21cdc940b and Pages876eacf4-2890-4b3a-a54b-d71cf1fa6ff1/source3a82b24 until a later provider receipt proves otherwise. Docker fixtures and Docker Desktop are stopped; no further database migration is planned.
