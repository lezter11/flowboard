import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';
const cleanup=[];const source='apps/api/src/adapters/trash.ts';const sha=async()=>crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');const before=await sha();
try{const f=await lifecycleFixture({after:fn=>cleanup.push(fn)});const call=async(method,path,body)=>{const r=await f.request(method,path,'owner',body);const j=await r.json();if(!r.ok)throw new Error(JSON.stringify({path,status:r.status,error:j.error}));return j.data};
const create=async title=>call('POST','/boards/brd/cards',{title,columnId:'col2',priority:'none',expectedBoardVersion:await f.version()});
const target=await create('Restore into nearest surviving gap');const right=await create('Right anchor');const deleted=await call('POST',`/cards/${target.id}/delete`,{expectedVersion:target.version,expectedBoardVersion:await f.version()});
let nextId=right.id;const inserted=[];for(let n=0;n<10;n++){const c=await create('New dense-gap task '+n);await call('POST',`/cards/${c.id}/move`,{toColumnId:'col2',previousCardId:'card',nextCardId:nextId,expectedVersion:c.version,expectedBoardVersion:await f.version()});nextId=c.id;inserted.push(c.id)}
const prior=(await f.pool.query("SELECT id,position::text FROM cards WHERE column_id='col2' AND state='active' ORDER BY cards.position,cards.id")).rows;
const restored=await call('POST',`/cards/${target.id}/restore`,{expectedVersion:deleted.version,expectedBoardVersion:await f.version()});const afterOrder=(await f.pool.query("SELECT id,position::text FROM cards WHERE column_id='col2' AND state='active' ORDER BY cards.position,cards.id")).rows;
console.log(JSON.stringify({before,after:await sha(),setup:'Only normal mounted create/delete/move/restore after synthetic base fixture; no manual rank mutation',survivingAnchors:['card',right.id],priorFirstGap:prior.slice(0,2),restoreStatus:200,restoredPosition:restored.position,expectedIndex:1,actualIndex:afterOrder.findIndex(row=>row.id===target.id),activeCount:afterOrder.length,nearestPositionPreserved:afterOrder[1]?.id===target.id},null,2));
}finally{for(const fn of cleanup.reverse())await fn()}
