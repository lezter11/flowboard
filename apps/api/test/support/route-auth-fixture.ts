import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type {TestContext} from 'node:test';
import pg from 'pg';
import {createApp} from '../../src/http/app.ts';
import {runMigrations} from '../../src/adapters/migrations.ts';
import {createDevUserAndSession,hashSessionToken} from '../../src/adapters/session.ts';
import {createPersonalAccessToken,verifyPersonalAccessToken} from '../../src/adapters/tokens.ts';
import {MemoryStorageDriver} from '../../src/adapters/storage.ts';
import {getImportTemplateBytes} from '../../src/services/import-template.ts';
import {imageFixture} from './image-fixtures.ts';
import {OPENAPI_SCHEMAS} from '../../../../packages/contracts/src/openapi/schemas.ts';
import type {OpenApiOperationDefinition} from '@flowboard/contracts/openapi';

export async function routeAuthFixture(t:TestContext){
  const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL']!;
  const u=new URL(uri);assert.ok(['postgres:','postgresql:'].includes(u.protocol));assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));assert.ok(u.port&&!['55432','55479'].includes(u.port));assert.equal(u.username,'flowboard_harness');assert.equal(u.pathname,'/flowboard_identity_extra_test');assert.equal(u.search,'');
  const previousCursorSecret=process.env['CURSOR_SECRET'];
  process.env['CURSOR_SECRET']=crypto.randomBytes(32).toString('hex');
  t.after(()=>{if(previousCursorSecret===undefined)delete process.env['CURSOR_SECRET'];else process.env['CURSOR_SECRET']=previousCursorSecret;});
  const schema='route_auth_'+crypto.randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:uri,max:8,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
  await runMigrations(pool);
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};
  for(const role of ['owner','expired','grantless','foreign','target'])actors[role]=await createDevUserAndSession(`matrix.${role}@flowboard.example`,`Matrix ${role}`,pool);
  const expired=await pool.query('UPDATE sessions SET user_id=$2,expires_at=NOW()-INTERVAL \'1 second\' WHERE id=$1',[hashSessionToken(actors.expired!.session.id),actors.owner!.user.id]);assert.equal(expired.rowCount,1,'Expired Owner session fixture must update a real stored hash');
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)VALUES('ws','PRIVATE_MATRIX_WORKSPACE','UTC',$1,NOW(),NOW()),('foreign_ws','Foreign','UTC',$2,NOW(),NOW())`,[actors.owner!.user.id,actors.foreign!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('prj','ws','PRIVATE_MATRIX_PROJECT',NOW(),NOW()),('foreign_prj','foreign_ws','Foreign',NOW(),NOW())`);
  for(const role of ['grantless','target'])await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES($1,'prj','ws',$2,$3,'active',NOW(),NOW())`,['pm_'+role,actors[role]!.user.id,role==='target'?'viewer':'member']);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES('brd','ws','prj','PRIVATE_MATRIX_BOARD',NOW(),NOW()),('foreign_brd','foreign_ws','foreign_prj','Foreign',NOW(),NOW())`);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)VALUES('col','ws','prj','brd','Todo','#64748b','todo',0,NOW(),NOW()),('col2','ws','prj','brd','Next','#64748b','todo',1,NOW(),NOW()),('foreign_col','foreign_ws','foreign_prj','foreign_brd','Other','#64748b','todo',0,NOW(),NOW())`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,position,state,created_at,updated_at)VALUES('card','ws','prj','brd','col','PRIVATE_MATRIX_CARD','Private description','medium',1000,'active',NOW(),NOW()),('foreign_card','foreign_ws','foreign_prj','foreign_brd','foreign_col','Foreign','Foreign','medium',1000,'active',NOW(),NOW())`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,deleted_at,deleted_by,restore_until,created_at,updated_at)VALUES('trash','ws','prj','brd','col','PRIVATE_MATRIX_TRASH','medium',2000,'trashed',NOW(),$1,NOW()+INTERVAL '24 hours',NOW(),NOW())`,[actors.owner!.user.id]);
  await pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,version,created_at,updated_at)VALUES('comment','ws','prj','card',$1,'PRIVATE_MATRIX_COMMENT',1,NOW(),NOW())`,[actors.owner!.user.id]);
  await pool.query(`INSERT INTO notifications(id,workspace_id,project_id,user_id,type,title,body,link,read,card_id,created_at)VALUES('notif','ws','prj',$1,'mention','PRIVATE_MATRIX_NOTICE','Private notification','/private',FALSE,'card',NOW())`,[actors.owner!.user.id]);
  const inviteToken='a'.repeat(64);
  await pool.query(`INSERT INTO project_invitations(id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at)VALUES('inv','prj','ws','matrix.target@flowboard.example','viewer',$1,$2,'pending',NOW()+INTERVAL '1 day',NOW(),NOW())`,[crypto.createHash('sha256').update(inviteToken).digest('hex'),actors.owner!.user.id]);
  const pngFixture=imageFixture('png'),png=pngFixture.bytes,pngHash=crypto.createHash('sha256').update(png).digest('hex');
  const storage=new MemoryStorageDriver();let storageMutations=0;
  const put=storage.put.bind(storage),remove=storage.delete.bind(storage);
  storage.put=async(...args)=>{storageMutations++;return put(...args);};storage.delete=async(...args)=>{storageMutations++;return remove(...args);};
  await storage.put('matrix/private-image',png,'image/png');
  await pool.query(`INSERT INTO card_images(id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,storage_key,sha256,width,height,created_at,updated_at)VALUES('image','ws','prj','card',$1,'PRIVATE_MATRIX_IMAGE.png',$2,'image/png','matrix/private-image',$3,$4,$5,NOW(),NOW())`,[actors.owner!.user.id,png.length,pngHash,pngFixture.width,pngFixture.height]);
  await pool.query(`INSERT INTO card_image_uploads(id,workspace_id,project_id,card_id,uploader_id,filename,byte_length,content_type,sha256,state,expires_at,created_at,updated_at)VALUES('upload','ws','prj','card',$1,'matrix.png',$2,'image/png',$3,'awaiting_content',NOW()+INTERVAL '1 hour',NOW(),NOW())`,[actors.owner!.user.id,png.length,pngHash]);
  await pool.query(`INSERT INTO card_imports(id,workspace_id,project_id,board_id,default_column_id,uploader_id,version,state,preview_digest,expires_at,created_at,updated_at)VALUES('imp','ws','prj','brd','col',$1,1,'ready','matrix_digest',NOW()+INTERVAL '1 day',NOW(),NOW())`,[actors.owner!.user.id]);
  const app=createApp(async()=>{},{pool,storage,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const scopes=['projects:read','boards:read','cards:read','cards:create']as const;
  const pat=await createPersonalAccessToken(pool,{userId:actors.owner!.user.id,name:'Matrix full token',scopes:[...scopes],projectId:'prj'});
  const expiredPat=await createPersonalAccessToken(pool,{userId:actors.owner!.user.id,name:'Matrix expired token',scopes:[...scopes],projectId:'prj'});
  assert.ok(await verifyPersonalAccessToken(pool,expiredPat.token),'Expired PAT fixture must first be a real valid credential');
  const expiredPatRow=await pool.query('UPDATE personal_access_tokens SET expires_at=NOW()-INTERVAL \'1 second\' WHERE id=$1',[expiredPat.tokenDetails.id]);assert.equal(expiredPatRow.rowCount,1);assert.equal(await verifyPersonalAccessToken(pool,expiredPat.token),null);
  const tables=(await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(r=>r.tablename as string);
  const fingerprintSql='SELECT '+tables.map(table=>`(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM "${schema}"."${table}" x) AS "${table}"`).join(',');
  const sequences=(await pool.query('SELECT sequencename FROM pg_sequences WHERE schemaname=current_schema() ORDER BY sequencename')).rows.map(r=>r.sequencename as string);
  const fingerprint=async()=>{const state={...((await pool.query(fingerprintSql)).rows[0]),__storageMutations:String(storageMutations)};for(const sequence of sequences){const row=(await pool.query(`SELECT last_value::text,is_called FROM \"${schema}\".\"${sequence}\"`)).rows[0];state['__sequence_'+sequence]=JSON.stringify(row);}return state;};
  const ids:Record<string,string>={workspaceId:'ws',projectId:'prj',boardId:'brd',cardId:'card',columnId:'col',commentId:'comment',imageId:'image',uploadId:'upload',importId:'imp',invitationId:'inv',notificationId:'notif',id:'notif',userId:actors.target!.user.id,tokenId:pat.tokenDetails.id};
  async function requestFixture(op:OpenApiOperationDefinition){
    let path=(op.basePath??'/api/v1')+op.path;
    path=path.replace(/\{(\w+)\}/g,(_all,param:string)=>{assert.ok(ids[param],`No real parameter fixture for ${param}`);return ids[param]!;});
    if(op.path.endsWith('/restore'))path=path.replace('/cards/card/','/cards/trash/');
    const revisions=(await pool.query("SELECT structure_version,snapshot_version FROM boards WHERE id='brd'")).rows[0];const version=Number(revisions.structure_version);
    const inputs:Record<string,unknown>={
      UpdateProfileInput:{displayName:'Matrix Updated'},SaveNameInput:{firstName:'Matrix',lastName:'Owner'},UpdateLastLocationInput:{projectId:'prj',boardId:'brd'},DevLoginInput:{email:'matrix.new@flowboard.example',displayName:'New Synthetic'},
      ProjectLifecycleInput:{expectedVersion:1},UpdateWorkspaceInput:{name:'Matrix updated',timezone:'UTC',expectedVersion:1},CreateOwnProjectInput:{name:'Matrix new'},CreateProjectInput:{name:'Matrix new'},UpdateProjectInput:{description:'Updated',expectedVersion:1},UpdateProjectMemberInput:{role:'viewer',status:'active',expectedVersion:1},
      CreateInvitationInput:{email:'matrix.newinvite@flowboard.example',role:'viewer'},AcceptInvitationInput:{token:inviteToken},CreateBoardInput:{name:'Matrix board'},BoardLifecycleInput:{expectedVersion:Number(revisions.snapshot_version)},UpdateBoardInput:{name:'Matrix renamed',expectedVersion:1},BoardGrantInput:{expectedAccessRevision:'1'},
      CreateColumnInput:{name:'Matrix column',color:'#64748b',category:'todo',expectedBoardVersion:version},UpdateColumnInput:{name:'Matrix renamed',expectedBoardVersion:version},ReorderColumnsInput:{columnIds:['col','col2'],expectedBoardVersion:version},DeleteColumnInput:{expectedBoardVersion:version},
      CreateCardInput:{title:'Matrix PAT created',columnId:'col',expectedBoardVersion:version},UpdateCardInput:{title:'Matrix renamed',expectedVersion:1},MoveCardInput:{toColumnId:'col2',previousCardId:null,nextCardId:null,expectedVersion:1,expectedBoardVersion:version},MoveUndoInput:{expectedVersion:1,expectedBoardVersion:version},
      PostCommentInput:{body:'Matrix comment',mentions:[]},EditCommentInput:{body:'Edited matrix',mentions:[],expectedVersion:1},DeleteCommentInput:{expectedVersion:1},CreateImageUploadInput:{filename:'matrix.png',byteLength:png.length,contentType:'image/png',sha256:pngHash},DeleteImageInput:{expectedVersion:1},
      SoftDeleteCardInput:{expectedVersion:1,expectedBoardVersion:version},RestoreCardInput:{expectedVersion:1,expectedBoardVersion:version,toColumnId:'col'},UpdateImportMappingsInput:{mappings:{},expectedVersion:1},CommitImportInput:{previewDigest:'matrix_digest',defaultColumnId:'col',expectedVersion:1},CreateTokenInput:{name:'Matrix nested',scopes:['projects:read'],projectId:'prj'},
    };
    let body=op.requestSchema?inputs[op.requestSchema]:undefined;
    if(op.requestSchema){assert.ok(body!==undefined,`No typed body factory for ${op.requestSchema}`);const validated=OPENAPI_SCHEMAS[op.requestSchema]!.schema.safeParse(body);assert.equal(validated.success,true,`Invalid body fixture for ${op.requestSchema}`);}
    if(/^\/api\/v1\/boards\//.test(path)&&/\/(archive|reopen)$/.test(path))body={expectedVersion:Number((await pool.query("SELECT snapshot_version FROM boards WHERE id='brd'")).rows[0].snapshot_version)};
    if(/^\/api\/v1\/projects\//.test(path)&&/\/(archive|reopen)$/.test(path))body={expectedVersion:Number((await pool.query("SELECT version FROM projects WHERE id='prj'")).rows[0].version)};
    const query=new URLSearchParams();
    if(op.querySchema==='MyTasksQuery'||op.querySchema==='WorkspaceMyTasksQuery')query.set('projectId','prj');
    if(op.querySchema==='PlacementInput'){query.set('movingCardId','card');query.set('at','first');}
    if(op.path==='/boards/{boardId}/cards'&&op.method==='GET')query.set('columnId','col');
    if(op.querySchema==='ProjectPeopleQuery'){query.set('purpose','mention');query.set('boardId','brd');}
    if(op.requestKind==='xlsx')query.set('defaultColumnId','col');
    const headers:Record<string,string>={Origin:'http://localhost','Idempotency-Key':crypto.randomUUID()};
    let bytes:BodyInit|undefined;
    if(op.requestKind==='xlsx'){headers['Content-Type']='application/octet-stream';bytes=getImportTemplateBytes();}
    else if(op.requestKind==='image'){headers['Content-Type']='image/png';bytes=new Uint8Array(png).buffer;}
    else if(body!==undefined){headers['Content-Type']='application/json';bytes=JSON.stringify(body);}
    if(op.querySchema){const input=Object.fromEntries(query);const parsed=OPENAPI_SCHEMAS[op.querySchema]!.schema.safeParse(input);assert.equal(parsed.success,true,`Invalid query fixture for ${op.querySchema}`);}
    return{url:'http://localhost'+path+(query.size?'?'+query:''),init:{method:op.method,headers,...(bytes===undefined?{}:{body:bytes})}as RequestInit,typedBody:op.requestSchema??op.requestKind??'no bound request body',query:op.querySchema??null};
  }
  return{pool,app,actors,pat,expiredPat,ids,fingerprint,requestFixture};
}
