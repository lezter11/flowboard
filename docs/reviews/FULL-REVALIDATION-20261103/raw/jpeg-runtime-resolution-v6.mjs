import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { validateJpegEntropy } from '../../../../apps/api/src/services/jpeg-entropy.ts';
import { SharpImageVerifier } from '../../../../apps/api/src/services/image-verifier-node.ts';
import { MemoryStorageDriver } from '../../../../apps/api/src/adapters/storage.ts';
import { importTestDatabaseUrl } from '../../../../apps/api/test/support/import-database.ts';
const cleanups=[];const f=await lifecycleFixture({after:fn=>cleanups.push(fn)});
const dir=await fs.mkdtemp('/private/tmp/flowboard-image-complexity-');
const url=new URL(importTestDatabaseUrl());url.searchParams.set('options',`-c search_path=${f.schema}`);
const configPath=path.join(dir,'wrangler.json');
await fs.writeFile(configPath,JSON.stringify({name:'flowboard-complexity-test',main:fileURLToPath(new URL('../../../../apps/api/src/runtime/worker.ts',import.meta.url)),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],ratelimits:[{name:'FB_RL_WRITES',namespace_id:'9912',simple:{limit:1000,period:60}}],images:{binding:'IMAGE_VERIFIER'},r2_buckets:[{binding:'IMAGES',bucket_name:'synthetic-complexity-images'}],vars:{DATABASE_URL:url.toString()}}));
const harness=createTestHarness({workers:[{configPath}]});
const results=[];
try{
 await harness.listen();const worker=harness.getWorker('flowboard-complexity-test');
 const app=createApp(async()=>{},{pool:f.pool,storage:new MemoryStorageDriver(),imageVerifier:new SharpImageVerifier(),rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
 const width=5000,height=4000,raw=Buffer.alloc(width*height*3);let state=19790621;
 for(let p=0;p<raw.length;p+=3){state^=state<<13;state^=state>>>17;state^=state<<5;raw[p]=state&255;raw[p+1]=(state>>>8)&255;raw[p+2]=(state>>>16)&255;}
 for(const kind of['rgb444baseline','rgb444progressive']){
  let bytes,quality;
  for(const q of[90,85,80,75,70,65,60,55,50,45,40,35,30,25,20,15,10,5]){let source=sharp(raw,{raw:{width,height,channels:3}});if(kind==='cmyk444')source=source.toColourspace('cmyk');bytes=await source.jpeg({progressive:kind.endsWith('progressive'),chromaSubsampling:'4:4:4',quality:q}).toBuffer();if(bytes.length<=10*1024*1024){quality=q;break;}}
  // Independent complete native decode/reencode establishes the generated file is valid.
  let encoded=0;const oracleStarted=performance.now();for await(const chunk of sharp(bytes,{failOn:'warning',limitInputPixels:20_000_000}).jpeg({quality:1}))encoded+=chunk.length;
  const oracle={complete:true,disposableJpegBytes:encoded,elapsedMs:Math.round(performance.now()-oracleStarted)};
  let checker; const checkerStart=performance.now(); try{checker={complete:true,metrics:await validateJpegEntropy(bytes)}}catch(error){checker={complete:false,error:error.message,elapsedMs:Math.round(performance.now()-checkerStart)}} console.log(JSON.stringify({kind,oracle,checker}));
  for(const runtime of['mounted-node','actual-workerd']){
   const headers={cookie:`flowboard_session=${f.actors.owner.session.id}`,origin:'http://localhost','content-type':'application/json','cf-connecting-ip':'192.0.2.222'};
   const fetch=runtime==='mounted-node'?(url,init)=>app.request(url,init):(url,init)=>worker.fetch(url,init);
   const stage=await fetch('http://localhost/api/v1/cards/card/image-uploads',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({filename:`${kind}.jpg`,byteLength:bytes.length,contentType:'image/jpeg',sha256:crypto.createHash('sha256').update(bytes).digest('hex')})});
   if(stage.status!==201)throw new Error('stage '+stage.status+' '+await stage.text());const id=(await stage.json()).data.id;
   const started=performance.now();const put=await fetch('http://localhost/api/v1/image-uploads/'+id+'/content',{method:'PUT',headers,body:new Uint8Array(bytes).buffer});
   const record={kind,runtime,width,height,quality,inputBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),oracle,checker,expectedStatus:200,status:put.status,elapsedMs:Math.round(performance.now()-started),response:await put.json()};
   if(put.status===200){
    const finalStarted=performance.now();const finalized=await fetch('http://localhost/api/v1/image-uploads/'+id+'/finalize',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()}});record.finalizeStatus=finalized.status;record.finalizeElapsedMs=Math.round(performance.now()-finalStarted);record.finalizeResponse=await finalized.json();
    if(finalized.status===200){const image=record.finalizeResponse.data;const read=await fetch('http://localhost/api/v1/images/'+image.id+'/content',{headers});record.readStatus=read.status;record.storedSha256=crypto.createHash('sha256').update(new Uint8Array(await read.arrayBuffer())).digest('hex');const removed=await fetch('http://localhost/api/v1/images/'+image.id,{method:'DELETE',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:image.version})});record.removeStatus=removed.status;}
   }
   results.push(record);console.log(JSON.stringify(record));await fs.writeFile(new URL('./jpeg-runtime-resolution-v6.partial.json',import.meta.url),JSON.stringify({results},null,2)+'\n');
   await fetch('http://localhost/api/v1/image-uploads/'+id,{method:'DELETE',headers});
  }
 }
 const saved=Number((await f.pool.query('SELECT COUNT(*) FROM card_images')).rows[0].count);
 await fs.writeFile(new URL('./jpeg-runtime-resolution-v6.json',import.meta.url),JSON.stringify({purpose:'V6 unchanged-source RGB baseline-vs-progressive bounded3schecker/8sverification valid20MP textured JPEG maximum diagnostic; actual mounted Node+workerd, synthetic local only; wall is not hosted CPU proof.',savedImages:saved,results},null,2)+'\n');
}finally{await harness.close();await fs.rm(dir,{recursive:true,force:true});for(const cleanup of cleanups.reverse())await cleanup();}
