import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { cleanupExpiredImports } from '../../../../apps/api/src/services/import-retention.ts';
test('Independent clock diagnosis: submillisecond future cleanup threshold is due on a later bounded sweep',async t=>{
 const f=await lifecycleFixture(t);const observations=[];
 for(let i=0;i<40;i++){
 const id='clock-'+i;
 const row=await f.pool.query(`INSERT INTO card_imports(id,workspace_id,project_id,board_id,default_column_id,uploader_id,state,cleanup_after,created_at,updated_at) VALUES($1,'ws','prj','brd','col',$2,'expired',NOW(),NOW(),NOW()) RETURNING (extract(epoch FROM cleanup_after)*1000)::text AS due_ms`,[id,f.actors.owner!.user.id]);
 const asOfDate=new Date();const due=Number(row.rows[0].due_ms);const first=await cleanupExpiredImports(f.pool,{asOfDate});
 const final=await cleanupExpiredImports(f.pool,{asOfDate:new Date(asOfDate.getTime()+1000)});
 observations.push({due_ms:row.rows[0].due_ms,asOfMs:asOfDate.getTime(),differenceMs:due-asOfDate.getTime(),first:first.cleanedCount,later:final.cleanedCount});
 assert.equal(first.cleanedCount+final.cleanedCount,1);assert.equal(first.cleanedCount,due>asOfDate.getTime()?0:1);
 }
 await fs.writeFile(new URL('./cleanup-clock-result.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');
 console.log('clock_future_cases='+observations.filter(o=>o.first===0).length+'; total='+observations.length);
});
