import {parseExcelWorkbook as original} from '../../../../apps/api/src/services/excel-parser.ts';
import {parseExcelWorkbook as profiled} from './profile-excel-parser.ts';
import {parseExcelWorkbook as scalar} from './candidate-scalar-excel-parser.ts';
import {parseExcelWorkbook as preflight} from './candidate-preflight-excel-parser.ts';
import {parseExcelWorkbook as both} from './candidate-both-excel-parser.ts';
import {events,reset} from './profile-state.ts';
export default {async fetch(request:Request){const bytes=Buffer.from(await request.arrayBuffer());reset();const start=performance.now();try{const r=({profile:profiled,scalar,preflight,both}[new URL(request.url).pathname.slice(1)]??original)(bytes);return Response.json({rows:r.rows.length,exact:r.rows.every((r,j)=>r.externalId===`max-text-${j}`&&r.description==='&'.repeat(20000)),elapsedMs:performance.now()-start,events});}catch(e:any){return Response.json({code:e.code,message:e.message,elapsedMs:performance.now()-start,events},{status:e.status??500});}}};
