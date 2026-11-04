import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {OPENAPI_ROUTES} from '@flowboard/contracts/openapi';
import {PERSONAL_ACCESS_TOKEN_ROUTES} from '../src/http/middleware/token-policy.ts';
import {routeAuthFixture} from './support/route-auth-fixture.ts';

const normalize=(path:string)=>path.replace(/:([A-Za-z][A-Za-z0-9]*)/g,'{$1}');
const key=(op:(typeof OPENAPI_ROUTES)[number])=>op.method+' '+(op.basePath??'/api/v1')+op.path;
const output=process.env['FLOWBOARD_AUTH_MATRIX_EVIDENCE_PATH'];
const result:any={kind:'generated_mounted_authentication_matrix_not_approval',inventory:[],cells:[],publicExemptions:[],notCovered:[],approval:null,score:null};
const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];

test('generated route auth matrix: mounted inventory, every bearer boundary, sessions and real private targets',{
  skip:!uri&&'Set isolated identity-extra PostgreSQL URL',timeout:120000,
},async(t)=>{
  const f=await routeAuthFixture(t);
  t.after(async()=>{if(output)await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');});
  const mounted=[...new Set(f.app.routes.filter(r=>r.method!=='ALL').map(r=>r.method+' '+normalize(r.path)))].sort();
  const documented=OPENAPI_ROUTES.map(key).sort();assert.equal(new Set(documented).size,documented.length);assert.deepEqual(documented,mounted,'Every explicit mounted operation needs an auth cell; no phantom/missing route');
  const patAllowed=new Map(PERSONAL_ACCESS_TOKEN_ROUTES.map(r=>[r.method+' '+normalize(r.path),r.scope]));
  assert.deepEqual(OPENAPI_ROUTES.filter(r=>r.patScope).map(r=>key(r)+' '+r.patScope).sort(),PERSONAL_ACCESS_TOKEN_ROUTES.map(r=>r.method+' '+normalize(r.path)+' '+r.scope).sort());
  result.inventory=OPENAPI_ROUTES.map(op=>({operation:key(op),auth:op.auth,minimumRole:op.minimumRole,patScope:op.patScope??null}));
  const cookie=(actor:string)=>`flowboard_session=${f.actors[actor]!.session.id}`;
  const variants=async(op:(typeof OPENAPI_ROUTES)[number]):Promise<Array<{name:string;expected:number;headers:Record<string,string>}>>=>op.path==='/mcp'?(op.method==='OPTIONS'?[
    {name:'anonymous_protocol_preflight',expected:204,headers:{Origin:'http://localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization, Content-Type, MCP-Protocol-Version'}},
    {name:'valid_pat_with_owner_cookie',expected:204,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.pat.token}},
    {name:'expired_pat_with_owner_cookie',expected:204,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.expiredPat.token}},
  ]:[
    {name:'anonymous',expected:401,headers:{}},
    {name:'expired_session',expected:401,headers:{Cookie:cookie('expired')}},
    {name:'owner_cookie_without_oauth',expected:401,headers:{Cookie:cookie('owner')}},
    {name:'valid_pat_with_owner_cookie',expected:401,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.pat.token}},
    {name:'expired_pat_with_owner_cookie',expected:401,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.expiredPat.token}},
    {name:'valid_oauth',expected:op.method==='POST'?200:405,headers:{Authorization:'Bearer '+(await f.hosted()).accessToken}},
  ]):[
    ...(op.auth==='session'||op.auth==='session-or-token'?[{name:'anonymous',expected:401,headers:{}},{name:'expired_session',expected:401,headers:{Cookie:cookie('expired')}}]:[]),
    ...(op.path==='/session/logout'&&op.auth==='optional-session'?[{name:'anonymous_optional_logout',expected:204,headers:{}},{name:'expired_session_optional_logout',expected:204,headers:{Cookie:cookie('expired')}}]:[]),
    ...(op.auth==='admin-secret'?[{name:'anonymous_admin',expected:403,headers:{}},{name:'expired_session_admin',expected:403,headers:{Cookie:cookie('expired')}}]:[]),
    {name:'valid_pat_with_owner_cookie',expected:patAllowed.has(key(op))?(op.method==='POST'?201:200):403,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.pat.token}},
    {name:'expired_pat_with_owner_cookie',expected:401,headers:{Cookie:cookie('owner'),Authorization:'Bearer '+f.expiredPat.token}},
  ];
  for(const op of OPENAPI_ROUTES){
    if(['public','local-test','optional-session'].includes(op.auth))result.publicExemptions.push({operation:key(op),auth:op.auth,note:op.auth==='optional-session'?'Optional logout has explicit anon/expired204 clear-cookie cells; bearer boundary still enforced.':op.auth==='local-test'?'Synthetic dev-login not invoked anonymously; no new identities/providers from this matrix.':'Public path exempt only from cookie-required401 cells; both bearer+Ownercookie cells still run.'});
    for(const variant of await variants(op))await t.test(key(op)+' / '+variant.name,async()=>{
      const fixture=await f.requestFixture(op),before=await f.fingerprint();
      const response=await f.app.request(fixture.url,{...fixture.init,headers:{...(fixture.init.headers as Record<string,string>),...variant.headers}});
      const text=await response.text();let parsed:any;try{parsed=JSON.parse(text);}catch{}
      const after=await f.fingerprint(),allEffects=Object.keys(before).filter(table=>before[table]!==after[table]);
      const counterEffects:string[]=op.path==='/mcp'&&variant.name==='valid_oauth'?allEffects.filter(table=>table==='rate_limit_windows'):[],effects=allEffects.filter(table=>!counterEffects.includes(table));
      const hasData=!!parsed&&typeof parsed==='object'&&Object.hasOwn(parsed,'data');
      const denied=variant.expected>=400;
      const cell={operation:key(op),variant:variant.name,expected:variant.expected,actual:response.status,code:parsed?.error?.code??null,hasData,effectTables:effects,counterEffects,typedBody:fixture.typedBody,querySchema:fixture.query,serverTiming:response.headers.has('server-timing')};result.cells.push(cell);
      assert.equal(response.status,variant.expected,`${key(op)} ${variant.name} status mismatch`);
      if(denied){
        assert.equal(hasData,false,`${key(op)} denial returned data`);
        assert.equal(text.includes('PRIVATE_MATRIX'),false,`${key(op)} denial exposed fixture private content`);
        assert.deepEqual(effects,[],`${key(op)} denied operation changed persisted state`);
        if(op.path==='/mcp'){assert.equal(parsed?.jsonrpc,'2.0');assert.equal(typeof parsed?.error?.code,'number');if(response.status===401)assert.match(response.headers.get('www-authenticate')??'',/resource_metadata=/);}
        else{
          if(variant.name==='expired_pat_with_owner_cookie')assert.equal(parsed?.error?.code,'UNAUTHORIZED');
          if(variant.name==='valid_pat_with_owner_cookie')assert.equal(parsed?.error?.code,'TOKEN_OPERATION_FORBIDDEN');
        }
      }else if(variant.expected===204){assert.equal(text,'');if(op.path==='/mcp'){assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('access-control-allow-credentials'),null);assert.match(response.headers.get('allow')??'',/POST/);}else assert.match(response.headers.get('set-cookie')??'',/flowboard_session=;/);assert.equal(hasData,false);assert.deepEqual(effects,[]);
      }else if(op.path==='/mcp'){
        assert.equal(parsed.jsonrpc,'2.0');assert.equal(parsed.result.tools.length,5);assert.equal(hasData,false);assert.deepEqual(effects,[]);
      }else{
        assert.equal(hasData,true,`${key(op)} allowed PAT must have a real successful response`);
        if(op.method==='POST'){
          assert.ok(parsed.data.id);assert.deepEqual(effects.sort(),['activity_log','boards','cards','idempotency_receipts','__sequence_card_key_seq'].sort());
          const activity=(await f.pool.query("SELECT safe_changes->'source' AS source FROM activity_log WHERE card_id=$1 AND action='card_created'",[parsed.data.id])).rows[0];assert.equal(activity.source.type,'personal_access_token');assert.equal(activity.source.credentialId,f.pat.tokenDetails.id);
        }else{
          assert.deepEqual(effects,[],`${key(op)} read changed state`);
          if(op.path==='/projects')assert.deepEqual(parsed.data.map((r:any)=>r.id),['prj']);
          if(op.path==='/projects/{projectId}/boards'){assert.deepEqual(parsed.data.map((r:any)=>r.id),['brd']);assert.ok(parsed.data.every((r:any)=>!Object.hasOwn(r,'description')));}
          if(op.path==='/boards/{boardId}/metadata')assert.equal(parsed.data.id,'brd');
          if(op.path==='/cards/{cardId}')assert.equal(parsed.data.id,'card');
          if(op.path.endsWith('/cards/search'))assert.ok(parsed.data.some((r:any)=>r.id==='card'));
        }
      }
    });
  }
  await t.test('real browser-bound consent and own connections retain actor/session ownership',async()=>{
    const oauth=await f.hosted(),path=`${oauth.root}/authorization-requests/${oauth.pending.requestId}`;
    const headers=(actor:string)=>({Cookie:`${cookie(actor)}; ${oauth.pending.bindingCookie}`,Origin:oauth.origin});
    const before=await f.fingerprint(),foreign=await f.app.request(oauth.origin+path,{headers:headers('foreign')});
    assert.equal(foreign.status,403);assert.equal((await foreign.text()).includes('PRIVATE_MATRIX'),false);assert.deepEqual(await f.fingerprint(),before);
    result.cells.push({operation:'GET /api/v1/mcp/authorization-requests/{requestId}',variant:'foreign_cookie_with_real_browser_binding',expected:403,actual:foreign.status,hasData:false,effectTables:[]});
    const own=await f.app.request(oauth.origin+path,{headers:headers('owner')});assert.equal(own.status,200);const view=await own.json()as any;
    assert.equal(view.data.requestId,oauth.pending.requestId);assert.ok(view.data.projects.some((project:any)=>project.id==='prj'));
    assert.equal(JSON.stringify(view).includes(oauth.accessToken),false);assert.ok(view.data.csrfToken);
    result.cells.push({operation:'GET /api/v1/mcp/authorization-requests/{requestId}',variant:'owner_cookie_and_browser_binding',expected:200,actual:own.status,hasData:true,effectTables:['mcp_oauth_authorization_requests']});
    const other=await f.app.request(oauth.origin+oauth.root+'/connections',{headers:{Cookie:cookie('foreign')}});assert.equal(other.status,200);assert.deepEqual((await other.json()as any).data,[]);
    const list=await f.app.request(oauth.origin+oauth.root+'/connections',{headers:{Cookie:cookie('owner')}});assert.equal(list.status,200);const data=(await list.json()as any).data;
    assert.ok(data.some((connection:any)=>connection.id===oauth.connectionId));assert.equal(JSON.stringify(data).includes(oauth.accessToken),false);
    result.cells.push({operation:'GET /api/v1/mcp/connections',variant:'owner_cookie_safe_own_list',expected:200,actual:list.status,hasData:true,effectTables:[]});
    result.cells.push({operation:'GET /api/v1/mcp/connections',variant:'foreign_cookie_empty_own_list',expected:200,actual:other.status,hasData:true,effectTables:[]});
  });
  // Existing real targets, with actor-owned foreign context and with project membership but no board grant.
  // These are selected meaningful privacy cases; unlisted resource/write workflows remain explicit gaps.
  const targetReads:Record<string,{foreign:number;grantless:number;empty?:boolean}>={
    'GET /api/v1/projects/{projectId}':{foreign:404,grantless:200},
    'GET /api/v1/projects/{projectId}/boards':{foreign:404,grantless:200,empty:true},
    'GET /api/v1/projects/{projectId}/people':{foreign:404,grantless:404},
    'GET /api/v1/projects/{projectId}/members':{foreign:404,grantless:403},
    'GET /api/v1/projects/{projectId}/invitations':{foreign:404,grantless:403},
    'GET /api/v1/projects/{projectId}/trash':{foreign:404,grantless:403},
    'GET /api/v1/projects/{projectId}/activity':{foreign:404,grantless:403},
    'GET /api/v1/workspaces/{workspaceId}/activity':{foreign:404,grantless:403},
    'GET /api/v1/boards/{boardId}':{foreign:404,grantless:404},
    'GET /api/v1/boards/{boardId}/metadata':{foreign:404,grantless:404},
    'GET /api/v1/boards/{boardId}/cards':{foreign:404,grantless:404},
    'GET /api/v1/boards/{boardId}/access':{foreign:404,grantless:404},
    'GET /api/v1/cards/{cardId}':{foreign:404,grantless:404},
    'GET /api/v1/cards/{cardId}/comments':{foreign:404,grantless:404},
    'GET /api/v1/cards/{cardId}/activity':{foreign:404,grantless:404},
    'GET /api/v1/cards/{cardId}/images':{foreign:404,grantless:404},
    'GET /api/v1/images/{imageId}/content':{foreign:404,grantless:404},
    'GET /api/v1/images/{imageId}/thumbnail':{foreign:404,grantless:404},
    'GET /api/v1/image-uploads/{uploadId}':{foreign:404,grantless:404},
    'GET /api/v1/imports/{importId}':{foreign:404,grantless:404},
    'GET /api/v1/card-imports/{importId}':{foreign:404,grantless:404},
    'GET /api/v1/boards/{boardId}/import-template':{foreign:404,grantless:404},
    'GET /api/v1/boards/{boardId}/card-import-template':{foreign:404,grantless:404},
  };
  for(const op of OPENAPI_ROUTES){
    const expectation=targetReads[key(op)];
    if(!expectation){result.notCovered.push({operation:key(op),cellFamily:'foreign/grantlesscookie',reason:'No additional workflow-valid existing-target factory/expectation in this bounded matrix; anonymous/expired and both bearer boundaries above remain covered.'});continue;}
    for(const actor of ['owner','foreign','grantless']as const)await t.test(key(op)+' / '+actor+'_cookie',async()=>{
      const fixture=await f.requestFixture(op),before=await f.fingerprint();const response=await f.app.request(fixture.url,{...fixture.init,headers:{...(fixture.init.headers as Record<string,string>),Cookie:cookie(actor)}});const text=await response.text();let body:any;try{body=JSON.parse(text);}catch{}
      const after=await f.fingerprint(),effects=Object.keys(before).filter(table=>before[table]!==after[table]);const expected=actor==='owner'?200:expectation[actor];result.cells.push({operation:key(op),variant:actor+'_cookie',expected,actual:response.status,hasData:!!body&&Object.hasOwn(body,'data'),effectTables:effects,typedBody:fixture.typedBody,querySchema:fixture.query});
      assert.equal(response.status,expected,`${key(op)} ${actor} status mismatch`);assert.deepEqual(effects,[]);
      if(expected===200&&actor==='owner'){assert.ok(text.length>0);if(response.headers.get('content-type')?.includes('application/json'))assert.equal(!!body&&Object.hasOwn(body,'data'),true);}
      if(expected>=400){assert.equal(!!body&&Object.hasOwn(body,'data'),false);assert.equal(text.includes('PRIVATE_MATRIX'),false);}
      if(actor==='grantless'&&expectation.empty)assert.deepEqual(body.data,[]);
    });
  }
  result.totals={operations:mounted.length,cells:result.cells.length,expectedDenials:result.cells.filter((c:any)=>c.expected>=400).length,positivePatCells:result.cells.filter((c:any)=>c.variant==='valid_pat_with_owner_cookie'&&c.expected<400&&patAllowed.has(c.operation)).length,publicProtocolPreflightCells:result.cells.filter((c:any)=>c.operation==='OPTIONS /api/v1/mcp'&&c.expected===204).length,publicCookieExemptions:result.publicExemptions.length,additionalCookieOperations:Object.keys(targetReads).length,failures:result.cells.filter((c:any)=>c.expected!==c.actual||c.expected>=400&&(c.hasData||c.effectTables.length)).length};
  t.diagnostic(JSON.stringify(result.totals));
});
