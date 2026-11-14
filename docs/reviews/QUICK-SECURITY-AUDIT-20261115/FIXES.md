# November 15 security repairs

This candidate addresses the four application findings in the [quick audit](AUDIT.md). The audited dependency advisories remain open as maintenance items. The audit did not reproduce their reported paths through Flowboard.

| Finding | Change |
| --- | --- |
| FB-QA-01 High | Google sign-in uses the provider's permanent account identifier. Linking an existing account requires an explicit same-origin request and the same live Flowboard session at callback. A verified address occupied by another account cannot move project grants or accept an invitation through stale account data. |
| FB-QA-02 Medium | Card detail locks and verifies access, then loads the current version of the card in the same transaction. The read and revocation serialize. Machine responses still omit Drive links. |
| FB-QA-03 Medium | Disable public Worker hostnames and preview URLs for production and UAT. The Worker also rejects non-HTTPS requests before authentication. Canonical health checks reach the Worker through the existing private Pages service binding. |
| FB-QA-04 Low | Pages sets a one-year HTTPS-only browser policy (HSTS) on static and Functions responses. The policy applies to the Flowboard hostname. |

## Hosted release sequence

1. Validate the first rollout on UAT. Cover new Google sign-in, an existing signed-in user linking from Account Settings, a linked user signing out and returning, signed-out recovery, and a real Claude connection. Prepare account communications and an authorized recovery contact before applying this to production. [Account migration and recovery](../../GOOGLE_ACCOUNT_RECOVERY.md)
2. Publish Pages first and verify both canonical health endpoints through the current Worker. Users can use the new account-link UI once the matching API is in service. Check for integrations pointed at the direct Worker hostname and move them to the canonical HTTPS Pages hostname.
3. Back up the target database and apply migration `0030_google_account_subject.sql` before deploying the new API. Confirm the migration and preserve the backup. Never infer existing identities from email. Rolling back to the legacy OAuth callback would reopen the takeover path, so follow the recovery guide if the Google flow must be suspended.
4. Deploy the matching Worker and apply its triggers and routing configuration. Verify that Cloudflare has disabled `workers_dev` and `preview_urls`. Confirm that the previous direct origin no longer serves Flowboard over HTTP or HTTPS and that canonical Pages and MCP still work over HTTPS. [Cloudflare Worker routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
5. Check `Strict-Transport-Security: max-age=31536000` on an HTTPS `/signin` response and generated redirects/API responses. Check both canonical health endpoints, anonymous session refusal and an authenticated MCP connection. [Cloudflare Pages response headers](https://developers.cloudflare.com/pages/configuration/headers/)

This is a local candidate. Hosted verification and release are separate.
