# Flowboard

Flowboard is a customizable team Kanban application. Projects contain boards, boards contain columns and cards, and access is checked for each project and board. [GitHub repository](https://github.com/lezter11/flowboard).

## Start here

**Hosted Claude connector and copyable card prompts are deployed to UAT.** [Connect without Terminal or copied tokens](docs/HOSTED_MCP_QUICKSTART.md). [Current release evidence and production gate](docs/reviews/PROD-MCP-20261105/SUMMARY.md).

1. **[flowBoardTasks.md](flowBoardTasks.md)** — ordered checklist: organization, CI repair, review, UAT deployment and hosted testing.
2. **[Project map](docs/PROJECT_MAP.md)** — which checkout to edit, where code lives and how documentation is organized.
3. **[MCP provenance](docs/MCP_PROVENANCE.md)** — original implementation, subsequent repairs and future capabilities.

**Current release, 2026-11-05:** repaired application `f32eafa` is deployed to UAT after independent local reviews and all22CIsteps passed. Exact deployed Worker bytes and anonymous17/17 checks match; the15-minute anonymous/scheduled observation has0CPUterminations/0exceptions plus one unresolvedbaselinepoolwarning. Signed-in runtime coverage remains pending. **Production remains on its restored previous release** after the earlier CPU-limit failures. Database ledger27 is retained; no migration is rerun. Fresh production backup disposition is pending. Docker is stopped. [Live release checklist](docs/reviews/PROD-MCP-20261105/cpu-release-f32eafa/RELEASE-CHECKLIST.md), [preserved incident](docs/reviews/PROD-MCP-20261105/CPU-INCIDENT.md).

## Source layout

| Folder | Purpose |
|---|---|
| [apps/api](apps/api/) | Hono API, Node/Worker entry points, PostgreSQL adapters, authorization and jobs |
| [apps/web](apps/web/) | Next.js/React application and Cloudflare Pages Functions |
| [packages/contracts](packages/contracts/) | Shared validation, types and API schemas |
| [packages/mcp](packages/mcp/README.md) | Local MCP server: discover projects/boards/columns, search and create cards |
| [database/migrations](database/migrations/) | PostgreSQL schema changes; the D1 prototype is historical |
| [design/flowboard-ui](design/flowboard-ui/) | Standalone design prototype, separate from the application |
| [docs](docs/PROJECT_MAP.md#documentation-and-evidence-navigation) | Specifications, decisions, references, handoffs and preserved audit evidence |
| [scripts](scripts/) | Build, verification, checklist and diagnostic tooling |

The `archive/worktrees/Flowboard-mcp` and `archive/worktrees/Flowboard-gemini` folders in the main Documents checkout are older linked Git worktrees. Their commits already exist in the active branch. They are not additional runtime dependencies. Open [Flowboard.code-workspace](Flowboard.code-workspace) in a compatible editor for a named active workspace with generated dependency/build folders hidden. Original source and audit evidence stay in place.

## Product and engineering documents

| Document | Purpose |
|---|---|
| [PRD.md](PRD.md) | Product intent and users |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, boundaries, data flow and portability |
| [DESIGN.md](DESIGN.md) | Visual and interaction guidance |
| [RULES.md](RULES.md), [AGENTS.md](AGENTS.md) | Working constraints, ownership and teaching format |
| [TASKS.md](TASKS.md), [PROGRESS.md](PROGRESS.md) | Product tasks and evidence; latest entries supersede older states |
| [Feature specification](docs/FEATURE_SPEC.md), [98-feature checklist](docs/FEATURE_CHECKLIST.md) | Expected behavior and generated evidence status |
| [Import specification](docs/IMPORT_SPEC.md), [API](docs/API.md) | Import rules and interface documentation |
| [Backend gate](BACKEND_REVIEW_GATE.md), [handoffs](docs/handoffs/README.md) | Independent acceptance and role-owned evidence |
| [Engineering checklist](docs/ENGINEERING_CHECKLIST.md), [references](docs/references/README.md) | Stable concerns and original UI references |
| [Stack explained](docs/LEARNING.md), [research](docs/research/) | Plain-English explanations and alternatives |

The [Excel template](outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx) and importer source exist. Template validity, current CI acceptance and deployed import behavior are separate claims. Early prototype documentation and historical scores are not current approval.
