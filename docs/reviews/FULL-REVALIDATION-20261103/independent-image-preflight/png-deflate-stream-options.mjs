import fs from 'node:fs/promises';
import path from 'node:path';
import {createTestHarness} from 'wrangler';
import zlib from 'node:zlib';
import { imageFixture } from '../../../../apps/api/test/support/image-fixtures.ts';
import { validateImageBinary } from '../../../../apps/api/src/services/image-validator.ts';
import { SharpImageVerifier } from '../../../../apps/api/src/services/image-verifier-node.ts';
const source=imageFixture('png').bytes;
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function chunk(type,data){const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b}
let p=8;const rows=[];while(p<source.length){const n=source.readUInt32BE(p),type=source.toString('latin1',p+4,p+8);rows.push({type,data:source.subarray(p+8,p+8+n),whole:source.subarray(p,p+12+n)});p+=12+n}
const idat=Buffer.concat(rows.filter(x=>x.type==='IDAT').map(x=>x.data)),raw=zlib.inflateSync(idat);
const wrongAdler=Buffer.from(idat);wrongAdler[wrongAdler.length-1]^=1;
const cases=[['original',idat],['extra-deflated-pixels',zlib.deflateSync(Buffer.concat([raw,Buffer.from([0,1,2,3])]))],['truncated-deflated-pixels',zlib.deflateSync(raw.subarray(0,-1))],['trailing-compressed-junk',Buffer.concat([idat,Buffer.from([0,1,2,3])])],['concatenated-zlib-stream',Buffer.concat([idat,zlib.deflateSync(raw)])],['bad-adler',wrongAdler]];
const dir=await fs.mkdtemp('/private/tmp/independent-deflate-stream-');const main=path.join(dir,'worker.mjs');await fs.writeFile(main,`export default { async fetch(request){let count=0;try {const stream=request.body.pipeThrough(new DecompressionStream('deflate'));for await(const chunk of stream){count+=chunk.byteLength;if(count>1000)throw new Error('bound')}return Response.json({ok:true,count})}catch(e){return Response.json({ok:false,count,message:e.message},{status:422})}}};`);const configPath=path.join(dir,'wrangler.json');await fs.writeFile(configPath,JSON.stringify({name:'independent-deflate-stream',main,compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat']}));const harness=createTestHarness({workers:[{configPath}]});const results=[];try{await harness.listen();const worker=harness.getWorker('independent-deflate-stream');for(const [name,data]of cases){const response=await worker.fetch('http://localhost/deflate',{method:'POST',body:new Uint8Array(data).buffer});results.push({name,status:response.status,body:await response.json()})}}finally{await harness.close();await fs.rm(dir,{recursive:true,force:true})}console.log(JSON.stringify({expectedInflatedBytes:raw.length,results},null,2));
