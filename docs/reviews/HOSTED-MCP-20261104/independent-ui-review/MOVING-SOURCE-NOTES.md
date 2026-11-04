# Moving-source notes — no acceptance verdict

2026-11-04. Root requested a focused independent source trace while the builder is still mutable. No source manifest, score, final finding or passing test claim is made here. Recheck all notes against the final hold.

## Observed safeguards to verify at hold

- `hosted-mcp-api.ts`: request deadline remains active through response JSON consumption; successful responses require exact status, including disconnect204; schema parsing refuses unexpected credential fields. These are source observations, not independent executed regressions yet.
- `connect/page.tsx`: exact request parser; blank required project; deny omits project; synchronous ref prevents duplicate posts; failed decision0/5xx becomes unknown; paging keeps selected project and replaces canonical response through merger; expiry clears view.
- `hosted-mcp-state.ts`: fixed Claude callback origin/path and local issuer; project-page merge replaces CSRF. Candidate: query presence is checked by truthiness for `code`, so `code=&error=access_denied` passes the helper. Backend is not expected to emit this shape, and there is no attacker-controlled destination; report as defence-in-depth contract weakness, not an exploitable redirect.
- `session.tsx` / `session-state.ts`: actor/access fingerprint invalidates protected query cache; consent component remounts on access fingerprint; Connections uses actor-scoped query and mounted component key. PollingProvider polls session while visible and wakes on focus. Actual account-switch timing/race behavior remains a required browser check.
- `connections-panel.tsx`: refused refresh hides stale list; unmount prevents obsolete async result state; disconnect busy/ref guard; shared DialogLayer provides Escape, focus trap/return and inert background. Actual keyboard and focus execution remains required.
- `google-auth.ts`: exact safe-next consent handle carried in HttpOnly state cookie and revalidated at success; failure continuation retained only when query state matches saved state; provider error text not reflected.
- Pages proxy: same public Request URL through private API binding; protocol traffic cannot fall back to rewritten API_ORIGIN; metadata allowlist bypasses sign-in middleware. Actual compiled static Functions routing remains mandatory and untested here.

## Evidence still needed

Stable enabled browser runner; held source hashes; independent focused tests; complete HUI09/11/13/14 runtime checks, including browser identity switch, all listed safe refusal/unknown states,320px/200% keyboard behavior and built Pages routes. Source traces do not close those cases. No real Google/Claude/hosted acceptance is implied by synthetic provider exchange.
