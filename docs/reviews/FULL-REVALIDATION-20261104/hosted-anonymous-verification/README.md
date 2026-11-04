# Independent anonymous UAT smoke checkpoint

**Actions:** PASS15/15anonymous HTTP GET checks, exit0, 2026-11-04T07:27:19.209Z through07:27:28.638Z. No actionable deployment mismatch was observed. No credentials, cookies, OAuth-start requests, automatic redirects, retries, account creation or writes were used. The only requested origins were the canonical UAT Pages host and confirmed UAT Worker default domain; no preview, provider, database, storage or production host was requested.

Confirmed release identifiers for source `d1c81f42fe306c352c9cb10f04883e251ead58bd`:

- Pages project `flowboard-app-uat`, canonical branch `main`, deployment `4dbcd83f-b562-4fc5-bbac-2e6f40bee529`.
- Worker `flowboard-api-uat`, version `21d3c2d8-2955-4aab-9765-5db6ad568d2e`, deployment `aa414e3d-fb72-4ea4-a8b6-cdac5b95b6ec`, version traffic100%.
- Existing release-agent Cloudflare metadata was independently read and checked: exact Pages commit, clean source flag, successful deploy stage, Pages API service binding to UAT Worker, UAT Hyperdrive ID and private UAT R2 bucket. Cloudflare labels the canonical branch deployment `production` **inside the UAT Pages project**; this is not the production Flowboard project. This reviewer made no Cloudflare administrative calls or changes.

**Why and options:** Anonymous smoke checks catch a missing service binding, failed public deployment, broken sign-in routing or accidental public API access before a user signs in. They give a small, bounded check of the deployed entry points. Real signed-in product/provider tests are the next layer and require their own authorized sessions and data boundaries.

**Evidence and limits:** `results.json` preserves all15request URLs/statuses, safe selected headers, body hashes, error codes and timings. `command.log` and `command-result.json` preserve the real command and exit0. `deployment-provenance.json` binds full deployment IDs and existing metadata SHA. `source-after.json` verifies the11routing/header/auth source files are unchanged from preparation.

| Observed entry | Result |
|---|---|
| Canonical Pages `/` |302to`/signin`, no-store |
| `/signin` |200HTML; exact byte hash matches prepared sign-in artifact; declared CSP, nosniff, DENY framing, referrer and permissions policies present |
| One same-host Next CSS asset |200, one-year immutable cache; declared static security headers present |
| Anonymous board URL with synthetic nonexistent ID |302to safely encoded sign-in next route, no-store; no existence claim |
| Pages session/projects/tokens/import template/import-status GETs |401`UNAUTHORIZED`, no-store, no data envelope |
| Pages administrative system status |403`FORBIDDEN`, no-store, no data envelope |
| Actual Worker `/health/live` and `/health/ready` |200`ok` and200`ready`, no-store |
| Direct Worker session/token administration/system status |401/401/403, no-store, no data envelope |

API and redirect Function responses do not carry static Pages security headers; this matches the source boundary and was not treated as a failure of static `_headers`. Protected responses carry JSON, request IDs and no-store. No Set-Cookie values or response bodies were retained; only public/error body hashes and safe structural summaries were saved. The exact sign-in hash proves that one served artifact matches preparation, not that every deployed byte was independently downloaded.

Health readiness demonstrates that the deployed Worker completed its configured database readiness probe at that time. It does not establish signed-in authorization, database application semantics or complete data isolation. Deployment-to-source binding comes from the independently inspected release-agent metadata and prepared artifact evidence, not from anonymous HTTP attestation.

Signed-in UI, real Google login, private object durability/policy, invitation/mail delivery, hosted scheduler, MCP/Claude client acceptance, CPU/heap/billing/load and full hosted acceptance remain pending. Existing local/backend approvals remain separate evidence. This reviewer performed no deployment, migration, storage-policy or database mutation.

**Next / your input:** This anonymous checkpoint is complete and all evidence is saved. Parent can preserve the release checkpoint and continue signed-in/provider/Claude acceptance later. No further HTTP probes or user action are needed for this bounded smoke.
