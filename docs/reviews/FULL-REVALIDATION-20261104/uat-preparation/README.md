# Exact-candidate UAT release — deployed

**Actions:** Prepared and subsequently deployed commit `d1c81f42fe306c352c9cb10f04883e251ead58bd` from a clean detached Git worktree. API TypeScript build, UAT Worker dry-run, fresh Next static export and recursive Pages Functions staging all exited 0. The parent cleared the recorded local release gates before the UAT rollout below. Signed-in hosted acceptance remains separate.

**Why and options:** The isolated worktree means a Flowboard card fix cannot accidentally acquire unrelated changes from the shared checkout during release. Pinned dependencies were reused through directory symlinks after verifying an identical lockfile and unchanged shared-package/web source. A fresh dependency install is the alternative; none was needed for this bounded build.

**Evidence and limits:** [Artifact manifest](artifact-preparation-manifest.json) binds source commit, clean tracked state, complete tracked non-sensitive-named file hashes, Worker bytes and staged Pages bytes. [Source manifest](source-manifest.json) records exact file hashes. [Cloudflare before-state](cloudflare-before.json) records current UAT identifiers and lifecycle rules without secret bindings. [Authentication metadata](auth-metadata.json) records actual read-only authentication/identity checks. Next warns that static exports do not apply Next rewrites; staged Pages Functions supply proxy and dynamic-route behavior. Hosted verification remains required.

- Clean source: `/private/tmp/flowboard-uat-release-d1c81f4`.
- Worker output: `/private/tmp/flowboard-uat-release-d1c81f4/apps/api/dist/worker-uat`.
- Pages stage: `/private/tmp/flowboard-pages-uat-d1c81f4`; config points to UAT service `flowboard-api-uat` and static directory `out`.
- Worker bundle SHA-256: `1665aec15cc6dcf61be0464b06f6376be122de761c4d6f1ee10547fa3ffa7906`.
- Worker artifact-map digest: `40d00cbc72caa9da54bdd9236dd89a3ffa1dc9cee9825ce5cddcb6168cc62a74`.
- Pages artifact-map digest: `ff3869d211d40564a5f9aff88ffa82634f9e1532c011bde0d4b7faf38b740470`.
- Existing UAT Worker version `41559e81-1e69-483b-a9f8-e7d08e103a11`; Pages deployment `35af3b28-20d8-4932-870e-f32278b927af`, source `3a82b24`, canonical branch `main` within UAT project.
- Wrangler 4.156.2 read-only identity succeeded after network escalation; OAuth has workers/pages write for account `6592b59b0da4771dc346b96c6fdc65fd`. Connector read-only calls succeeded too.
- Cached Neon 8.15.1 read-only metadata confirms project `misty-unit-76664549`, branch `br-polished-term-a172b6x5` named `uat` ready, database `neondb`. No database rows queried.
- R2 `staging-expire` prefix `staging/` delete-after-86400s remains enabled. Multipart abort-after-604800s remains enabled. No storage policy changes performed.

**Next / your input:** The approved UAT deployment is complete. Continue signed-in product/provider/MCP acceptance separately using synthetic fixtures. No further deployment action or running release process requires the laptop to remain open. Production remains excluded.

## Fresh backup and ledger — 2026-11-04 05:30 UTC

The user-approved encrypted UAT backup was refreshed at `2026-11-04T05:30:11.252Z`, outside Git in `/Users/shubham/.codex/flowboard-uat-backups/d1c81f4-20261104`. [Backup metadata](encrypted-backup.json) records 113607 archive bytes, 232 table-of-contents items and 27 table-data items. Full authenticated AES-GCM decryption matched the original archive and `pg_restore --list` exited 0; an actual database restore was not executed. [Post-backup verification](backup-verification.json) confirms directory/file permission modes and ciphertext hash. No key, database URI or row data is included in public evidence.

Two failed attempts are retained separately. The successful third attempt added bounded PostgreSQL connect/lock waits and disabled password prompting, preserving backup format, encryption and verification. Child error diagnostics stayed private.

[Read-only UAT ledger](uat-ledger-before.json) confirmed the exact branch endpoint, `neondb`, PostgreSQL 18.6 and a read-only transaction. The ledger contains migrations 1–19; reviewed migrations 20–26 remain pending. Its historical entries contain names/timestamps, not SQL checksums. No migration, lifecycle edit or deployment was performed. Parent release gates remain in force.

## UAT deployment completed — 2026-11-04

After the parent cleared the current-source release gates, source and artifact hashes were rechecked. The encrypted backup was refreshed again immediately before migration at `05:51:39 UTC` into a new private directory; [release backup metadata](encrypted-backup-release.json) preserves that result. [Migration evidence](migrations-d1c81f4.json) confirms exactly migrations 20–26 applied, ledger 19→26, exit 0. [R2 before](r2-lifecycle-before.json) and [after](r2-lifecycle-after.json) confirm removal of only `staging-expire`; the multipart-abort rule remains byte-for-byte unchanged.

[Deployment state](deployment-state-d1c81f4.json) and [live provider metadata](live-uat-metadata-d1c81f4.json) confirm:

- Worker `flowboard-api-uat`: version `21d3c2d8-2955-4aab-9765-5db6ad568d2e`, deployment `aa414e3d-fb72-4ea4-a8b6-cdac5b95b6ec`, 100% traffic. Uploaded bundle bytes match the prepared SHA above. URL: <https://flowboard-api-uat.web-app-cloud.workers.dev>.
- Pages `flowboard-app-uat`: deployment `4dbcd83f-b562-4fc5-bbac-2e6f40bee529`, canonical `main` within the UAT project, exact full `d1c81f4` commit and `commit_dirty=false`. URL: <https://flowboard-app-uat.pages.dev>; deployment URL: <https://4dbcd83f.flowboard-app-uat.pages.dev>.
- Both deployment commands exited 0. Actual live bindings reference the UAT Hyperdrive `7a1e3a69f51e41b1a8c46e0be263b814`, bucket `flowboard-images-uat`, and Pages service `API → flowboard-api-uat`. Public evidence contains binding names/nonsecret references only.

The first Worker upload and its network-return retry failed before deployment with Node connection timeouts. Live state was checked before retry; migrations were not repeated. Read-only OAuth verification succeeded with `NODE_OPTIONS=--dns-result-order=ipv4first`, and the final Worker/Pages uploads used that network setting. [Interruption record](resume-after-network-interruption.json) preserves the observed partial state.

[Four anonymous checks](anonymous-release-smoke.json) confirm Worker liveness/readiness 200, signed-out root redirect 302, and protected API 401. The initial root expectation incorrectly assumed public HTML 200; that failed check is preserved separately and the corrected expectation is source-grounded, with no repeated request. The independent hosted reviewer separately owns wider anonymous smoke evidence. No signed-in acceptance is claimed.

Rollback identifiers are retained in deployment state. No rollback was executed; retain schema 26 and the safe R2 policy. Production was untouched. Deployment is complete; signed-in product/provider/MCP acceptance remains a separate task.
