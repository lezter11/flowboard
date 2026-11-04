# Hosted MCP connector: UAT release complete

**Deployed application:** `dce1a67dedb1de8f5f7aae9b99fcbcb2b875d105`, 2026-11-04. [Open Flowboard UAT](https://flowboard-app-uat.pages.dev). [Five-step Claude setup](../../../HOSTED_MCP_QUICKSTART.md). Production was not deployed.

## What is available

Colleagues add the hosted URL in Claude, sign in through Google, approve one project and use their current board permissions. Personal Settings → Connections supports disconnecting access. The five tools discover projects/boards/columns, search and create cards. Existing local stdio/PAT integration remains separate. Updating cards and company machine-to-machine client credentials are future work.

## Executed evidence

- [Native CI41877634812](https://github.com/lezter11/flowboard/actions/runs/41877634812): overall success, all22 steps success, API **1,926/1,926**, hosted browser **24** cases. Actual result/count receipts are [ci-result.json](ci-result.json) and [ci-primary-counts.json](ci-primary-counts.json).
- [Fresh independent local review](../hosted-browser-linux-repair/independent-review/new-reviewer/0cd36f07dc66739a759272722d1da017f56588fb6f3a062805f3d62de6a95ea8-round-1.json) **8.955/10**, all category minimums/no blockers, 817-file source/evidence manifest. Architect validator passed; current 98 Backend / 74 required UI / 98 local Integration handoffs reference that review. Unchanged checks retain their actual original SHA/environment/logs through explicit source continuity; they are not invented reruns.
- Fresh full browser flows: Mac24/24 and actual Linux24/24, diagnostic4 tests and bad-executable refusal/cleanup. Original max-XLSX parser budget/limits/fixture remain unchanged; native CI verifies the repaired full API.
- Clean detached production artifacts pass exact patch/map checks. Prepared default/UAT Worker SHA256 is `b66ea3c07de35f7921551d33236cdb3f9f88cb64e3596c8ac079a8bfa711da21`, matching the independently wire-tested artifact and the module fetched from Cloudflare after upload.
- Approved encrypted UAT backup verified outside Git; authenticated decrypt and archive listing passed. **No actual database restore was performed.** Only reviewed migration0027 applied; ledger26→27 verified. No credentials, private database content or key were printed or committed.
- Final public smoke **15/15** plus health **2/2** passed. Total anonymous UAT requests **37**, below60. No signed-in/application-record writes were used for these probes.

## Deployed identity

| Resource | Verified value |
| --- | --- |
| Worker | `flowboard-api-uat` |
| Worker version / deployment | `7aa27279-7df7-4a69-ac2a-a9963843dce7` / `96d196c3-f8c9-467a-aad0-b35df88acb99` at100% |
| Worker bytes | 2,876,735; exact reviewed SHA above |
| Pages project / canonical deployment | `flowboard-app-uat` / `cf2a01be-73f5-4053-b2aa-acb5438f14ca` |
| Pages source | full dce1a67 SHA above, dirty=false, deploy success |
| Pages API binding | `flowboard-api-uat` |
| Database/storage | Existing verified UAT Hyperdrive and R2 bucket retained; existing secret binding names retained |

[Worker byte proof](deployed-worker-proof.json), [Pages proof](deployed-pages-proof.json), [migration receipt](migration-receipt.json), [backup receipt](backup-receipt.json), [final smoke](anonymous-smoke-v2.json), [health](health-smoke.json).

## Retained failed probes and privacy check

The initial smoke passed14/15 but incorrectly required a single literal Referrer-Policy value. Cloudflare returned `strict-origin-when-cross-origin, no-referrer`. The standards-aware correction requires effective policy exactly `no-referrer`; reversed permissive policies fail. Independent OPS review approved the correction;13 tests pass, and an actual isolated browser observed no stylesheet Referer with only two anonymous GETs. An initial browser representation-adapter failure is also retained. No application change or redeployment was needed. [Review](referrer-policy-review.md), [passing browser proof](live-referrer-browser-v2.json). This limited browser probe disabled JavaScript and is not a signed-in UI acceptance claim.

## Owner acceptance and safe closure

Real Google/Claude approval, tools, refresh/reconnect and disconnect are ready for the owner to test using the quickstart. Signed-in images/mail/long-duration timers and full hosted product cases remain separately pending; local/anonymous success does not mark them done. Current connections remain limited by live project membership, role and board grants.

Docker and owned test containers are stopped; temporary policy browsers are closed. Both uploads and probes finished, so **the laptop can be closed safely** and the hosted connector continues running in Cloudflare. Earlier rollback IDs are retained in CHECKPOINT.md; rollback application artifacts only if needed, retain additive schema27 and safe image policy. No production down-migration or destructive restore is authorized.

GitHub verifies code but does not deploy this project. These UAT uploads used explicit Cloudflare CLI targets after CI/review, without extra Actions jobs. Remaining monthly Actions allowance was not readable; no paid settings changed.
