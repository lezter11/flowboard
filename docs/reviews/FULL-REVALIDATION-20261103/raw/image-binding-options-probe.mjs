import fs from 'node:fs/promises';
import path from 'node:path';
import {createTestHarness} from 'wrangler';
import sharp from 'sharp';
import {imageFixture,pngChunk,corruptEntropyImages} from '../../../../apps/api/test/support/image-fixtures.ts';
const directory=await fs.mkdtemp('/private/tmp/flowboard-image-binding-assessment-');
const workerSource=`export default {async fetch(request,env){try{const output=await env.IMAGE_VERIFIER.input(request.body).output({format:'image/png',anim:true});const response=output.response();let bytes=0;for await(const chunk of response.body)bytes+=chunk.byteLength;return Response.json({decoded:true,encodedOutputBytes:bytes});}catch(error){return Response.json({decoded:false,errorClass:error.name,code:error.code,message:error.message}, {status:422});}}};`;
await fs.writeFile(path.join(directory,'worker.mjs'),workerSource);
const configPath=path.join(directory,'wrangler.json');await fs.writeFile(configPath,JSON.stringify({name:'flowboard-image-binding-assessment',main:path.join(directory,'worker.mjs'),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],images:{binding:'IMAGE_VERIFIER'}}));
const good=imageFixture('png').bytes;
const bad=Buffer.concat([good.subarray(0,33),pngChunk('IDAT',Buffer.from([0x78,0x9c,0xff,0xff,0xff,0xff,0,0,0,1])),pngChunk('IEND',Buffer.alloc(0))]);
const large=await sharp({create:{width:5000,height:4000,channels:3,background:{r:12,g:140,b:99}}}).jpeg({progressive:true,chromaSubsampling:'4:4:4'}).toBuffer();
const cases=[...corruptEntropyImages().map(row=>({...row,expected:422})),{name:'valid-png',bytes:good,expected:200},{name:'corrupt-deflate-valid-envelope',bytes:bad,expected:422},{name:'valid-progressive-jpeg-20MP-444',bytes:large,expected:200},{name:'valid-animated-webp',bytes:imageFixture('webp-animated').bytes,expected:200}];
const harness=createTestHarness({workers:[{configPath}]});const results=[];
try{await harness.listen();const worker=harness.getWorker('flowboard-image-binding-assessment');for(const row of cases){const started=performance.now();const response=await worker.fetch('http://localhost/probe',{method:'POST',body:new Uint8Array(row.bytes).buffer});results.push({name:row.name,inputBytes:row.bytes.length,expectedStatus:row.expected,status:response.status,output:await response.json(),elapsedMs:Math.round(performance.now()-started)});}}
finally{await harness.close();await fs.rm(directory,{recursive:true,force:true});}
const report={purpose:'Local assessment prototype only; no production source/config/bindings/resources changed. Local Images binding is Miniflare sharp-backed, not hosted backend proof.',results};await fs.writeFile(new URL('./image-binding-options-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(report);if(results.some(row=>row.status!==row.expectedStatus))process.exitCode=1;
