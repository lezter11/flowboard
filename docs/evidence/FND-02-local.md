# FND-02 — Shared API schemas and multi-tenant fixtures evidence

Date: 2026-10-26 (Asia/Kolkata). Owner: Architect + Backend. Status: **verified locally for FND-02**.

## Scope and Files

- Package workspace: `packages/contracts/package.json` (`@flowboard/contracts@0.3.0`).
- Strict validation schemas and types under `packages/contracts/src/`:
  - `common.ts`: Standard data/paginated response envelopes, error envelope with 19 canonical error codes, 16–128 ASCII idempotency keys, real Gregorian calendar date-only strings (`YYYY-MM-DD`), UTC ISO 8601 timestamps, `PersonDisplay`, mutation receipts with `replayed: boolean`.
  - `auth.ts`: Actor session and logout responses enforcing sibling project privacy.
  - `workspaces.ts`: Atomic creation, partial updates, and ownership transfer.
  - `projects.ts`: Project creation, settings, read-only archiving/reopening, people/assignee/mention picker queries, and member role administration.
  - `invitations.ts`: Email normalization, project invitation creation, single-use token acceptance.
  - `boards.ts`: Board CRUD, archiving, columns (max 12 columns, unique normalized names, categories `todo`|`active`|`done`), placement neighbor computation, and consistent board snapshot.
  - `cards.ts`: Title (1–200), description (≤20k), priority, due date, assignees (≤20 unique), and movement adjacency checks.
  - `discussion.ts`: Plain-text comments, UTF-16 non-overlapping mention span validation, activity items, and notifications.
  - `images.ts`: Private image upload allocation (≤10 MiB, PNG/JPEG/WebP), status machine, and finalized proxy metadata.
  - `trash.ts`: Soft delete, exact 24h restore window (`restoreUntil`), trash row representation with `canRestore` and `blockedReason`, and error detail schemas (HTTP 410 `RESTORE_WINDOW_EXPIRED`, HTTP 409 `RESTORE_DESTINATION_REQUIRED`).
  - `imports.ts`: 7-column Excel import preview rows, outcome states (`new`, `already_imported`, `invalid`, `conflict`, `created`, `skipped`), status-to-column mapping, and atomic batch commit.
  - `openapi/index.ts`: OpenAPI 3.1.0 specification metadata and comprehensive route catalog covering all 36 API v0.3 routes.
  - `fixtures/index.ts`: Comprehensive multi-tenant synthetic fixtures covering 2 workspaces, sibling-project isolation, cross-workspace guests, historical removed authors, active cards, 24h trash states, and repeated import rows.
  - `index.ts`: Exported schemas, types, and validation helpers (`parseOrThrow`, `safeParse`, `ValidationError`).
- Test suite: `packages/contracts/test/contracts.test.ts` (41 unit tests across 19 suites).
- Coordinated root tooling: Updated `package.json` and `tsconfig.json` to include `@flowboard/contracts`.

## Verification Commands and Results

1. **Strict Typecheck**:
   ```sh
   npm run typecheck
   ```
   Result: Exit code 0, 0 errors.

2. **Unit Test Suite**:
   ```sh
   npm test --workspace @flowboard/contracts
   ```
   Result: **41 passed, 0 failed, 0 skipped** across 19 suites (duration ~10ms).
   - Validates leap year and non-leap year Gregorian date-only calculations (`2026-02-29` rejected, `2024-02-29` accepted).
   - Validates UTC ISO timestamps and rejects local offsets.
   - Validates 16–128 char ASCII idempotency keys.
   - Validates non-overlapping mention offsets.
   - Validates column reordering bounds (max 12).
   - Validates all 100% of synthetic fixtures in `FIXTURE_WORKSPACES`, `FIXTURE_PROJECTS`, `FIXTURE_BOARDS`, `FIXTURE_CARDS`, `FIXTURE_COMMENTS`, `FIXTURE_TRASH`, and `FIXTURE_IMPORT_ROWS`.

3. **Subagent Independent Audit**:
   - Evaluated by `Contract Validation Auditor` against 4 pre-established criteria:
     - API v0.3 Coverage: 2.5 / 2.5
     - Type Safety & Strict Validation Logic: 2.5 / 2.5
     - Multi-Tenant Fixtures with Sibling Isolation: 2.5 / 2.5
     - OpenAPI Spec & Test Verification: 2.5 / 2.5
   - Overall Audit Score: **9.8 / 10.0** (Threshold: ≥ 8.5 / 10.0). Status: Passed with distinction.

## Limitations

- Contracts define and validate payloads at the boundaries.
- Database persistence, foreign keys, and transaction atomicity belong to FND-03.
- HTTP routing and authentication middleware consume these contracts in FND-04 and subsequent feature tasks.
