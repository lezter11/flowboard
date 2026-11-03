import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/http/app.ts';
import {MemoryStorageDriver} from '../src/adapters/storage.ts';
import {imageFixture} from './support/image-fixtures.ts';
import {lifecycleFixture} from './support/lifecycle-fixture.ts';
import type {ImageVerifier} from '../src/services/image-verifier.ts';

function deferred(){let resolve!:()=>void;return {promise:new Promise<void>(r=>resolve=r),resolve:()=>resolve()};}
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function wait(p:Promise<unknown>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected bounded test barrier')),1500);})]);}finally{clearTimeout(timer);}}
async function fixture(t:Parameters<typeof lifecycleFixture>[0],verifier:ImageVerifier,deadlineMs=5000){
  const f=await lifecycleFixture(t),storage=new MemoryStorageDriver();
  const makeApp=(deadline=deadlineMs,imageBodyReadDeadlineMs=5000,imageDeadlineMs?:number)=>createApp(async()=>{},{pool:f.pool,storage,imageVerifier:verifier,deadlineMs:deadline,imageBodyReadDeadlineMs,...(imageDeadlineMs===undefined?{}:{imageDeadlineMs}),rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const app=makeApp();const row=imageFixture('png');
  const headers={cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','content-type':'application/json'};
  const stage=await makeApp(5000).request('http://localhost/api/v1/cards/card/image-uploads',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({filename:'admission.png',contentType:row.contentType,byteLength:row.bytes.length,sha256:crypto.createHash('sha256').update(row.bytes).digest('hex')})});
  assert.equal(stage.status,201,await stage.clone().text());const id=(await stage.json()as any).data.id;
  const content=(a=app,body:BodyInit=new Uint8Array(row.bytes).buffer,extra:Record<string,string>={})=>a.request(new Request(`http://localhost/api/v1/image-uploads/${id}/content`,{method:'PUT',headers:{...headers,...extra},body,duplex:'half'}as RequestInit));
  return {...f,app,makeApp,headers,id,row,content};
}

test('Image admission: concurrent apps refuse a second image before its body is pulled; status/cancel/stage stay available',async t=>{
  const entered=deferred(),release=deferred();let calls=0;
  const f=await fixture(t,{verify:async()=>{calls++;entered.resolve();await release.promise;}});
  const first=Promise.resolve(f.content());let second:Promise<Response>|undefined;
  try{
    await wait(entered.promise);
    let pulls=0;const body=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(f.row.bytes));c.close();}},{highWaterMark:0});
    second=Promise.resolve(f.content(f.makeApp(),body));
    const refusal=await wait(second)as Response;assert.equal(refusal.status,503);assert.equal(refusal.headers.get('retry-after'),'1');assert.equal(pulls,0);assert.equal(calls,1);
    const status=await f.app.request(`http://localhost/api/v1/image-uploads/${f.id}`,{headers:f.headers});assert.equal(status.status,200);
    const staged=await f.app.request('http://localhost/api/v1/cards/card/image-uploads',{method:'POST',headers:{...f.headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({filename:'second.png',contentType:f.row.contentType,byteLength:f.row.bytes.length,sha256:crypto.createHash('sha256').update(f.row.bytes).digest('hex')})});assert.equal(staged.status,201);
    const cancelled=await f.app.request(`http://localhost/api/v1/image-uploads/${f.id}`,{method:'DELETE',headers:f.headers});assert.equal(cancelled.status,200);
  }finally{release.resolve();await first;await second;}
  assert.equal(Number((await f.pool.query('SELECT count(*) FROM card_images')).rows[0].count),0);
});

test('Image admission: response timeout retains underlying verifier lease, blocks finalize, then releases after actual settlement',async t=>{
  const entered=deferred(),release=deferred();let calls=0;
  const f=await fixture(t,{verify:async()=>{calls++;entered.resolve();await release.promise;}},300);
  const first=Promise.resolve(f.content());let second:Promise<Response>|undefined;
  try{
    await wait(entered.promise);assert.equal((await first).status,504);
    second=Promise.resolve(f.content(f.makeApp(5000)));
    assert.equal((await wait(second)as Response).status,503);assert.equal(calls,1);
    const finalize=await f.app.request(`http://localhost/api/v1/image-uploads/${f.id}/finalize`,{method:'POST',headers:{...f.headers,'idempotency-key':crypto.randomUUID()}});assert.equal(finalize.status,503);
  }finally{release.resolve();await first;await second;await delay(30);}
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1',[f.id])).rows[0].state,'awaiting_content');
  const retry=await f.content(f.makeApp(5000));assert.equal(retry.status,200,await retry.clone().text());
});

test('Image admission: invalid cookies are refused before body pull and do not reserve the image lease',async t=>{
  let calls=0;const f=await fixture(t,{verify:async()=>{calls++;}});
  let pulls=0;const body=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(f.row.bytes));c.close();}},{highWaterMark:0});
  const denied=await f.content(f.app,body,{cookie:'flowboard_session=not-a-real-session'});assert.equal(denied.status,401);assert.equal(pulls,0);assert.equal(calls,0);
  assert.equal((await f.content()).status,200);assert.equal(calls,1);
});

test('Image admission: actual bytes enforce cap even with a forged small Content-Length',async t=>{
  let calls=0;const f=await fixture(t,{verify:async()=>{calls++;}});
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(10*1024*1024+65537));c.close();}});
  const denied=await f.content(f.app,body,{'content-length':'1'});assert.equal(denied.status,413);assert.equal((await denied.json()as any).error.code,'PAYLOAD_TOO_LARGE');assert.equal(calls,0);
  assert.equal((await f.content()).status,200);
});

test('Image admission: slow body read is bounded, cancelled and releases capacity without accepting content',async t=>{
  let cancelled=0,calls=0;const f=await fixture(t,{verify:async()=>{calls++;}});
  const body=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled++;}},{highWaterMark:0});
  const started=performance.now();const denied=await f.content(f.makeApp(5000,30),body);
  assert.equal(denied.status,503);assert.equal(denied.headers.get('retry-after'),'1');assert.ok(performance.now()-started<1000);assert.equal(cancelled,1);assert.equal(calls,0);
  await delay(10);assert.equal((await f.content()).status,200);
});

test('Image admission: caller response does not release a still-pending stream cancellation',async t=>{
  const release=deferred();let cancelled=0;const f=await fixture(t,{verify:async()=>{}});
  const body=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled++;return release.promise;}},{highWaterMark:0});
  try{
    const denied=await f.content(f.makeApp(5000,30),body);assert.equal(denied.status,503);assert.equal(cancelled,1);
    assert.equal((await f.content(f.makeApp())).status,503);
  }finally{release.resolve();await delay(10);}
  assert.equal((await f.content()).status,200);
});

test('Image admission: separate image deadline preserves ordinary request budget and explicit test overrides',async t=>{
  const f=await fixture(t,{verify:async()=>{await delay(60);}});
  const app=f.makeApp(30,5000,500);
  app.get('/__image_test/ordinary',async c=>{await delay(60);return c.json({data:'late'});});
  assert.equal((await app.request('http://localhost/__image_test/ordinary')).status,504);
  const accepted=await f.content(app);assert.equal(accepted.status,200,await accepted.clone().text());
});
