# Earlier UAT/promotion checkpoint — superseded by CPU incident

**Current state: the owner approved the backup cleanup; production was uploaded and then rolled back after CPU-limit failures.** Database27 and the fresh backup are retained. A request-local router repair is being tested. [Read the current incident and actual rollout counts](CPU-INCIDENT.md). The earlier pending-backup statements below are historical, not the current blocker.

Application source: **40e51e1336a783a6b450806260ed6c5aa8ace0ea**, 2026-11-05. Production promotion was requested and authorized by the user after owner-reported UAT connector success. This report records what actually executed, not a production deployment claim.

## Delivered

Settings → Connections → **Create a card from your AI app** now has a selectable prompt and Copy sample prompt button. It identifies required Title/Board/Column in the approved project and optional priority, calendar due date and description. Assignment is explicitly manual because the existing MCP tool cannot set assignees. Hosted browser sign-in currently supports Claude; portable prompt text does not enable arbitrary hosted clients.

The clipboard success and blocked-copy fallback, keyboard disclosure and 320px layout passed real isolated Chrome component checks. There are no new API tools, automatic sends or token storage. Production configuration now declares the image-verifier binding already exercised on UAT; the new configuration is prepared, not applied to production.

## Executed gates and UAT

- [Fresh scoped application/configuration review](independent-review/0585374a5972c9cad40f356ed57736acf7dbd989a7f449c2d8b262818f49bd2c-round-2.json): **9.065/10**, 842-file target; Architect validator and Git-index hash checks passed. Initial compatibility-copy issue retained and repaired.
- [Fresh operations-helper review](operations-review/9e7a2dd1b76730ff45dbae7f1d5b800fade5b7e28d4de3d7810d0a8f3a3f4ea5-round-2.json): **8.79/10**, 57-file target. Synthetic guard tests15, independent synthetic Git tests2 and syntax3 passed; these are not a live production migration or restore test.
- [CI42003364732](https://github.com/lezter11/flowboard/actions/runs/42003364732): **22/22 steps success**, API **1,926/1,926**, hosted browser **24** cases with zero failures; other required web/MCP/contracts/build gates passed. [Actual counts](ci-primary-counts.json). One new hosted run only; source was pushed only to `uat`.
- Clean detached candidate, offline ignored-script installation, explicit reviewed dependency patch/verification, production-mode static build and both exact-upload dry runs passed. Default/UAT Worker bodies remain SHA256 `b66ea3c07de35f7921551d33236cdb3f9f88cb64e3596c8ac079a8bfa711da21`, byte-identical to the previously deployed and independently wire-tested UAT artifact.
- UAT **Pages upload exit0**: canonical deployment **0df2875d-10d9-4076-a78b-71340283b00b**, source40e51e1, dirty=false, API binding `flowboard-api-uat`. [Provider proof](uat-deployed-proof.json).
- UAT Worker was deliberately **retained**, version **7aa27279-7df7-4a69-ac2a-a9963843dce7**, deployment96d196c3-f8c9-467a-aad0-b35df88acb99: current provider identity matches the earlier fetched-byte proof, and the newly built Worker body is unchanged. No redundant Worker upload or database migration was needed for this UAT update.
- [Final UAT smoke](uat-smoke.json): **17/17**, exit0, 17 anonymous requests; exact new Settings JavaScript/copy text and CSS/HTML bytes, OAuth metadata, unauthorized/error boundaries, headers and Worker health. No sign-in or cards were created by the probes. New prompt signed-in UAT acceptance is still an owner step; the user accepted the previous connector, not this newly added UI.

## Production blocker and preserved state

[Read-only database preflight](production-db-preflight.json) verified production branch `br-orange-union-a1kqetvn`, direct endpoint, PostgreSQL18.6, **ledger1–19**. Exact reviewed migrations20–27 are pending. They include legacy import expiry, privacy backfills/redaction, replacement column uniqueness/guards and finalized-upload repair; do not describe them as purely additive or as already applied to production.

[Fresh branch-backup attempt](production-backup-receipt.json) exited1 with **branch-quota-blocked**. No new backup or production migration was performed. An explicit owner permission request is pending to delete **only** the old restore point `uat-backup-2026-10-28` (`br-lingering-field-a1hfhs5o`). [Read-only safety check](old-uat-backup-preconditions.json) confirms no child branches and a separate idle backup compute. Deleting that restore point also deletes its backup compute. The active UAT/production branches and existing production backup are not the deletion target. No deletion or local production-data backup is authorized by elapsed time.

Production **remains unchanged**: Worker version **756fdc6e-34f9-4ea8-88cc-59f21cdc940b**, deploymentaaaaf3c3-1b1a-4382-9da6-823c9a1adf3e; Pages **876eacf4-2890-4b3a-a54b-d71cf1fa6ff1**, source3a82b24; database ledger19. The production branch `main` has not been promoted. All probes in this release targeted UAT; no production public smoke was run.

The prior D-24 beta exception for the broad runtime database role and missing uptime alert remains a known limitation. No least-privilege, alert, general-availability or hosted production acceptance claim is made.

## Resume after the owner's answer

1. If approved, reread exact old-backup identity, leaf status and distinct endpoint before deleting only that approved branch; save receipt. Never delete a different backup automatically.
2. Create a fresh ready, full-data/no-compute production backup using the reviewed helper against the clean40e51e1 candidate. Verify provider parent/freshness/endpoints again. A past failed/quota receipt cannot authorize migration.
3. Check ledger19, normalized-column conflicts, all runner-eligible migration hashes and fresh backup; execute reviewed migrations20–27 only. Stop on any partial failure. No destructive restore or downmigration.
4. Recheck rollback IDs, source/CI/review manifests, safe R2 lifecycle and exact production bindings. Deploy the immutable default Worker with production IMAGE_VERIFIER, then staged production Pages. Verify actual deployed Worker bytes/source/bindings and run the reviewed bounded production smoke.
5. Monitor15minutes with redacted operational evidence; confirm cron outcome, database/health failures and owner production sign-in/tools. Promote Git `main` without duplicate CI for an identical application, using a documentation-only `[skip ci]` evidence commit and explicit tested applicationSHA. Do not mark owner tests executed without results.

Canonical candidate `/private/tmp/flowboard-prod-release-40e51e1`; UAT stage `/private/tmp/flowboard-uat-pages-40e51e1`; production stage `/private/tmp/flowboard-prod-pages-40e51e1`. Docker stayed off. All current uploads/checks finished; the laptop can close while production waits for permission. Temporary stages must be revalidated if missing or changed when resuming.
