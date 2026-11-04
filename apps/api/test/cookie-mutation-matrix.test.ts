import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {OPENAPI_ROUTES} from '@flowboard/contracts/openapi';
import {updateProjectMemberInputSchema} from '@flowboard/contracts';
import {cookieMutationFixture} from './support/cookie-mutation-fixture.ts';

const key=(op:(typeof OPENAPI_ROUTES)[number])=>op.method+' '+(op.basePath??'/api/v1')+op.path;
const normalize=(path:string)=>path.replace(/:([A-Za-z][A-Za-z0-9]*)/g,'{$1}');
const selected=(op:(typeof OPENAPI_ROUTES)[number])=>op.method!=='GET'&&(op.path.includes('{')||['/session/last-location','/tokens'].includes(op.path));
const retired=(op:(typeof OPENAPI_ROUTES)[number])=>op.path.endsWith('/transfer-ownership');
const boardScoped=(op:(typeof OPENAPI_ROUTES)[number])=>/^\/(boards|cards|comments|images|image-uploads|imports|card-imports)\//.test(op.path)||op.path==='/session/last-location';
const consentDecision=(op:(typeof OPENAPI_ROUTES)[number])=>op.path==='/mcp/authorization-requests/{requestId}/decision';
const ownConnection=(op:(typeof OPENAPI_ROUTES)[number])=>op.path==='/mcp/connections/{connectionId}';
const output=process.env['FLOWBOARD_COOKIE_MATRIX_EVIDENCE_PATH'];
const result:any={kind:'generated_cookie_mutation_isolation_not_approval',criteria:'criteria/cookie-mutation-matrix.json',inventory:[],cells:[],controls:[],classifications:[],notCovered:[],score:null,approval:null};

test('generated cookie resource mutation isolation with genuine authorized controls',{
  skip:!process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL']&&'Set isolated identity-extra PostgreSQL URL',timeout:240000,
},async(t)=>{
  t.after(async()=>{result.totals={operations:result.inventory.length,cells:result.cells.length,controls:result.controls.length,denials:result.cells.filter((c:any)=>c.expected>=400).length,failures:result.cells.filter((c:any)=>c.actual!==c.expected||c.hasData||c.effects.length).length+result.controls.filter((c:any)=>!c.passed).length};if(output)await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');t.diagnostic(JSON.stringify(result.totals));});
  for(const op of OPENAPI_ROUTES.filter(op=>!selected(op))){result.classifications.push({operation:key(op),reason:op.path.startsWith('/mcp/oauth/')?'Public OAuth client/PKCE workflow; genuine register/token/revoke controls are executed below.':op.path==='/mcp'?'OAuth-only protocol: cookie/PAT refusal, explicit preflight and valid OAuth method controls are executed in route-auth-matrix.':op.method==='GET'?'Read operation: private reads and browser-bound OAuth consent are covered separately in route-auth-matrix; not a resource mutation.':op.path==='/invitations/accept'?'Opaque-token redemption identity workflow: mounted invitation-repair and inv01-inv03 race/lifecycle suites; not a foreign resource ID command.':'Account/global/create-own-resource operation: no selected foreign resource ID. Existing full functional suites remain necessary.'});}
  for(const op of OPENAPI_ROUTES.filter(selected))await t.test(key(op),async(t)=>{
    const f=await cookieMutationFixture(t,op);
    const mounted=[...new Set(f.app.routes.filter(r=>r.method!=='ALL').map(r=>r.method+' '+normalize(r.path)))].sort();assert.deepEqual(mounted,OPENAPI_ROUTES.map(key).sort(),'Generated inventory must equal actual mounted methods/paths');
    result.inventory.push({operation:key(op),requestSchema:op.requestSchema??op.requestKind??null,classification:retired(op)?'retired410':consentDecision(op)?'browser-session-csrf-bound-consent':ownConnection(op)?'actor-owned-nondisclosing-disconnect':op.path.startsWith('/tokens/')||op.path.startsWith('/notifications/')?'actor-owned-target':'resource-scoped',setupProof:f.setupProof});
    const fixture=await f.command();
    const deny=async(actor:string,expected:number,variant=actor)=>{
      const before=await f.fingerprint();
      const response=await f.app.request(fixture.url,{...fixture.init,headers:{...(fixture.init.headers as Record<string,string>),...f.headers(actor)}});
      const text=await response.text();let body:any;try{body=JSON.parse(text);}catch{}
      const after=await f.fingerprint(),allEffects=Object.keys(before).filter(k=>before[k]!==after[k]);
      const counterEffects:string[]=consentDecision(op)?allEffects.filter(k=>k==='rate_limit_windows'):[],effects=allEffects.filter(k=>!counterEffects.includes(k));
      const cell={operation:key(op),variant,expected,actual:response.status,code:body?.error?.code??body?.error??null,hasData:!!body&&Object.hasOwn(body,'data'),effects,counterEffects,typedBody:fixture.typedBody,querySchema:fixture.querySchema};result.cells.push(cell);
      assert.equal(response.status,expected,`${key(op)} ${variant} status`);assert.equal(cell.hasData,false,'Denied command must not return data');assert.equal(text.includes('PRIVATE_MATRIX'),false,'Denied command must not disclose seeded private content');assert.deepEqual(effects,[],'Denied command must preserve every application table, sequence, storage mutation count');
    };
    for(const actor of ['ownerA','managerA','memberA','viewerA'])await deny(actor,retired(op)?410:ownConnection(op)?204:consentDecision(op)||op.path==='/workspaces/{workspaceId}'?403:404);
    if(!retired(op)&&boardScoped(op))for(const actor of ['managerB','memberB','viewerB'])await deny(actor,404,actor+'_without_board_grant');
    if(retired(op)){await deny('ownerB',410,'ownerB_retired');result.classifications.push({operation:key(op),reason:'Retired410 is deliberate for all signed-in roles; no success control exists or is claimed.'});return;}
    const actor=op.path==='/projects/{projectId}/boards'?'managerB':op.path==='/projects/{projectId}/leave'?'memberB':'ownerB';
    const before=await f.fingerprint();const response=await f.app.request(fixture.url,{...fixture.init,headers:{...(fixture.init.headers as Record<string,string>),...f.headers(actor)}});const text=await response.text();let body:any;try{body=JSON.parse(text);}catch{}
    const after=await f.fingerprint(),effects=Object.keys(before).filter(k=>before[k]!==after[k]);
    const expected=Object.keys(op.responses).map(Number).find(status=>status>=200&&status<300);const control={operation:key(op),actor,expected,actual:response.status,code:body?.error?.code??null,passed:response.status===expected,effects};result.controls.push(control);
    assert.equal(response.status,expected,`${key(op)} authorized genuine control must succeed (safe code ${control.code??'none'})`);
    if(ownConnection(op)){
      assert.equal(text,'','Disconnect204 has no JSON envelope');assert.equal(body,undefined);
      assert.deepEqual(effects,['mcp_oauth_connections']);
      assert.ok((await f.pool.query('SELECT revoked_at FROM mcp_oauth_connections WHERE id=$1',[f.oauth!.connectionId])).rows[0].revoked_at);
      const replayBefore=await f.fingerprint(),again=await f.app.request(fixture.url,{...fixture.init,headers:{...(fixture.init.headers as Record<string,string>),...f.headers(actor)}});
      assert.equal(again.status,204);assert.equal(await again.text(),'');assert.deepEqual(await f.fingerprint(),replayBefore,'Own disconnect is idempotent');
    }else assert.equal(!!body&&Object.hasOwn(body,'data'),true,'Successful JSON control needs its real data envelope');
    if(consentDecision(op)){
      assert.equal(new URL(body.data.redirectUrl).origin,'https://claude.ai');
      assert.ok(effects.includes('mcp_oauth_connections')&&effects.includes('mcp_oauth_authorization_codes'));
      assert.equal(effects.includes('cards'),false,'Consent must not create domain cards');
    }
    if(op.path==='/projects/{projectId}/boards')assert.equal(Number((await f.pool.query('SELECT COUNT(*) FROM board_grants WHERE board_id=$1 AND user_id=$2',[body.data.id,f.actors.managerB!.user.id])).rows[0].count),1,'Manager without old-board grants may create a new board and gets its grant');
  });
  await t.test('public OAuth register/token/revoke use real client and PKCE state, not cookie authority',async(t)=>{
    const op=OPENAPI_ROUTES.find(o=>o.path==='/mcp/oauth/register')!,f=await cookieMutationFixture(t,op),oauth=f.oauth!;
    const snapshot=async()=>f.fingerprint();
    const checked=async(operation:string,variant:string,expected:number,work:()=>Promise<Response>|Response,counterOnly=false)=>{
      const before=await snapshot(),response=await work(),text=await response.text();let body:any;try{body=JSON.parse(text);}catch{}
      const after=await snapshot(),allEffects=Object.keys(before).filter(k=>before[k]!==after[k]);
      const counterEffects:string[]=counterOnly?allEffects.filter(k=>k==='rate_limit_windows'):[],effects=allEffects.filter(k=>!counterEffects.includes(k));
      result.cells.push({operation,variant,expected,actual:response.status,hasData:!!body&&Object.hasOwn(body,'data'),effects,counterEffects});
      assert.equal(response.status,expected);assert.equal(!!body&&Object.hasOwn(body,'data'),false);assert.equal(text.includes('PRIVATE_MATRIX'),false);
      assert.deepEqual(effects,[],'Refused or non-disclosing wrong-client OAuth operation must preserve persisted state');
      return body;
    };
    const registerBody={client_name:'Public matrix registration',redirect_uris:[oauth.callback],token_endpoint_auth_method:'none'};
    await checked('POST /api/v1/mcp/oauth/register','invalid_callback_without_cookie',400,()=>f.app.request(oauth.origin+oauth.root+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...registerBody,redirect_uris:['https://attacker.example/callback']})}));
    const registered=await f.app.request(oauth.origin+oauth.root+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(registerBody)});
    assert.equal(registered.status,201);const client=await registered.json()as any;
    assert.equal(client.token_endpoint_auth_method,'none');assert.deepEqual(client.redirect_uris,[oauth.callback]);assert.equal(Object.hasOwn(client,'client_secret'),false);
    assert.equal((await f.pool.query('SELECT client_id FROM mcp_oauth_clients WHERE client_id=$1',[client.client_id])).rowCount,1);
    result.controls.push({operation:'POST /api/v1/mcp/oauth/register',actor:'public_without_cookie',expected:201,actual:201,passed:true});

    const code=await oauth.code(),input=oauth.tokenInput(code);
    const wrong=await checked('POST /api/v1/mcp/oauth/token','wrong_pkce_with_owner_cookie',400,()=>f.app.request(oauth.origin+oauth.root+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:oauth.cookie},body:new URLSearchParams({...input,code_verifier:'b'.repeat(64)})}));
    assert.equal(wrong.error,'invalid_grant');
    const target=await checked('POST /api/v1/mcp/oauth/token','wrong_resource_without_cookie',400,()=>oauth.redeem({...input,resource:'https://attacker.example/mcp'}));
    assert.equal(target.error,'invalid_target');
    const exchanged=await oauth.redeem(input);assert.equal(exchanged.status,200);const token=await exchanged.json()as any;
    assert.equal(token.token_type,'Bearer');assert.match(token.access_token,/^flw_mcp_access_[a-f0-9]{64}$/);
    assert.deepEqual(token.scope.split(' ').sort(),oauth.scopes.split(' ').sort());
    assert.equal(Object.hasOwn(token,'data'),false);result.controls.push({operation:'POST /api/v1/mcp/oauth/token',actor:'public_matching_pkce_client_without_cookie',expected:200,actual:200,passed:true});
    const tools=await f.app.request(oauth.origin+oauth.root,{method:'POST',headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
    assert.equal(tools.status,200);assert.equal((await tools.json()as any).result.tools.length,5);

    const revoke=(clientId:string)=>f.app.request(oauth.origin+oauth.root+'/oauth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:oauth.accessToken,client_id:clientId})});
    await checked('POST /api/v1/mcp/oauth/revoke','wrong_client_nondisclosing',200,()=>revoke(client.client_id));
    const revoked=await revoke(oauth.clientId);assert.equal(revoked.status,200);assert.equal(await revoked.text(),'');
    assert.ok((await f.pool.query('SELECT revoked_at FROM mcp_oauth_connections WHERE id=$1',[oauth.connectionId])).rows[0].revoked_at);
    const denied=await f.app.request(oauth.origin+oauth.root,{headers:{Authorization:'Bearer '+oauth.accessToken}});assert.equal(denied.status,401);
    result.controls.push({operation:'POST /api/v1/mcp/oauth/revoke',actor:'public_matching_client_without_cookie',expected:200,actual:200,passed:true});
  });
  // Target-role protections are separate from project/board isolation and use their own fresh fixtures.
  const memberOp=OPENAPI_ROUTES.find(o=>o.path==='/projects/{projectId}/members/{userId}'&&o.method==='PATCH')!;
  for(const scenario of [
    {name:'manager cannot demote peer manager',actor:'managerB',target:'peerB',body:{status:'active',role:'viewer',expectedVersion:1}},
    {name:'manager cannot remove peer manager',actor:'managerB',target:'peerB',method:'DELETE'},
    {name:'manager cannot promote viewer to manager',actor:'managerB',target:'target',body:{status:'active',role:'manager',expectedVersion:1}},
    {name:'manager cannot change own role',actor:'managerB',target:'managerB',body:{status:'active',role:'viewer',expectedVersion:1}},
    {name:'member cannot administer project roles',actor:'memberB',target:'target',body:{status:'active',role:'member',expectedVersion:1}},
    {name:'viewer cannot administer project roles',actor:'viewerB',target:'target',body:{status:'active',role:'member',expectedVersion:1}},
  ])await t.test(scenario.name,async(t)=>{
    const f=await cookieMutationFixture(t,memberOp),target=scenario.target==='target'?f.ids.userId:f.actors[scenario.target]!.user.id;
    if(scenario.body)assert.equal(updateProjectMemberInputSchema.safeParse(scenario.body).success,true,'Protected-target body must satisfy actual shared schema');
    const path='/projects/prj/members/'+target,before=await f.fingerprint();const response=await f.call(scenario.actor,path,scenario.method??'PATCH',scenario.body);const text=await response.text();let body:any;try{body=JSON.parse(text);}catch{}
    const after=await f.fingerprint(),effects=Object.keys(before).filter(k=>before[k]!==after[k]);result.cells.push({operation:(scenario.method??'PATCH')+' /api/v1/projects/{projectId}/members/{userId}',variant:scenario.name,expected:403,actual:response.status,hasData:!!body&&Object.hasOwn(body,'data'),effects});assert.equal(response.status,403);assert.equal(!!body&&Object.hasOwn(body,'data'),false);assert.deepEqual(effects,[]);
    const allowed=await f.call('ownerB',path,scenario.method??'PATCH',scenario.body);const status=allowed.status;await allowed.arrayBuffer();result.controls.push({operation:scenario.name,actor:'ownerB',expected:200,actual:status,passed:status===200});assert.equal(status,200,'Owner control proves protected-target request is otherwise valid');
  });
});
