# Delivery and parallel ownership

## Current evidence

The starting workspace was empty and was not a Git repository. This phase creates architecture, preserved visual references, research reports and an initial SQL foundation. No app, login integration, local Git remote, Cloudflare bindings or deployed environment has been created. The user supplied https://github.com/lezter11/flowboard; read access is observed, push is not. Local historical SQLite verification is separate from selected PostgreSQL/runtime verification. Canonical task/evidence state is in root TASKS.md and PROGRESS.md.

## Ownership

| Area | Owner |
|---|---|
| Product scope, architecture, API decisions, shared contract changes, integration review | Flowboard Architect |
| `apps/api`, `database`, identity, authorization, outbox, API integration tests | Flowboard Backend |
| `apps/web`, accessible board/dialog, client state, visual reference reconciliation, UI tests | Flowboard UI |
| `packages/contracts`, root tooling, deployment workflows | Architect coordinates changes before either chat edits |

Both implementation chats share this local folder. They must avoid editing the same files concurrently. Each initial chat turn is read-only. Research agents own only their reports under docs/research. Shared contracts are versioned; breaking payload/error changes require coordinated UI and Backend updates.

## Sequenced milestones

Follow root TASKS.md and docs/FEATURE_CHECKLIST.md (98 product/implementation units). Detailed flows and Owner/Project Manager matrix live in FEATURE_SPEC.md; XLSX rules live in IMPORT_SPEC.md. Complete S0 foundation, S1 project-scoped access/invites, S2 cards/board, S3 discussion/activity/inbox, S4 images/trash, S5 Excel import, then S6 hardening.

Each feature follows Backend implementation and evidence → Architect contract review → UI implementation and evidence → integrated acceptance. Backend and UI may work on different ready features concurrently. UI visual planning may precede backend; fixture-only work cannot be marked integrated. Role-owned handoff records and scripts/render_feature_checklist.py generate the visible status.

FND-01 local backend harness is the first authorized implementation task, with explicit coordination for minimal root tooling. No cloud provisioning or paid benchmark belongs to that handoff. Older workspace-wide and archive-only assumptions are superseded.

## GitHub and environments

Proposed branch promotion: feature PR → develop/dev → uat/UAT → main/production. Prefer tested commit promotion and review over unrelated branch-specific manual edits. GitHub is source control and CI; Cloudflare serves the app/API/data. Do not create a second deployment trigger through Workers Builds if GitHub Actions already owns deployment.

PR checks: formatting/lint, types, schema/contract verification, Worker integration tests, frontend build and targeted browser flows. Preview code uses synthetic isolated data and no production credentials. Fork PRs cannot access deployment secrets. Pin Actions by immutable commit when configuring CI; least-privilege workflow permissions. Production deploy job uses a protected GitHub Environment; use a scoped Cloudflare API token in that environment.

Separate PostgreSQL databases/roles and session secrets for local/dev/UAT/production; isolate private R2 and any Queue resources too. Wrangler environment-specific bindings must be explicit. Preview deployments cannot silently inherit production resources. Record compatibility date and test runtime upgrades. Keep secrets out of Git and docs.

## Persistence and recovery

Migrations are forward-only additive where possible. Apply schema expansion first, deploy compatible application code second; remove old schema only in a later release. Capture backup/recovery evidence before destructive changes. Test a restoration into a separate database. Reverting a Worker version cannot revert PostgreSQL schema or user writes.

Monitor API latency/errors, PostgreSQL query plans/lock waits/storage, conflicts/replays, outbox backlog/attempts and auth denials. Set retention for sessions, idempotency receipts, activity and removed memberships before production. Initial schema retains history and avoids destructive cascades by default; retention jobs must be separately implemented and tested.

## Outstanding inputs

Login audience/provider; GitHub push access for the supplied public lezter11/flowboard repo; Cloudflare account and domain; expected workspaces/users/cards and any region requirements. Continue local implementation with explicit assumptions, but do not claim deployments or final visual acceptance until these are resolved.
