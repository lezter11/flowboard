import {createTestHarness} from 'wrangler';
import {runtimeStats} from './process-stats.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workbook} from '../../../../apps/api/test/support/import-workbook.ts';
const dir=path.dirname(fileURLToPath(import.meta.url)),configPath=path.join(dir,'wrangler-profile.json');
await fs.writeFile(configPath,JSON.stringify({name:'hosted-linux-xlsx-profile',main:path.join(dir,'profile-worker.ts'),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat']}));
const h=createTestHarness({workers:[{configPath}]});
const bytes=workbook(Array.from({length:200},(_,i)=>({externalId:`max-text-${i}`,title:'Maximum description',description:'&'.repeat(20000)})),{inlineStrings:true});
try{await h.listen();const w=h.getWorker('hosted-linux-xlsx-profile');for(const path of ['/original','/profile','/scalar','/preflight','/both','/original','/both']){const statsBefore=await runtimeStats();const r=await w.fetch('http://localhost'+path,{method:'POST',body:new Uint8Array(bytes).buffer});console.log(JSON.stringify({path,status:r.status,result:await r.json(),statsBefore,statsAfter:await runtimeStats()}));}}finally{await h.close();}
