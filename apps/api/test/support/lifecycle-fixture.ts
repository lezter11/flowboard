import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../../src/http/app.ts';
import { runMigrations } from '../../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../src/adapters/session.ts';
import { importTestDatabaseUrl } from './import-database.ts';
const connectionString=importTestDatabaseUrl();
export async function lifecycleFixture(t: TestContext, legacy: boolean | number = false) {
  const schema = 'lifecycle_retention_' + crypto.randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({
    connectionString,
    max: 1
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString,
    max: 12,
    application_name: schema,
    options: `-c search_path=${schema}`,
    statement_timeout: 5000
  });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  if (legacy) {
    const fs = await import('node:fs/promises');
    const dir = await fs.mkdtemp('/private/tmp/flowboard-comment-migrations-');
    t.after(() => fs.rm(dir, {
      recursive: true,
      force: true
    }));
    const source = new URL('../../../../database/migrations/', import.meta.url);
    for (const file of await fs.readdir(source)) if (/^\d{4}_.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= (typeof legacy === 'number' ? legacy : 22)) await fs.copyFile(new URL(file, source), `${dir}/${file}`);
    await runMigrations(pool, {
      migrationsDir: dir
    });
  } else await runMigrations(pool);
  const actors: Record<string, Awaited<ReturnType<typeof createDevUserAndSession>>> = {};
  for (const name of ['owner', 'manager', 'member', 'viewer', 'outsider']) actors[name] = await createDevUserAndSession(`retention-${name}@flowboard.example`, `Retention ${name}`, pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','Retention','UTC',$1,NOW(),NOW())`, [actors.owner!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','Retention',NOW(),NOW())`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','Retention',NOW(),NOW())`);
  for (const [id, name, pos] of [['col', 'Old column', 0], ['col2', 'Current column', 1]] as const) await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES($1,'ws','prj','brd',$2,'#64748b','todo',$3,NOW(),NOW())`, [id, name, pos]);
  for (const name of ['manager', 'member', 'viewer']) {
    await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES($1,'prj','ws',$2,$3,'active',NOW(),NOW())`, ['pm_' + name, actors[name]!.user.id, name]);
    await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES('brd','prj','ws',$1,$2)`, [actors[name]!.user.id, actors.owner!.user.id]);
  }
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('card','ws','prj','brd','col2','Discussion','medium',1000,'active',NOW(),NOW())`);
  const app = createApp(async () => {}, {
    pool,
    rateLimiter: () => ({
      limit: async () => ({
        success: true
      })
    }),
    windowCounter: () => ({
      consume: async () => ({
        count: 1,
        retryAfterSeconds: 60
      })
    })
  });
  const request = (method: string, path: string, actor = 'owner', body?: object, key: string = crypto.randomUUID()) => app.request('http://localhost/api/v1' + path, {
    method,
    headers: {
      cookie: `flowboard_session=${actors[actor]!.session.id}`,
      origin: 'http://localhost',
      'content-type': 'application/json',
      'idempotency-key': key
    },
    ...(body ? {
      body: JSON.stringify(body)
    } : {})
  });
  const version = async () => Number((await pool.query("SELECT structure_version FROM boards WHERE id='brd'")).rows[0].structure_version);
  const removeColumn = async () => request('DELETE', `/boards/brd/columns/col?expectedBoardVersion=${await version()}`);
  const post = async (secret = 'Private deleted comment') => {
    const token = '@' + actors.manager!.user.displayName;
    const body = secret + ' ' + token;
    const r = await request('POST', '/cards/card/comments', 'member', {
      body,
      mentions: [{
        userId: actors.manager!.user.id,
        start: body.lastIndexOf(token),
        end: body.length
      }]
    });
    assert.equal(r.status, 201, await r.clone().text());
    return ((await r.json()) as any).data;
  };
  return {
    schema,
    pool,
    app,
    actors,
    request,
    version,
    removeColumn,
    post
  };
}
