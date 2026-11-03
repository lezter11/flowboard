import { importTestDatabaseUrl } from './support/import-database.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { workbook } from './support/import-workbook.ts';
import { rewriteWorkbook } from './support/import-xml-fixture.ts';
import { createTestHarness } from 'wrangler';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';

// Regression: host filesystem paths do not package the workbook into actual workerd.
const connectionString = importTestDatabaseUrl();
test('import repair: real workerd serves exact supplied blank XLSX without a host filesystem dependency', {
  timeout: 60000
}, async t => {
  const schema = 'import_worker_' + crypto.randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({
    connectionString,
    max: 1
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    options: `-c search_path=${schema}`
  });
  const dir = await fs.mkdtemp('/private/tmp/flowboard-import-worker-');
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await fs.rm(dir, {
      recursive: true,
      force: true
    });
  });
  await runMigrations(pool);
  const actor = await createDevUserAndSession('worker-import@flowboard.example', 'Synthetic Import Worker', pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws','Worker imports','UTC',$1,NOW(),NOW())`, [actor.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('prj','ws','Worker imports',NOW(),NOW())`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES('brd','ws','prj','Worker imports',NOW(),NOW())`);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES('col','ws','prj','brd','Todo','#64748b','todo',0,NOW(),NOW())`);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const configPath = path.join(dir, 'wrangler.json');
  await fs.writeFile(configPath, JSON.stringify({
    name: 'flowboard-import-template-test',
    main: fileURLToPath(new URL('../src/runtime/worker.ts', import.meta.url)),
    compatibility_date: '2026-10-19',
    compatibility_flags: ['nodejs_compat'],
    ratelimits: [{
      name: 'FB_RL_WRITES',
      namespace_id: '9911',
      simple: {
        limit: 1000,
        period: 60
      }
    }],
    vars: {
      DATABASE_URL: url.toString()
    }
  }));
  const harness = createTestHarness({
    workers: [{
      configPath
    }]
  });
  try {
    await harness.listen();
    const worker = harness.getWorker('flowboard-import-template-test');
    const response = await worker.fetch('http://localhost/api/v1/import/template', {
      headers: {
        cookie: `flowboard_session=${actor.session.id}`
      }
    });
    assert.equal(response.status, 200, await response.clone().text());
    const supplied = await fs.readFile(new URL('../../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx', import.meta.url));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), supplied);
    const headers = {
      cookie: `flowboard_session=${actor.session.id}`,
      origin: 'http://localhost',
      'content-type': 'application/octet-stream',
      'cf-connecting-ip': '127.0.0.1'
    };
    const blank = await worker.fetch('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col', {
      method: 'POST',
      headers,
      body: new Uint8Array(supplied).buffer
    });
    assert.equal(blank.status, 201, await blank.clone().text());
    assert.equal(((await blank.json()) as any).data.counts.total, 0);
    const bytes = workbook(Array.from({
      length: 200
    }, (_, i) => ({
      externalId: `worker-${i}`,
      title: `Worker row ${i}`,
      description: 'Literal worker description',
      priority: 'medium',
      dueDate: 45000
    })), {
      dateStyle: true
    });
    const started = performance.now();
    const full = await worker.fetch('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col', {
      method: 'POST',
      headers,
      body: new Uint8Array(bytes).buffer
    });
    assert.equal(full.status, 201, await full.clone().text());
    const preview = ((await full.json()) as any).data;
    assert.equal(preview.counts.new, 200);
    assert.equal(preview.rows[0].description, 'Literal worker description');
    assert.equal(preview.rows[0].dueDate, '2023-03-15');
    const commit = await worker.fetch(`http://localhost/api/v1/imports/${preview.id}/commit`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID()
      },
      body: JSON.stringify({
        expectedVersion: preview.version,
        previewDigest: preview.previewDigest,
        defaultColumnId: 'col'
      })
    });
    assert.equal(commit.status, 200, await commit.clone().text());
    assert.equal(((await commit.json()) as any).data.counts.created, 200);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM cards')).rows[0].n), 200);
    t.diagnostic(`actual local workerd200-row preview+atomic commit elapsed_ms=${(performance.now() - started).toFixed(2)}; local synthetic fixture, not a hosted CPU/load benchmark`);
    // Exercise untrusted XML inside actual workerd, then prove the same isolate
    // remains usable. No Worker memory/CPU quota is inferred from wall-clock time.
    let resourceCase = 10;
    for (const [name, xml] of [
      ['20MB-node-forest', '<n/>'.repeat(5_000_000)],
      ['19MB-text', 'x'.repeat(19 * 1024 * 1024)],
      ['depth10000', '<n>'.repeat(10_000) + 'x' + '</n>'.repeat(10_000)],
    ]) {
      const malicious = rewriteWorkbook(workbook([]), parts => {
        parts['xl/worksheets/sheet1.xml'] = Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${xml}</worksheet>`);
      });
      const before = performance.now();
      const rejected = await worker.fetch('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col', { method: 'POST', headers: { ...headers, 'cf-connecting-ip': `127.0.0.${resourceCase++}` }, body: new Uint8Array(malicious).buffer });
      assert.equal(rejected.status, 422, name + ': ' + await rejected.clone().text());
      t.diagnostic(`actual local workerd resource rejection ${name} compressed_bytes=${malicious.length} elapsed_ms=${(performance.now()-before).toFixed(2)}`);
    }
    const rich = workbook([{ externalId:'0001-worker-literal', title:'Literal &#65;', description:'  Keep &amp;#x41;  ' }], { inlineStrings:true });
    const literalPreview=await worker.fetch('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col',{method:'POST',headers:{...headers,'cf-connecting-ip':'127.0.0.25'},body:new Uint8Array(rich).buffer});
    assert.equal(literalPreview.status,201,await literalPreview.clone().text());
    const literalData=(await literalPreview.json() as any).data;
    assert.equal(literalData.rows[0].externalId,'0001-worker-literal');assert.equal(literalData.rows[0].title,'Literal &#65;');assert.equal(literalData.rows[0].description,'  Keep &amp;#x41;  ');
    // Near20MiB expanded XML:200maximum-length legal descriptions made of
    // escaped ampersands stress string processing while staying inside all caps.
    const maxTextBytes=workbook(Array.from({length:200},(_,i)=>({externalId:`max-text-${i}`,title:'Maximum description',description:'&'.repeat(20_000)})),{inlineStrings:true});
    const maxStarted=performance.now();
    const maxPreview=await worker.fetch('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col',{method:'POST',headers:{...headers,'cf-connecting-ip':'127.0.0.26'},body:new Uint8Array(maxTextBytes).buffer});
    assert.equal(maxPreview.status,201,await maxPreview.clone().text());
    const maxData=(await maxPreview.json() as any).data;assert.equal(maxData.counts.new,200);assert.equal(maxData.counts.invalid,0);assert.equal(maxData.rows[0].description.length,20_000);
    t.diagnostic(`actual local workerd200x20k escaped-description preview compressed_bytes=${maxTextBytes.length} elapsed_ms=${(performance.now()-maxStarted).toFixed(2)}; no hosted memory/CPU measurement`);
    const page=await worker.fetch('http://localhost/api/v1/boards/brd/cards?columnId=col&limit=100',{headers:{cookie:headers.cookie}});
    assert.equal(page.status,200);const firstPage=(await page.json()as any);assert.equal(firstPage.data.length,100);assert.ok(firstPage.nextCursor);assert.equal(typeof firstPage.data[0].key,'string');assert.equal(typeof firstPage.data[0].descriptionExcerpt,'string');
    const nextPage=await worker.fetch('http://localhost/api/v1/boards/brd/cards?columnId=col&limit=100&cursor='+encodeURIComponent(firstPage.nextCursor),{headers:{cookie:headers.cookie}});
    assert.equal(nextPage.status,200);assert.equal((await nextPage.json()as any).data.length,100);
    const boardState=async()=>((await pool.query("SELECT structure_version,snapshot_version FROM boards WHERE id='brd'")).rows[0]);
    const jsonHeaders={...headers,'content-type':'application/json','idempotency-key':crypto.randomUUID()};
    const column=await worker.fetch('http://localhost/api/v1/boards/brd/columns',{method:'POST',headers:jsonHeaders,body:JSON.stringify({name:'Historical worker column',color:'#64748b',category:'todo',expectedBoardVersion:(await boardState()).structure_version})});
    assert.equal(column.status,201,await column.clone().text());const columnId=(await column.json()as any).data.id;
    await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('worker_history','ws','prj','brd',$1,'Historical worker source','none',1000,'purged',NOW(),NOW())`,[columnId]);
    const retired=await worker.fetch('http://localhost/api/v1/boards/brd/columns/'+columnId+'?expectedBoardVersion='+(await boardState()).structure_version,{method:'DELETE',headers:{...jsonHeaders,'idempotency-key':crypto.randomUUID()}});
    assert.equal(retired.status,200,await retired.clone().text());assert.ok((await pool.query('SELECT deleted_at FROM columns WHERE id=$1',[columnId])).rows[0].deleted_at);
    const metadata=await worker.fetch('http://localhost/api/v1/boards/brd/metadata',{headers:{cookie:headers.cookie}});assert.equal(JSON.stringify(await metadata.json()).includes('Historical worker column'),false);
    const archived=await worker.fetch('http://localhost/api/v1/boards/brd/archive',{method:'POST',headers:{...jsonHeaders,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:(await boardState()).snapshot_version})});assert.equal(archived.status,200,await archived.clone().text());
    const discovery=await worker.fetch('http://localhost/api/v1/projects/prj/boards?includeArchived=true',{headers:{cookie:headers.cookie}});assert.equal(discovery.status,200);assert.equal((await discovery.json()as any).data[0].isArchived,true);
    const reopened=await worker.fetch('http://localhost/api/v1/boards/brd/reopen',{method:'POST',headers:{...jsonHeaders,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:(await boardState()).snapshot_version})});assert.equal(reopened.status,200,await reopened.clone().text());

  } finally {
    await harness.close();
  }
});
