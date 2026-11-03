import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createTestHarness} from 'wrangler';
import {lifecycleFixture} from './support/lifecycle-fixture.ts';
import {importTestDatabaseUrl} from './support/import-database.ts';
import {imageFixture} from './support/image-fixtures.ts';

test('Image admission: actual workerd retains its isolate slot after a504 until the underlying verifier settles', {timeout:30000},async t=>{
  const f=await lifecycleFixture(t);
  const dir=await fs.mkdtemp('/private/tmp/flowboard-image-admission-');
  const uri=new URL(importTestDatabaseUrl());uri.searchParams.set('options',`-c search_path=${f.schema}`);
  const configPath=path.join(dir,'wrangler.json');
  await fs.writeFile(configPath,JSON.stringify({name:'image-admission-worker-test',main:fileURLToPath(new URL('./image-admission-worker-probe.ts',import.meta.url)),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],vars:{DATABASE_URL:uri.toString()}}));
  const harness=createTestHarness({workers:[{configPath}]});
  try{
    await harness.listen();const worker=harness.getWorker('image-admission-worker-test');
    const headers={cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json'};
    const row=imageFixture('png');
    const stage=await worker.fetch('http://localhost/api/v1/cards/card/image-uploads',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({filename:'workerd.png',contentType:row.contentType,byteLength:row.bytes.length,sha256:crypto.createHash('sha256').update(row.bytes).digest('hex')})});
    assert.equal(stage.status,201,await stage.clone().text());const id=(await stage.json()as any).data.id;
    const put=()=>worker.fetch(`http://localhost/api/v1/image-uploads/${id}/content`,{method:'PUT',headers,body:new Uint8Array(row.bytes).buffer});
    const first=put();
    let entered=false;
    for(let i=0;i<100;i++){
      const state=await(await worker.fetch('http://localhost/__image_test/state')).json()as {pending:number};
      if(state.pending===1){entered=true;break;}
      await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(entered,true,'Real provider promise entered inside workerd');
    assert.equal((await first).status,504);
    const blocked=await put();assert.equal(blocked.status,503);assert.equal(blocked.headers.get('retry-after'),'1');
    const finalize=await worker.fetch(`http://localhost/api/v1/image-uploads/${id}/finalize`,{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()}});assert.equal(finalize.status,503);
    assert.deepEqual(await(await worker.fetch('http://localhost/__image_test/state')).json(),{pending:1,calls:1});
    assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[id])).rows[0].state,'awaiting_content');
    await worker.fetch('http://localhost/__image_test/release');
    await new Promise(r=>setTimeout(r,30));
    assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[id])).rows[0].state,'awaiting_content','Late verifier did not save after its response timeout');
    const retry=await put();assert.equal(retry.status,200,await retry.clone().text());
    assert.equal((await f.pool.query('SELECT count(*) FROM card_images')).rows[0].count,'0');
  }finally{
    try{await harness.getWorker('image-admission-worker-test').fetch('http://localhost/__image_test/release');}catch{}
    await harness.close();await fs.rm(dir,{recursive:true,force:true});
  }
});
