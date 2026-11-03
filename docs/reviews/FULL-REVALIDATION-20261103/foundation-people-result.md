# Schema-bearing OpenAPI and user-directed People policy: builder handoff

## Actions

- Added build-time native Zod4 schema generation and `openapi:generate` / `openapi:check` npm scripts, without new dependencies or runtime generation. Current `docs/openapi.json` has103 explicit mounted operations and221 components.
- Preserved metadata exports and the original consumer interface. Documented exact route aliases, retired410 transfer/workspace paths, OAuth/session/PAT/admin authority, six bearer capabilities, idempotency, queries, normal/replay/auth-specific response variants and binary/CSV/204 shapes.
- Added actual mounted-registration parity, emitted-JSON-schema fixture validation and synthetic mounted wire checks. Missing/phantom routes, wrong wire fixtures, private PAT metadata or retained replay bodies fail checks.
- Implemented the user's explicit full People directory decision under pre-frozen `criteria/people-directory-policy.json`: Owner/current Project Manager only, including emails; Member/Viewer403 without data, outsider/removed404. Workspace/member read locks cover directory assembly; archived admin reads remain allowed. Board-scoped public pickers remain available under their existing rules.

The paired JSON lists14 owned paths, exact hashes, commands, source differences and preserved failures. Runtime changes in this slice are restricted to the directory guard; root package contribution adds scripts only.

## Why and options

An OpenAPI file with schema references describes the actual fields a client sends/receives. Merely listing route names cannot catch a misspelled path, a JSON response wrongly used for a CSV download, or a full Board response incorrectly promised to a metadata-only credential. The generator uses the shared Zod objects plus explicit source-grounded wire projections, then fixtures and mounted responses check those shapes. JavaScript semantic refinements and current database authority still need the real validators/handlers; structural schema conversion does not replace them.

The directory policy is now a user decision, not an inferred tightening. A Project Manager can administer people in that project even without a board grant; a Member can still pick eligible assignees/mentions on a board they may use, while receiving no email directory. Both race directions are checked: demotion that wins prevents disclosure; an already authorized read can finish before demotion.

## Evidence and limits

| Check | Actual result |
|---|---|
| Original metadata parity baseline |0 passed,2 failed,exit1 |
| New People policy baseline |1 passed,3 failed,exit1 |
| Mounted wire + People real PostgreSQL checks |8 passed,0 failed,0 skipped,exit0 |
| Normal legacy directory/board-access checks |45 passed,0 failed,0 skipped,exit0 |
| Final contracts |123 passed,0 failed,0 skipped,exit0 |
| Final registration/PAT inventory-only checks |3 passed,0 failed,exit0 |
| openapi:check |Exit0 |
| Most recent root typecheck |Exit1 solely on concurrent lifecycle test UUID typing at `boards-lifecycle-repair.test.ts:115-116`; owner notified. Earlier phase typechecks passed. |

New mounted cases used fresh schemas in disposable `flowboard_identity_extra_test` on loopback55931. The normal legacy suites used root-reserved primary/access databases sequentially and applied current filesystem migrations (including lifecycle0024); those databases are released. No real OAuth/provider/email/cloud/deployment was involved. Preserve both failing baselines and the current typecheck failure log; no score, feature closure or independent approval is claimed.

True convenience-schema/wire differences are explicit: empty logout vs historical JSON schema; board lifecycle omitting workspaceId/description; nested image gallery; card detail people; search counts; minimal replay; nullable last location; route-specific admin/Worker bootstrap errors lacking requestId; archive handlers not consuming expectedVersion bodies. These projections document source instead of quietly changing shared public types. Full People directory still has no explicit SQL pagination; no measured grandfathered-data response bound is claimed.

**Concurrent Root My Tasks reopen:** Root is adding mandatory QRY03 cursor/due-state filtering. The old custom `wire('MyTasksQuery',...)` and `wire('MyTasksResponse',...)` definitions in `schemas.ts` now collide with the newly added shared names. Root explicitly owns removing those legacy projections, binding its shared new schemas, refreshing workspace query/docs/metadata/wire expectations and regenerating immediately after handoff. The earlier8-pass mounted run predates that concurrent change; it is not final proof of the new My Tasks shape.

## Next / your input

Source is free for Root's My Tasks binding update and final stable-generation pass. Lifecycle test typing needs its owner fix, then full local build/API/access/UI/integration checks and fresh independent full-target review remain. UI owner has the new directory policy and stable API errors. Hosted OAuth/provider/deployed privileges/provenance and signed-in workflow acceptance remain UAT pending after local gates and direct UAT. No dev/production, commit, push or deployment occurred. No user action needed.
