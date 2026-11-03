# Notification retry recovery — local implementation evidence

The new mounted/database probe produced a real PostgreSQL23514 on notification insert. Before repair the retry UPDATE then failed25P02 (transaction aborted), so the whole batch rolled back rather than recording its bounded retry. Evidence: `raw/outbox-recovery-red.log`,1 pass/1 fail, exit1.

Each accepted outbox row is now handled inside a savepoint after the claim locks. A job error rolls back its partial effects before persisting retry/quarantine. Required-schema/permissions and serialization failures still abort the whole transaction and retain accepted work. Existing `FOR UPDATE SKIP LOCKED` row locks act as the database consumer fence: another consumer skips held rows, and a crashed/rolled-back transaction releases them. No external queue lease service was added. Provider sends remain subject to their existing stable provider idempotency key; a SQL transaction cannot guarantee an external email provider's exactly-once behavior.

`raw/outbox-recovery-green-1.log`:16/16 pass,0 skipped, exit0 (2 recovery tests +14 comment retention/concurrency regressions), PostgreSQL17.11-alpine on owned loopback55931. Real separate connections cover a held claim, rollback, restart and overlapping consumers with one logical source/recipient notification. Job-specific poison retry reaches terminal quarantine while an independent valid job commits. Invitation branch/privacy regression and full API suite must still run on final frozen source.

This is builder evidence, not a passing independent review or task closure. The earlier MCP review does not approve these new shared changes.

## Savepoint privacy regression and repair

A later real23514 poison attempt exposed that `ROLLBACK TO SAVEPOINT` also restored a legacy comment outbox payload sanitized inside that savepoint. `raw/outbox-savepoint-redaction-red.log` preserves the failed privacy assertion. After rolling back partial effects, comment intent is now sanitized again before retry/quarantine bookkeeping, so a body/email copy cannot survive a failed notification insert. `raw/outbox-savepoint-redaction-green.log`:16/16 pass,0 skipped, exit0 (two recovery plus14 retention tests) on the same owned disposable PostgreSQL. Required-schema/permission and serialization failures still abort the batch; no false settled outcome is written. This is additional builder evidence, not current independent approval.
