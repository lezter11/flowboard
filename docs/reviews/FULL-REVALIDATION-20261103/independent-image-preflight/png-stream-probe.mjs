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
const results=[];for(const [name,data] of cases){const bytes=Buffer.concat([source.subarray(0,8),...rows.filter(x=>x.type!=='IDAT'&&x.type!=='IEND').map(x=>x.whole),chunk('IDAT',data),chunk('IEND',Buffer.alloc(0))]);let envelope,native;try{const dims=validateImageBinary(bytes,'image/png');envelope='accept';try{await new SharpImageVerifier().verify({bytes,...dims},new AbortController().signal);native='accept'}catch(e){native=e.code??e.message}}catch(e){envelope=e.code??e.message}results.push({name,envelope,native})}console.log(JSON.stringify({rawBytes:raw.length,results},null,2));
