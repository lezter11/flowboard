import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';
import { boardGrantsDraftRoutes } from '../src/http/routes/board-grants-draft.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
// Synthetic test-only cursor key. Runtime must provide a private random key.
process.env['CURSOR_SECRET'] ??= 'flowboard_test_cursor_key_do_not_use_in_production_2026';
test('draft board grant routes on isolated PostgreSQL', {skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.'}, async t => {
  const url = new URL(testUrl!);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') throw new Error('Use only the disposable local board-access database.');
  const schema = `grant_route_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({connectionString:testUrl, max:2});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({connectionString:testUrl, max:4, options:`-c search_path=${schema}`});
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner@test.invalid','Owner',pool);
    const manager = await createDevUserAndSession('manager@test.invalid','Manager',pool);
    const member = await createDevUserAndSession('member@test.invalid','Member',pool);
    const stranger = await createDevUserAndSession('stranger@test.invalid','Stranger',pool);
    await pool.query("INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Workspace','UTC',$1,now(),now())", [owner.user.id]);
    await pool.query("INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Project',now(),now()),('p2','w','Other',now(),now())");
    await pool.query("INSERT INTO boards (id,project_id,workspace_id,name,created_at,updated_at) VALUES ('b','p','w','Board',now(),now()),('b2','p2','w','Other',now(),now())");
    await pool.query("INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('pm','p','w',$1,'manager','active',now(),now()),('pmm','p','w',$2,'member','active',now(),now())", [manager.user.id,member.user.id]);
    const app = createApp(async () => {}, {pool});
    const request = (method:string, path:string, session?:string, revision?:unknown) => app.request(`http://localhost/api/v1${path}`, {method, headers:{...(session ? {cookie:`flowboard_session=${session}`} : {}),...(revision !== undefined ? {'content-type':'application/json'} : {})},...(revision !== undefined ? {body:JSON.stringify({expectedAccessRevision:revision})} : {})});
    const currentRevision = async () => String((await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision);
    const write = async (method:string, target:string, session:string) => request(method,target,session,await currentRevision());
    const path = `/boards/b/grants/${member.user.id}`;
    await t.test('authentication, owner scope, and non-enumerating denial', async () => {
      assert.equal((await request('GET','/boards/b/access')).status,401);
      for (const session of [manager.session.id, stranger.session.id]) {
        assert.equal((await request('GET','/boards/b/access',session)).status,404);
        assert.equal((await write('PUT',path,session)).status,404);
      }
      assert.equal((await write('PUT',`/boards/b/grants/${stranger.user.id}`,owner.session.id)).status,404);
      assert.equal((await write('PUT',`/boards/b2/grants/${member.user.id}`,owner.session.id)).status,404);
      assert.equal((await request('GET','/boards/absent/access',owner.session.id)).status,404);
    });
    await t.test('owner grant and revoke use explicit revisions and audit only changes', async () => {
      const first=await write('PUT',path,owner.session.id);
      assert.equal(first.status,200); assert.equal((await first.json()).data.changed,true);
      const again=await write('PUT',path,owner.session.id);
      assert.equal((await again.json()).data.changed,false);
      const list=await request('GET','/boards/b/access',owner.session.id);
      assert.equal(list.headers.get('cache-control'),'no-store');
      const listing=(await list.json()).data;
      assert.deepEqual(listing.grants,[{userId:member.user.id}]);
      assert.equal(listing.accessRevision,await currentRevision());
      assert.equal((await (await write('DELETE',path,owner.session.id)).json()).data.changed,true);
      assert.equal((await (await write('DELETE',path,owner.session.id)).json()).data.changed,false);
      assert.equal((await pool.query("SELECT count(*)::int n FROM activity_log WHERE action IN ('board_access_granted','board_access_revoked')")).rows[0].n,2);
    });
    await t.test('revision validation and stale retries cannot undo revocation', async () => {
      for(const value of [0, 1, '', '0', '-1', '01', '1.0', '9223372036854775808', '99999999999999999999']) {
        const response=await request('PUT',path,owner.session.id,value);
        assert.equal(response.status,400,JSON.stringify(value));
        assert.equal((await response.json()).error.code,'INVALID_ACCESS_REVISION');
      }
      assert.equal((await request('PUT',path,owner.session.id)).status,400);
      const missingType=await app.request(`http://localhost/api/v1${path}`, {method:'PUT',headers:{cookie:`flowboard_session=${owner.session.id}`},body:'{}'});
      assert.equal(missingType.status,400);
      assert.equal((await missingType.json()).error.code,'INVALID_CONTENT_TYPE');
      const malformed=await app.request(`http://localhost/api/v1${path}`, {method:'PUT',headers:{cookie:`flowboard_session=${owner.session.id}`,'content-type':'application/json'},body:'{'});
      assert.equal(malformed.status,400);
      const revision=await currentRevision();
      assert.equal((await request('PUT',path,owner.session.id,revision)).status,200);
      const afterGrant=await currentRevision();
      const staleNoop=await request('PUT',path,owner.session.id,revision);
      assert.equal(staleNoop.status,409);
      assert.equal((await staleNoop.json()).error.code,'STALE_ACCESS_REVISION');
      assert.equal((await request('DELETE',path,owner.session.id,afterGrant)).status,200);
      const staleRetry=await request('PUT',path,owner.session.id,revision);
      assert.equal(staleRetry.status,409);
      assert.equal((await staleRetry.json()).error.code,'STALE_ACCESS_REVISION');
      assert.equal((await pool.query('SELECT count(*)::int n FROM board_grants')).rows[0].n,0);
      assert.equal((await request('GET','/boards/b/access?after=cursor',owner.session.id)).status,400);
    });
    await t.test('archived project or board rolls back a grant and audit', async () => {
      for (const [table,id] of [['projects','p'],['boards','b']] as const) {
        await pool.query(`UPDATE ${table} SET archived=true WHERE id=$1`,[id]);
        assert.equal((await write('PUT',path,owner.session.id)).status,409);
        assert.equal((await pool.query('SELECT count(*)::int n FROM board_grants')).rows[0].n,0);
        assert.equal((await pool.query("SELECT count(*)::int n FROM activity_log WHERE action='board_access_granted'")).rows[0].n,2);
        await pool.query(`UPDATE ${table} SET archived=false WHERE id=$1`,[id]);
      }
    });
    await t.test('audit insertion failure rolls back grant and revision', async () => {
      const before=(await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision;
      await pool.query("CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'board_access_granted' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$");
      await pool.query('CREATE TRIGGER reject_test_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit()');
      assert.equal((await write('PUT',path,owner.session.id)).status,500);
      assert.equal((await pool.query('SELECT count(*)::int n FROM board_grants')).rows[0].n,0);
      assert.equal((await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision,before);
    });
    await t.test('paged access cursors bind board, actor and revision', async () => {
      // Synthetic users and grants only, confined to this disposable schema.
      await pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at)
        SELECT 'bulk_'||lpad(i::text,3,'0'), 'bulk_'||i||'@test.invalid', 'Bulk', now(), now() FROM generate_series(1,101) i`);
      await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
        SELECT 'bulk_pm_'||i, 'p','w','bulk_'||lpad(i::text,3,'0'),'member','active',now(),now() FROM generate_series(1,101) i`);
      await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
        SELECT 'b','p','w','bulk_'||lpad(i::text,3,'0'),$1 FROM generate_series(1,101) i`, [owner.user.id]);
      await pool.query("UPDATE boards SET access_revision=access_revision+1 WHERE id='b'");
      const first=await (await request('GET','/boards/b/access',owner.session.id)).json();
      assert.equal(first.data.grants.length,100);
      assert.ok(first.data.nextCursor);
      const cursor=encodeURIComponent(first.data.nextCursor);
      const second=await (await request('GET',`/boards/b/access?after=${cursor}`,owner.session.id)).json();
      assert.equal(second.data.grants.length,1);
      assert.equal(second.data.nextCursor,null);
      assert.equal((await request('GET',`/boards/b2/access?after=${cursor}`,owner.session.id)).status,400);
      // Both sessions can administer the same board at different times, but a
      // cursor issued to one Owner must not be accepted for the next Owner.
      await pool.query("UPDATE workspaces SET owner_id=$1 WHERE id='w'",[manager.user.id]);
      assert.equal((await request('GET',`/boards/b/access?after=${cursor}`,manager.session.id)).status,400);
      await pool.query("UPDATE workspaces SET owner_id=$1 WHERE id='w'",[owner.user.id]);
      await pool.query("UPDATE boards SET access_revision=access_revision+1 WHERE id='b'");
      const stale=await request('GET',`/boards/b/access?after=${cursor}`,owner.session.id);
      assert.equal(stale.status,409);
      assert.equal((await stale.json()).error.code,'STALE_ACCESS_REVISION');
    });
  } finally {
    setGlobalPool(null);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
