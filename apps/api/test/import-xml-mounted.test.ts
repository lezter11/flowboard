import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { importTestDatabaseUrl } from './support/import-database.ts';
import { workbook } from './support/import-workbook.ts';
import { rewriteWorkbook } from './support/import-xml-fixture.ts';
import { CELL_TYPES, INVALID_CELL_CHILDREN, cellWorkbook } from './support/import-xml-cell-fixture.ts';

const prior = (name: string) => fs.readFileSync(new URL(`../../../docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/${name}.xlsx`, import.meta.url));
async function setup(t: TestContext) {
  const connectionString = importTestDatabaseUrl();
  const schema = 'import_xml_' + crypto.randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
  await runMigrations(pool);
  const owner = await createDevUserAndSession('xml-owner@flowboard.example', 'Synthetic XML Owner', pool);
  await pool.query("INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','XML','UTC',$1,NOW(),NOW())", [owner.user.id]);
  await pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','XML',NOW(),NOW())");
  await pool.query("INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','XML',NOW(),NOW())");
  await pool.query("INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('col','ws','prj','brd','Current column','#64748b','todo',0,NOW(),NOW())");
  const app = createApp(async () => {}, { pool, rateLimiter: () => ({ limit: async () => ({ success: true }) }), windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }) });
  const headers = (json = false) => ({ cookie: `flowboard_session=${owner.session.id}`, origin: 'http://localhost', 'content-type': json ? 'application/json' : 'application/octet-stream', 'idempotency-key': crypto.randomUUID() });
  const preview = (bytes: Buffer) => app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col', { method: 'POST', headers: headers(), body: new Uint8Array(bytes).buffer });
  const commit = (p: any, key = crypto.randomUUID()) => app.request(`http://localhost/api/v1/imports/${p.id}/commit`, { method: 'POST', headers: { ...headers(true), 'idempotency-key': key }, body: JSON.stringify({ expectedVersion: p.version, previewDigest: p.previewDigest, defaultColumnId: 'col' }) });
  return { pool, preview, commit, app, headers, schema };
}

test('XML mounted: original findings reject422 before any import, receipt, card or activity write', async t => {
  const f = await setup(t);
  for (const name of ['utf16-formula','macro-content-type','external-relationship','actual-image-package','invalid-numeric-entity','merged-data','formula','xxe']) {
    const res = await f.preview(prior(name));
    assert.equal(res.status, 422, `${name}: ${await res.clone().text()}`);
  }
  for (const table of ['cards','card_imports','card_import_rows','card_import_duplicates','activity_log','idempotency_receipts']) {
    assert.equal(Number((await f.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n), 0, table);
  }
});

test('XML mounted: prior legal entity/richtext/UTF16/singlequotes persist exact values', async t => {
  const f = await setup(t);
  const fixtures = [['double-entity', 'Literal &#x41; and &#65;'], ['rich-inline-unique','First Second'], ['utf16-worksheet','=Browser imported literal title'], ['single-quote-attributes','=Browser imported literal title']];
  for (const [name, title] of fixtures) {
    // Unique source identity per original fixture avoids accidental duplicate confounding.
    const bytes = rewriteWorkbook(prior(name!), p => {
      const raw = p['xl/worksheets/sheet1.xml']!;
      const encoding = raw[0] === 0xff ? 'utf16le' : 'utf8';
      p['xl/worksheets/sheet1.xml'] = Buffer.from(raw.toString(encoding).replace(/0001(?:-[^<]*)?/, `0001-${name}`), encoding);
    });
    const res = await f.preview(bytes); assert.equal(res.status,201,await res.clone().text());
    const p = (await res.json() as any).data; assert.equal(p.counts.new,1); assert.equal(p.rows[0].title,title);
    const done = await f.commit(p); assert.equal(done.status,200,await done.clone().text());
    assert.equal((await f.pool.query('SELECT c.title FROM cards c JOIN card_import_duplicates d ON d.card_id=c.id WHERE d.external_id=$1',[`0001-${name}`])).rows[0].title,title);
  }
});

test('XML mounted: literal identity, CDATA and shared/inline representations compete without duplicate effects', async t => {
  const f = await setup(t);
  const row = { externalId: '0001-&#65;', title: 'Literal &#x41; and &', description: '  Δ\n &#65; literal &amp;  ' };
  const a = await f.preview(workbook([row], { inlineStrings: true }));
  const sharedCdata = rewriteWorkbook(workbook([row]), parts => {
    parts['xl/sharedStrings.xml'] = Buffer.from(parts['xl/sharedStrings.xml']!.toString().replace('<t>Literal &amp;#x41; and &amp;</t>', '<t><![CDATA[' + row.title + ']]></t>'));
  });
  const b = await f.preview(sharedCdata);
  assert.equal(a.status,201,await a.clone().text()); assert.equal(b.status,201,await b.clone().text());
  const pa=(await a.json() as any).data, pb=(await b.json() as any).data;
  assert.deepEqual(pa.rows[0].externalId,row.externalId); assert.equal(pa.rows[0].description,row.description);
  // Separate real connections hold the board write lock while both mounted requests enter.
  const lock = await f.pool.connect(); await lock.query('BEGIN');
  await lock.query("SELECT id FROM boards WHERE id='brd' FOR UPDATE");
  const first=f.commit(pa), second=f.commit(pb);
  let waiting=0;
  for(let i=0;i<100;i++) {
    const q=await f.pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%boards%'");
    waiting=Number(q.rows[0].n); if(waiting>=2) break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  await lock.query('COMMIT'); lock.release();
  const responses=await Promise.all([first,second]);
  assert.ok(waiting>=2, 'two distinct mounted requests blocked on the real PostgreSQL board lock');
  for(const response of responses) assert.equal(response.status,200,await response.clone().text());
  const cards=(await f.pool.query('SELECT c.title,c.description,d.external_id FROM cards c JOIN card_import_duplicates d ON d.card_id=c.id')).rows;
  assert.deepEqual(cards,[{ title:row.title,description:row.description,external_id:row.externalId }]);
  assert.equal(Number((await f.pool.query("SELECT count(*) AS n FROM activity_log WHERE action='card_created'")).rows[0].n),1);
  assert.equal(Number((await f.pool.query('SELECT count(*) AS n FROM card_import_duplicates')).rows[0].n),1);
  t.diagnostic(`synthetic PostgreSQL simultaneous waiters=${waiting}; schema=${f.schema}`);
});


test('XML mounted: outer-cell malformed content rejects422 with zero writes, valid cells remain accepted', async t => {
  const f=await setup(t);
  const original=['str-cell-inline-child','foreign-cell-value','mixed-value-inline'];
  for(const name of original) {
    const response=await f.preview(fs.readFileSync(new URL(`../../../docs/reviews/FULL-REVALIDATION-20261103/formal-import-round2/${name}.xlsx`,import.meta.url)));
    assert.equal(response.status,422,name+': '+await response.clone().text());
  }
  for(const utf16 of [false,true]) for(const type of CELL_TYPES) for(const [name,content]of INVALID_CELL_CHILDREN) {
    const response=await f.preview(cellWorkbook(type,content,utf16));
    assert.equal(response.status,422,`${type}/${name}/utf16=${utf16}: ${await response.clone().text()}`);
  }
  for(const table of ['cards','card_imports','card_import_rows','card_import_duplicates','activity_log','idempotency_receipts']) {
    assert.equal(Number((await f.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),0,table);
  }
  const valid=await f.preview(cellWorkbook('str',' <v>Kept<![CDATA[&amp;#65;]]>literal</v> '));
  assert.equal(valid.status,201,await valid.clone().text());
  const p=(await valid.json()as any).data;assert.equal(p.counts.new,1);assert.equal(p.rows[0].description,'Kept&amp;#65;literal');
  assert.equal(Number((await f.pool.query('SELECT count(*) AS n FROM cards')).rows[0].n),0,'valid preview also creates no domain card');
  t.diagnostic(`outer-cell rejection count=${original.length+2*CELL_TYPES.length*INVALID_CELL_CHILDREN.length}; PostgreSQL synthetic schema=${f.schema}`);
});
