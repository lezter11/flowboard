import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { PerformanceObserver } from 'node:perf_hooks';
import { parseExcelWorkbook as original } from '../../../../apps/api/src/services/excel-parser.ts';
import { parseExcelWorkbook as profiled } from './profile-excel-parser.ts';
import {workbook} from '../../../../apps/api/test/support/import-workbook.ts';
import {unzipFixture} from '../../../../apps/api/test/support/import-xml-fixture.ts';
import {events,reset} from './profile-state.ts';
const bytes=workbook(Array.from({length:200},(_,i)=>({externalId:`max-text-${i}`,title:'Maximum description',description:'&'.repeat(20_000)})),{inlineStrings:true});
console.log(JSON.stringify({kind:'environment',node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,compressedBytes:bytes.length,fixtureSha256:crypto.createHash('sha256').update(bytes).digest('hex'),parts:Object.entries(unzipFixture(bytes)).map(([name,b])=>({name,bytes:b.length})),budgetMs:1000}));
const gc=[];const observer=new PerformanceObserver(list=>gc.push(...list.getEntries().map(e=>({durationMs:e.duration,detail:e.detail}))));observer.observe({entryTypes:['gc']});
for(const [i,parse] of [original,profiled,original,profiled].entries()){
  reset();const start=performance.now(),cpu=process.cpuUsage(),memoryBefore=process.memoryUsage();let result;
  try{const r=parse(bytes);result={ok:true,rows:r.rows.length,exact:r.rows.every((r,j)=>r.externalId===`max-text-${j}`&&r.description==='&'.repeat(20000))};}
  catch(e){result={ok:false,code:e.code,message:e.message};}
  const ms=performance.now()-start,cpuUsed=process.cpuUsage(cpu);await new Promise(r=>setImmediate(r));console.log(JSON.stringify({kind:'run',i,profiled:i%2===1,ms,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,result,memoryBefore,memoryAfter:process.memoryUsage(),gc:gc.splice(0),events:[...events]}));
}
observer.disconnect();
