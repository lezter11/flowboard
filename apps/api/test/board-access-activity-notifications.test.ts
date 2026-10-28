import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';
import { changeBoardGrant } from '../src/adapters/board-grants-foundation.ts';
import { markNotificationRead, markAllNotificationsRead } from '../src/adapters/notifications.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
test('mounted activity and notifications enforce board access', { skip: !testUrl && 'Disposable local PostgreSQL required' }, async t => {
  const url = new URL(testUrl!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/flowboard_access_test')
    throw new Error('Use only local disposable flowboard_access_test database');
  const schema = `access_aud_ntf_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 8, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner-aud@test.invalid', 'Owner', pool);
    const manager = await createDevUserAndSession('manager-aud@test.invalid', 'Manager', pool);
    const member = await createDevUserAndSession('member-aud@test.invalid', 'Member', pool);
    const viewer = await createDevUserAndSession('viewer-aud@test.invalid', 'Viewer', pool);
    const outsider = await createDevUserAndSession('outsider-aud@test.invalid', 'Outsider', pool);
    const ids = { owner: owner.user.id, manager: manager.user.id, member: member.user.id, viewer: viewer.user.id, outsider: outsider.user.id };
    await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)
      VALUES ('w','Owned','UTC',$1,now(),now())`, [ids.owner]);
    await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)
      VALUES ('p','w','Project',now(),now()),('sibling','w','Sibling',now(),now())`);
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
      VALUES ('pm','p','w',$1,'manager','active',now(),now()),
             ('pn','p','w',$2,'member','active',now(),now()),
             ('pv','p','w',$3,'viewer','active',now(),now()),
             ('po','sibling','w',$4,'manager','active',now(),now())`, [ids.manager, ids.member, ids.viewer, ids.outsider]);
    await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)
      VALUES ('visible','w','p','Visible',now(),now()),('secret','w','p','Secret',now(),now()),
             ('other','w','sibling','Other',now(),now())`);
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)
      VALUES ('cv','w','p','visible','V','blue','todo',0,now(),now()),
             ('cs','w','p','secret','S','red','todo',0,now(),now()),
             ('co','w','sibling','other','O','blue','todo',0,now(),now())`);
    await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
      VALUES ('card-v','w','p','visible','cv','Visible card','low',100,'active',now(),now()),
             ('card-s','w','p','secret','cs','Secret card','low',100,'active',now(),now()),
             ('card-o','w','sibling','other','co','Other card','low',100,'active',now(),now())`);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
      VALUES ('visible','p','w',$1,$4),('visible','p','w',$2,$4),('visible','p','w',$3,$4)`, [ids.manager, ids.member, ids.viewer, ids.owner]);
    await pool.query(`INSERT INTO activity_log(id,workspace_id,project_id,board_id,visibility_scope,card_id,actor_id,action,safe_changes,created_at)
      VALUES ('a1','w','p','visible','board','card-v',$1,'card_created','{}','2026-01-01T00:00:00.123100Z'),
             ('a2','w','p','visible','board','card-v',$1,'card_changed','{}','2026-01-01T00:00:00.123900Z'),
             ('hidden','w','p','secret','board','card-s',$1,'card_changed','{"private":"secret"}','2026-01-01T00:00:00.124000Z'),
             ('unknown','w','p',NULL,'unknown',NULL,$1,'legacy','{"private":"unknown"}','2026-01-01T00:00:00.125000Z'),
             ('other-a','w','sibling','other','board','card-o',$1,'card_created','{}','2026-01-01T00:00:00.126000Z')`, [ids.owner]);
    await pool.query(`INSERT INTO notifications(id,workspace_id,project_id,user_id,type,title,body,link,read,created_at,card_id)
      VALUES ('n1','w','p',$1,'mention','Visible 1','Visible','/visible',false,'2026-01-01T00:00:00.123100Z','card-v'),
             ('n2','w','p',$1,'mention','Visible 2','Visible','/visible',false,'2026-01-01T00:00:00.123900Z','card-v'),
             ('nh','w','p',$1,'mention','Secret','Secret','/secret',false,'2026-01-01T00:00:00.124000Z','card-s'),
             ('nl','w','p',$1,'mention','Legacy','Legacy','/legacy',false,'2026-01-01T00:00:00.125000Z',NULL),
             ('no','w','p',$2,'mention','Owner legacy','Owner','/owner',false,'2026-01-01T00:00:00.126000Z',NULL)`, [ids.manager, ids.owner]);
    const app = createApp(async () => {}, { pool });
    const request = async (session: string, path: string, method = 'GET') => {
      const response = await app.request(`http://localhost/api/v1${path}`, { method,
        headers: { cookie: `flowboard_session=${session}` } });
      return { status: response.status, body: await response.json() as any };
    };

    await t.test('project and card activity hide hidden boards and unknown events before pagination', async () => {
      const first = await request(manager.session.id, '/projects/p/activity?limit=1');
      assert.equal(first.status, 200);
      assert.deepEqual(first.body.data.map((x: any) => x.id), ['a2']);
      const second = await request(manager.session.id, `/projects/p/activity?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
      assert.equal(second.status, 200);
      assert.deepEqual(second.body.data.map((x: any) => x.id), ['a1']);
      assert.equal(second.body.nextCursor, null);
      assert.equal((await request(manager.session.id, '/cards/card-v/activity')).body.data.length, 2);
      assert.equal((await request(manager.session.id, '/cards/card-s/activity')).status, 404);
      assert.equal((await request(member.session.id, '/projects/p/activity')).status, 403);
      assert.equal((await request(viewer.session.id, '/cards/card-v/activity')).status, 200);
      assert.equal((await request(outsider.session.id, '/cards/card-v/activity')).status, 404);
      const ownerFeed = await request(owner.session.id, '/projects/p/activity');
      assert.deepEqual(ownerFeed.body.data.map((x: any) => x.id), ['unknown', 'hidden', 'a2', 'a1']);
    });

    await t.test('inbox hides hidden and legacy rows, and mark operations respect board access', async () => {
      const first = await request(manager.session.id, '/notifications?limit=1');
      assert.equal(first.status, 200);
      assert.deepEqual(first.body.data.map((x: any) => x.id), ['n2']);
      const second = await request(manager.session.id, `/notifications?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
      assert.deepEqual(second.body.data.map((x: any) => x.id), ['n1']);
      assert.equal(second.body.nextCursor, null);
      assert.equal((await request(manager.session.id, '/notifications/nh/read', 'PATCH')).status, 404);
      assert.equal((await request(manager.session.id, '/notifications/nl/read', 'PATCH')).status, 404);
      assert.equal((await request(member.session.id, '/notifications/n1/read', 'PATCH')).status, 404);
      const all = await request(manager.session.id, '/notifications/mark-all-read', 'POST');
      assert.equal(all.status, 200);
      assert.equal(all.body.data.count, 2);
      const unread = await pool.query(`SELECT id FROM notifications WHERE id IN ('nh','nl') AND NOT read ORDER BY id`);
      assert.deepEqual(unread.rows.map(r => r.id), ['nh', 'nl']);
      assert.deepEqual((await request(owner.session.id, '/notifications')).body.data.map((x: any) => x.id), ['no']);
      await pool.query(`UPDATE notifications SET read=false WHERE id IN ('n1','n2')`);
    });

    await t.test('revocation invalidates cursors and blocks reads and marks', async () => {
      const first = await request(manager.session.id, '/projects/p/activity?limit=1');
      const inbox = await request(manager.session.id, '/notifications?limit=1');
      await pool.query(`DELETE FROM board_grants WHERE board_id='visible' AND user_id=$1`, [ids.manager]);
      await pool.query(`UPDATE boards SET access_revision=access_revision+1 WHERE id='visible'`);
      assert.equal((await request(manager.session.id, `/projects/p/activity?cursor=${encodeURIComponent(first.body.nextCursor)}`)).status, 409);
      assert.equal((await request(manager.session.id, `/notifications?cursor=${encodeURIComponent(inbox.body.nextCursor)}`)).status, 409);
      assert.deepEqual((await request(manager.session.id, '/projects/p/activity')).body.data, []);
      assert.deepEqual((await request(manager.session.id, '/notifications')).body.data, []);
      assert.equal((await request(manager.session.id, '/notifications/n1/read', 'PATCH')).status, 404);
      await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES ('visible','p','w',$1,$2)`, [ids.manager, ids.owner]);
    });

    await t.test('notification read and grant revocation serialize', async () => {
      const revoker = await pool.connect();
      const marker = await pool.connect();
      try {
        const revision = BigInt((await pool.query(`SELECT access_revision FROM boards WHERE id='visible'`)).rows[0].access_revision);
        await revoker.query('BEGIN'); await marker.query('BEGIN');
        const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const markerPid = (await marker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await changeBoardGrant(revoker, 'visible', ids.owner, ids.manager, false, revision);
        const pending = markNotificationRead(marker, 'n1', ids.manager).then(() => 'marked', (e: any) => e.status);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = Boolean((await pool.query('SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [markerPid, revokerPid])).rows[0].blocked);
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true);
        await revoker.query('COMMIT');
        assert.equal(await pending, 404);
        await marker.query('COMMIT');
        assert.equal((await pool.query(`SELECT read FROM notifications WHERE id='n1'`)).rows[0].read, false);
      } finally {
        await revoker.query('ROLLBACK').catch(() => {}); await marker.query('ROLLBACK').catch(() => {});
        revoker.release(); marker.release();
      }
    });

    await t.test('batch read commits before a waiting revocation, then later marks are denied', async () => {
      await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
        VALUES ('visible','p','w',$1,$2)`, [ids.manager, ids.owner]);
      await pool.query(`UPDATE notifications SET read=false WHERE id IN ('n1','n2')`);
      const revoker = await pool.connect();
      const marker = await pool.connect();
      try {
        const revision = BigInt((await pool.query(`SELECT access_revision FROM boards WHERE id='visible'`)).rows[0].access_revision);
        await revoker.query('BEGIN'); await marker.query('BEGIN');
        const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const markerPid = (await marker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        assert.equal((await markAllNotificationsRead(marker, ids.manager)).count, 2);
        const pending = changeBoardGrant(revoker, 'visible', ids.owner, ids.manager, false, revision);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = Boolean((await pool.query('SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [revokerPid, markerPid])).rows[0].blocked);
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true);
        await marker.query('COMMIT');
        assert.equal(await pending, true);
        await revoker.query('COMMIT');
        assert.equal((await markAllNotificationsRead(pool, ids.manager)).count, 0);
      } finally {
        await revoker.query('ROLLBACK').catch(() => {}); await marker.query('ROLLBACK').catch(() => {});
        revoker.release(); marker.release();
      }
    });
  } finally {
    setGlobalPool(null);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
