# Independent Reviewer Session Evidence: RBAC-02

## 1. Independence and Audit Metadata
- **Feature ID**: RBAC-02 (verifyProjectAncestry & resource parentage boundary enforcement)
- **Reviewer Actor ID**: `independent-backend-reviewer`
- **Reviewer Session ID**: `b54e0975-7baf-4cac-99fe-0f396b9bb498`
- **Implementer Actor ID**: `builder`
- **Implementer Session ID**: `builder-session-id`
- **Reviewer Model**: `gemini-2.5-pro`
- **Fresh Context**: Yes, clean auditor session with no implementation crossover
- **Read-Only Audit**: Reviewer did not write or modify production code under audit
- **Environment**: macOS arm64, Node.js 24.15.0, PostgreSQL 17 isolated synthetic test database

## 2. Reachable Scope and Source Verification
- `apps/api/src/adapters/rbac.ts`:
  - `verifyProjectAncestry(clientOrPool, workspaceId, projectId, resource)`:
    - Queries `projects` table verifying `id = $1 AND workspace_id = $2`. Throws 404 if project does not belong to workspace.
    - If a resource ID is provided, detects entity type either via prefix (`brd_`, `col_`, `crd_`/`card_`, `cmt_`, `img_`, `upl_`, `imp_`) or falls back to a UNION ALL across entity tables.
    - Compares `workspace_id` and `project_id` against the resource row. If either does not match, immediately throws `404 NOT_FOUND`.
- `apps/api/src/http/middleware/rbac.ts`:
  - `requireProjectAncestry(resourceType, resourceParam)`:
    - Extracts `workspaceId`, `projectId`, and `resourceId` from params/query.
    - Invokes `verifyProjectAncestry`. Rejects unauthorized or mismatched access with uniform `404 NOT_FOUND`.
- `database/migrations/0003_constraints.sql`:
  - Composite parentage constraints enforced at the database level:
    - `fk_project_memberships_project_workspace`: `(project_id, workspace_id) REFERENCES projects(id, workspace_id)`
    - `fk_boards_project_workspace`: `(project_id, workspace_id) REFERENCES projects(id, workspace_id)`
    - `fk_columns_board_project_workspace`: `(board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id)`
    - `fk_cards_board_project_workspace`: `(board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id)`
    - `fk_cards_column_board`: `(column_id, board_id) REFERENCES columns(id, board_id)`
    - `fk_comments_card_project_workspace`: `(card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id)`
    - `fk_card_images_card_project_workspace`: `(card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id)`
    - `fk_card_image_uploads_card_project_workspace`: `(card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id)`
    - `fk_card_imports_board_project_workspace`: `(board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id)`
    - `fk_card_imports_column_board`: `(default_column_id, board_id) REFERENCES columns(id, board_id)`

## 3. Mandatory Criteria Evaluation
1. **Strict resource hierarchy**: Verified. Database composite foreign keys and `verifyProjectAncestry` guarantee that child entities must belong to both the exact specified parent container and the project/workspace hierarchy.
2. **Cross-project ID probing prevention**: Verified. Providing an ID from a sibling project (e.g. `card_sibling_01` inside `prj_main`) throws `404 NOT_FOUND`.
3. **Uniform error response**: Verified. A non-existent ID and a sibling project ID return the exact same 404 NOT_FOUND status, error envelope, and no-store headers, preventing ID enumeration.
4. **Multi-parent validation**: Verified. Both database foreign key constraints (e.g. `(column_id, board_id)`) and adapter queries verify that a card cannot reference a column on a different board.

## 4. Test Verification
The mandatory test suite passed with exit code 0:
- `npm run typecheck`
- `WRANGLER_SEND_METRICS=false node --test apps/api/test/rbac-advanced.test.ts`
Tests specifically covering RBAC-02:
- `verifyProjectAncestry succeeds for valid project and resources` (pass)
- `Guessing sibling project or resources returns consistent 404 NOT_FOUND without metadata leakage` (pass)
- `requireProjectAncestry HTTP middleware enforces boundary` (pass)

## 5. Plain-English System Design Teaching & Decision Analysis
In a hierarchical data model (Workspace -> Project -> Board -> Column -> Card), resources often have globally unique IDs (like UUIDs or prefixed IDs).
- **The Problem**: If an endpoint is `PATCH /workspaces/w1/projects/p1/cards/c100`, an attacker might pass a card `c100` that actually belongs to `p2` (a sibling project they have no permission to view). If the code only checks `SELECT * FROM cards WHERE id = 'c100'`, the update could erroneously succeed or leak metadata.
- **The Decision**: Flowboard enforces ancestry both at the application level (via `verifyProjectAncestry` middleware returning 404) and at the database level (via composite foreign keys on `(project_id, workspace_id)`).
- **Benefits**: Defense-in-depth. Even if an application query forgot a `WHERE project_id = ...` clause, the relational database foreign key would reject an invalid parent-child link. Furthermore, returning 404 instead of 403 prevents attackers from learning whether `c100` exists.
- **Drawbacks**: Composite foreign keys require composite unique indexes, slightly increasing table index size.
- **Alternatives Considered**: Relying solely on application-level checks without DB composite foreign keys (rejected due to risk of silent data corruption if an application bug is introduced).
