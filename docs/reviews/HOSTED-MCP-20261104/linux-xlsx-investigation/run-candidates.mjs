import {parseExcelWorkbook as baseline} from './profile-excel-parser.ts';
import {parseExcelWorkbook as scalar} from './candidate-scalar-excel-parser.ts';
import {parseExcelWorkbook as preflight} from './candidate-preflight-excel-parser.ts';
import {parseExcelWorkbook as both} from './candidate-both-excel-parser.ts';
import {workbook} from '../../../../apps/api/test/support/import-workbook.ts';
import {events,reset} from './profile-state.ts';
const bytes=workbook(Array.from({length:200},(_,i)=>({externalId:`max-text-${i}`,title:'Maximum description',description:'&'.repeat(20000)})),{inlineStrings:true});
for(let repeat=0;repeat<2;repeat++)for(const [mode,parse] of Object.entries({baseline,scalar,preflight,both})){reset();const started=performance.now(),cpu=process.cpuUsage();let result;try{const r=parse(bytes);result={rows:r.rows.length,exact:r.rows.every((r,i)=>r.description==='&'.repeat(20000)&&r.externalId===`max-text-${i}`)};}catch(e){result={code:e.code};}const cpuUsed=process.cpuUsage(cpu);console.log(JSON.stringify({mode,repeat,result,elapsedMs:performance.now()-started,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,events}));}
