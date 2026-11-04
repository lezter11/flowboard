import { Hono, type Context } from 'hono';
import { hostedMcpAuthorizationViewSchema,hostedMcpDecisionInputSchema,hostedMcpDecisionResponseSchema,hostedMcpConnectionsResponseSchema } from '@flowboard/contracts';
import { getCookie,setCookie } from 'hono/cookie';
import { readHostedOAuthBody } from '../middleware/hosted-oauth-body.ts';
import { errorHandler } from '../middleware/error-handler.ts';
import { getPool } from '../../adapters/postgres.ts';
import { getSessionWithUser } from '../../adapters/session.ts';
import { consumeWindow } from '../../adapters/rate-limit-postgres.ts';
import { clientKey,UNKNOWN_CLIENT_KEY,WINDOW_BUCKETS,type WindowBucket } from '../../services/rate-limit.ts';
import { getHostedMcpConfig,HOSTED_CLAUDE_CALLBACK,HOSTED_MCP_PATH,HOSTED_OAUTH_PATH } from '../../services/hosted-mcp-config.ts';
import {
  HostedOAuthError,registerHostedClient,resolveHostedClient,parseHostedScopes,startHostedAuthorization,
  describeHostedAuthorization,decideHostedAuthorization,exchangeHostedCode,refreshHostedTokens,
  revokeHostedToken,listHostedConnections,disconnectHostedConnection,
} from '../../adapters/hosted-oauth.ts';

const BINDING_COOKIE='flowboard_mcp_authorization';
export interface HostedOAuthRouteOptions { publicOrigin?:string; }

async function enforceRate(c:Context,buckets:WindowBucket[],key=clientKey(c.req.raw.headers)){
  if(key===UNKNOWN_CLIENT_KEY&&process.env['NODE_ENV']==='test')return;
  for(const bucket of buckets){
    let counted;
    try{const config=WINDOW_BUCKETS[bucket];counted=await consumeWindow(getPool(c),bucket,key,config.windowSeconds);}
    catch{throw new HostedOAuthError('temporarily_unavailable',503);}
    if(counted.count>WINDOW_BUCKETS[bucket].limit){c.header('Retry-After',String(counted.retryAfterSeconds));throw new HostedOAuthError('temporarily_unavailable',429);}
  }
}
function object(value:unknown):Record<string,unknown>{if(!value||Array.isArray(value)||typeof value!=='object')throw new HostedOAuthError('invalid_request');return value as Record<string,unknown>;}
function bounded(value:unknown,max:number,required=true):string|undefined{
  if(value===undefined&&!required)return undefined;
  if(typeof value!=='string'||!value.length||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new HostedOAuthError('invalid_request');return value;
}
function one(params:URLSearchParams,name:string,max:number,required=true):string|undefined{
  if(params.getAll(name).length>1)throw new HostedOAuthError('invalid_request');
  return bounded(params.get(name)??undefined,max,required);
}
async function body(c:Context,kind:'json'|'form'):Promise<unknown>{
  const type=(c.req.header('content-type')??'').split(';')[0]!.trim().toLowerCase();
  if(type!==(kind==='json'?'application/json':'application/x-www-form-urlencoded'))throw new HostedOAuthError('invalid_request');
  const result=await readHostedOAuthBody(c.req.raw);
  if(kind==='form')return new URLSearchParams(result);
  try{return object(JSON.parse(result));}catch{throw new HostedOAuthError('invalid_request');}
}
async function session(c:Context){
  if(c.req.header('authorization')!==undefined)throw new HostedOAuthError('login_required',401);
  const raw=getCookie(c,'flowboard_session')??getCookie(c,'session');if(!raw)throw new HostedOAuthError('login_required',401);
  const value=await getSessionWithUser(raw,getPool(c));if(!value)throw new HostedOAuthError('login_required',401);return value;
}
function sameOrigin(c:Context,origin:string){if(c.req.header('origin')!==origin)throw new HostedOAuthError('access_denied',403);}
function forbidAuthorization(c:Context){if(c.req.header('authorization')!==undefined)throw new HostedOAuthError('invalid_client',401);}

/** Full application paths keep the public issuer and transport on one proxy origin. */
export function createHostedOAuthRoutes(options:HostedOAuthRouteOptions={}){
  const routes=new Hono<{Variables:{requestId:string}}>();
  routes.onError((error,c)=>{
    c.header('Cache-Control','no-store');
    if(error instanceof HostedOAuthError)return c.json({error:error.error},error.status);
    if(c.req.path.startsWith(HOSTED_OAUTH_PATH))return c.json({error:'server_error'},503);
    return errorHandler(error,c);
  });
  routes.use(`${HOSTED_MCP_PATH}/*`,async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('Pragma','no-cache');c.header('Referrer-Policy','no-referrer');
    // Top-level authorize navigations and server clients omit Origin. A declared
    // browser origin must be the explicit Flowboard public origin.
    if(c.req.path.startsWith(HOSTED_OAUTH_PATH)&&c.req.header('origin')!==undefined){sameOrigin(c,getHostedMcpConfig(c,options.publicOrigin).origin);}
    await next();
  });
  routes.post(`${HOSTED_OAUTH_PATH}/register`,async c=>{
    getHostedMcpConfig(c,options.publicOrigin);forbidAuthorization(c);
    await enforceRate(c,['mcp-oauth-register','mcp-oauth-register-hour']);
    const input=object(await body(c,'json'));
    const redirects=input['redirect_uris'];
    if(!Array.isArray(redirects)||redirects.length!==1||redirects[0]!==HOSTED_CLAUDE_CALLBACK||(input['token_endpoint_auth_method']!==undefined&&input['token_endpoint_auth_method']!=='none')||(input['response_types']!==undefined&&(!Array.isArray(input['response_types'])||input['response_types'].length!==1||input['response_types'][0]!=='code'))||(input['grant_types']!==undefined&&(!Array.isArray(input['grant_types'])||input['grant_types'].length>2||input['grant_types'].some(x=>x!=='authorization_code'&&x!=='refresh_token')||!input['grant_types'].includes('authorization_code'))))throw new HostedOAuthError('invalid_client_metadata');
    const name=input['client_name']===undefined?'Unverified registered client':bounded(input['client_name'],100)!;
    const clientId=await registerHostedClient(getPool(c),name,HOSTED_CLAUDE_CALLBACK);
    return c.json({client_id:clientId,client_id_issued_at:Math.floor(Date.now()/1000),client_name:name,redirect_uris:[HOSTED_CLAUDE_CALLBACK],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
  });
  routes.get(`${HOSTED_OAUTH_PATH}/authorize`,async c=>{
    const config=getHostedMcpConfig(c,options.publicOrigin);forbidAuthorization(c);await enforceRate(c,['mcp-oauth-authorize']);
    if(c.req.url.length>8192)throw new HostedOAuthError('invalid_request');
    const query=new URL(c.req.url).searchParams;
    const clientId=one(query,'client_id',2048)!,redirectUri=one(query,'redirect_uri',2048)!,resource=one(query,'resource',2048)!;
    if(one(query,'response_type',32)!=='code'||one(query,'code_challenge_method',16)!=='S256'||resource!==config.resource||one(query,'response_mode',32,false)!==undefined)throw new HostedOAuthError('invalid_request');
    const codeChallenge=one(query,'code_challenge',128)!;if(!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))throw new HostedOAuthError('invalid_request');
    const scopes=parseHostedScopes(one(query,'scope',256,false)),state=one(query,'state',1024,false)??null;
    const client=await resolveHostedClient(getPool(c),clientId);if(redirectUri!==HOSTED_CLAUDE_CALLBACK||redirectUri!==client.redirectUri)throw new HostedOAuthError('invalid_request');
    const pending=await startHostedAuthorization(getPool(c),{clientId,clientName:client.name,redirectUri,resource,scopes,state,codeChallenge});
    setCookie(c,BINDING_COOKIE,pending.browserBinding,{secure:config.origin.startsWith('https:'),httpOnly:true,sameSite:'Lax',path:'/',maxAge:600});
    return c.redirect(`${config.origin}/connect?request=${pending.requestId}`,302);
  });
  routes.get(`${HOSTED_MCP_PATH}/authorization-requests/:requestId`,async c=>{
    getHostedMcpConfig(c,options.publicOrigin);const actor=await session(c);
    const projectCursor=one(new URL(c.req.url).searchParams,'projectCursor',4096,false);
    const result=await describeHostedAuthorization(getPool(c),{requestId:c.req.param('requestId'),binding:getCookie(c,BINDING_COOKIE)??'',userId:actor.user.id,sessionHash:actor.session.id,...(projectCursor?{projectCursor}:{})});
    return c.json(hostedMcpAuthorizationViewSchema.parse({data:result}));
  });
  routes.post(`${HOSTED_MCP_PATH}/authorization-requests/:requestId/decision`,async c=>{
    const config=getHostedMcpConfig(c,options.publicOrigin);sameOrigin(c,config.origin);const actor=await session(c);
    await enforceRate(c,['mcp-oauth-consent']);await enforceRate(c,['mcp-oauth-consent-user'],actor.user.id);
    const parsed=hostedMcpDecisionInputSchema.safeParse(await body(c,'json'));if(!parsed.success)throw new HostedOAuthError('invalid_request');const input=parsed.data;
    const redirectUrl=await decideHostedAuthorization(getPool(c),{requestId:c.req.param('requestId'),binding:getCookie(c,BINDING_COOKIE)??'',userId:actor.user.id,sessionHash:actor.session.id,csrfToken:input.csrfToken,decision:input.decision,...(input.projectId?{projectId:input.projectId}:{}),issuer:config.issuer});
    return c.json(hostedMcpDecisionResponseSchema.parse({data:{redirectUrl}}));
  });
  routes.post(`${HOSTED_OAUTH_PATH}/token`,async c=>{
    const config=getHostedMcpConfig(c,options.publicOrigin);forbidAuthorization(c);await enforceRate(c,['mcp-oauth-token']);
    const input=await body(c,'form') as URLSearchParams;
    const grant=one(input,'grant_type',64)!,clientId=one(input,'client_id',2048)!,resource=one(input,'resource',2048)!;
    if(resource!==config.resource)throw new HostedOAuthError('invalid_target');
    if(input.has('client_secret'))throw new HostedOAuthError('invalid_client');
    let result;
    if(grant==='authorization_code')result=await exchangeHostedCode(getPool(c),{code:one(input,'code',128)!,clientId,redirectUri:one(input,'redirect_uri',2048)!,resource,verifier:one(input,'code_verifier',128)!});
    else if(grant==='refresh_token'){
      const requested=one(input,'scope',256,false);
      result=await refreshHostedTokens(getPool(c),{refreshToken:one(input,'refresh_token',128)!,clientId,resource,...(requested?{scopes:parseHostedScopes(requested)}:{})});
    }else throw new HostedOAuthError('unsupported_grant_type');
    if('error' in result)return c.json(result,400);return c.json(result);
  });
  routes.post(`${HOSTED_OAUTH_PATH}/revoke`,async c=>{
    getHostedMcpConfig(c,options.publicOrigin);forbidAuthorization(c);await enforceRate(c,['mcp-oauth-revoke']);const input=await body(c,'form') as URLSearchParams;
    await revokeHostedToken(getPool(c),one(input,'token',256)!,one(input,'client_id',2048)!);return c.body(null,200);
  });
  routes.get(`${HOSTED_MCP_PATH}/connections`,async c=>{getHostedMcpConfig(c,options.publicOrigin);const actor=await session(c);return c.json(hostedMcpConnectionsResponseSchema.parse({data:await listHostedConnections(getPool(c),actor.user.id)}));});
  routes.delete(`${HOSTED_MCP_PATH}/connections/:connectionId`,async c=>{const config=getHostedMcpConfig(c,options.publicOrigin);sameOrigin(c,config.origin);const actor=await session(c);await disconnectHostedConnection(getPool(c),actor.user.id,c.req.param('connectionId'));return c.body(null,204);});
  return routes;
}
