# Flowboard agent entry point

Read and follow [RULES.md](RULES.md). Canonical planning documents are [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [TASKS.md](TASKS.md) and [PROGRESS.md](PROGRESS.md). Read [the engineering checklist](docs/ENGINEERING_CHECKLIST.md) for the 50 stable concerns and [the reference catalogue](docs/references/README.md) before UI/backend design decisions.

Architect coordinates shared contracts. Backend owns apps/api/database; UI owns apps/web. This is a shared checkout: do not edit another chat's files concurrently. Read the current task state before implementing. The original D1 schema is historical prototype evidence; PostgreSQL is the recommended implementation engine and requires its own migrations/tests. Never equate a local historical SQLite pass with selected-database verification.

Use the teaching/result format and plain-English system-design teaching rule in RULES.md in every Flowboard chat. Explain relevant decisions with concrete Flowboard examples, benefits, drawbacks and alternatives; do not assume prior system-design knowledge. Keep implementation and verification status separate from design coverage.

Feature-first baseline: read docs/FEATURE_SPEC.md, docs/FEATURE_CHECKLIST.md, docs/IMPORT_SPEC.md and docs/handoffs/README.md before implementation. Project-only access, Owner/Project Manager administration, 24-hour card trash, private images and XLSX import supersede old scope. Research agents use Luna per user preference. Definitions live in docs/features.tsv; role-owned handoff evidence generates the checklist.
