import crypto from 'node:crypto';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createPool } from '../../../../apps/api/src/adapters/postgres.ts';
import { createDevUserAndSession } from '../../../../apps/api/src/adapters/session.ts';
import { commitCardImport } from '../../../../apps/api/src/adapters/imports.ts';

const url=process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('/flowboard_harness')) throw new Error('requires disposable flowboard_harness only');
const pool=createPool(url,8), s=crypto.randomUUID().replaceAll('-','').slice(0,10);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),(()=>{const b=Buffer.alloc(25);b.writeUInt32BE(13,0);b.write('IHDR',4,'ascii');b.writeUInt32BE(1,8);b.writeUInt32BE(1,12);b[16]=8;b[17]=2;return b;})(),Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])]);
const objects=new Map(); let enterPut, releasePut;
const putEntered=new Promise(r=>enterPut=r), putGate=new Promise(r=>releasePut=r);
const storage={
 async put(key,data,type){if(key.startsWith('images/')){enterPut();await putGate;}objects.set(key,{data:new Uint8Array(data),type});},
 async get(key){const x=objects.get(key);return x?{data:new Uint8Array(x.data),contentType:x.type}:null;},
 async delete(key){objects.delete(key);},
};
const answer=async r=>({status:r.status,body:await r.json().catch(()=>null)});
try {
  await runMigrations(pool);
  const owner=await createDevUserAndSession(`race-owner.${s}@example.invalid`,'Race owner',pool);
  const ws=`race_ws_${s}`, project=`race_pr_${s}`, board=`race_bo_${s}`, column=`race_col_${s}`, card=`race_card_${s}`;
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Race','UTC',$2,now(),now())`,[ws,owner.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Race',now(),now())`,[project,ws]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES($1,$2,$3,'Race',now(),now())`,[board,ws,project]);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at) VALUES($1,$2,$3,$4,'Todo','#64748b','todo',0,1,now(),now())`,[column,ws,project,board]);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'Race image','medium',1000,'active',1,now(),now())`,[card,ws,project,board,column]);

  // Hold finalization after the staged object has been read and the card row is locked. Then start
  // the actual card-delete route, which must serialize on that same card row.
  const upload=`race_upload_${s}`, digest=crypto.createHash('sha256').update(png).digest('hex');
  await pool.query(`INSERT INTO card_image_uploads(id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,sha256,state,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'audit.png',$6,'image/png',$7,'content_received',now()+interval '1 hour',now(),now())`,[upload,ws,project,card,owner.user.id,png.byteLength,digest]);
  objects.set(`staging/${upload}/audit.png`,{data:new Uint8Array(png),type:'image/png'});
  const app=createApp(async()=>{}, {pool,storage});
  const cookie=`flowboard_session=${owner.session.id}`;
  const finalizePromise=app.request(`http://localhost/api/v1/image-uploads/${upload}/finalize`,{method:'POST',headers:{cookie,origin:'http://localhost','idempotency-key':`finalize-${s}`}});
  await Promise.race([putEntered,new Promise((_,rej)=>setTimeout(()=>rej(new Error('finalize did not reach storage gate')),5000))]);
  const deletePromise=app.request(`http://localhost/api/v1/cards/${card}/delete`,{method:'POST',headers:{cookie,origin:'http://localhost','content-type':'application/json','idempotency-key':`delete-${s}`},body:JSON.stringify({expectedVersion:1,expectedBoardVersion:1})});
  await new Promise(r=>setTimeout(r,30)); releasePut();
  const [finalize,deleted]=await Promise.all([finalizePromise,deletePromise]);
  const finalResults=[await answer(finalize),await answer(deleted)];
  const state=await pool.query(`SELECT c.state,(SELECT count(*)::int FROM card_images i WHERE i.card_id=c.id) AS image_count FROM cards c WHERE c.id=$1`,[card]);

  // Two independent transactions attempt to commit one ready import simultaneously.
  const importId=`race_import_${s}`;
  await pool.query(`INSERT INTO card_imports(id,workspace_id,project_id,board_id,default_column_id,uploader_id,version,state,preview_digest,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,'ready','synthetic-digest',now()+interval '1 hour',now(),now())`,[importId,ws,project,board,column,owner.user.id]);
  await pool.query(`INSERT INTO card_import_rows(id,import_id,row_number,external_id,title,status,priority,outcome,created_at) VALUES($1,$2,1,$3,'Imported once',NULL,'medium','new',now())`,[`race_row_${s}`,importId,`external_${s}`]);
  const commitOne=async()=>{const client=await pool.connect();try{await client.query('BEGIN');const value=await commitCardImport(client,importId,owner.user.id,{expectedVersion:1,previewDigest:'synthetic-digest',defaultColumnId:column});await client.query('COMMIT');return {state:value.state,rows:value.counts?.created??null};}catch(e){await client.query('ROLLBACK').catch(()=>{});return {error:e?.code??e?.name??'Error'};}finally{client.release();}};
  const imports=await Promise.all([commitOne(),commitOne()]);
  const imported=await pool.query(`SELECT count(*)::int AS n FROM cards WHERE project_id=$1 AND title='Imported once'`,[project]);
  console.log(JSON.stringify({imageFinalizeVsCardDelete:{statuses:finalResults.map(x=>x.status),errors:finalResults.map(x=>x.body?.error?.code??null),cardState:state.rows[0]?.state,finalizedImages:state.rows[0]?.image_count,storageObjectCount:objects.size},doubleImportCommit:{results:imports,createdCards:imported.rows[0]?.n}}));
} finally { releasePut(); await pool.end(); }
