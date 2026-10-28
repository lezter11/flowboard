import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

test('QRY-01 to QRY-03: Discovery, Search, Multi-Facet Filters & My Tasks Suite', async (t) => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env['DATABASE_URL']),
    max: 5,
    connectionTimeoutMillis: 5_000,
  });

  const app = createApp(async () => { await pool.query('SELECT 1'); }, { pool });

  const workspaceId = 'ws_qry_test';
  const projectAId = 'prj_qry_a';
  const projectBId = 'prj_qry_b';
  const boardAId = 'brd_qry_a';
  const boardBId = 'brd_qry_b';

  const colTodoA = 'col_qry_todo_a';
  const colDoneA = 'col_qry_done_a';
  const colTodoB = 'col_qry_todo_b';

  let ownerCookie = '';
  let memberCookie = '';
  let outsiderCookie = '';

  let ownerUserId = '';
  let memberUserId = '';
  let outsiderUserId = '';

  let card1Id = 'crd_qry_1';
  let card2Id = 'crd_qry_2';
  let card3Id = 'crd_qry_3';
  let cardTrashId = 'crd_qry_trash';
  let cardProjectBId = 'crd_qry_b1';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      // 1. Create sessions for Owner, Member, and Outsider
      const devSecret = 'flowboard-dev-secret';
      const devHeaders = {
        'Content-Type': 'application/json',
        'X-Dev-Secret': devSecret,
      };

      const ownerLogin = await app.request('/api/v1/session/dev-login', {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ email: 'owner_qry@example.com', name: 'Owner QRY' }),
      });
      assert.ok(ownerLogin.status === 200 || ownerLogin.status === 201);
      ownerCookie = ownerLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
      ownerUserId = ((await ownerLogin.json()) as any).data.actor.id;

      const memberLogin = await app.request('/api/v1/session/dev-login', {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ email: 'member_qry@example.com', name: 'Member QRY' }),
      });
      assert.ok(memberLogin.status === 200 || memberLogin.status === 201);
      memberCookie = memberLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
      memberUserId = ((await memberLogin.json()) as any).data.actor.id;

      const outsiderLogin = await app.request('/api/v1/session/dev-login', {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ email: 'outsider_qry@example.com', name: 'Outsider QRY' }),
      });
      assert.ok(outsiderLogin.status === 200 || outsiderLogin.status === 201);
      outsiderCookie = outsiderLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
      outsiderUserId = ((await outsiderLogin.json()) as any).data.actor.id;

      // 2. Insert Workspace, Projects, Memberships
      await client.query(
        `INSERT INTO workspaces (id, name, owner_id, timezone, created_at, updated_at)
         VALUES ($1, 'QRY Workspace', $2, 'UTC', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, ownerUserId],
      );

      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, created_at, updated_at)
         VALUES ($1, $3, 'Project Alpha', 'Main project', NOW(), NOW()),
                ($2, $3, 'Project Beta', 'Sibling secret project', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [projectAId, projectBId, workspaceId],
      );

      // Grant member to Project Alpha ONLY
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ('pm_qry_mem_a', $1, $3, $2, 'member', 'active', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [projectAId, memberUserId, workspaceId],
      );

      // 3. Insert Boards and Columns
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, created_at, updated_at)
         VALUES ($1, $3, $4, 'Board Alpha', NOW(), NOW()),
                ($2, $3, $5, 'Board Beta', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [boardAId, boardBId, workspaceId, projectAId, projectBId],
      );

      // Project membership alone does not expose a board. The Owner grants
      // this member Board Alpha, while Board Beta remains private.
      await client.query(
        `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, projectAId, boardAId, memberUserId, ownerUserId],
      );

      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, created_at, updated_at)
         VALUES ($1, $4, $5, $6, 'To Do', 'slate', 'todo', 0, NOW(), NOW()),
                ($2, $4, $5, $6, 'Done', 'green', 'done', 1, NOW(), NOW()),
                ($3, $4, $7, $8, 'Beta To Do', 'slate', 'todo', 0, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [colTodoA, colDoneA, colTodoB, workspaceId, projectAId, boardAId, projectBId, boardBId],
      );

      // 4. Insert Cards in Project Alpha
      // Card 1: High priority, assigned to member, due in past (overdue), title "Optimize Search Engine"
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, due_date, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Optimize Search Engine', 'PostgreSQL full text query optimization', 'high', '2020-01-01', 1000, 1, 'active', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [card1Id, workspaceId, projectAId, boardAId, colTodoA],
      );
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [card1Id, memberUserId, workspaceId, projectAId],
      );

      // Card 2: Low priority, assigned to owner, due in future (upcoming), title "Write Documentation"
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, due_date, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Write Documentation', 'Markdown user guide for search and filters', 'low', '2030-01-01', 2000, 1, 'active', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [card2Id, workspaceId, projectAId, boardAId, colTodoA],
      );
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [card2Id, ownerUserId, workspaceId, projectAId],
      );

      // Card 3: None priority, in Done column, past due date (NOT overdue because it is in Done column)
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, due_date, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Completed Sprint Setup', 'Initial scaffolding completed', 'none', '2020-01-01', 3000, 1, 'active', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [card3Id, workspaceId, projectAId, boardAId, colDoneA],
      );

      // Card Trash: Trashed card in Project Alpha (must NEVER appear in search or My Tasks)
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, due_date, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Deleted Card with Secret Query', 'Top secret query description', 'urgent', '2020-01-01', 4000, 1, 'trashed', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [cardTrashId, workspaceId, projectAId, boardAId, colTodoA],
      );
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [cardTrashId, memberUserId, workspaceId, projectAId],
      );

      // Card in Project Beta: Assigned to member, but member has NO grant in Project Beta
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, due_date, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Project Beta Secret Task', 'Confidential beta card', 'urgent', '2020-01-01', 1000, 1, 'active', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [cardProjectBId, workspaceId, projectBId, boardBId, colTodoB],
      );
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [cardProjectBId, memberUserId, workspaceId, projectBId],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
  });

  // ==========================================================================
  // QRY-01: Project-Scoped Card Search
  // ==========================================================================
  await t.test('QRY-01: Project-scoped card search matches title and description while enforcing boundaries', async () => {
    // 1. Search by title substring
    const resTitle = await app.request(`/api/v1/projects/${projectAId}/cards/search?query=Optimize`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resTitle.status, 200);
    const titleBody = (await resTitle.json()) as any;
    assert.equal(titleBody.data.length, 1);
    assert.equal(titleBody.data[0].id, card1Id);
    assert.equal(titleBody.activeCardCount, 3);
    assert.equal(titleBody.matchingCardCount, 1);

    // 2. Search by description substring
    const resDesc = await app.request(`/api/v1/projects/${projectAId}/cards/search?query=scaffolding`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resDesc.status, 200);
    const descBody = (await resDesc.json()) as any;
    assert.equal(descBody.data.length, 1);
    assert.equal(descBody.data[0].id, card3Id);

    // 3. Sibling project privacy: Member granted in Project Alpha querying Project Beta returns 404 NOT_FOUND
    const resSibling = await app.request(`/api/v1/projects/${projectBId}/cards/search?query=Secret`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resSibling.status, 404);

    // 4. Outsider querying Project Alpha returns 404 NOT_FOUND
    const resOutsider = await app.request(`/api/v1/projects/${projectAId}/cards/search?query=Optimize`, {
      method: 'GET',
      headers: { Cookie: outsiderCookie },
    });
    assert.equal(resOutsider.status, 404);

    // 5. Trashed cards are strictly excluded from search
    const resTrash = await app.request(`/api/v1/projects/${projectAId}/cards/search?query=Secret`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resTrash.status, 200);
    const trashBody = (await resTrash.json()) as any;
    assert.equal(trashBody.data.length, 0);
  });

  // ==========================================================================
  // QRY-02: Multi-Facet Filters
  // ==========================================================================
  await t.test('QRY-02: Combine assignee, priority, column, and due date facets with active vs matching counts', async () => {
    // 1. Filter by priority=high
    const resHigh = await app.request(`/api/v1/projects/${projectAId}/cards/search?priority=high`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resHigh.status, 200);
    const highBody = (await resHigh.json()) as any;
    assert.equal(highBody.data.length, 1);
    assert.equal(highBody.data[0].id, card1Id);
    assert.equal(highBody.activeCardCount, 3);
    assert.equal(highBody.matchingCardCount, 1);

    // 2. Filter by assigneeId
    const resAssignee = await app.request(
      `/api/v1/projects/${projectAId}/cards/search?assigneeId=${ownerUserId}`,
      {
        method: 'GET',
        headers: { Cookie: memberCookie },
      },
    );
    assert.equal(resAssignee.status, 200);
    const assigneeBody = (await resAssignee.json()) as any;
    assert.equal(assigneeBody.data.length, 1);
    assert.equal(assigneeBody.data[0].id, card2Id);

    // 3. Filter by columnId
    const resCol = await app.request(`/api/v1/projects/${projectAId}/cards/search?columnId=${colDoneA}`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resCol.status, 200);
    const colBody = (await resCol.json()) as any;
    assert.equal(colBody.data.length, 1);
    assert.equal(colBody.data[0].id, card3Id);

    // 4. Overdue filter: matches Card 1 (past due date in To Do), excludes Card 3 (past due date in Done)
    const resOverdue = await app.request(`/api/v1/projects/${projectAId}/cards/search?due=overdue`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resOverdue.status, 200);
    const overdueBody = (await resOverdue.json()) as any;
    assert.equal(overdueBody.data.length, 1);
    assert.equal(overdueBody.data[0].id, card1Id, 'Only Card 1 in To Do is overdue');

    // 5. Combined facets: query + priority + column
    const resCombined = await app.request(
      `/api/v1/projects/${projectAId}/cards/search?query=Optimize&priority=high&columnId=${colTodoA}`,
      {
        method: 'GET',
        headers: { Cookie: memberCookie },
      },
    );
    assert.equal(resCombined.status, 200);
    const combBody = (await resCombined.json()) as any;
    assert.equal(combBody.data.length, 1);
    assert.equal(combBody.data[0].id, card1Id);
  });

  // ==========================================================================
  // QRY-03: My Assigned Tasks Personal View
  // ==========================================================================
  await t.test('QRY-03: My assigned tasks within one project with revocation and sibling protection', async () => {
    const missingScope = await app.request('/api/v1/me/tasks', {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(missingScope.status, 400, 'Cross-project My Tasks queries require one projectId');

    // 1. Member calls /api/v1/me/tasks for Project Alpha:
    // Should see Card 1 from Project Alpha.
    // MUST NOT see Card Project Beta (even though assigned) because Member has NO active grant in Project Beta!
    const resMemTasks = await app.request(`/api/v1/me/tasks?projectId=${projectAId}`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resMemTasks.status, 200);
    const memTasksBody = (await resMemTasks.json()) as any;
    assert.equal(memTasksBody.data.length, 1);
    assert.equal(memTasksBody.data[0].id, card1Id);
    assert.equal(memTasksBody.data[0].projectName, 'Project Alpha');
    assert.equal(memTasksBody.data[0].boardName, 'Board Alpha');
    assert.equal(memTasksBody.data[0].columnTitle, 'To Do');

    // 2. Workspace Owner calls /api/v1/me/tasks:
    // Sees Card 2 from Project Alpha
    const resOwnerTasks = await app.request(`/api/v1/me/tasks?projectId=${projectAId}`, {
      method: 'GET',
      headers: { Cookie: ownerCookie },
    });
    assert.equal(resOwnerTasks.status, 200);
    const ownerTasksBody = (await resOwnerTasks.json()) as any;
    assert.ok(ownerTasksBody.data.some((c: any) => c.id === card2Id));

    // 3. Workspace-scoped my-tasks: /api/v1/workspaces/:workspaceId/my-tasks
    const resWsTasks = await app.request(`/api/v1/workspaces/${workspaceId}/my-tasks?projectId=${projectAId}`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resWsTasks.status, 200);
    const wsTasksBody = (await resWsTasks.json()) as any;
    assert.equal(wsTasksBody.data.length, 1);
    assert.equal(wsTasksBody.data[0].id, card1Id);

    // 4. Access revocation: Remove Member from Project Alpha
    // Card 1 must disappear immediately on the very next request
    await pool.query(
      `UPDATE project_memberships SET status = 'removed' WHERE id = 'pm_qry_mem_a'`,
    );

    const resRevoked = await app.request(`/api/v1/me/tasks?projectId=${projectAId}`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(resRevoked.status, 404, 'Revoked member must not learn project task scope');
    assert.equal((await resRevoked.json() as any).error.code, 'NOT_FOUND');

    // Restore membership for subsequent checks
    await pool.query(
      `UPDATE project_memberships SET status = 'active' WHERE id = 'pm_qry_mem_a'`,
    );
  });
});
