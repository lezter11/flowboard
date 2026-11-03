# Generated route authentication matrix — 2026-11-03

## Actions

Created an inventory-driven mounted authentication matrix under [frozen criteria v2](criteria/route-auth-matrix.json). [The JSON result](route-auth-matrix-result.json) records exact commands, source/log hashes, coverage counts, exemptions and untested combinations. Only new test/helper and evidence files were changed; root corrected logout metadata and released generator ownership for the final artifact refresh.

The test compares the actual mounted method/path set with OpenAPI and the exact PAT allowlist. A missing, phantom, duplicate or unsupported parameter route fails. Every named body/query fixture is checked against its actual shared/wire Zod schema. Private target reads have successful Owner controls before foreign/grantless checks. All denial cells compare application tables, sequence values and stored-object mutation counts.

## Why and options

A bearer request carrying an Owner cookie must use the bearer capability, rather than silently inherit the cookie's broader permissions. The matrix sends both credentials together on every operation. It also proves the expired credentials were real: the Owner session is expired by its stored hash with a matched row; the PAT verifies before expiry, updates a real row, and fails verification afterward.

Logout is deliberately optional-cookie behavior. Anonymous or expired-cookie logout clears the cookie and returns an empty 204; bearer requests still obey the global restriction. Root corrected the metadata instead of changing that runtime behavior.

## Evidence and limits

Final: **466/466 Node tests**, zero skips, exit 0, representing **465 real HTTP request cells across 103 mounted operations**:

| Cell family | Count |
|---|---:|
| Required-session anonymous / expired cookie | 92 + 92 |
| Admin-secret anonymous / expired cookie | 2 + 2 |
| Valid PAT with Owner cookie | 103 |
| Expired PAT with Owner cookie | 103 |
| Optional logout empty-204 / clear-cookie controls | 2 |
| Additional Owner / foreign / grantless private reads | 23 + 23 + 23 |

All **432 expected denial cells** returned no data/private fixture content and changed no persisted application state, sequence or stored object. Exactly **six PAT capabilities** succeeded: project list, project board discovery, board metadata, project card search, card detail and card creation. The create records the server-derived credential origin and canonical card/board/activity/receipt/sequence effects; it does not invent notification work for an unassigned card.

There are **nine explicit public/local/optional-cookie classifications**. No signed OAuth/provider calls, email, live admin key or cloud mutation occurs. Authentication and PostgreSQL authorization are real; only unrelated limiter ports are deterministic test doubles.

The raw result explicitly lists **80 operations without extra foreign/grantless cookie workflow cells**. Those operations still have the required session/bearer boundary checks; this is not all possible roles, states or payloads, and is not 930 cells.

OpenAPI regenerated: 103 operations / 223 schemas. Contracts **126/126**, typecheck and owned-path diff check exited 0. The first matrix failure and stale golden failure are retained, including the probe expiry/hash and nonexistent counter-table mistakes; they are not reported as runtime security defects.

Early bearer rejections have no Server-Timing header because the timing middleware follows the global bearer policy. That diagnostic remains explicit. This suite uses mounted Hono requests in Node with real PostgreSQL, not hosted/browser/provider acceptance. Root image/JPEG work still changes the shared source; handoff fingerprints are not independent approval of a final immutable target.

## Next / your input

Root completes the remaining source work, full local gate and freeze, then obtains fresh independent reviews before direct UAT and hosted checks. No user action needed. This bounded slice is handed back and source edits stop; the agent remains available for later coordination.
