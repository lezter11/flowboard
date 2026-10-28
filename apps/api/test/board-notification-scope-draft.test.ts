import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { runMigrations } from '../src/adapters/migrations.ts';
import { listDraftNotifications, markDraftNotificationRead, markAllDraftNotificationsRead, insertDraftMention } from '../src/adapters/board-notification-scope-draft.ts';
import { changeBoardGrant } from '../src/adapters/board-grants-foundation.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
test('unmounted notification visibility draft on disposable PostgreSQL', { skip: !testUrl && 'Disposable database required' }, async t => {
  const url = new URL(testUrl!);
  if (!['127.0.0.1','localhost','::1'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') throw new Error('Expected disposable local flowboard_access_test database');
  const schema = `ntf_scope_${crypto.randomUUID().replaceAll('-','')}`;
  const admin = new pg.Pool({connectionString:testUrl,max:2});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({connectionString:testUrl,max:4,options:`-c search_path=${schema}`});
  async function tx<T>(f:(c:pg.PoolClient)=>Promise<T>):Promise<T> {
    const c=await pool.connect(); try {await c.query('BEGIN');const value=await f(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('owner','owner@test.invalid','Owner',now(),now()),('member','member@test.invalid','Member',now(),now()),('outside','outside@test.invalid','Outside',now(),now())`);
    await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Workspace','UTC','owner',now(),now())`);
    await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Project',now(),now()),('p2','w','Other',now(),now())`);
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('m','p','w','member','member','active',now(),now()),('m2','p2','w','outside','member','active',now(),now())`);
    await pool.query(`INSERT INTO boards(id,project_id,workspace_id,name,created_at,updated_at) VALUES ('b','p','w','Allowed',now(),now()),('hidden','p','w','Hidden',now(),now()),('sibling','p2','w','Sibling',now(),now())`);
    await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES ('col','w','p','b','Ready','blue','todo',0,now(),now()),('col2','w','p','hidden','Ready','blue','todo',0,now(),now()),('col3','w','p2','sibling','Ready','blue','todo',0,now(),now())`);
    await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES ('card','w','p','b','col','Visible','low',100,'active',now(),now()),('secret','w','p','hidden','col2','Secret','low',100,'active',now(),now()),('foreign','w','p2','sibling','col3','Foreign','low',100,'active',now(),now())`);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES ('b','p','w','member','owner')`);
    await pool.query(`INSERT INTO notifications(id,workspace_id,project_id,user_id,type,title,body,link,read,created_at,card_id) VALUES
      ('hidden-n','w','p','member','mention','Secret','Secret','/secret',false,'2026-01-05', 'secret'),
      ('legacy','w','p','member','mention','Unknown','Unknown','/legacy',false,'2026-01-04',NULL),
      ('good2','w','p','member','mention','Visible two','Visible','/visible',false,'2026-01-03 00:00:00.123900+00','card'),
      ('good1','w','p','member','mention','Visible one','Visible','/visible',false,'2026-01-03 00:00:00.123100+00','card'),
      ('owner-legacy','w','p','owner','mention','Owner legacy','Own','/own',false,'2026-01-01',NULL)`);
    await t.test('filters before paging and hides unclassified legacy', async()=>{
      const first=await listDraftNotifications(pool,'member',1); assert.deepEqual(first.map(n=>n.id),['good2']);
      const last=first[0]!; assert.equal(last.cursor_at,'2026-01-03T00:00:00.123900Z');
      const second=await listDraftNotifications(pool,'member',1,{createdAt:last.cursor_at,id:last.id}); assert.deepEqual(second.map(n=>n.id),['good1']);
      const final=second[0]!; assert.deepEqual(await listDraftNotifications(pool,'member',1,{createdAt:final.cursor_at,id:final.id}),[]);
      assert.deepEqual((await listDraftNotifications(pool,'owner',10)).map(n=>n.id),['owner-legacy']);
      assert.deepEqual(await listDraftNotifications(pool,'outside',10),[]);
    });
    await t.test('mark operations never update hidden or another person\'s records', async()=>{
      assert.equal(await tx(c=>markDraftNotificationRead(c,'member','hidden-n')),false);
      assert.equal(await tx(c=>markDraftNotificationRead(c,'member','legacy')),false);
      assert.equal(await tx(c=>markDraftNotificationRead(c,'member','owner-legacy')),false);
      assert.equal(await tx(c=>markAllDraftNotificationsRead(c,'outside')),0);
      assert.equal(await tx(c=>markAllDraftNotificationsRead(c,'member')),2);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id='member' AND NOT read`)).rows[0].n,2);
      const hidden=await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE id IN ('hidden-n','legacy') AND NOT read`);assert.equal(hidden.rows[0].n,2);
      await pool.query(`UPDATE notifications SET read=FALSE WHERE id IN ('good1','good2')`);
    });
    await t.test('single mark and revocation serialize in both orders', async()=>{
      const getRevision=async()=>BigInt((await pool.query(`SELECT access_revision FROM boards WHERE id='b'`)).rows[0].access_revision);
      const waitBlocked=async(pid:number,blocker:number)=>{
        for(let i=0;i<100;i++){
          if((await pool.query(`SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked`,[pid,blocker])).rows[0].blocked)return;
          await new Promise(resolve=>setTimeout(resolve,10));
        }throw new Error('Transaction did not block on expected grant lock');
      };
      const revoker=await pool.connect(),marker=await pool.connect();
      try {
        let revision=await getRevision();
        await revoker.query('BEGIN');await marker.query('BEGIN');
        const rp=(await revoker.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        const mp=(await marker.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        await changeBoardGrant(revoker,'b','owner','member',false,revision);
        const pendingMark=markDraftNotificationRead(marker,'member','good2');
        await waitBlocked(mp,rp);await revoker.query('COMMIT');
        assert.equal(await pendingMark,false);await marker.query('COMMIT');
        revision=await getRevision(); await tx(c=>changeBoardGrant(c,'b','owner','member',true,revision));
        revision=await getRevision();await revoker.query('BEGIN');await marker.query('BEGIN');
        assert.equal(await markDraftNotificationRead(marker,'member','good2'),true);
        const pendingRevoke=changeBoardGrant(revoker,'b','owner','member',false,revision);
        await waitBlocked(rp,mp);await marker.query('COMMIT');
        assert.equal(await pendingRevoke,true);await revoker.query('COMMIT');
        assert.equal(await tx(c=>markDraftNotificationRead(c,'member','good2')),false);
        revision=await getRevision();await tx(c=>changeBoardGrant(c,'b','owner','member',true,revision));
      } finally {await revoker.query('ROLLBACK').catch(()=>{});await marker.query('ROLLBACK').catch(()=>{});revoker.release();marker.release();}
    });
    await t.test('batch mark all and revocation serialize in both orders', async()=>{
      const getRevision=async()=>BigInt((await pool.query(`SELECT access_revision FROM boards WHERE id='b'`)).rows[0].access_revision);
      const waitBlocked=async(pid:number,blocker:number)=>{
        for(let i=0;i<100;i++){
          if((await pool.query(`SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked`,[pid,blocker])).rows[0].blocked)return;
          await new Promise(resolve=>setTimeout(resolve,10));
        }throw new Error('Transaction did not block on expected grant lock');
      };
      const revoker=await pool.connect(),marker=await pool.connect();
      try {
        await pool.query(`UPDATE notifications SET read=FALSE WHERE id IN ('good1','good2')`);
        let revision=await getRevision();
        await revoker.query('BEGIN');await marker.query('BEGIN');
        const rp=(await revoker.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        const mp=(await marker.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        await changeBoardGrant(revoker,'b','owner','member',false,revision);
        const pendingMark=markAllDraftNotificationsRead(marker,'member');
        await waitBlocked(mp,rp);await revoker.query('COMMIT');
        assert.equal(await pendingMark,0);await marker.query('COMMIT');
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE id IN ('good1','good2') AND NOT read`)).rows[0].n,2);
        revision=await getRevision(); await tx(c=>changeBoardGrant(c,'b','owner','member',true,revision));
        revision=await getRevision();await revoker.query('BEGIN');await marker.query('BEGIN');
        assert.equal(await markAllDraftNotificationsRead(marker,'member'),2);
        const pendingRevoke=changeBoardGrant(revoker,'b','owner','member',false,revision);
        await waitBlocked(rp,mp);await marker.query('COMMIT');
        assert.equal(await pendingRevoke,true);await revoker.query('COMMIT');
        assert.equal(await tx(c=>markAllDraftNotificationsRead(c,'member')),0);
        revision=await getRevision();await tx(c=>changeBoardGrant(c,'b','owner','member',true,revision));
      } finally {await revoker.query('ROLLBACK').catch(()=>{});await marker.query('ROLLBACK').catch(()=>{});revoker.release();marker.release();}
    });
    await t.test('revocation blocks later reads, marking and notification delivery', async()=>{
      await pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,created_at,updated_at) VALUES ('comment','w','p','card','owner','Hello',now(),now())`);
      await pool.query(`INSERT INTO comment_mentions(id,comment_id,user_id,start_offset,end_offset,created_at) VALUES ('mention','comment','member',0,1,now())`);
      assert.equal(await tx(c=>insertDraftMention(c,{id:'new',cardId:'card',commentId:'comment',userId:'member',authorId:'owner'})),true);
      await pool.query(`DELETE FROM board_grants WHERE board_id='b' AND user_id='member'`);
      assert.deepEqual(await listDraftNotifications(pool,'member',100),[]);
      assert.equal(await tx(c=>markDraftNotificationRead(c,'member','new')),false);
      assert.equal(await tx(c=>insertDraftMention(c,{id:'denied',cardId:'card',commentId:'comment',userId:'member',authorId:'owner'})),false);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE id='denied'`)).rows[0].n,0);
    });
    await t.test('processOutboxLease enforces board grants when delivering mention notifications', async () => {
      const initialMemberCount = Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 'member' AND card_id = 'card'`)).rows[0].n);
      const initialOwnerCount = Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 'owner' AND card_id = 'card'`)).rows[0].n);

      // 1. Queue outbox comment.created mentioning 'member' (who currently has no grant on 'b') and 'owner'
      const payloadWithoutGrant = JSON.stringify({
        cardId: 'card',
        commentId: 'comment',
        authorId: 'outside',
        actorDisplayName: 'Outside',
        commentBody: 'Hello @member and @owner',
        mentions: ['member', 'owner'],
      });
      await pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
         VALUES ('ob_1', 'w', 'p', 'comment.created', $1::jsonb, 'pending', 0, NOW(), NOW())`,
        [payloadWithoutGrant],
      );

      // Process outbox: member lacks board grant, so notification for member must NOT be created.
      // Owner is workspace owner, so implicit grant creates notification for owner.
      await processOutboxLease(pool, { batchSize: 10 });

      const afterOb1MemberCount = Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 'member' AND card_id = 'card'`)).rows[0].n);
      assert.equal(afterOb1MemberCount, initialMemberCount);

      const afterOb1OwnerCount = Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 'owner' AND card_id = 'card'`)).rows[0].n);
      assert.equal(afterOb1OwnerCount, initialOwnerCount + 1);

      // 2. Now grant member access to board 'b'
      await pool.query(`INSERT INTO board_grants(board_id, project_id, workspace_id, user_id, granted_by) VALUES ('b', 'p', 'w', 'member', 'owner')`);

      // Create card2 and comment2 on board 'b'
      await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES ('card2','w','p','b','col','Card Two','low',200,'active',now(),now())`);
      await pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,created_at,updated_at) VALUES ('comment2','w','p','card2','outside','Hello card2',now(),now())`);

      // Queue another outbox job mentioning member on card2
      const payloadWithGrant = JSON.stringify({
        cardId: 'card2',
        commentId: 'comment2',
        authorId: 'outside',
        actorDisplayName: 'Outside',
        commentBody: 'Hello again @member',
        mentions: ['member'],
      });
      await pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
         VALUES ('ob_2', 'w', 'p', 'comment.created', $1::jsonb, 'pending', 0, NOW(), NOW())`,
        [payloadWithGrant],
      );

      await processOutboxLease(pool, { batchSize: 10 });

      const notifMemberCard2 = await pool.query(`SELECT * FROM notifications WHERE user_id = 'member' AND card_id = 'card2'`);
      assert.equal(notifMemberCard2.rows.length, 1);
    });
  } finally {await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
