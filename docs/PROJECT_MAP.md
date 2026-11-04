# Flowboard project map

Verified against local files on 2026-11-04. This is a navigation guide, not a release approval. The organization work physically groups historical checkouts and provides current-document shortcuts; CI repair, application changes and deployment have separate owners and evidence.

## Start here

1. Read [the current task tracker](../flowBoardTasks.md) for the immediate organizational/release sequence, then [TASKS.md](../TASKS.md) and the latest entries in [PROGRESS.md](../PROGRESS.md). Older entries remain historical and can describe superseded plans.
2. Read [RULES.md](../RULES.md) and [AGENTS.md](../AGENTS.md) before editing. This is a shared checkout: coordinate ownership before changing someone else's files.
3. Use [PRD.md](../PRD.md) for product intent, [ARCHITECTURE.md](../ARCHITECTURE.md) for the system and [DESIGN.md](../DESIGN.md) for visual direction. The architecture's current checkpoint precedes older proposal sections.
4. For feature work, use [FEATURE_SPEC.md](FEATURE_SPEC.md), [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md), [IMPORT_SPEC.md](IMPORT_SPEC.md), [the handoff rules](handoffs/README.md), [the engineering checklist](ENGINEERING_CHECKLIST.md) and [the reference catalogue](references/README.md). [features.tsv](features.tsv) supplies stable feature definitions.
5. For the machine integration, read [MCP provenance](MCP_PROVENANCE.md), then [the MCP package guide](../packages/mcp/README.md).

The root [README](../README.md) now links the current checklist and this map. Some older documents, including `database/README.md`, contain early statements such as “not implemented yet.” Those are historical descriptions, not a reliable inventory of today's files. The map below follows the present source; current acceptance still requires its own evidence.

## Which folder should I edit?

**For this active task, edit `/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard`, on branch `codex/mcp-uat-hardening`.** Do not edit the archived older copies to fix the active application. In the familiar Documents folder, open `/Users/shubham/Documents/Flowboard/project-docs` for numbered links to the current active documents, or start at its `START_HERE.md`.

A Git **worktree** is another working folder for the same repository, usually checked out on another branch. It has its own visible files and local edits, while sharing Git history with the other worktrees. For example, changing the card editor in the active worktree does not change the card editor files in the older MCP worktree; the change becomes shared history only when it is committed and integrated. A worktree is neither a backup nor a second hosted deployment.

Four task-relevant worktrees were verified:

| Local folder | Branch | Verified HEAD | Role |
|---|---|---|---|
| `/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard` | `codex/mcp-uat-hardening` | `bf047e085f50c2c74dfbd640dc01ca37f5ba4f8a` | Active source and organizational work |
| `/Users/shubham/Documents/Flowboard` | `chore/baseline-2026-10-28` | `7c6418a6867a3e5cebd09b21754f8bcc9fdba2f2` | Older main working folder; preserve its unrelated local changes |
| `/Users/shubham/Documents/Flowboard/archive/worktrees/Flowboard-mcp` | `feat/mcp-scoped-token` | `62ce05f49aed3179bf6af97ffb3f5415512ef392` | Preserved historical MCP development snapshot |
| `/Users/shubham/Documents/Flowboard/archive/worktrees/Flowboard-gemini` | `feat/gemini-h12-ci-monitoring` | `2598ae7da55c2b5116c8f65f8334a208937a064f` | Preserved historical CI/monitoring development snapshot |

Both historical worktrees remained clean after the physical moves, with unchanged HEADs and tracked file hashes. Their HEAD commits, and the main folder's HEAD, are ancestors of the inspected active HEAD: the active history already contains those commits. No merge is needed to incorporate those snapshots. This does not compare or incorporate unrelated uncommitted edits in the main folder.

Git's registry initially listed the historical worktrees under former sibling locations, `/Users/shubham/Documents/Flowboard-mcp` and `/Users/shubham/Documents/Flowboard-gemini`. The initial navigation pass repaired registrations to the then-existing nested folders without moving them; see [that historical inventory](project-organization/2026-11-04-inventory.json). The subsequent user-requested physical pass used `git worktree move` to group both under `archive/worktrees/`, preserving Git registrations and branches. The [physical move journal](project-organization/2026-11-04-restructure.json) records before/after HEADs, hashes, statuses, operations and undo commands. The registry also includes temporary audit/release worktrees, which were not moved or pruned.

### Human-facing folder structure

The familiar main checkout now separates current navigation from historical copies:

```text
/Users/shubham/Documents/Flowboard/
  START_HERE.md                 local entry point to the active work
  project-docs/                 14 numbered shortcuts to active canonical documents
  apps/, packages/, database/   older main checkout source; preserved in place
  docs/, design/, scripts/      existing documents, evidence, prototype and tooling
  archive/
    README.md                  explains preserved history and the move journal
    worktrees/Flowboard-mcp/    historical Git worktree, unchanged tracked bytes
    worktrees/Flowboard-gemini/ historical Git worktree, unchanged tracked bytes
    retired-layout/contracts/  empty former root folder, preserved
```

The `project-docs` entries are symbolic links: opening one follows it to the active original, so editing the link edits that original rather than creating a second copy. They are local-machine navigation and depend on the active checkout retaining its recorded path. The older main checkout's six baseline planning/review documents (`ARCHITECTURE.md`, `BACKEND_REVIEW_GATE.md`, `DESIGN.md`, `PRD.md`, `PROGRESS.md`, `TASKS.md`), `node_modules/` and generated `package-lock.json` have reversible Finder-only hidden flags. Their original paths and bytes remain accessible to tooling; Finder's Command-Shift-Period shows hidden entries, and `chflags nohidden PATH` reverses each flag. `README.md`, `START_HERE.md`, `AGENTS.md`, `RULES.md` and source/build configuration remain visible. Finder-visible main-root entries decreased from 25 to 16; this combines real folder moves with explicit presentation changes.

Gemini's existing absolute dependency links still resolve to the main dependencies. One pre-existing broken MCP contracts dependency link, pointing to the former sibling location, was repaired to the archived MCP checkout's own `packages/contracts`. The current shared schemas remain at `packages/contracts/`; the archived empty root `contracts/` was unused. Do not stage the historical worktree directories as application additions. Frozen evidence keeps its original paths and historical path references.

## Source navigation

The root [package.json](../package.json) defines four npm workspaces. An npm workspace groups related packages under one dependency lockfile; it is different from a Git worktree.

| Location | What belongs here | First useful stop |
|---|---|---|
| [apps/api](../apps/api/) | Backend API, authorization, database adapters, jobs and runtime entry points | [http/app.ts](../apps/api/src/http/app.ts) wires the Hono application |
| [apps/web](../apps/web/) | React/Next.js application, browser state, UI tests and Pages Functions | [src/app](../apps/web/src/app/), [components](../apps/web/src/components/), [lib/api.ts](../apps/web/src/lib/api.ts) |
| [packages/contracts](../packages/contracts/) | Shared Zod validation schemas, TypeScript types, fixtures and OpenAPI definitions | [src/index.ts](../packages/contracts/src/index.ts), [src/openapi](../packages/contracts/src/openapi/) |
| [packages/mcp](../packages/mcp/) | Local MCP server executable, API client, tool schemas and package tests | [src/index.ts](../packages/mcp/src/index.ts), [src/client.ts](../packages/mcp/src/client.ts), [src/schemas.ts](../packages/mcp/src/schemas.ts) |
| [database/migrations](../database/migrations/) | Ordered PostgreSQL schema changes, currently `0001` through `0026` | [API migration runner](../apps/api/src/adapters/migrations.ts), [runtime entry](../apps/api/src/runtime/migrate.ts) |
| [database/prototypes/d1](../database/prototypes/d1/) | Original SQLite/D1 prototype | [Historical initial schema](../database/prototypes/d1/migrations/0001_initial.sql) |
| [design/flowboard-ui](../design/flowboard-ui/) | Standalone HTML/CSS/JavaScript visual and interaction prototype | [Prototype README](../design/flowboard-ui/README.md), [brand guide](../design/flowboard-ui/brand/design.md) |
| [scripts](../scripts/) | Review/checklist tooling, artifact generators, browser diagnostics and staging helpers | [render_feature_checklist.py](../scripts/render_feature_checklist.py), [e2e](../scripts/e2e/) |
| [.github/workflows](../.github/workflows/) | Build, test and release automation definitions | CI work has its own owner; the organizational pass does not change workflows |

Backend owns `apps/api` and `database`; UI owns `apps/web`; Architect coordinates shared contracts and root tooling. Ownership prevents two chats from silently changing the same save-card payload in different ways.

### API: one application with runtime entry points

Hono is the HTTP routing framework: it matches a request such as “save this card” to its handler. It is not the database. Follow:

- [src/http/routes](../apps/api/src/http/routes/) for request parsing and route behavior, and [src/http/middleware](../apps/api/src/http/middleware/) for cross-cutting request checks.
- [src/adapters](../apps/api/src/adapters/) for persistence, authorization and integrations; [cards.ts](../apps/api/src/adapters/cards.ts) and [postgres.ts](../apps/api/src/adapters/postgres.ts) are useful examples.
- [src/services](../apps/api/src/services/) for supporting logic such as image verification, Excel parsing and trash purge.
- [runtime/node.ts](../apps/api/src/runtime/node.ts) and [runtime/worker.ts](../apps/api/src/runtime/worker.ts) for Node and Cloudflare Worker setup. These are two ways to run the same application, not two independently owned APIs.
- [apps/api/test](../apps/api/test/) for local behavior verification; tests must be read with their database/runtime setup and evidence scope.

PostgreSQL migrations are current implementation source. The embedded Worker migration module is generated from them via [sync-embedded-migrations.ts](../scripts/sync-embedded-migrations.ts). The D1 prototype remains historical evidence; its SQLite checks cannot establish PostgreSQL transaction or concurrency behavior. Migration files existing locally do not establish which migrations a hosted database has applied.

### Web: Next.js source, static export and Pages Functions

The application source is Next.js/React, not the standalone design prototype. [next.config.ts](../apps/web/next.config.ts) enables static export when `NEXT_EXPORT=true`; ordinary development has a Next.js API rewrite. Deployment preparation uses exported assets plus separate Cloudflare Pages Functions.

- [src/app](../apps/web/src/app/) defines screens/routes; [src/components](../apps/web/src/components/) holds UI; [src/lib](../apps/web/src/lib/) holds API access and state logic; [public](../apps/web/public/) holds source assets.
- [functions/api/[[path]].ts](../apps/web/functions/api/[[path]].ts) forwards same-origin `/api/*` requests to the API Worker. [functions/_middleware.ts](../apps/web/functions/_middleware.ts) and the other route Functions are separate hosting code.
- [stage-pages-functions.mjs](../scripts/stage-pages-functions.mjs) stages Functions and their local imports. An exported `out/` folder alone does not describe the complete hosted request path.
- [apps/web/test](../apps/web/test/) contains web tests; [scripts/e2e](../scripts/e2e/) contains browser/integration diagnostics. Source tests are separate from signed-in hosted acceptance.

For a card save, the browser UI calls its API client, the Pages proxy forwards the request, Hono dispatches it, the adapter checks authority and updates PostgreSQL, and the response reconciles browser state. For local development the proxy stage can differ. This map describes source connections, not proof that every stage currently succeeds on UAT.

### MCP: an additional client of the same API

MCP (Model Context Protocol) lets an assistant call named tools. `packages/mcp` implements a local stdio server: the host starts a process and exchanges protocol messages through standard input/output. Its client calls Flowboard's HTTP API; it does not replace API authorization or access PostgreSQL directly. API token routes/middleware and shared token schemas live in `apps/api` and `packages/contracts`, so a change to machine access can span all three packages. See [MCP provenance](MCP_PROVENANCE.md) for the branch and integration history.

## Documentation and evidence navigation

| Location | Purpose and limits |
|---|---|
| [docs/FEATURE_SPEC.md](FEATURE_SPEC.md), [API.md](API.md), [IMPORT_SPEC.md](IMPORT_SPEC.md), [FRONTEND_BEHAVIOR_SPEC.md](FRONTEND_BEHAVIOR_SPEC.md) | Feature, API, import and UI behavior specifications. They define expected behavior; they do not prove implementation. |
| [docs/decisions](decisions/) | Recorded choices, alternatives and consequences. Check dates and later decisions before applying an old proposal. |
| [docs/references](references/README.md) | Original visual references, interpretation and checksums. Reference content does not create business requirements. |
| [docs/research](research/) | Supporting research and alternatives. Current canonical scope takes precedence. |
| [docs/handoffs](handoffs/README.md) | Role-owned backend, UI and integration evidence records; proposals remain distinct from accepted behavior. |
| [docs/reviews](reviews/README.md) | Frozen manifests, independent review records, logs and failed/passing rounds. [FULL-REVALIDATION-20261103](reviews/FULL-REVALIDATION-20261103/) and [MCP-REPAIR-20261103](reviews/MCP-REPAIR-20261103/) are key recent entry points. |
| [docs/audits](audits/README.md) | Index to retained audit findings and externally stored reports. |
| [docs/evidence](evidence/) | Supporting local/integration observations; each claim is bounded by its recorded environment and target. |
| [docs/FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md) | Generated status from stable definitions and role-owned evidence. Do not hand-edit checkboxes. |
| [docs/openapi.json](openapi.json) | Generated API description from shared contract definitions; generation/check tooling is in [scripts/generate-openapi.ts](../scripts/generate-openapi.ts). |
| [outputs](../outputs/) | Exported deliverables such as the Excel import template. A valid template file does not verify the importer. |

A frozen manifest records exact file hashes, so a reviewer can say which source bytes were reviewed. Moving or deleting a referenced file can invalidate that link even when its contents appear unchanged. Preserve frozen review/audit folders, failed rounds and referenced artifacts in their current paths during this pass. A passing local review is tied to its target and does not approve a newer source snapshot or establish hosted acceptance. Backend closure follows [BACKEND_REVIEW_GATE.md](../BACKEND_REVIEW_GATE.md).

## Generated files and bounded cleanup

`node_modules/`, API/MCP `dist/`, web `.next/`, web `out/`, `tsconfig.tsbuildinfo`, caches and temporary logs can appear next to source. These are dependencies or generated/runtime outputs, not the primary place to edit behavior. Some generated artifacts are intentionally checked in or referenced by evidence: regenerate them through their owner tool and review the diff; do not assume every generated file is disposable.

The completed physical pass groups the two historical worktrees and empty retired folder. A later cleanup can classify other unreferenced caches/logs and obsolete prose after ownership and references are checked. Its benefit is a smaller folder tree; its risk is breaking reproducibility or losing unrelated local work. No cache deletion, worktree/branch removal, evidence relocation or evidence regeneration was performed here.

## Evidence and next step

This map was checked with bounded directory/source reads, package/config inspection, `git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain`, `git worktree list --porcelain` and `git merge-base --is-ancestor`. The physical pass additionally compares tracked SHA-256 file hashes before/after for the main and both historical worktrees, verifies clean historical statuses and unchanged HEADs, resolves dependency/document symlinks, and records Finder flags. All twelve preservation/navigation checks passed in the [move journal](project-organization/2026-11-04-restructure.json). The main folder and active folder had pre-existing local changes/evidence. No application tests, Docker startup, network probes, CI implementation or deployments were performed by this organization task; concurrent owners record their work separately.

Continue using [flowBoardTasks.md](../flowBoardTasks.md) for the agreed next task. Source layout, local test results, independent review approval and hosted behavior remain separate evidence levels. No action is needed from the user to use this map.
