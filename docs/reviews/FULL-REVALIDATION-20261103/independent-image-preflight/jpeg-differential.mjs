import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { jpegCorpus,jpegSegments } from '../../../../apps/api/test/support/jpeg-corpus.ts';
import { strictJpegOracle } from '../../../../apps/api/test/support/jpeg-oracle.ts';
import { validateImageBinary } from '../../../../apps/api/src/services/image-validator.ts';
import { validateJpegEntropy } from '../../../../apps/api/src/services/jpeg-entropy.ts';
import { SharpImageVerifier } from '../../../../apps/api/src/services/image-verifier-node.ts';
const files=['apps/api/src/services/jpeg-entropy.ts','apps/api/src/services/image-validator.ts','apps/api/src/services/image-verifier-node.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex')])));
const before=await hashes(),counts={total:0,bothAccept:0,bothReject:0,oursOnly:0,oracleOnly:0},disagreements=[];
const names=['baseline-420','baseline-422','baseline-444','progressive-420','progressive-422','progressive-444','progressive-restart','custom-spectral-refinement'];
let rng=0x51c0ffee;const rand=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0};
for(const name of names){const row=jpegCorpus.find(x=>x.name===name);if(!row)continue;const segs=jpegSegments(row.bytes);const scans=segs.filter(x=>x.marker===218);const positions=[];for(const s of scans)for(let p=s.end;p<s.entropyEnd;p++)if(row.bytes[p]!==255&&row.bytes[p-1]!==255)positions.push(p);
 for(let i=0;i<160;i++) {const bytes=Buffer.from(row.bytes);let pos,description;
  if(i<128){pos=positions[rand()%positions.length];const mask=1<<(rand()%8);bytes[pos]^=mask;description=`entropy bit${mask}`;}else{const scan=scans[rand()%scans.length];pos=scan.end-1-(rand()%3);bytes[pos]=rand()%256;description='spectral header';}
  let ours=false,oracle=false,reason;
  try{validateImageBinary(bytes,'image/jpeg');await validateJpegEntropy(bytes);ours=true}catch(e){reason=e.code??e.message}
  try{strictJpegOracle(bytes);oracle=true}catch{}
  counts.total++;counts[ours?(oracle?'bothAccept':'oursOnly'):(oracle?'oracleOnly':'bothReject')]++;
  if(ours&&!oracle){let native;try{const dims=validateImageBinary(bytes,'image/jpeg');await new SharpImageVerifier().verify({bytes,...dims},new AbortController().signal);native=true}catch(e){native=e.code??e.message}disagreements.push({name,index:i,pos,description,ours,oracle,native,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});await fs.writeFile(new URL(`./jpeg-disagreement-${disagreements.length}.bin`,import.meta.url),bytes);}
 }
}
console.log(JSON.stringify({before,after:await hashes(),counts,disagreements,note:'Seeded bounded small-corpus entropy/header mutations; strict oracle is not universal JPEG conformance authority.'},null,2));
