import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test,{type TestContext} from 'node:test';
import pg from 'pg';
import {createApp} from '../src/http/app.ts';
import {runMigrations} from '../src/adapters/migrations.ts';
import {createDevUserAndSession} from '../src/adapters/session.ts';
const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const check=(name:string,fn:(t:TestContext)=>Promise<void>)=>test(name,{skip:!uri&&'Set isolated identity-extra PostgreSQL URL'},fn);
async function fixture(t:TestContext){
  const target=new URL(uri!);assert.equal(target.hostname,'127.0.0.1');assert.ok(['postgres:','postgresql:'].includes(target.protocol));assert.ok(target.port&&!['55432','55479'].includes(target.port));assert.equal(target.username,'flowboard_harness');assert.equal(target.search,'');assert.equal(target.pathname,'/flowboard_identity_extra_test');
  const schema='cursor_integrity_'+crypto.randomUUID().replaceAll('-','');const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:uri,max:8,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});await runMigrations(pool);
  const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};for(const role of ['owner','manager'])actors[role]=await createDevUserAndSession(`cursor.${role}@flowboard.example`,`Cursor ${role}`,pool);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)VALUES('ws','One','UTC',$1,NOW(),NOW()),('ws2','Two','UTC',$1,NOW(),NOW())`,[actors.owner!.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('prj1','ws','A',NOW(),NOW()),('prj2','ws','A',NOW(),NOW()),('prj3','ws2','Z',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES('pm1','prj1','ws',$1,'manager','active',NOW(),NOW()),('pm2','prj2','ws',$1,'manager','active',NOW(),NOW())`,[actors.manager!.user.id]);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at)VALUES('brd','ws','prj1','One',NOW(),NOW()),('brd2','ws','prj2','Two',NOW(),NOW())`);
  await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)VALUES('brd','prj1','ws',$1,$2),('brd2','prj2','ws',$1,$2)`,[actors.manager!.user.id,actors.owner!.user.id]);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at)VALUES('col','ws','prj1','brd','Todo','#64748b','todo',0,NOW(),NOW()),('col2','ws','prj2','brd2','Other','#64748b','todo',0,NOW(),NOW())`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)VALUES('active','ws','prj1','brd','col','Active','medium',1000,'active',NOW(),NOW()),('other','ws','prj2','brd2','col2','Other','medium',1000,'active',NOW(),NOW())`);
  const times=['2026-11-03T05:00:00.123100Z','2026-11-03T05:00:00.123500Z','2026-11-03T05:00:00.123900Z','2026-11-03T05:00:00.123900Z'];
  for(const [index,time]of times.entries()){
    const suffix=String.fromCharCode(97+index);await pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,version,created_at,updated_at)VALUES($1,'ws','prj1','active',$2,$1,1,$3,$3)`,['c_'+suffix,actors.owner!.user.id,time]);
    await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,deleted_at,deleted_by,restore_until,created_at,updated_at)VALUES($1,'ws','prj1','brd','col',$1,'medium',2000+$4,'trashed',$3,$2,$3::timestamptz+INTERVAL '24 hours',$3,$3)`,['trash_'+suffix,actors.owner!.user.id,time,index]);
    await pool.query(`INSERT INTO activity_log(id,workspace_id,project_id,board_id,visibility_scope,card_id,actor_id,action,safe_changes,created_at)VALUES($1,'ws','prj1','brd','board','active',$2,'card_updated','{}',$3)`,['act_'+suffix,actors.owner!.user.id,time]);
    for(const role of ['owner','manager'])await pool.query(`INSERT INTO notifications(id,workspace_id,project_id,user_id,type,title,body,link,read,card_id,created_at)VALUES($1,'ws','prj1',$2,'mention','Visible','Safe','/visible',FALSE,'active',$3)`,['notif_'+role+'_'+suffix,actors[role]!.user.id,time]);
  }
  const app=createApp(async()=>{},{pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const req=(path:string,role='owner')=>app.request('http://localhost/api/v1'+path,{headers:{cookie:`flowboard_session=${actors[role]!.session.id}`}});
  return{pool,actors,app,req};
}
const feeds=[['comments','/cards/active/comments','c_','asc'],['trash','/projects/prj1/trash','trash_','desc'],['cardActivity','/cards/active/activity','act_','asc'],['projectActivity','/projects/prj1/activity','act_','desc'],['workspaceActivity','/workspaces/ws/activity','act_','desc'],['notifications','/notifications','notif_owner_','desc']]as const;
check('cursor integrity: same-millisecond microseconds and exact ties walk once in both directions',async(t)=>{
  const f=await fixture(t);for(const [label,path,prefix,order]of feeds)await t.test(label,async()=>{
    const seen:string[]=[];let cursor:string|null=null;let pages=0;do{const r=await f.req(path+'?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200,await r.clone().text());const body=await r.json()as any;seen.push(...body.data.map((row:any)=>row.id));cursor=body.nextCursor;assert.ok(++pages<=5,'cursor must terminate without repeating rows');}while(cursor);
    assert.deepEqual(seen,(order==='asc'?['a','b','c','d']:['d','c','b','a']).map(id=>prefix+id));
  });
});
check('cursor integrity: forged impossible dates never reach PostgreSQL as500',async(t)=>{
  const f=await fixture(t);for(const [label,path]of feeds)await t.test(label,async()=>{
    const r=await f.req(path+'?limit=1'),body=await r.json()as any;assert.ok(body.nextCursor);
    for(const value of ['2026-02-30T00:00:00.123100Z','0000-01-01T00:00:00.000000Z','2026-01-01T25:00:00.000000Z','not-a-timestamp']){
      const parsed=JSON.parse(Buffer.from(body.nextCursor,'base64url').toString('utf8'));parsed[label==='trash'?'dAt':'createdAt']=value;const cursor=Buffer.from(JSON.stringify(parsed)).toString('base64url');const response=await f.req(path+'?limit=1&cursor='+encodeURIComponent(cursor));assert.ok([400,409].includes(response.status),`${label}/${value}: ${response.status} ${await response.clone().text()}`);
    }
  });
});
check('cursor integrity: actor, resource and notification filter scope are bound',async(t)=>{
  const f=await fixture(t);for(const path of ['/cards/active/comments','/projects/prj1/trash','/projects/prj1/activity','/notifications'])await t.test(path,async()=>{
    const first=await(await f.req(path+'?limit=1')).json()as any;assert.ok(first.nextCursor);const r=await f.req(path+'?limit=1&cursor='+encodeURIComponent(first.nextCursor),'manager');assert.ok([400,409].includes(r.status),await r.clone().text());
  });
  const c=await(await f.req('/cards/active/comments?limit=1')).json()as any;assert.equal((await f.req('/cards/other/comments?limit=1&cursor='+encodeURIComponent(c.nextCursor))).status,409);
  const n=await(await f.req('/notifications?limit=1')).json()as any;assert.equal((await f.req('/notifications?limit=1&unreadOnly=true&cursor='+encodeURIComponent(n.nextCursor))).status,409);
});
check('cursor integrity: lexical projects walk ties and reject malformed/cross-scope cursors',async(t)=>{
  const f=await fixture(t);const ids:string[]=[];let cursor:string|null=null;let firstCursor='';let count=0;do{const r=await f.req('/projects?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);const b=await r.json()as any;ids.push(...b.data.map((p:any)=>p.id));cursor=b.nextCursor;if(!firstCursor&&cursor)firstCursor=cursor;assert.ok(++count<=4);}while(cursor);assert.deepEqual(ids,['prj1','prj2','prj3']);
  for(const path of ['/projects?limit=1&cursor=not-json','/workspaces/ws/projects?limit=1&cursor='+encodeURIComponent(firstCursor)]){const r=await f.req(path);assert.equal(r.status,400,await r.clone().text());}
  assert.equal((await f.req('/projects?limit=1&cursor='+encodeURIComponent(firstCursor),'manager')).status,400);
  const minted=await f.app.request('http://localhost/api/v1/tokens',{method:'POST',headers:{cookie:`flowboard_session=${f.actors.owner!.session.id}`,origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({name:'Cursor project token',projectId:'prj1',scopes:['projects:read']})});assert.equal(minted.status,201,await minted.clone().text());const token=(await minted.json()as any).data.token;const scoped=await f.app.request('http://localhost/api/v1/projects?limit=1&cursor='+encodeURIComponent(firstCursor),{headers:{Authorization:'Bearer '+token}});assert.equal(scoped.status,400,await scoped.clone().text());
  const workspace=await(await f.req('/workspaces/ws/projects?limit=1')).json()as any;assert.ok(workspace.nextCursor);assert.equal((await f.req('/workspaces/ws2/projects?limit=1&cursor='+encodeURIComponent(workspace.nextCursor))).status,400);
});

check('cursor integrity: oversized and legacy ambiguous cursors fail without restarting',async(t)=>{
  const f=await fixture(t);
  for(const [,path]of feeds){const r=await f.req(path+'?cursor='+encodeURIComponent('x'.repeat(4097)));assert.ok([400,409,422].includes(r.status),path+': '+await r.clone().text());}
  for(const [path,payload]of [['/cards/active/comments',{v:1,cardId:'active',createdAt:'2026-11-03T05:00:00.123Z',id:'c_a'}],['/projects/prj1/trash',{pId:'prj1',dAt:'2026-11-03T05:00:00.123Z',id:'trash_a'}],['/projects',{name:'A',id:'prj1'}]]as const){const r=await f.req(path+'?limit=1&cursor='+Buffer.from(JSON.stringify(payload)).toString('base64url'));assert.ok([400,409].includes(r.status));}
  assert.equal((await f.req('/projects/prj1/trash?limit=0&cursor=not-json')).status,422);
});
check('cursor integrity: notification malformed queries reject422 and literalfalse staysfalse',async(t)=>{
  const f=await fixture(t);
  for(const query of ['limit=0','limit=101','limit=garbage','unreadOnly=garbage','unreadOnly=','cursor=','extra=ignored'])await t.test(query,async()=>{const r=await f.req('/notifications?'+query);assert.equal(r.status,422,await r.clone().text());});
  await f.pool.query("UPDATE notifications SET read=TRUE WHERE id='notif_owner_a'");
  for(const [query,expected]of [['',4],['?unreadOnly=false',4],['?unreadOnly=true',3]]as const){const r=await f.req('/notifications'+query);assert.equal(r.status,200);assert.equal((await r.json()as any).data.length,expected);}
});
check('cursor integrity: forged cursor text cannot send NUL to PostgreSQL',async(t)=>{
  const f=await fixture(t);for(const [label,path]of [...feeds,['projects','/projects']]as const)await t.test(label,async()=>{
    const body=await(await f.req(path+'?limit=1')).json()as any;assert.ok(body.nextCursor);const parsed=JSON.parse(Buffer.from(body.nextCursor,'base64url').toString('utf8'));parsed.id='bad\u0000id';
    const r=await f.req(path+'?limit=1&cursor='+encodeURIComponent(Buffer.from(JSON.stringify(parsed)).toString('base64url')));assert.ok([400,409].includes(r.status),`${label}: ${r.status} ${await r.clone().text()}`);
  });
});

check('cursor integrity: free lexical name and lone-surrogate boundaries are controlled',async(t)=>{
  const f=await fixture(t);const first=await(await f.req('/projects?limit=1')).json()as any;
  for(const [field,value]of [['name','bad\u0000name'],['id','\ud800']]as const){const parsed=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));parsed[field]=value;const r=await f.req('/projects?limit=1&cursor='+Buffer.from(JSON.stringify(parsed)).toString('base64url'));assert.equal(r.status,400);}
});
