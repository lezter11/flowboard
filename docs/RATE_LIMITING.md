# Rate limiting plan (UAT and production)

Status: **proposal, nothing applied.** The API has no rate limiting today, so a single client can call auth, writes, invitations, imports and image uploads as fast as the Worker allows. This document sets the thresholds, says which route can enforce them, and lists the steps that need a human in the Cloudflare dashboard.

**Decision (Architect, 2026-10-29):** Option B (Worker-side rate-limiting binding, section 4) is the plan for now. Backend builds it. Cloudflare WAF rules (sections 1 to 3, 5, 6) stay as the long-term plan and are used only if a custom domain is added later. Nothing is applied to Cloudflare for UAT or production.

Owner: Deployment. Backend may need to add a Worker-side limiter (section 4). Production is not to be touched until the Architect approves.

## 1. What can be enforced where

| Option | Works on `*.pages.dev` / `*.workers.dev`? | Needs | Scriptable with API token? |
|---|---|---|---|
| A. Cloudflare WAF rate-limiting rules | **No.** Rules attach to a zone (a custom domain on your Cloudflare account). The default hostnames are not zones. | A custom domain on Cloudflare for UAT and for production, then the rules | Yes (Rulesets API, token with zone WAF edit) |
| B. Worker rate-limiting binding (`ratelimits` in `wrangler.jsonc`) | **Yes.** It runs inside the Worker, so it covers both hostnames. | Backend code change in `apps/api`, plus a `wrangler deploy` | Yes (it is config in the repo) |

Important limitation for Option B: the binding is **approximate**. Counters are kept separately in each Cloudflare location and are eventually consistent, so a client whose requests are served from several locations can exceed the configured number, and the counts never add up to one global limit. Counters also reset when an isolate is recycled. It softens bursts from one location; it is not an exact quota. The limiter is a soft control: if the binding throws, the request is let through (fail open) and `rate_limit_error` is logged.

Important limitation for Option A: the Pages proxy calls the Worker through a service binding, so Worker-to-Worker traffic does not pass the zone edge. Zone rules only see requests that reach the custom domain, which is what we want for client traffic.

## 2. Plan limits (Cloudflare docs, Oct 2026; verify in the dashboard before relying on them)

| Plan | Rate-limit rules | Counting period | Notes |
|---|---|---|---|
| Free | 1 | 10 s only | Too short for the per-minute targets below |
| Pro | 2 | up to 1 min | Enough for auth + general writes only |
| Business | 5 | up to 10 min | Enough for every rule below |

Current plan for this Cloudflare account: **not confirmed by me.** The user must check it (section 5, step 1).

Counting per minute (60 s period) is available on Pro and Business. Response-code counting (for example 401/403) needs Business.

## 3. Rules

Thresholds are per client IP, per 60-second period. "Block" means the action is `block` with the mitigation duration shown. Each rule uses the same expression on both UAT and PROD; only the host differs.

| # | Name | Match expression (Wirefilter) | Threshold / period | Action and duration | Plan |
|---|---|---|---|---|---|
| R1 | `fb-auth-google` | `starts_with(http.request.uri.path, "/api/v1/auth/google")` | 10 requests / 60 s | Block, 60 s | Pro+ |
| R2 | `fb-writes` | `starts_with(http.request.uri.path, "/api/v1/") and http.request.method in {"POST" "PATCH" "PUT" "DELETE"}` | 60 requests / 60 s | Block, 60 s | Pro+ |
| R3 | `fb-invitations` | `http.request.method eq "POST" and http.request.uri.path matches "^/api/v1/projects/[^/]+/invitations$"` | 10 requests / 60 s | Block, 300 s | Business |
| R4 | `fb-imports` | `http.request.method eq "POST" and (http.request.uri.path matches "^/api/v1/boards/[^/]+/(card-)?imports$" or http.request.uri.path matches "^/api/v1/(card-)?imports/[^/]+/commit$")` | 5 requests / 60 s | Block, 300 s | Business |
| R5 | `fb-image-upload` | `http.request.method eq "POST" and http.request.uri.path matches "^/api/v1/(cards/[^/]+/image-uploads|image-uploads/[^/]+/finalize)$"` | 10 requests / 60 s | Block, 300 s | Business |

R3, R4 and R5 are stricter than R2 and overlap with it. Cloudflare evaluates each rule separately, so one invitation POST counts toward both R2 and R3.

Choosing the plan:
- Business: deploy R1 to R5 as written.
- Pro: deploy R1 and R2 only. R3 to R5 stay unprotected at the zone edge until Option B is in place.
- Free: not enough for this design. Use Option B.

Routes not covered by these rules (reads of `GET /api/v1/...`) are not rate limited at the edge. Board reads still need the session and grant checks.

## 4. Option B: Worker-side limiter (built in `apps/api`; approximate, fail-open)

Proposed `apps/api/wrangler.jsonc` addition (binding name and namespace id are placeholders; Backend to confirm the exact schema against the wrangler 4.152.0 config schema before use):

```jsonc
"ratelimits": [
  { "name": "WRITE_LIMITER", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } }
]
```

The implemented bindings are `FB_RL_AUTH`, `FB_RL_WRITES`, `FB_RL_INVITE`, `FB_RL_IMPORT` and `FB_RL_UPLOAD` (limits 10, 60, 10, 5 and 10 per 60 s), with namespace ids 1001-1005 in production and 2001-2005 in UAT. The Worker returns `429` with `TOO_MANY_REQUESTS` and `Retry-After: 60` when a binding refuses. Period must be 10 or 60 seconds for this binding. Key: the `cf-connecting-ip` header, which Cloudflare sets. Forwarding headers are never read.

This is the only option that works on the default hostnames today, so it is the fallback if the custom domains are not ready. It is not an exact limit. Exact limits need either a custom-domain WAF rule (section 3; its counting accuracy is not confirmed here and must be checked in Cloudflare's WAF documentation before it is relied on) or Durable Objects, which are not built. Revisit with real traffic or a custom domain.

## 5. Dashboard steps the user must do (no token needed)

Labels in the Cloudflare dashboard change; if a label differs, look for the nearest match under the same menu.

1. Check the plan: Cloudflare dashboard → select the zone (custom domain) → Overview → "Plan" in the right-hand panel. If there is no zone yet, skip to step 2.
2. Add custom domains for UAT and PROD (zone DNS, then Pages → project → Custom domains). This is a prerequisite for Option A. It changes public DNS, so it needs the Architect's yes.
3. For each rule in section 3 (Business plan: all five; Pro: R1 and R2):
   1. Zone → Security → WAF → Rate limiting rules → Create rule.
   2. Name: the name from the table.
   3. Expression: paste the expression from the table into the custom filter expression box.
   4. Characteristics: IP.
   5. Period: 1 minute. Requests: the threshold from the table.
   6. Mitigation timeout and action: Block, duration from the table.
   7. Deploy. Repeat per rule.
4. After deploying, confirm on the rule list that each rule shows "Active" and the expression matches the table.

## 6. What can be scripted with an API token

Option A can be scripted through the Rulesets API (`http_ratelimit` phase) using a zone-scoped token with "Zone WAF: Edit" permission. The user creates the token in the dashboard, with the minimum scope, and keeps it out of chat and git. The exact request body must be checked against the current Rulesets docs before the first run. Deletion is out of scope for this document.

Option B is scripted through the normal `wrangler deploy --env uat` path. It needs no extra token.

## 7. Verification after applying

- UAT: send 11 requests in a minute to `/api/v1/auth/google` from one IP; the 11th should return a Cloudflare block page or 429. Record the count and response in `docs/UAT_DEPLOY.md`.
- UAT: send 61 `POST` requests in a minute to a write route; the 61st should be blocked.
- Do not run these against production.
- Normal sign-in and card moves must still work after the rules are active.

## 8. Not decided here

- Whether the invitation, import and upload limits sit on the zone or in the Worker. Recommendation: zone rules on Business; Worker limiter on Pro or Free.
- Mitigation durations above are starting values, not measured.
- Response-code rules (for example "5 failed sign-ins") need Business and a separate design.
