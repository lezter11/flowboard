# Zod 3.24.2 to 4.6.7 in packages/contracts — 2026-10-29

Status: applied on `chore/baseline-2026-10-28`. Backend-owned change to a shared contract package; no payload shape, status code or OpenAPI output changed.

## Advisory facts (from `npm audit` and the GitHub advisory API)

- Advisory: GHSA-mrhx-c7xc-m3w5, "Zod can exhaust memory while validating oversized constrained collections". Severity high, CVSS 7.5, CWE-770.
- Affected range as published: `< 4.6.6`. Patched version: `4.6.6`. No 3.x patch is named.
- Our pin `3.24.2` is inside the published range, so 3.x was treated as affected. No 3.x release is named as fixed, so a 3.25.x bump was not a provable fix.
- The fix is therefore a 4.x major upgrade. Gemini's note "4.6.6+ (minor)" was wrong: the bump is major.

## Exploitability for Flowboard

- The API caps request bodies at 1 MiB (`bodyLimitMiddleware`). A probe in a scratch script parsed a 1 MiB array of 524,288 numbers against `z.array(z.number()).max(12)`:
  - zod 3.24.2: about 30 ms and about 50 MB transient heap, then rejected. The `.max()` check runs after every element is parsed.
  - zod 4.6.7: rejected at once (0 ms, no heap growth).
- So a 1 MiB body can trigger the heavy path on 3.x. The probe covers zod only; the real route also pays for `JSON.parse`. Within a Worker memory limit this is a bounded, single-request cost, but concurrent requests could add up. We treat it as a real high-severity item for production and fix it.

## Change

- `packages/contracts/package.json`: `zod` `3.24.2` to `4.6.7` (exact pin).
- `package-lock.json`: the root `zod` entry is now 4.6.7; the two nested `@neon/*` copies of zod 4.6.7 were deduplicated.
- Source adjustments for zod 4 APIs (no behaviour change intended):
  - `z.record(valueSchema)` now takes a key schema: `common.ts`, `discussion.ts`, `imports.ts` use `z.record(z.string(), ...)`.
  - `index.ts` `safeParse` helper returns `z.ZodSafeParseResult<T>` (the v3 `SafeParseReturnType` name is gone).

## Verification (2026-10-29)

- `npm run typecheck` and `npm run typecheck:web`: exit 0.
- `npm test --workspace @flowboard/contracts`: 41 pass, 0 fail, 0 skipped.
- `npm test --workspace @flowboard/api` on a disposable PostgreSQL 17 (port 55493): 409 pass, 0 fail, 0 skipped. Same as the previous run.
- OpenAPI: `packages/contracts/src/openapi/index.ts` does not import zod and is unchanged, so its output is byte-identical by construction.
- `npm audit`: the zod advisory is gone. The remaining findings are listed below.

## Remaining npm audit findings (not forced)

| Package | Severity | Where it sits | Fix path |
|---|---|---|---|
| `postcss` (<=8.5.22) | high | nested under `next` (web build tooling) | `next@16.4.3`, a major bump. UI owner decision. |
| `next` | moderate | `apps/web` dependency | same as above |
| `undici` (7.0.0–7.30.0) | high | via `miniflare` to `wrangler` (dev dependency of `apps/api`) | `wrangler@4.155.0`. Deployment owner decision. |
| `miniflare`, `wrangler` | moderate | local Worker emulator and CLI, dev/deploy only | same as above |

None of these is in the API runtime bundle: `apps/api` runtime dependencies are `@hono/node-server`, `hono`, `kysely`, `pg`. Whether the deployed web output includes `next` depends on the Pages build setup, which the Deployment chat owns.

## Residual risk

- zod 4 can change error message wording. The API error envelope and codes are unchanged, and the full API suite passes. Anything that matches zod message text should be checked by the UI owner.
