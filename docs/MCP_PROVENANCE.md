# MCP provenance and reuse

Verified from local Git history and source on 4 November 2026. Active target: `bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a` on `codex/mcp-uat-hardening`. This is a source and lineage explanation, not a fresh backend acceptance review.

## Actions

The active MCP implementation **extends the original implementation; it was not independently recreated as a second MCP service**. Its original files and commits remain in the active branch's history. Some code was substantially rewritten to repair security, retries and packaging, while retaining the same `@flowboard/mcp` package, SDK, local transport, API client and five tool names.

The historical copies are separate Git worktree snapshots, now physically grouped under the main checkout's `archive/worktrees/`. They are useful historical references, but the active build uses this checkout's [`packages/mcp`](../packages/mcp/README.md). The root [`package.json`](../package.json) includes that package as a workspace; it does not import the archived folders. The [physical move journal](project-organization/2026-11-04-restructure.json) preserves old-to-new paths and verification.

| Checkout inspected | Local HEAD | Relationship to active target |
| --- | --- | --- |
| `/Users/shubham/Documents/Flowboard/archive/worktrees/Flowboard-mcp` (`feat/mcp-scoped-token`) | `62ce05f49aed3179bf6af97ffb3f5415512ef392` | Original MCP/scoped-token branch; an ancestor of the active target. Clean after the move; tracked hashes unchanged. |
| `/Users/shubham/Documents/Flowboard/archive/worktrees/Flowboard-gemini` (`feat/gemini-h12-ci-monitoring`) | `2598ae7da55c2b5116c8f65f8334a208937a064f` | Older CI/monitoring branch; an ancestor of the active target, with no commits unique relative to it. Clean after the move; tracked hashes unchanged. |
| Active repair checkout | `bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a` | Contains both histories plus later repairs. |

“Ancestor” means an older commit is already included in the newer branch's history. Moving a historical worktree into the archive does not make that folder part of the running application. `git worktree move` updates its registered location while preserving its branch and source; ordinary folder moves can leave that registration broken.

## Why and options

For a concrete Flowboard example, a host can discover a board's columns and create a card in “To Do.” The original MCP package already provided that path. Reusing it preserved the tool interface; repairing the API permission boundary and create receipt made that path safer. Creating a separate implementation would introduce another set of tool contracts and permission rules to maintain, without resolving the original API weaknesses.

### Commit trail

| Commit | Contribution |
| --- | --- |
| `1ecfaf08294b630a764803b70eb34cb7a711b3b4` | Original API personal access token adapter, bearer middleware, token routes and scoped creation integration. A personal access token (PAT) is a revocable machine credential associated with a human user. |
| `daebeb269f8eb4c450b93b017169c6a76d8ce399` | Created `@flowboard/mcp`, its `src/index.ts`, `src/client.ts` and client tests; added it to the root workspace. |
| `62ce05f49aed3179bf6af97ffb3f5415512ef392` | Corrected original board snapshot response mapping and board structure-version handling. This remains the archived MCP checkout's HEAD. |
| `917706ae0433df471c72736be4d548eb022236c4` | Hardened the inherited MCP/API implementation, including token capabilities, stable create retries and the compiled distribution. |
| `bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a` | Current inspected source after further release/revalidation work and Linux fixture portability changes. |

Every commit above, plus the archived Gemini HEAD, is an ancestor of the active target. Git records the same account as author for the original MCP commits and hardening commit. It cannot establish which AI model wrote a change. The user's attribution of the original work to Gemini is context; the independently verified fact is source reuse and commit continuity.

### What was retained and what changed

| Area | Original contribution retained | Later repair or limit |
| --- | --- | --- |
| MCP shape | SDK server, local standard input/output transport, `FlowboardClient`, five tools | Same tools: `flowboard_list_projects`, `flowboard_list_boards`, `flowboard_get_board_columns`, `flowboard_search_cards`, `flowboard_create_card`. Shared schemas and bounded pagination were added. See [`index.ts`](../packages/mcp/src/index.ts) and [`schemas.ts`](../packages/mcp/src/schemas.ts). |
| Token permissions | Hashed PAT storage, bearer authentication and scope/project concepts | API now denies routes outside six explicit method/path capabilities, retains current human and board permissions, and keeps credential administration session-only. See [`token-policy.ts`](../apps/api/src/http/middleware/token-policy.ts). A scope is a named permission such as `cards:create`; it does not override the person's current access. |
| Board discovery | Board/column lookup for card placement | Server responses explicitly contain metadata only, without cards/counts or board descriptions for PAT discovery. Full board snapshots remain unavailable to PATs. See [`boards.ts`](../apps/api/src/http/routes/boards.ts). |
| Creation | Existing API create-card path and board revision check | Caller supplies a stable `operationId`; card, activity and receipt commit together. Retrying the same input/key within seven days and the same credential returns the original result. This is idempotency: a lost reply can be retried without making a second card. One stale-board refresh is allowed. See [`cards.ts`](../apps/api/src/http/routes/cards.ts) and [`client.ts`](../packages/mcp/src/client.ts). It does not provide permanent external-issue deduplication. |
| HTTP client | Existing API calls and search tool | Correct `query` mapping, URL/input validation, redirect rejection, 10-second default deadline, maximum 30-second configured deadline, 1 MiB response cap and bounded safe errors. See [`client.ts`](../packages/mcp/src/client.ts). |
| Distribution | Original package and test files | Explicit TypeScript build, compiled `dist/index.js` executable, packed-artifact SDK test and root/CI inclusion. See [`package.json`](../packages/mcp/package.json), [`finalize-build.mjs`](../packages/mcp/scripts/finalize-build.mjs) and [`artifact.test.mjs`](../packages/mcp/test/artifact.test.mjs). |

The current MCP server uses local standard input/output, which lets a local host launch the process and exchange protocol messages. It is not a remote HTTP MCP server. Updating an existing card, company installation credentials, OAuth client-credentials authentication and a durable external-alert identity are not implemented MCP capabilities. Ordinary Flowboard API operations outside this tool list do not imply MCP support.

The design rationale and future boundaries are recorded in [Scoped machine operations in the existing API](decisions/2026-11-03-mcp-capability-boundary.md). The [MCP README](../packages/mcp/README.md) explains the actual local configuration and credential/retry behavior.

## Evidence and limits

The initial lineage inspection used read-only local Git/source commands. The later physical organization used `git worktree move` for both historical copies, preserved main/historical tracked hashes and clean historical statuses, retained Gemini's resolving dependency links, and repaired one pre-existing broken MCP contracts dependency symlink. Its original target was `/Users/shubham/Documents/Flowboard-mcp/packages/contracts`; it now points to the archived MCP checkout's own `packages/contracts`. No application source, frozen review evidence, network checks, database operations, credentials or deployment were part of that organization task. See the [journal](project-organization/2026-11-04-restructure.json) for exact operations, checks and undo instructions.

Reproduce the lineage checks from the active checkout:

```sh
git rev-parse HEAD
git log --reverse --format='%H %s' -- packages/mcp
git show --stat 1ecfaf08294b630a764803b70eb34cb7a711b3b4
git show --stat daebeb269f8eb4c450b93b017169c6a76d8ce399
git diff --stat 62ce05f49aed3179bf6af97ffb3f5415512ef392..917706ae0433df471c72736be4d548eb022236c4 -- packages/mcp apps/api
git merge-base --is-ancestor 62ce05f49aed3179bf6af97ffb3f5415512ef392 bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a
git merge-base --is-ancestor 2598ae7da55c2b5116c8f65f8334a208937a064f bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a
git log --oneline bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a..2598ae7da55c2b5116c8f65f8334a208937a064f
```

Both ancestry commands returned exit 0; the final log returned no commits. A search of active `package.json`, `packages`, `apps`, `scripts` and `.github` found no `Flowboard-mcp` or `Flowboard-gemini` path references.

The [original audit](reviews/MCP-REPAIR-20261103/independent-round-2/original-audit-findings.md) found eight issues in `62ce05f` and advised against merging or deploying that version. The subsequent [repair summary](reviews/MCP-REPAIR-20261103/summary.md), [independent report](reviews/MCP-REPAIR-20261103/independent-round-2/review.md), [source manifest](reviews/MCP-REPAIR-20261103/source-manifest-round-2.json) and [passing review record](reviews/MCP-REPAIR-20261103/4a3ccc28fead268148e65d5ee4f5bdef56a921984167dd4e30d909fc0943d84b-round-2.json) preserve the historical 8.98/10 local review of an exact frozen source. That record is evidence of the repair process; this document does not turn it into approval of the current HEAD, current CI, deployed UAT or production behavior.

## Next / your input

Use the active `packages/mcp` implementation for ongoing work and the archived worktrees to understand earlier changes. From the familiar Documents folder, `project-docs/10-MCP-provenance.md` links to this active document. No duplicate implementation or folder merge is needed to obtain their existing commits. No action needed from the user for this provenance check. Any backend closure or deployment remains subject to the current exact-source review and environment-specific acceptance gates.
