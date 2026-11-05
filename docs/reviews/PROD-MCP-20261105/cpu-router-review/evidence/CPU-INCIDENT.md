# Production promotion rolled back — CPU failures

2026-11-05. Current state supersedes the earlier backup-gate checkpoint and initial successful public smoke.

The owner approved deleting only old UAT backup br-lingering-field-a1hfhs5o. Exact guarded deletion passed; active UAT/production and the previous production backup were preserved. Fresh production backup **br-fancy-dream-a15hpqam** was created and verified. Reviewed migrations20–27 applied successfully; ledger27 and no-op second run passed. No database restore occurred.

Application40e51e1 was uploaded to production Worker58a363e0 and Pages76ca822d. Actual Worker bytes matched the approved b66 hash; exact Pages source/private bindings and anonymous17/17 smoke passed. These initial checks did not establish sustained runtime safety.

During redacted live observation, the failed candidate produced **396 observed invocations: 376ok, 4canceled, 16exceededCpu, 41 exception entries, 314error-level logs**. The observation was deliberately stopped after **789.105seconds**, exit130/cleanuptrue; it was not a completed clean900second window. Counts overlap and are not distinct errors. No HTTP5xx were present in the tail's reported response-status subset; CPU failures often lacked a response-status entry, so that is not an absence-of-failures claim.

A separate361.685second classifier observed319invocations/16exceededCpu/41exceptions and250 exact handled PostgreSQL connection-error labels. UAT direct-endpoint control also recorded that fixed error on one readiness request; the production pooler host alone is not an established cause. No raw request URLs, headers, log messages or exception text were retained. Initial monitor startup/observer repair records remain preserved separately.

## Rollback executed

- Worker rollback exit0: **756fdc6e-34f9-4ea8-88cc-59f21cdc940b** at100%, new rollback deployment **85a8828e-0345-4219-9fa0-2856f2566deb**.
- Pages rolled back to **876eacf4-2890-4b3a-a54b-d71cf1fa6ff1**, source**3a82b24**. Provider proof in production-rollback-proof.json.
- Post-rollback liveness/readiness **2/2 pass**. Migrations/data and fresh backup remain intact; no downmigration or destructive restore.
- Git main has not been promoted. The new hosted MCP connector and sample prompt remain available on UAT, not on the restored production release. Pause the production owner test until a new promotion is announced.

## Repair in progress

Profile actual request-local app construction/first dispatch against old/new code. Both rebuild Hono routes per request; additional routes may raise repeated matcher construction cost. This is a hypothesis until measured. Prefer the narrowest measured change that preserves request-local identity/pools; consider a no-build router before caching mutable application state. No paid account settings or CPU limits may be changed without explicit owner authorization.

Before a new production attempt: local regression/security/runtime tests, source-bound independent review, one new exact candidate CI (not a hosted debugging loop), UAT runtime checks under the actual platform limits, then reviewed production artifacts and sustained observation. Keep every failed release/probe and its original counts. A green unit suite or public smoke cannot waive observed deployed CPU failures.
