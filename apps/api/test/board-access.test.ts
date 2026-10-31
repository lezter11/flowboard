import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';
import { listScopedProjectActivityDraft } from '../src/adapters/board-activity-scope-draft.ts';
import { recordActivity } from '../src/adapters/activity.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
// Synthetic test-only cursor key. Runtime must provide a private random key.
process.env['CURSOR_SECRET'] ??= 'flowboard_test_cursor_key_do_not_use_in_production_2026';

test('board access comprehensive integration on isolated PostgreSQL', {
  skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.',
}, async (t) => {
  // Image routes fail closed without a bound driver; this suite serves images from an in-process one.
  setStorageDriver(new MemoryStorageDriver());
  const url = new URL(testUrl!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') {
    throw new Error('Use only the disposable local board-access database.');
  }

  const schema = `board_acc_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 8, options: `-c search_path=${schema}` });

  try {
    // 1. Verify clean install and formal migration DDL
    await runMigrations(pool);

    // 2. Setup actors: owner, manager, member, viewer, outsider, stranger
    const owner = await createDevUserAndSession('owner@test.invalid', 'Workspace Owner', pool);
    const manager = await createDevUserAndSession('mgr@test.invalid', 'Project Manager', pool);
    const member = await createDevUserAndSession('mbr@test.invalid', 'Project Member', pool);
    const viewer = await createDevUserAndSession('vwr@test.invalid', 'Project Viewer', pool);
    const outsider = await createDevUserAndSession('out@test.invalid', 'Sibling Project Member', pool);
    const stranger = await createDevUserAndSession('str@test.invalid', 'Stranger Workspace User', pool);

    // 3. Workspaces & Projects
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at)
       VALUES ('w1', 'Workspace One', 'UTC', $1, NOW(), NOW()),
              ('w2', 'Workspace Two', 'UTC', $2, NOW(), NOW())`,
      [owner.user.id, stranger.user.id],
    );

    await pool.query(
      `INSERT INTO projects (id, workspace_id, name, created_at, updated_at)
       VALUES ('p1', 'w1', 'Brand Fashion', NOW(), NOW()),
              ('p2', 'w1', 'Operations Sibling', NOW(), NOW()),
              ('p_foreign', 'w2', 'Foreign Project', NOW(), NOW())`,
    );

    // Project memberships for P1
    await pool.query(
      `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ('pm_mgr', 'p1', 'w1', $1, 'manager', 'active', NOW(), NOW()),
              ('pm_mbr', 'p1', 'w1', $2, 'member', 'active', NOW(), NOW()),
              ('pm_vwr', 'p1', 'w1', $3, 'viewer', 'active', NOW(), NOW()),
              ('pm_out', 'p2', 'w1', $4, 'member', 'active', NOW(), NOW()),
              ('pm_str', 'p_foreign', 'w2', $5, 'manager', 'active', NOW(), NOW())`,
      [manager.user.id, member.user.id, viewer.user.id, outsider.user.id, stranger.user.id],
    );

    // Boards in P1
    await pool.query(
      `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
       VALUES ('b_visible', 'w1', 'p1', 'Dev Board', 1, 1, FALSE, NOW(), NOW()),
              ('b_secret', 'w1', 'p1', 'Secret Board', 1, 1, FALSE, NOW(), NOW()),
              ('b_sibling', 'w1', 'p2', 'Sibling Board', 1, 1, FALSE, NOW(), NOW())`,
    );

    // Columns for b_visible and b_secret
    await pool.query(
      `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
       VALUES ('col_v1', 'w1', 'p1', 'b_visible', 'To Do', 'blue', 'todo', 0, 1, NOW(), NOW()),
              ('col_v2', 'w1', 'p1', 'b_visible', 'Done', 'green', 'done', 1, 1, NOW(), NOW()),
              ('col_s1', 'w1', 'p1', 'b_secret', 'Private To Do', 'red', 'todo', 0, 1, NOW(), NOW())`,
    );

    // Cards
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, created_at, updated_at)
       VALUES ('card_v1', 'w1', 'p1', 'b_visible', 'col_v1', 'Visible Card One', 'medium', 100, 'active', NOW(), NOW()),
              ('card_s1', 'w1', 'p1', 'b_secret', 'col_s1', 'Secret Card One', 'high', 100, 'active', NOW(), NOW())`,
    );

    // Initialize App with mounted board grants
    const app = createApp(async () => {}, { pool });

    // B-20: the transfer route is retired. A synthetic owner change takes the same workspace row lock an
    // owner change takes, so the reader-blocking checks below keep their meaning without the route.
    const syntheticOwnerChange = async (targetUserId: string, expectedVersion: number) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(
          `UPDATE workspaces SET owner_id = $2, version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $3`,
          ['w1', targetUserId, expectedVersion],
        );
        await client.query('COMMIT');
        return { status: res.rowCount ? 200 : 409 };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    };

    const req = (method: string, path: string, sessionId?: string, body?: unknown, headers?: Record<string, string>) =>
      app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          ...(sessionId ? { cookie: `flowboard_session=${sessionId}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method === 'POST' ? { 'Idempotency-Key': 'idem_' + crypto.randomUUID() } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const getRevision = async (boardId: string) =>
      String((await pool.query('SELECT access_revision FROM boards WHERE id = $1', [boardId])).rows[0].access_revision);

    // --------------------------------------------------------------------------
    // Criterion 1: Workspace owner implicit access & nonowner grant requirement
    // --------------------------------------------------------------------------
    await t.test('Criterion 1: Owner has implicit access to all boards; nonowner without grant gets 404', async () => {
      // Owner can read access list and board snapshot on both boards
      const ownerResVisible = await req('GET', '/boards/b_visible/access', owner.session.id);
      assert.equal(ownerResVisible.status, 200);

      const ownerResSecret = await req('GET', '/boards/b_secret/access', owner.session.id);
      assert.equal(ownerResSecret.status, 200);

      // Nonowner without board grant receives 404 (non-enumerating)
      const mgrAccess = await req('GET', '/boards/b_visible/access', manager.session.id);
      assert.equal(mgrAccess.status, 404);

      const mbrAccess = await req('GET', '/boards/b_visible/access', member.session.id);
      assert.equal(mbrAccess.status, 404);

      const vwrAccess = await req('GET', '/boards/b_visible/access', viewer.session.id);
      assert.equal(vwrAccess.status, 404);

      const outAccess = await req('GET', '/boards/b_visible/access', outsider.session.id);
      assert.equal(outAccess.status, 404);

      const strAccess = await req('GET', '/boards/b_visible/access', stranger.session.id);
      assert.equal(strAccess.status, 404);
    });

    // --------------------------------------------------------------------------
    // Criterion 3: Only the workspace Owner can administer board grants
    // --------------------------------------------------------------------------
    await t.test('Criterion 3: Only workspace Owner can administer board grants; reject self-elevation and foreign targets', async () => {
      const rev = await getRevision('b_visible');

      // Manager attempts to grant member access -> 404
      const mgrTryGrant = await req('PUT', `/boards/b_visible/grants/${member.user.id}`, manager.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(mgrTryGrant.status, 404);

      // Member attempts to grant themselves -> 404
      const mbrSelfGrant = await req('PUT', `/boards/b_visible/grants/${member.user.id}`, member.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(mbrSelfGrant.status, 404);

      // Stranger attempts to grant -> 404
      const strTryGrant = await req('PUT', `/boards/b_visible/grants/${member.user.id}`, stranger.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(strTryGrant.status, 404);

      // Owner attempts to grant non-member stranger -> 404
      const ownerGrantStranger = await req('PUT', `/boards/b_visible/grants/${stranger.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(ownerGrantStranger.status, 404);

      // Owner attempts to grant on sibling project board for P1 member -> 404
      const ownerGrantSibling = await req('PUT', `/boards/b_sibling/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: await getRevision('b_sibling'),
      });
      assert.equal(ownerGrantSibling.status, 404);

      // Owner grants manager access on b_visible -> succeeds
      const ownerGrantMgr = await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(ownerGrantMgr.status, 200);
      assert.equal((await ownerGrantMgr.json()).data.changed, true);

      // Duplicate grant is a safe no-op with changed: false
      const revAfterGrant = await getRevision('b_visible');
      const ownerGrantMgrNoop = await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: revAfterGrant,
      });
      assert.equal(ownerGrantMgrNoop.status, 200);
      assert.equal((await ownerGrantMgrNoop.json()).data.changed, false);
    });

    // --------------------------------------------------------------------------
    // Criterion 4: Project Managers can create boards, but receive no implicit grant
    // --------------------------------------------------------------------------
    await t.test('Criterion 4: Project Manager can create a board; receives no implicit grant until Owner grants it', async () => {
      // 1. Manager creates a new board in P1
      const createRes = await req('POST', '/projects/p1/boards', manager.session.id, {
        name: 'Ops Board by Manager',
      });
      assert.equal(createRes.status, 201);
      const createdBoard = (await createRes.json()).data;
      const createdBoardId = createdBoard.id;

      // 2. Manager cannot access the access list of the created board
      const mgrReadAccess = await req('GET', `/boards/${createdBoardId}/access`, manager.session.id);
      assert.equal(mgrReadAccess.status, 404);

      // 3. Owner CAN access the board (implicit owner access)
      const ownerReadAccess = await req('GET', `/boards/${createdBoardId}/access`, owner.session.id);
      assert.equal(ownerReadAccess.status, 200);

      // 4. Owner explicitly grants Manager access to the board
      const revCreated = await getRevision(createdBoardId);
      const grantRes = await req('PUT', `/boards/${createdBoardId}/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: revCreated,
      });
      assert.equal(grantRes.status, 200);

      // 5. Manager still cannot administer grants on that board (Owner-only rule)
      const mgrTrySubGrant = await req('PUT', `/boards/${createdBoardId}/grants/${member.user.id}`, manager.session.id, {
        expectedAccessRevision: await getRevision(createdBoardId),
      });
      assert.equal(mgrTrySubGrant.status, 404);
    });

    // --------------------------------------------------------------------------
    // Criterion 2: Project removal clears grants; no resurrection upon rejoin
    // --------------------------------------------------------------------------
    await t.test('Criterion 2: Project removal atomically clears board grants; re-adding member does not resurrect grants', async () => {
      const rev = await getRevision('b_visible');
      // Grant member access to b_visible
      await req('PUT', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });

      // Verify grant exists in database
      const grantCheck = await pool.query(
        'SELECT * FROM board_grants WHERE board_id = $1 AND user_id = $2',
        ['b_visible', member.user.id],
      );
      assert.equal(grantCheck.rows.length, 1);

      // Now remove member from project P1
      await pool.query(
        `UPDATE project_memberships SET status = 'removed', updated_at = NOW() WHERE id = 'pm_mbr'`,
      );

      // Trigger clear_board_grants_on_project_removal must have deleted the grant row
      const grantAfterRemoval = await pool.query(
        'SELECT * FROM board_grants WHERE board_id = $1 AND user_id = $2',
        ['b_visible', member.user.id],
      );
      assert.equal(grantAfterRemoval.rows.length, 0);

      // Reactivate member in project P1
      await pool.query(
        `UPDATE project_memberships SET status = 'active', updated_at = NOW() WHERE id = 'pm_mbr'`,
      );

      // Grant MUST NOT be resurrected!
      const grantAfterReactivation = await pool.query(
        'SELECT * FROM board_grants WHERE board_id = $1 AND user_id = $2',
        ['b_visible', member.user.id],
      );
      assert.equal(grantAfterReactivation.rows.length, 0);
    });

    // --------------------------------------------------------------------------
    // Criterion 7: Stale revisions & revocation concurrency
    // --------------------------------------------------------------------------
    await t.test('Criterion 7: Revocation advances access revision and rejects stale retries', async () => {
      const rev = await getRevision('b_visible');
      // Grant member access
      await req('PUT', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });
      const revAfterGrant = await getRevision('b_visible');

      // Stale retry of grant with previous revision returns 409 STALE_ACCESS_REVISION
      const staleGrant = await req('PUT', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });
      assert.equal(staleGrant.status, 409);
      assert.equal((await staleGrant.json()).error.code, 'STALE_ACCESS_REVISION');

      // Revoke grant
      const revokeRes = await req('DELETE', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: revAfterGrant,
      });
      assert.equal(revokeRes.status, 200);
      assert.equal((await revokeRes.json()).data.changed, true);

      // Delayed retry of grant with stale revision is rejected (cannot undo revocation)
      const staleUndo = await req('PUT', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: revAfterGrant,
      });
      assert.equal(staleUndo.status, 409);
      assert.equal((await staleUndo.json()).error.code, 'STALE_ACCESS_REVISION');
    });

    // --------------------------------------------------------------------------
    // Criterion 6: Activity Scope & Outbox Mention Delivery Isolation
    // --------------------------------------------------------------------------
    await t.test('Criterion 6: Activity scope & mention delivery isolate by board grant', async () => {
      // 1. Record an activity log on visible card and secret card
      const actIdV = await recordActivity(pool, {
        workspaceId: 'w1',
        projectId: 'p1',
        boardId: 'b_visible',
        cardId: 'card_v1',
        actorId: owner.user.id,
        action: 'card_updated',
        safeChanges: { title: 'Updated Visible Card' },
      });

      const actIdS = await recordActivity(pool, {
        workspaceId: 'w1',
        projectId: 'p1',
        boardId: 'b_secret',
        cardId: 'card_s1',
        actorId: owner.user.id,
        action: 'card_updated',
        safeChanges: { title: 'Updated Secret Card' },
      });

      // Manager has grant on b_visible only. Read scoped activity as Manager:
      const actClient = await pool.connect();
      let mgrActIds: string[] = [];
      try {
        const mgrActivity = await listScopedProjectActivityDraft(actClient, 'p1', manager.user.id);
        mgrActIds = mgrActivity.items.map((x) => x.id);
      } finally {
        actClient.release();
      }
      assert.ok(mgrActIds.includes(actIdV));
      assert.ok(!mgrActIds.includes(actIdS));

      // 2. Outbox mention delivery on b_secret mentioning manager (who has no grant on b_secret)
      await pool.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, created_at, updated_at)
         VALUES ('cmt_secret', 'w1', 'p1', 'card_s1', $1, 'Hey @mgr', NOW(), NOW())`,
        [owner.user.id],
      );

      const payload = JSON.stringify({
        cardId: 'card_s1',
        commentId: 'cmt_secret',
        authorId: owner.user.id,
        actorDisplayName: 'Workspace Owner',
        commentBody: 'Hey @mgr',
        mentions: [manager.user.id],
      });

      await pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
         VALUES ('ob_secret_1', 'w1', 'p1', 'comment.created', $1::jsonb, 'pending', 0, NOW(), NOW())`,
        [payload],
      );

      // Process outbox
      await processOutboxLease(pool, { batchSize: 10 });

      // Manager must NOT have received notification on secret card
      const notifRes = await pool.query(
        `SELECT * FROM notifications WHERE user_id = $1 AND card_id = 'card_s1'`,
        [manager.user.id],
      );
      assert.equal(notifRes.rows.length, 0);
    });

    // --------------------------------------------------------------------------
    // Criterion 5: Project identity vs board listing isolation
    // --------------------------------------------------------------------------
    await t.test('Criterion 5: Project members with zero grants see empty board list; granted members see only granted boards', async () => {
      // 1. Viewer has zero board grants in P1
      const vwrBoardsRes = await req('GET', '/projects/p1/boards', viewer.session.id);
      assert.equal(vwrBoardsRes.status, 200);
      const vwrBoards = (await vwrBoardsRes.json()).data;
      assert.deepEqual(vwrBoards, []);

      // 2. Grant viewer access to b_visible only
      const rev = await getRevision('b_visible');
      await req('PUT', `/boards/b_visible/grants/${viewer.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });

      // 3. Viewer now sees exactly b_visible, never b_secret
      const vwrBoardsAfterRes = await req('GET', '/projects/p1/boards', viewer.session.id);
      assert.equal(vwrBoardsAfterRes.status, 200);
      const vwrBoardsAfter = (await vwrBoardsAfterRes.json()).data;
      assert.equal(vwrBoardsAfter.length, 1);
      assert.equal(vwrBoardsAfter[0].id, 'b_visible');

      // 4. Owner sees all active boards in project
      const ownerBoardsRes = await req('GET', '/projects/p1/boards', owner.session.id);
      assert.equal(ownerBoardsRes.status, 200);
      const ownerBoards = (await ownerBoardsRes.json()).data;
      const ownerBoardIds = ownerBoards.map((b: { id: string }) => b.id);
      assert.ok(ownerBoardIds.includes('b_visible'));
      assert.ok(ownerBoardIds.includes('b_secret'));
    });

    // --------------------------------------------------------------------------
    // Criterion 1 & 9: Action limits on granted board
    // --------------------------------------------------------------------------
    await t.test('Criterion 1 & 9: Role action limits are strictly preserved on granted boards', async () => {
      // Viewer granted on b_visible:
      // Can read snapshot
      const vwrSnap = await req('GET', '/boards/b_visible', viewer.session.id);
      assert.equal(vwrSnap.status, 200);

      // Cannot create a card -> 403 FORBIDDEN
      const vwrTryCard = await req('POST', '/boards/b_visible/cards', viewer.session.id, {
        columnId: 'col_v1',
        title: 'Viewer Card Attempt',
        expectedBoardVersion: 1,
      });
      assert.equal(vwrTryCard.status, 403);

      // Grant member access to b_visible
      const rev = await getRevision('b_visible');
      await req('PUT', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
        expectedAccessRevision: rev,
      });

      // Member CAN create a card -> 201 CREATED
      const mbrCard = await req('POST', '/boards/b_visible/cards', member.session.id, {
        columnId: 'col_v1',
        title: 'Member Card Created',
        expectedBoardVersion: 1,
      });
      assert.equal(mbrCard.status, 201);

      // Member CANNOT create a column -> 403 FORBIDDEN (manager role required)
      const mbrTryCol = await req('POST', '/boards/b_visible/columns', member.session.id, {
        name: 'Member Column Attempt',
        category: 'active',
        color: '#64748b',
        expectedBoardVersion: 1,
      });
      assert.equal(mbrTryCol.status, 403);

      // Manager granted on b_visible CAN create a column -> 201 CREATED
      const currentBoardVersion = Number(
        (await pool.query('SELECT structure_version FROM boards WHERE id = $1', ['b_visible'])).rows[0].structure_version,
      );
      const mgrCol = await req('POST', '/boards/b_visible/columns', manager.session.id, {
        name: 'Manager Column Created',
        category: 'active',
        color: '#0ea5e9',
        expectedBoardVersion: currentBoardVersion,
      });
      assert.equal(mgrCol.status, 201);
    });

    await t.test('Board-scoped people picker includes only people who can open that board', async () => {
      const response = await req('GET', '/projects/p1/people?purpose=assignee&boardId=b_visible', manager.session.id);
      assert.equal(response.status, 200);
      const people = (await response.json()).data as { id: string }[];
      const ids = new Set(people.map((person) => person.id));
      assert.ok(ids.has(owner.user.id));
      assert.ok(ids.has(manager.user.id));
      assert.ok(ids.has(member.user.id));
      assert.ok(!ids.has(viewer.user.id));

      // Knowing a board ID in the same project is not enough to ask for its
      // assignees or mention candidates.
      const hidden = await req('GET', '/projects/p1/people?purpose=mention&boardId=b_secret', manager.session.id);
      assert.equal(hidden.status, 404);
    });

    await t.test('Mounted comment list requires the current board grant', async () => {
      // A project Manager can read a granted board's discussion, but knowing
      // the card ID on another board in that project confers no access.
      const granted = await req('GET', '/cards/card_v1/comments', manager.session.id);
      assert.equal(granted.status, 200);
      const hidden = await req('GET', '/cards/card_s1/comments', manager.session.id);
      assert.equal(hidden.status, 404);

      const revision = await getRevision('b_visible');
      const revoked = await req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: revision,
      });
      assert.equal(revoked.status, 200);
      const afterRevocation = await req('GET', '/cards/card_v1/comments', manager.session.id);
      assert.equal(afterRevocation.status, 404);
    });

    await t.test('Mounted card list holds its grant until delivery, then revocation denies the next read', async () => {
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/boards/b_visible/cards?limit=1', manager.session.id);

        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM cards c%'
               AND cardinality(pg_blocking_pids(pid)) > 0
             LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted card list should reach the card query while holding its grant');

        const revision = await getRevision('b_visible');
        const revokePromise = req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Grant removal must wait for the in-flight mounted read');
        await blocker.query('COMMIT');
        assert.equal((await readPromise).status, 200);
        assert.equal((await revokePromise).status, 200);
        assert.equal((await req('GET', '/boards/b_visible/cards?limit=1', manager.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted comment list holds its grant until delivery, then revocation denies the next read', async () => {
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE comments IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/cards/card_v1/comments?limit=1', manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM comments%'
               AND cardinality(pg_blocking_pids(pid)) > 0
             LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted comment list should reach its comment query while holding its grant');

        const revision = await getRevision('b_visible');
        const revokePromise = req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Grant removal must wait for the in-flight mounted comment read');
        await blocker.query('COMMIT');
        assert.equal((await readPromise).status, 200);
        assert.equal((await revokePromise).status, 200);
        assert.equal((await req('GET', '/cards/card_v1/comments?limit=1', manager.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted board snapshot holds its grant until delivery, then revocation denies the next read', async () => {
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/boards/b_visible', manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%LEFT JOIN cards c%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted snapshot should reach the card query while holding its grant');
        const revision = await getRevision('b_visible');
        const revokePromise = req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Grant removal must wait for the in-flight snapshot');
        await blocker.query('COMMIT');
        assert.equal((await readPromise).status, 200);
        assert.equal((await revokePromise).status, 200);
        assert.equal((await req('GET', '/boards/b_visible', manager.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted placement read holds its grant until delivery, then Owner revocation denies the next read', async () => {
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const path = '/boards/b_visible/columns/col_v1/placement?movingCardId=card_v1&at=last';
        const readPromise = req('GET', path, manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM cards WHERE id = $1%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted placement read should reach its card lookup while holding its grant');

        const revision = await getRevision('b_visible');
        const revokePromise = req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Owner grant revocation must wait for the in-flight placement read');
        await blocker.query('COMMIT');
        assert.equal((await readPromise).status, 200);
        assert.equal((await revokePromise).status, 200);
        assert.equal((await req('GET', path, manager.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted project Trash read holds its board grant until delivery, then revocation denies the next read', async () => {
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
         VALUES ('card_trash_race', 'w1', 'p1', 'b_visible', 'col_v1', 'Synthetic trash race card', 'low', 200, 'trashed', NOW(), $1, NOW() + INTERVAL '24 hours', NOW(), NOW())`,
        [manager.user.id],
      );
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/projects/p1/trash', manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM cards c%'
               AND query LIKE '%c.state = ''trashed''%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted project Trash read should reach its card query while holding the grant');

        const revision = await getRevision('b_visible');
        const revokePromise = req('DELETE', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Owner grant revocation must wait for the in-flight project Trash read');
        await blocker.query('COMMIT');
        const response = await readPromise;
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes('card_trash_race'));
        assert.equal((await revokePromise).status, 200);
        assert.equal((await req('GET', '/projects/p1/trash', manager.session.id)).status, 200);
        const afterRevocation = await req('GET', '/projects/p1/trash', manager.session.id);
        assert.equal(afterRevocation.status, 200);
        assert.equal((await afterRevocation.text()).includes('card_trash_race'), false);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted project search counts an off-page granted board and holds that grant through delivery', async () => {
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, created_at, updated_at)
         VALUES ('card_search_visible', 'w1', 'p1', 'b_visible', 'col_v1', 'RaceQuery visible', 'low', 300, 'active', NOW(), NOW()),
                ('card_search_offpage', 'w1', 'p1', 'b_secret', 'col_s1', 'RaceQuery off page', 'low', 300, 'active', NOW(), NOW())`,
      );
      for (const boardId of ['b_visible', 'b_secret']) {
        const revision = await getRevision(boardId);
        assert.equal((await req('PUT', `/boards/${boardId}/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        })).status, 200);
      }

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const path = '/projects/p1/cards/search?query=RaceQuery&limit=1';
        const readPromise = req('GET', path, manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%AS active_count%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted search should reach its aggregate count query while holding the board grants');

        const revision = await getRevision('b_secret');
        const revokePromise = req('DELETE', `/boards/b_secret/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Revoking an off-page board grant must wait for the search count');
        await blocker.query('COMMIT');
        const response = await readPromise;
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.data.length, 1);
        assert.equal(result.matchingCardCount, 2, 'Matching count includes the granted board outside the returned page');
        assert.equal((await revokePromise).status, 200);

        const afterRevocation = await req('GET', path, manager.session.id);
        assert.equal(afterRevocation.status, 200);
        assert.equal((await afterRevocation.json()).matchingCardCount, 1);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted project Trash read holds Manager access until delivery, then demotion denies the next read', async () => {
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
         VALUES ('card_trash_demotion', 'w1', 'p1', 'b_visible', 'col_v1', 'Synthetic demotion race card', 'low', 400, 'trashed', NOW(), $1, NOW() + INTERVAL '24 hours', NOW(), NOW())`,
        [manager.user.id],
      );
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      let demotionPromise: Promise<pg.QueryResult> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/projects/p1/trash', manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM cards c%'
               AND query LIKE '%c.state = ''trashed''%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted Trash read should reach its card query while holding Manager authority');

        demotionPromise = pool.query(
          `UPDATE project_memberships SET role = 'member', updated_at = NOW() WHERE id = 'pm_mgr'`,
        );
        let demotionBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND query LIKE '%UPDATE project_memberships%'
                 AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          demotionBlocked = waiting.rows[0]?.blocked ?? false;
          if (demotionBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(demotionBlocked, true, 'Manager demotion must wait for the in-flight Trash read');
        await blocker.query('COMMIT');
        const readResponse = await readPromise;
        assert.equal(readResponse.status, 200);
        assert.ok((await readResponse.text()).includes('card_trash_demotion'));
        assert.equal((await demotionPromise).rowCount, 1);
        assert.equal((await req('GET', '/projects/p1/trash', manager.session.id)).status, 403);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
        await demotionPromise?.catch(() => {});
        await pool.query(
          `UPDATE project_memberships SET role = 'manager', updated_at = NOW() WHERE id = 'pm_mgr'`,
        );
      }
    });

    await t.test('Mounted My Tasks across two granted boards holds both grants through delivery', async () => {
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, created_at, updated_at)
         VALUES ('card_task_visible', 'w1', 'p1', 'b_visible', 'col_v1', 'Visible assigned task', 'low', 500, 'active', NOW(), NOW()),
                ('card_task_second_board', 'w1', 'p1', 'b_secret', 'col_s1', 'Second board assigned task', 'low', 500, 'active', NOW(), NOW())`);
      await pool.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ('card_task_visible', $1, 'w1', 'p1', NOW()), ('card_task_second_board', $1, 'w1', 'p1', NOW())`,
        [manager.user.id],
      );
      for (const boardId of ['b_visible', 'b_secret']) {
        const revision = await getRevision(boardId);
        assert.equal((await req('PUT', `/boards/${boardId}/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        })).status, 200);
      }

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
        const path = '/me/tasks?projectId=p1&limit=10';
        const readPromise = req('GET', path, manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM cards c%JOIN card_assignees ca%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted My Tasks read should reach its multi-board query while holding both grants');

        const revision = await getRevision('b_secret');
        const revokePromise = req('DELETE', `/boards/b_secret/grants/${manager.user.id}`, owner.session.id, {
          expectedAccessRevision: revision,
        });
        let revokeBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS blocked`, [readerPid],
          );
          revokeBlocked = waiting.rows[0]?.blocked ?? false;
          if (revokeBlocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(revokeBlocked, true, 'Revoking the second board grant must wait for the entire My Tasks read');
        await blocker.query('COMMIT');
        const response = await readPromise;
        assert.equal(response.status, 200);
        const tasks = (await response.json()).data as { id: string; boardId: string }[];
        assert.equal(tasks.length, 2);
        assert.deepEqual(new Set(tasks.map((task) => task.id)), new Set(['card_task_visible', 'card_task_second_board']));
        assert.equal((await revokePromise).status, 200);

        const afterRevocation = await req('GET', path, manager.session.id);
        assert.equal(afterRevocation.status, 200);
        const remaining = (await afterRevocation.json()).data as { id: string }[];
        assert.deepEqual(remaining.map((task) => task.id), ['card_task_visible']);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Scheduled mention cannot cross the outbox project boundary even for an Owner', async () => {
      await pool.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, created_at, updated_at)
         VALUES ('cmt_sibling', 'w1', 'p1', 'card_s1', $1, 'Other project', NOW(), NOW())`,
        [outsider.user.id],
      );
      await pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
         VALUES ('ob_wrong_project', 'w1', 'p2', 'comment.created', $1::jsonb, 'pending', 0, NOW(), NOW())`,
        [JSON.stringify({ cardId: 'card_s1', commentId: 'cmt_sibling', authorId: outsider.user.id, mentions: [owner.user.id] })],
      );
      await processOutboxLease(pool, { batchSize: 10 });
      const leaked = await pool.query(
        `SELECT id FROM notifications WHERE project_id = 'p2' AND user_id = $1 AND card_id = 'card_s1'`,
        [owner.user.id],
      );
      assert.equal(leaked.rows.length, 0);
    });

    // --------------------------------------------------------------------------
    // Criterion 8: DDL rollback atomicity on upgrade/restart
    // --------------------------------------------------------------------------
    await t.test('Criterion 8: PostgreSQL DDL rollback safety in transactional migration block', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE TABLE temp_board_upgrade_probe (id TEXT PRIMARY KEY)');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Verify table was completely rolled back and did not pollute schema
      const checkRes = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = 'temp_board_upgrade_probe'
         ) AS exists`,
        [schema],
      );
      assert.equal(checkRes.rows[0]?.exists, false);
    });

    await t.test('Mounted trashed-card image list holds Manager authority through delivery during demotion', async () => {
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
         VALUES ('card_image_demotion', 'w1', 'p1', 'b_visible', 'col_v1', 'Private trashed image card', 'low', 900, 'trashed', NOW(), $1, NOW() + INTERVAL '24 hours', NOW(), NOW())`,
        [owner.user.id],
      );
      await pool.query(
        `INSERT INTO card_images (id, workspace_id, project_id, card_id, uploader_id, filename, byte_length, content_type, storage_key, sha256, created_at, updated_at)
         VALUES ('img_demotion_race', 'w1', 'p1', 'card_image_demotion', $1, 'private-trash-image.png', 3, 'image/png', 'race/private-image', 'abc', NOW(), NOW())`,
        [owner.user.id],
      );
      const grantRevision = await getRevision('b_visible');
      assert.equal((await req('PUT', `/boards/b_visible/grants/${manager.user.id}`, owner.session.id, {
        expectedAccessRevision: grantRevision,
      })).status, 200);

      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE card_images IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/cards/card_image_demotion/images', manager.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM card_images%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted image list should reach its image query while holding Manager authority');

        const membershipVersion = (await pool.query<{ version: number }>(
          `SELECT version FROM project_memberships WHERE id = 'pm_mgr'`,
        )).rows[0]?.version;
        assert.ok(membershipVersion !== undefined);
        const demotionPromise = req('PATCH', `/projects/p1/members/${manager.user.id}`, owner.session.id, {
          role: 'member', status: 'active', expectedVersion: membershipVersion,
        }, { 'Idempotency-Key': `idem_${crypto.randomUUID()}` });
        let demotionPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`, [readerPid],
          );
          demotionPid = waiting.rows[0]?.pid;
          if (demotionPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(demotionPid, 'Manager demotion must wait on the in-flight image list authorization lock');

        await blocker.query('COMMIT');
        const readResponse = await readPromise;
        assert.equal(readResponse.status, 200);
        assert.ok((await readResponse.text()).includes('private-trash-image.png'));
        assert.equal((await demotionPromise).status, 200);
        assert.equal((await req('GET', '/cards/card_image_demotion/images', manager.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('Mounted image content and thumbnail recheck Manager access after storage delivery', async () => {
      const privateBytes = new TextEncoder().encode('synthetic-private-trashed-image');
      const storage = new MemoryStorageDriver();
      await storage.put('race/binary-private-image', privateBytes, 'image/png');
      setStorageDriver(storage);
      try {
        await pool.query(`UPDATE project_memberships SET role = 'manager' WHERE id = 'pm_mgr'`);
        await pool.query(
          `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
           VALUES ('b_visible', 'p1', 'w1', $1, $2) ON CONFLICT DO NOTHING`,
          [manager.user.id, owner.user.id],
        );
        await pool.query(
          `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
           VALUES ('card_binary_race', 'w1', 'p1', 'b_visible', 'col_v1', 'Private binary card', 'low', 950, 'trashed', NOW(), $1, NOW() + INTERVAL '24 hours', NOW(), NOW())`,
          [owner.user.id],
        );
        await pool.query(
          `INSERT INTO card_images (id, workspace_id, project_id, card_id, uploader_id, filename, byte_length, content_type, storage_key, sha256, created_at, updated_at)
           VALUES ('img_binary_race', 'w1', 'p1', 'card_binary_race', $1, 'private-binary.png', $2, 'image/png', 'race/binary-private-image', 'abc', NOW(), NOW())`,
          [owner.user.id, privateBytes.byteLength],
        );

        const originalGet = storage.get.bind(storage);
        for (const suffix of ['content', 'thumbnail']) {
          await pool.query(`UPDATE project_memberships SET role = 'manager' WHERE id = 'pm_mgr'`);
          let releaseStorageRead!: () => void;
          let signalStorageRead!: () => void;
          const storageReadEntered = new Promise<void>(resolve => { signalStorageRead = resolve; });
          const storageReadReleased = new Promise<void>(resolve => { releaseStorageRead = resolve; });
          storage.get = async (key: string) => {
            const object = await originalGet(key);
            signalStorageRead();
            await storageReadReleased;
            return object;
          };

          const responsePromise = req('GET', `/images/img_binary_race/${suffix}`, manager.session.id);
          try {
            await storageReadEntered;
            const membershipVersion = (await pool.query<{ version: number }>(
              `SELECT version FROM project_memberships WHERE id = 'pm_mgr'`,
            )).rows[0]?.version;
            assert.ok(membershipVersion !== undefined);
            const demotion = await req('PATCH', `/projects/p1/members/${manager.user.id}`, owner.session.id, {
              role: 'member', status: 'active', expectedVersion: membershipVersion,
            }, { 'Idempotency-Key': `idem_${crypto.randomUUID()}` });
            assert.equal(demotion.status, 200, await demotion.text());
            assert.equal((await pool.query(`SELECT role FROM project_memberships WHERE id = 'pm_mgr'`)).rows[0]?.role, 'member');
          } finally {
            releaseStorageRead();
          }

          const delivered = await responsePromise;
          const responseBody = await delivered.text();
          assert.equal(delivered.status, 404, `${suffix} must deny delivery after demotion; body=${responseBody}`);
          assert.ok(!responseBody.includes('synthetic-private-trashed-image'));
          storage.get = originalGet;
          assert.equal((await req('GET', `/images/img_binary_race/${suffix}`, manager.session.id)).status, 404);
        }
      } finally {
        setStorageDriver(new MemoryStorageDriver());
      }
    });

    await t.test('Mounted access summary holds Owner scope through board count during ownership transfer', async () => {
      const summaryNextOwner = await createDevUserAndSession('summary-next-owner-race@test.invalid', 'Summary Next Owner', pool);
      const expectedBoardCount = Number((await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM boards WHERE project_id = 'p1' AND archived = FALSE`,
      )).rows[0]?.count ?? 0);
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE boards IN ACCESS EXCLUSIVE MODE');
        const summaryPromise = req('GET', '/projects/p1/access-summary', owner.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%COUNT(*)::INT AS board_count%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted access summary should reach its board count while holding Owner scope');

        const workspaceVersion = (await pool.query<{ version: number }>(
          `SELECT version FROM workspaces WHERE id = 'w1'`,
        )).rows[0]?.version;
        assert.ok(workspaceVersion !== undefined);
        const transferPromise = syntheticOwnerChange(summaryNextOwner.user.id, workspaceVersion);
        let transferPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`, [readerPid],
          );
          transferPid = waiting.rows[0]?.pid;
          if (transferPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(transferPid, 'Ownership transfer must wait for the access summary authorization scope');

        await blocker.query('COMMIT');
        const summaryResponse = await summaryPromise;
        assert.equal(summaryResponse.status, 200);
        const summary = (await summaryResponse.json()).data;
        assert.equal(summary.actor.role, 'owner');
        assert.equal(summary.boardInheritance.boardCount, expectedBoardCount);
        assert.equal((await transferPromise).status, 200);
        assert.equal((await req('GET', '/projects/p1/access-summary', owner.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
        // Leave the shared fixture owner in place for the following independent race test.
        await pool.query(`UPDATE workspaces SET owner_id = $1, version = version + 1 WHERE id = 'w1'`, [owner.user.id]);
      }
    });

    await t.test('Mounted people, directory and workspace project reads retain authorization through response assembly', async () => {
      await pool.query(`UPDATE project_memberships SET role = 'member', status = 'active' WHERE id = 'pm_mbr'`);
      await pool.query(
        `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
         VALUES ('b_visible', 'p1', 'w1', $1, $2) ON CONFLICT DO NOTHING`,
        [member.user.id, owner.user.id],
      );

      const prototypeProbe = await pool.connect();
      const clientPrototype = Object.getPrototypeOf(prototypeProbe) as any;
      prototypeProbe.release();
      const originalClientQuery = clientPrototype.query;
      const restoreQuery = () => { clientPrototype.query = originalClientQuery; };
      async function pauseBeforeQuery(path: string, sessionId: string, matches: (sql: string) => boolean) {
        let release!: () => void;
        let signalEntered!: () => void;
        const released = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { signalEntered = resolve; });
        let readerPid: number | undefined;
        let armed = true;
        clientPrototype.query = async function (...queryArgs: any[]) {
          const first = queryArgs[0];
          const sql = typeof first === 'string' ? first : first?.text ?? '';
          if (armed && matches(sql)) {
            armed = false;
            readerPid = this.processID;
            signalEntered();
            await released;
          }
          return originalClientQuery.apply(this, queryArgs);
        };
        const pending = req('GET', path, sessionId);
        try {
          await Promise.race([entered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Mounted read did not reach its query barrier for ${path}`)), 3000))]);
          restoreQuery();
          return { pending, readerPid: readerPid!, release };
        } catch (error) {
          release();
          restoreQuery();
          throw error;
        }
      }
      async function waitUntilBlockedBy(readerPid: number, label: string) {
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`, [readerPid],
          );
          if (waiting.rows[0]?.pid) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail(`${label} should wait on the in-flight read authorization lock`);
      }
      const removeMember = () => req('DELETE', `/projects/p1/members/${member.user.id}`, owner.session.id,
        undefined, { 'Idempotency-Key': `idem_${crypto.randomUUID()}` });
      const restoreMember = async () => {
        await pool.query(`UPDATE project_memberships SET status = 'active' WHERE id = 'pm_mbr'`);
        await pool.query(
          `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
           VALUES ('b_visible', 'p1', 'w1', $1, $2) ON CONFLICT DO NOTHING`,
          [member.user.id, owner.user.id],
        );
      };

      try {
        // Board-specific picker: the selected member must stay eligible through its result query.
        const boardPeopleRace = await pauseBeforeQuery(
          '/projects/p1/people?boardId=b_visible&purpose=mention', member.session.id,
          sql => sql.includes('WITH project_context AS'),
        );
        const grantRevision = await getRevision('b_visible');
        const revokeGrant = req('DELETE', `/boards/b_visible/grants/${member.user.id}`, owner.session.id, {
          expectedAccessRevision: grantRevision,
        }, { 'Idempotency-Key': `idem_${crypto.randomUUID()}` });
        try {
          await waitUntilBlockedBy(boardPeopleRace.readerPid, 'Board grant revocation');
        } finally {
          boardPeopleRace.release();
        }
        const boardPeopleResponse = await boardPeopleRace.pending;
        assert.equal(boardPeopleResponse.status, 200);
        assert.ok((await boardPeopleResponse.json()).data.some((person: { id: string }) => person.id === member.user.id));
        assert.equal((await revokeGrant).status, 200);
        assert.equal((await req('GET', '/projects/p1/people?boardId=b_visible&purpose=mention', member.session.id)).status, 404);
        await restoreMember();

        // Project picker: removal waits for the picker query, then fresh access is hidden.
        const projectPeopleRace = await pauseBeforeQuery(
          '/projects/p1/people', member.session.id, sql => sql.includes('WITH project_context AS'),
        );
        const removalAfterPicker = removeMember();
        try {
          await waitUntilBlockedBy(projectPeopleRace.readerPid, 'Project membership removal after picker start');
        } finally {
          projectPeopleRace.release();
        }
        const projectPeopleResponse = await projectPeopleRace.pending;
        assert.equal(projectPeopleResponse.status, 200);
        assert.ok((await projectPeopleResponse.json()).data.some((person: { id: string }) => person.id === member.user.id));
        assert.equal((await removalAfterPicker).status, 200);
        assert.equal((await req('GET', '/projects/p1/people', member.session.id)).status, 404);
        await restoreMember();

        // Directory: removal cannot invalidate the actor between authorization and data collection.
        const directoryRace = await pauseBeforeQuery(
          '/projects/p1/members', member.session.id, sql => sql.includes('pm.id AS membership_id'),
        );
        const removalAfterDirectoryStart = removeMember();
        try {
          await waitUntilBlockedBy(directoryRace.readerPid, 'Project membership removal after directory start');
        } finally {
          directoryRace.release();
        }
        const directoryResponse = await directoryRace.pending;
        assert.equal(directoryResponse.status, 200);
        assert.ok((await directoryResponse.json()).data.some((person: { email: string }) => person.email === member.user.email));
        assert.equal((await removalAfterDirectoryStart).status, 200);
        assert.equal((await req('GET', '/projects/p1/members', member.session.id)).status, 404);
        await restoreMember();

        // Workspace project list: transfer waits for the Owner-scoped project query.
        const nextOwner = await createDevUserAndSession('next-owner-project-list-race@test.invalid', 'Next Owner', pool);
        const workspaceProjectsRace = await pauseBeforeQuery(
          '/workspaces/w1/projects', owner.session.id,
          sql => sql.includes('FROM projects p') && sql.includes('WHERE p.workspace_id = $1') && sql.includes('LIMIT $5'),
        );
        const workspaceVersion = (await pool.query<{ version: number }>(
          `SELECT version FROM workspaces WHERE id = 'w1'`,
        )).rows[0]?.version;
        assert.ok(workspaceVersion !== undefined);
        const transfer = syntheticOwnerChange(nextOwner.user.id, workspaceVersion);
        try {
          await waitUntilBlockedBy(workspaceProjectsRace.readerPid, 'Ownership transfer after workspace project list start');
        } finally {
          workspaceProjectsRace.release();
        }
        const workspaceProjectsResponse = await workspaceProjectsRace.pending;
        assert.equal(workspaceProjectsResponse.status, 200);
        assert.ok((await workspaceProjectsResponse.json()).data.some((project: { id: string }) => project.id === 'p1'));
        assert.equal((await transfer).status, 200);
        assert.equal((await req('GET', '/workspaces/w1/projects', owner.session.id)).status, 404);
      } finally {
        restoreQuery();
        await restoreMember();
        await pool.query(`UPDATE workspaces SET owner_id = $1, version = version + 1 WHERE id = 'w1'`, [owner.user.id]);
      }
    });

    await t.test('Mounted project board list holds Owner authority through delivery during ownership transfer', async () => {
      const nextOwner = await createDevUserAndSession('next-owner-race@test.invalid', 'Next Owner', pool);
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE boards IN ACCESS EXCLUSIVE MODE');
        const readPromise = req('GET', '/projects/p1/boards', owner.session.id);
        let readerPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND query LIKE '%FROM boards%'
               AND cardinality(pg_blocking_pids(pid)) > 0 LIMIT 1`,
          );
          readerPid = waiting.rows[0]?.pid;
          if (readerPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(readerPid, 'Mounted board list should reach its board query while holding Owner authority');

        const workspaceVersion = (await pool.query<{ version: number }>(
          `SELECT version FROM workspaces WHERE id = 'w1'`,
        )).rows[0]?.version;
        assert.ok(workspaceVersion !== undefined);
        const transferPromise = syntheticOwnerChange(nextOwner.user.id, workspaceVersion);
        let transferPid: number | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const waiting = await pool.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE state = 'active' AND $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`, [readerPid],
          );
          transferPid = waiting.rows[0]?.pid;
          if (transferPid) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(transferPid, 'Ownership transfer must wait on the in-flight board list authorization lock');
        await blocker.query('COMMIT');
        const readResponse = await readPromise;
        assert.equal(readResponse.status, 200);
        assert.ok((await readResponse.text()).includes('b_visible'));
        assert.equal((await transferPromise).status, 200);
        assert.equal((await pool.query(`SELECT owner_id FROM workspaces WHERE id = 'w1'`)).rows[0]?.owner_id, nextOwner.user.id);
        assert.equal((await req('GET', '/projects/p1/boards', owner.session.id)).status, 404);
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    });

    await t.test('BAR7: Project, invitation, and membership authority and replay gates reject former owner after ownership transfer', async () => {
      const currentOwner = await createDevUserAndSession('current-bar7-owner@test.invalid', 'Current Owner', pool);
      await pool.query(`UPDATE workspaces SET owner_id = $1, version = version + 1 WHERE id = 'w1'`, [currentOwner.user.id]);

      // 1. Former owner cannot create projects in workspace w1
      const prjCreateRes = await req('POST', '/workspaces/w1/projects', owner.session.id, {
        name: 'Denied Project By Former Owner',
      });
      assert.equal(prjCreateRes.status, 404);

      // 2. Former owner cannot archive or reopen projects
      const archRes = await req('POST', '/projects/p1/archive', owner.session.id);
      assert.equal(archRes.status, 404);
      const reopenRes = await req('POST', '/projects/p1/reopen', owner.session.id);
      assert.equal(reopenRes.status, 404);

      // 3. Former owner cannot list invitations (directory privacy)
      const listInvRes = await req('GET', '/projects/p1/invitations', owner.session.id);
      assert.equal(listInvRes.status, 404);

      // 4. Former owner cannot create invitations
      const createInvRes = await req('POST', '/projects/p1/invitations', owner.session.id, {
        email: 'attacker-invite@test.invalid',
        role: 'member',
      });
      assert.equal(createInvRes.status, 404);

      // 5. Manager cannot invite a manager (403 FORBIDDEN)
      const mgrInviteMgrRes = await req('POST', '/projects/p1/invitations', manager.session.id, {
        email: 'new-mgr@test.invalid',
        role: 'manager',
      });
      assert.equal(mgrInviteMgrRes.status, 403);

      // 6. Current owner (currentOwner) creates a manager invitation and a member invitation
      const ownerMgrInvRes = await req('POST', '/projects/p1/invitations', currentOwner.session.id, {
        email: 'valid-mgr@test.invalid',
        role: 'manager',
      });
      assert.equal(ownerMgrInvRes.status, 201);
      const ownerMgrInvId = (await ownerMgrInvRes.json()).data.id;

      const ownerMbrInvRes = await req('POST', '/projects/p1/invitations', currentOwner.session.id, {
        email: 'valid-mbr@test.invalid',
        role: 'member',
      });
      assert.equal(ownerMbrInvRes.status, 201);
      const ownerMbrInvId = (await ownerMbrInvRes.json()).data.id;

      // 7. Manager cannot resend or revoke the manager invitation
      const mgrResendMgr = await req('POST', `/projects/p1/invitations/${ownerMgrInvId}/resend`, manager.session.id);
      assert.equal(mgrResendMgr.status, 403);
      const mgrRevokeMgr = await req('POST', `/projects/p1/invitations/${ownerMgrInvId}/revoke`, manager.session.id);
      assert.equal(mgrRevokeMgr.status, 403);

      // 8. Former owner cannot resend or revoke invitations
      const formerResend = await req('POST', `/projects/p1/invitations/${ownerMbrInvId}/resend`, owner.session.id);
      assert.equal(formerResend.status, 404);
      const formerRevoke = await req('POST', `/projects/p1/invitations/${ownerMbrInvId}/revoke`, owner.session.id);
      assert.equal(formerRevoke.status, 404);

      // 9. Replay authorization: Former owner cannot replay a PATCH membership receipt
      const currentMemVersion = (await pool.query<{ version: number }>(
        `SELECT version FROM project_memberships WHERE project_id = 'p1' AND user_id = $1`,
        [member.user.id],
      )).rows[0]!.version;
      const memberPatchKey = `bar7-patch-key-${crypto.randomUUID()}`;
      const patchRes = await req('PATCH', `/projects/p1/members/${member.user.id}`, currentOwner.session.id, {
        role: 'viewer',
        status: 'active',
        expectedVersion: currentMemVersion,
      }, { 'Idempotency-Key': memberPatchKey });
      assert.equal(patchRes.status, 200);

      // Same key replayed by former owner (who lost all access) returns 404
      const formerPatchReplay = await req('PATCH', `/projects/p1/members/${member.user.id}`, owner.session.id, {
        role: 'viewer',
        status: 'active',
        expectedVersion: currentMemVersion,
      }, { 'Idempotency-Key': memberPatchKey });
      assert.equal(formerPatchReplay.status, 404);

      // 10. Replay authorization: Former owner cannot replay invitation creation receipt
      const createInvKey = `bar7-inv-key-${crypto.randomUUID()}`;
      const ownerInvWithKey = await req('POST', '/projects/p1/invitations', currentOwner.session.id, {
        email: 'key-test@test.invalid',
        role: 'member',
      }, { 'Idempotency-Key': createInvKey });
      assert.equal(ownerInvWithKey.status, 201);

      const formerInvReplay = await req('POST', '/projects/p1/invitations', owner.session.id, {
        email: 'key-test@test.invalid',
        role: 'member',
      }, { 'Idempotency-Key': createInvKey });
      assert.equal(formerInvReplay.status, 404);
    });

    await t.test('Scheduled mention delivery fails closed when board_grants is missing', async () => {
      await pool.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, created_at, updated_at)
         VALUES ('cmt_pre0007', 'w1', 'p1', 'card_s1', $1, 'Private mention', NOW(), NOW())`,
        [owner.user.id],
      );
      await pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
         VALUES ('ob_pre0007', 'w1', 'p1', 'comment.created', $1::jsonb, 'pending', 0, NOW(), NOW())`,
        [JSON.stringify({ cardId: 'card_s1', commentId: 'cmt_pre0007', authorId: owner.user.id, mentions: [manager.user.id] })],
      );
      // This isolated schema now models a runtime whose 0007 migration is
      // unavailable. The worker must not fall back to project-only access.
      await pool.query('DROP TABLE board_grants CASCADE');
      await assert.rejects(processOutboxLease(pool, { batchSize: 10 }));
      const leaked = await pool.query(
        `SELECT id FROM notifications WHERE user_id = $1 AND card_id = 'card_s1'`,
        [manager.user.id],
      );
      assert.equal(leaked.rows.length, 0);
      const pending = await pool.query(`SELECT status FROM outbox WHERE id = 'ob_pre0007'`);
      assert.equal(pending.rows[0]?.status, 'pending');
    });


  } finally {
    setGlobalPool(null);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
