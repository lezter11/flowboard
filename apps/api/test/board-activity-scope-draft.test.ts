import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { runMigrations } from '../src/adapters/migrations.ts';
import { listScopedProjectActivityDraft } from '../src/adapters/board-activity-scope-draft.ts';
import { recordActivity } from '../src/adapters/activity.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
test('unmounted activity scope draft on isolated PostgreSQL', { skip: !testUrl && 'Requires disposable local flowboard_access_test database' }, async t => {
  const u = new URL(testUrl!);
  if (!['127.0.0.1','localhost','::1'].includes(u.hostname) || u.pathname !== '/flowboard_access_test') throw new Error('Expected disposable local test database.');
  const schema = `activity_scope_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString:testUrl, max:1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString:testUrl, max:4, options:`-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES
      ('owner','owner@test.invalid','Owner',now(),now()),('mgr','mgr@test.invalid','Manager',now(),now()),
      ('member','member@test.invalid','Member',now(),now()),('other','other@test.invalid','Other',now(),now())`);
    await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES
      ('w','Workspace','UTC','owner',now(),now())`);
    await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES
      ('p','w','Project',now(),now()),('p2','w','Sibling',now(),now())`);
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES
      ('pm','p','w','mgr','manager','active',now(),now()),('pmm','p','w','member','member','active',now(),now()),
      ('pm2','p2','w','other','manager','active',now(),now())`);
    await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES
      ('visible','w','p','Visible',now(),now()),('secret','w','p','Secret',now(),now()),('sibling','w','p2','Sibling',now(),now())`);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES ('visible','p','w','mgr','owner')`);
    await pool.query(`INSERT INTO activity_log(id,workspace_id,project_id,board_id,visibility_scope,actor_id,action,safe_changes,created_at) VALUES
      ('v1','w','p','visible','board','owner','card_created','{"safe":true}','2026-01-01T00:00:00.000001Z'),
      ('v2','w','p','visible','board','owner','card_changed','{"safe":true}','2026-01-01T00:00:00.000002Z'),
      ('secret1','w','p','secret','board','owner','board_access_granted','{"secret":"hidden"}','2026-01-01T00:00:00.000003Z'),
      ('project1','w','p',NULL,'project','owner','project_changed','{}','2026-01-01T00:00:00.000004Z'),
      ('unknown1','w','p',NULL,'unknown','owner','legacy','{"secret":"unclassified"}','2026-01-01T00:00:00.000005Z'),
      ('misclassified','w','p',NULL,'project','owner','project_changed','{"nested":{"boardId":"secret"}}','2026-01-01T00:00:00.000006Z'),
      ('sibling1','w','p2','sibling','board','owner','card_created','{}','2026-01-01T00:00:00.000007Z')`);
    async function read(actor: string, options: Parameters<typeof listScopedProjectActivityDraft>[3] = {}) {
      const client = await pool.connect();
      try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result=await listScopedProjectActivityDraft(client,'p',actor,options); await client.query('COMMIT'); return result; }
      catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    await t.test('manager sees granted board events only; project, unknown and sibling events fail closed', async () => {
      const result=await read('mgr'); assert.deepEqual(result.items.map(x=>x.id),['v2','v1']);
      assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('sibling'));
    });
    await t.test('owner sees all events in the owned project and members and outsiders are denied', async () => {
      assert.deepEqual((await read('owner')).items.map(x=>x.id),['misclassified','unknown1','project1','secret1','v2','v1']);
      await assert.rejects(read('member'), (e: unknown)=>(e as {status:number}).status===403);
      await assert.rejects(read('other'), (e: unknown)=>(e as {status:number}).status===404);
    });
    await t.test('pagination filters before LIMIT and preserves microsecond ordering', async () => {
      const first=await read('mgr',{limit:1}); assert.deepEqual(first.items.map(x=>x.id),['v2']); assert.ok(first.nextCursor);
      const second=await read('mgr',{limit:1,cursor:first.nextCursor!}); assert.deepEqual(second.items.map(x=>x.id),['v1']); assert.equal(second.nextCursor,null);
    });
    await t.test('revocation invalidates previous cursor and next reads do not leak board events', async () => {
      const first=await read('mgr',{limit:1}); assert.ok(first.nextCursor);
      await pool.query("DELETE FROM board_grants WHERE board_id='visible' AND user_id='mgr'");
      await pool.query("UPDATE boards SET access_revision=access_revision+1 WHERE id='visible'");
      await assert.rejects(read('mgr',{cursor:first.nextCursor!}), (e:unknown)=>(e as {code:string}).code==='STALE_CURSOR');
      assert.deepEqual((await read('mgr')).items.map(x=>x.id),[]);
    });
    await t.test('ancestry constraint and immutable scope reject fabricated changes', async () => {
      await assert.rejects(pool.query("UPDATE activity_log SET visibility_scope='project',board_id=NULL WHERE id='secret1'"));
      await assert.rejects(pool.query("INSERT INTO activity_log(id,workspace_id,project_id,board_id,visibility_scope,actor_id,action,created_at) VALUES ('bad','w','p','sibling','board','owner','bad',now())"));
    });
    await t.test('recordActivity writes automatically scope to board and enforce isolation', async () => {
      await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES
        ('col_v','w','p','visible','ColV','blue','todo',0,now(),now()),
        ('col_s','w','p','secret','ColS','blue','todo',0,now(),now())`);
      await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES
        ('card_v','w','p','visible','col_v','Card Visible','low',100,'active',now(),now()),
        ('card_s','w','p','secret','col_s','Card Secret','low',100,'active',now(),now())`);
      await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES ('visible','p','w','mgr','owner') ON CONFLICT DO NOTHING`);

      // 1. Record card event on visible card (boardId omitted, resolved from card)
      const actIdV = await recordActivity(pool, {
        workspaceId: 'w',
        projectId: 'p',
        cardId: 'card_v',
        actorId: 'owner',
        action: 'card_created',
        safeChanges: { title: 'Card Visible' },
      });
      const rowV = (await pool.query('SELECT board_id, visibility_scope FROM activity_log WHERE id = $1', [actIdV])).rows[0];
      assert.equal(rowV.board_id, 'visible');
      assert.equal(rowV.visibility_scope, 'board');

      // 2. Record card event on secret card
      const actIdS = await recordActivity(pool, {
        workspaceId: 'w',
        projectId: 'p',
        boardId: 'secret',
        cardId: 'card_s',
        actorId: 'owner',
        action: 'comment_deleted',
        safeChanges: { commentId: 'c1' },
      });
      const rowS = (await pool.query('SELECT board_id, visibility_scope FROM activity_log WHERE id = $1', [actIdS])).rows[0];
      assert.equal(rowS.board_id, 'secret');
      assert.equal(rowS.visibility_scope, 'board');

      // 3. Record board-level batch event (card_id is null, boardId provided)
      const actIdImport = await recordActivity(pool, {
        workspaceId: 'w',
        projectId: 'p',
        boardId: 'visible',
        actorId: 'owner',
        action: 'card_import_committed',
        visibilityScope: 'board',
        safeChanges: { count: 5 },
      });
      const rowImport = (await pool.query('SELECT board_id, visibility_scope FROM activity_log WHERE id = $1', [actIdImport])).rows[0];
      assert.equal(rowImport.board_id, 'visible');
      assert.equal(rowImport.visibility_scope, 'board');

      // 4. Mgr can read visible card event and visible import event, but NEVER secret card event
      const mgrEvents = await read('mgr', { limit: 50 });
      const mgrIds = mgrEvents.items.map((x) => x.id);
      assert.ok(mgrIds.includes(actIdV));
      assert.ok(mgrIds.includes(actIdImport));
      assert.ok(!mgrIds.includes(actIdS));

      // 5. Spoofed boardId on card mismatch is rejected by trigger
      await assert.rejects(
        recordActivity(pool, {
          workspaceId: 'w',
          projectId: 'p',
          boardId: 'secret', // wrong board!
          cardId: 'card_v',  // card_v actually lives in 'visible'
          actorId: 'owner',
          action: 'card_updated',
          visibilityScope: 'board',
        }),
        (err: Error) => err.message.includes('activity card scope does not match'),
      );
    });
  } finally { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});
