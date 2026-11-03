import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type {TestContext} from 'node:test';
import type {OpenApiOperationDefinition} from '@flowboard/contracts/openapi';
import {OPENAPI_SCHEMAS} from '../../../../packages/contracts/src/openapi/schemas.ts';
import {createApp} from '../../src/http/app.ts';
import {createDevUserAndSession} from '../../src/adapters/session.ts';
import {MemoryStorageDriver} from '../../src/adapters/storage.ts';
import {SharpImageVerifier} from '../../src/services/image-verifier-node.ts';
import {routeAuthFixture} from './route-auth-fixture.ts';
import {imageFixture} from './image-fixtures.ts';
import {workbook} from './import-workbook.ts';

/** Existing complete resources are tenant B; the prior fixture's foreign workspace is tenant A. */
export async function cookieMutationFixture(t:TestContext,op:OpenApiOperationDefinition){
  const base=await routeAuthFixture(t);
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={ownerB:base.actors.owner!,ownerA:base.actors.foreign!,memberB:base.actors.grantless!};
  for(const tenant of ['A','B'])for(const role of ['manager','member','viewer']){
    if(tenant==='B'&&role==='member')continue;
    const actor=await createDevUserAndSession(`cookie.${role}.${tenant.toLowerCase()}@flowboard.example`,`Tenant ${tenant} ${role}`,base.pool);actors[role+tenant]=actor;
    const project=tenant==='A'?'foreign_prj':'prj',workspace=tenant==='A'?'foreign_ws':'ws';
    await base.pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES($1,$2,$3,$4,$5,'active',NOW(),NOW())`,['pm_cookie_'+role+tenant,project,workspace,actor.user.id,role]);
    if(tenant==='A')await base.pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES('foreign_brd','foreign_prj','foreign_ws',$1,$2)`,[actor.user.id,actors.ownerA!.user.id]);
  }
  const peer=await createDevUserAndSession('cookie.peer.b@flowboard.example','Tenant B peer manager',base.pool);actors.peerB=peer;
  await base.pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES('pm_peer_b','prj','ws',$1,'manager','active',NOW(),NOW())`,[peer.user.id]);
  const storage=new MemoryStorageDriver();let mutations=0;
  const put=storage.put.bind(storage),remove=storage.delete.bind(storage);
  storage.put=async(...args)=>{mutations++;return put(...args);};storage.delete=async(...args)=>{mutations++;return remove(...args);};
  const png=imageFixture('png').bytes;await storage.put('matrix/private-image',png,'image/png');
  const app=createApp(async()=>{},{pool:base.pool,storage,imageVerifier:new SharpImageVerifier(),rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const headers=(actor:string)=>({Cookie:`flowboard_session=${actors[actor]!.session.id}`,Origin:'http://localhost','Idempotency-Key':crypto.randomUUID()});
  const call=(actor:string,path:string,method='GET',body?:unknown)=>app.request('http://localhost/api/v1'+path,{method,headers:{...headers(actor),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const setupProof:string[]=[];
  for(const actor of ['ownerA','managerA','memberA','viewerA']){
    const r=await call(actor,'/boards/foreign_brd');assert.equal(r.status,200,`${actor} must have real current access to own tenant A`);await r.arrayBuffer();
  }
  setupProof.push('All four tenant-A roles successfully read their own granted board.');
  assert.equal(Number((await base.pool.query('SELECT COUNT(*) FROM project_memberships WHERE project_id=$1 AND user_id=ANY($2::text[])',['prj',['ownerA','managerA','memberA','viewerA'].map(a=>actors[a]!.user.id)])).rows[0].count),0);
  assert.equal(Number((await base.pool.query('SELECT COUNT(*)FROM board_grants WHERE board_id=$1 AND user_id=ANY($2::text[])',['brd',['managerB','memberB','viewerB'].map(a=>actors[a]!.user.id)])).rows[0].count),0);
  if(op.path==='/boards/{boardId}/reopen')await base.pool.query("UPDATE boards SET archived=TRUE WHERE id='brd'");
  if(op.path==='/projects/{projectId}/reopen')await base.pool.query("UPDATE projects SET archived=TRUE WHERE id='prj'");
  if(op.path.includes('/invitations/{invitationId}'))await base.pool.query("UPDATE project_invitations SET email='cookie.pending.b@flowboard.example' WHERE id='inv'");
  if(op.path==='/boards/{boardId}/grants/{userId}'&&op.method==='DELETE')await base.pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES('brd','prj','ws',$1,$2)`,[base.actors.target!.user.id,actors.ownerB!.user.id]);
  if(op.path==='/cards/{cardId}/move-undo'){
    const r=await call('ownerB','/cards/card/move','POST',{toColumnId:'col2',previousCardId:null,nextCardId:null,expectedVersion:1,expectedBoardVersion:1});assert.equal(r.status,200,'Undo requires a real committed prior move');await r.arrayBuffer();setupProof.push('Real mounted prior move200 creates undo activity/version state.');
  }
  if(op.path==='/image-uploads/{uploadId}/finalize'){
    const r=await app.request('http://localhost/api/v1/image-uploads/upload/content',{method:'PUT',headers:{...headers('ownerB'),'Content-Type':'image/png'},body:new Uint8Array(png).buffer});assert.equal(r.status,200,'Finalize requires real accepted PNG content');await r.arrayBuffer();setupProof.push('Real mounted image content PUT200 before full Sharp verification.');
  }
  let importId='imp',preview:any;
  if(op.path.startsWith('/imports/{importId}')||op.path.startsWith('/card-imports/{importId}')){
    const bytes=workbook([{externalId:'cookie-matrix-row',title:'Cookie mutation import',description:'A genuine import preview',priority:'medium',status:'Todo'}]);
    const r=await app.request('http://localhost/api/v1/boards/brd/imports?defaultColumnId=col',{method:'POST',headers:{...headers('ownerB'),'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes).buffer});assert.equal(r.status,201,'Import controls need a genuine parsed/validated preview');preview=(await r.json()as any).data;importId=preview.id;setupProof.push('Real mounted XLSX preview201 binds digest, actor, target and row state.');
  }
  async function command(){
    const f=await base.requestFixture(op);let url=f.url,body:any;
    if(typeof f.init.body==='string')body=JSON.parse(f.init.body);
    url=url.replace('/imports/imp','/imports/'+importId).replace('/card-imports/imp','/card-imports/'+importId);
    if(op.method==='DELETE'&&op.path==='/boards/{boardId}/columns/{columnId}')url=url.replace('/columns/col','/columns/col2');
    if(op.path==='/boards/{boardId}/columns/reorder')body.columnIds=['col2','col'];
    if(op.path==='/projects/{projectId}/members/{userId}'&&op.method==='PATCH')body.role='member';
    if(op.path==='/cards/{cardId}/move-undo')body.expectedVersion=Number((await base.pool.query("SELECT version FROM cards WHERE id='card'")).rows[0].version);
    if(preview&&op.requestSchema==='CommitImportInput')body={expectedVersion:preview.version,previewDigest:preview.previewDigest,defaultColumnId:'col'};
    if(preview&&op.requestSchema==='UpdateImportMappingsInput')body={expectedVersion:preview.version,mappings:{Todo:'col2'}};
    // The shared lifecycle request carries the deliberately observed project version.
    if(op.path.startsWith('/projects/')&&/\/(archive|reopen)$/.test(op.path))body={expectedVersion:Number((await base.pool.query("SELECT version FROM projects WHERE id='prj'")).rows[0].version)};
    if(op.requestSchema){const parsed=OPENAPI_SCHEMAS[op.requestSchema]!.schema.safeParse(body);assert.equal(parsed.success,true,`Scenario body must satisfy ${op.requestSchema}`);}
    const init={...f.init,headers:{...(f.init.headers as Record<string,string>)}};
    if(body!==undefined){init.body=JSON.stringify(body);(init.headers as Record<string,string>)['Content-Type']='application/json';}
    else if(!op.requestKind){delete init.body;delete(init.headers as Record<string,string>)['Content-Type'];}
    return{url,init,typedBody:f.typedBody,querySchema:f.query};
  }
  const fingerprint=async()=>({...await base.fingerprint(),__cookieStorageMutations:String(mutations)});
  return{...base,app,actors,headers,call,command,fingerprint,setupProof};
}
