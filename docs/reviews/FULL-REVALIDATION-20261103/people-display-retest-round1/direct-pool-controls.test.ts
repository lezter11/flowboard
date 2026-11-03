import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { getProjectPeople } from '../../../../apps/api/src/adapters/rbac.ts';
async function waitBlocked(pool:any,schema:string){
 for(let i=0;i<200;i++){const r=await pool.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[schema]);if(r.rows.length)return;await new Promise(r=>setTimeout(r,10));}
 assert.fail('Expected a distinct PostgreSQL connection to block on current authority');
}
test('independent control: direct Pool display denies after demotion wins membership lock',async t=>{
 const f=await lifecycleFixture(t),blocker=await f.pool.connect();await blocker.query('BEGIN');
 await blocker.query("UPDATE project_memberships SET role='viewer',version=version+1 WHERE id='pm_manager'");
 const read=getProjectPeople(f.pool,'prj','display',undefined,undefined,50,undefined,f.actors.manager.user.id);
 const rejected=assert.rejects(read,(e:any)=>e.code==='FORBIDDEN');
 try{await waitBlocked(f.pool,f.schema);}finally{await blocker.query('COMMIT');blocker.release();}
 await rejected;
 assert.equal(f.pool.waitingCount,0);
});
test('independent control: direct Pool display retains authority until roster assembled',async t=>{
 const f=await lifecycleFixture(t),connect=f.pool.connect.bind(f.pool);
 let entered!:()=>void,release!:()=>void;const atRead=new Promise<void>(r=>{entered=r;}),released=new Promise<void>(r=>{release=r;});let armed=true;
 f.pool.connect=((...args:any[])=>{if(typeof args[0]==='function')return(connect as any)(...args);return(async()=>{const c=await(connect as any)(...args),query=c.query.bind(c),giveBack=c.release.bind(c);c.query=async(...qs:any[])=>{if(armed&&String(qs[0]).includes('WITH project_context')){armed=false;entered();await released;}return query(...qs);};c.release=(...args:any[])=>{c.query=query;return giveBack(...args);};return c;})();})as any;
 const read=getProjectPeople(f.pool,'prj','display',undefined,undefined,50,undefined,f.actors.manager.user.id);let demote:Promise<Response>|undefined;
 try{await Promise.race([atRead,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Direct Pool read never reached protected roster query')),2000))]);demote=Promise.resolve(f.request('PATCH',`/projects/prj/members/${f.actors.manager.user.id}`,'owner',{role:'viewer',status:'active',expectedVersion:1}));await waitBlocked(f.pool,f.schema);}
 finally{release();f.pool.connect=connect;}
 assert.equal((await read).data.length,4);assert.equal((await demote!).status,200);
 await assert.rejects(getProjectPeople(f.pool,'prj','display',undefined,undefined,50,undefined,f.actors.manager.user.id),(e:any)=>e.code==='FORBIDDEN');
});
test('independent control: directory denial precedes missing-board lookup; authorized pickers still scope',async t=>{
 const f=await lifecycleFixture(t);await f.pool.query('DELETE FROM board_grants WHERE user_id=$1',[f.actors.manager.user.id]);
 for(const role of ['member','viewer']){
  const denied=await f.request('GET','/projects/prj/people?purpose=display&boardId=unknown&query=Retention&limit=1&cursor=arbitrary',role);assert.equal(denied.status,403);assert.equal((await denied.json()as any).data,undefined);
  for(const purpose of ['assignee','mention']){const r=await f.request('GET',`/projects/prj/people?purpose=${purpose}&boardId=brd`,role);assert.equal(r.status,200);const rows=(await r.json()as any).data;assert.ok(rows.length);assert.equal(rows.some((p:any)=>p.id===f.actors.manager.user.id),false);assert.ok(rows.every((p:any)=>!Object.hasOwn(p,'email')));}
 }
 const admin=await f.request('GET','/projects/prj/people?purpose=display','manager');assert.equal(admin.status,200,'Manager directory authority does not require a board grant');
});
