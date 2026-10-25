# Flowboard

A customizable collaborative Kanban application inspired by Azure Boards, with its own UI. Source repository: [lezter11/flowboard](https://github.com/lezter11/flowboard). Current phase: feature specification complete; first local backend foundation handed off. No hosted application is verified.

## Canonical project documents

| File | Purpose |
|---|---|
| [PRD.md](PRD.md) | What we are building, users, scope and acceptance |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack recommendation, folders, transactions, data flow and portability |
| [DESIGN.md](DESIGN.md) | Reference-informed colors, typography, components and pending visual decisions |
| [RULES.md](RULES.md) | Coding/agent constraints, evidence and teaching response format |
| [TASKS.md](TASKS.md) | Small ordered tasks and ownership |
| [PROGRESS.md](PROGRESS.md) | Observed results, issues and next inputs |

Start with the [98-feature checklist](docs/FEATURE_CHECKLIST.md), [detailed feature flows](docs/FEATURE_SPEC.md), [Excel import specification](docs/IMPORT_SPEC.md) and [Backend-to-UI handoffs](docs/handoffs/README.md). Then read [the 50-item engineering checklist](docs/ENGINEERING_CHECKLIST.md), [API contract](docs/API.md), [reference catalogue](docs/references/README.md), [access setup](docs/ACCESS_SETUP.md) and [the stack explained in simple English](docs/LEARNING.md).

## Research and validation

[Stack comparison](docs/research/stack-comparison.md), [data reliability 01–25](docs/research/reliability-data.md), [runtime reliability 26–50](docs/research/reliability-runtime.md), [initial backend research](docs/research/backend-research.md) and [product research](docs/research/product-research.md). Research records alternatives; root architecture/product documents and API contract govern implementation.

The v0.2 recommendation is PostgreSQL with Hono on an initial Cloudflare Worker, plus a real Node target. It has not been benchmarked or implemented. The original [D1 prototype](database/prototypes/d1/migrations/0001_initial.sql) is preserved; run `python3 scripts/check_schema.py` for 11 local SQLite checks. These do not validate PostgreSQL or hosted behavior; see [verification](docs/VERIFICATION.md).

## Working chats

Flowboard Architect owns architecture/shared contracts and integration review. Flowboard Backend owns the future API/database. Flowboard UI owns the future interface. All read the same six root documents and reference catalogue, following [AGENTS.md](AGENTS.md).

## Excel template

[Download the seven-column card-import template](outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx). Cards is blank; examples live separately in Instructions. The importer is specified, not implemented.

## Latest feature research

[Project access and card lifecycle](docs/research/features-access-lifecycle.md), [board/detail workflows](docs/research/features-board-workflows.md), [Excel import research](docs/research/features-excel-import.md). These Luna reports support the v0.3 baseline; where options differ, FEATURE_SPEC/API own implementation decisions.
