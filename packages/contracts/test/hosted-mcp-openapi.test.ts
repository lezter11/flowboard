import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { generateOpenApiDocument } from '../../../scripts/generate-openapi.ts';
import { OPENAPI_ROUTES } from '../src/openapi/index.ts';
import { OPENAPI_SCHEMAS } from '../src/openapi/schemas.ts';

const document = generateOpenApiDocument();
const operation = (path: string, method: string): any => document.paths[path]?.[method];
const valid = (name: string, value: unknown) => z.fromJSONSchema(document.components.schemas[name]!).safeParse(value).success;

test('hosted operation inventory adds discovery, OAuth, consent, connections and explicit transport methods', () => {
  assert.equal(OPENAPI_ROUTES.length, 118);
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp', '/.well-known/oauth-authorization-server']) {
    assert.deepEqual(operation(path, 'get').security, []);
  }
  for (const method of ['post', 'get', 'delete', 'options']) assert.ok(operation('/api/v1/mcp', method));
  assert.ok(operation('/api/v1/mcp/authorization-requests/{requestId}', 'get'));
  assert.ok(operation('/api/v1/mcp/authorization-requests/{requestId}/decision', 'post'));
  assert.ok(operation('/api/v1/mcp/connections', 'get'));
  assert.ok(operation('/api/v1/mcp/connections/{connectionId}', 'delete'));
});

test('OAuth bearer authorizes only MCP; six existing PAT capabilities remain unchanged', () => {
  const oauthRoutes = OPENAPI_ROUTES.filter(route => route.auth === 'oauth-mcp');
  assert.deepEqual(oauthRoutes.map(route => route.method).sort(), ['DELETE', 'GET', 'POST']);
  for (const route of oauthRoutes) assert.equal(route.path, '/mcp');
  assert.equal(OPENAPI_ROUTES.filter(route => route.auth === 'session-or-token').length, 6);
  assert.deepEqual(operation('/api/v1/mcp', 'post').security, [{oauthMcpBearer: []}]);
  assert.deepEqual(operation('/api/v1/projects', 'get').security, [{sessionCookie: []}, {personalAccessToken: []}]);
  assert.deepEqual(operation('/api/v1/mcp/connections', 'get').security, [{sessionCookie: []}]);
});

test('OAuth token and revoke use bounded forms and unwrapped standard responses', () => {
  const token = operation('/api/v1/mcp/oauth/token', 'post');
  assert.ok(token.requestBody.content['application/x-www-form-urlencoded']);
  assert.equal(token.requestBody.content['application/json'], undefined);
  assert.equal(token['x-max-request-bytes'], 16384);
  assert.deepEqual(token.responses['200'].content['application/json'].schema, {$ref: '#/components/schemas/HostedOAuthTokenResponse'});
  assert.deepEqual(token.responses.default.content['application/json'].schema.anyOf[0], {$ref: '#/components/schemas/HostedOAuthError'});
  const revoke = operation('/api/v1/mcp/oauth/revoke', 'post');
  assert.ok(revoke.requestBody.content['application/x-www-form-urlencoded']);
  assert.equal(revoke.responses['200'].content, undefined);
  assert.ok(operation('/api/v1/mcp/oauth/register', 'post').requestBody.content['application/json']);
  assert.ok(operation('/api/v1/mcp/oauth/authorize', 'get').parameters.some((p: any) => p.name === 'code_challenge_method' && p.schema.const === 'S256'));
});

test('MCP documents JSON-RPC, notification acceptance, authentication challenge and authenticated 405', () => {
  const post = operation('/api/v1/mcp', 'post');
  assert.equal(post['x-max-request-bytes'], 131072);
  assert.ok(post.responses['202']);
  assert.ok(post.responses['401'].headers['WWW-Authenticate']);
  for (const method of ['get', 'delete']) {
    const item = operation('/api/v1/mcp', method);
    assert.ok(item.responses['401'].headers['WWW-Authenticate']);
    assert.ok(item.responses['405'].headers.Allow);
    assert.equal(item.responses['200'], undefined);
  }
  assert.equal(valid('HostedMcpMessageInput', {jsonrpc:'2.0',id:1,method:'tools/list',params:{}}), true);
  assert.equal(valid('HostedMcpMessageInput', {data:{jsonrpc:'2.0',method:'tools/list'}}), false);
  assert.equal(valid('HostedMcpResponse', {jsonrpc:'2.0',id:1,result:{tools:[]}}), true);
  assert.equal(valid('HostedMcpResponse', {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}}), true);
  assert.equal(valid('HostedMcpResponse', {data:{tools:[]}}), false);
});

test('hosted wire schemas preserve safe shared contracts and exact callback/resource validation notes', () => {
  assert.equal(valid('HostedOAuthTokenResponse', {access_token:'flw_mcp_access_'+'a'.repeat(64),token_type:'Bearer',expires_in:900,scope:'cards:read'}), true);
  assert.equal(valid('HostedOAuthTokenResponse', {data:{access_token:'secret'}}), false);
  assert.equal(valid('HostedOAuthRegisterInput', {redirect_uris:['https://attacker.invalid/callback']}), false);
  assert.equal(OPENAPI_SCHEMAS.HostedMcpDecisionInput!.schema.safeParse({decision:'allow',csrfToken:'a'.repeat(24)}).success, false);
  assert.equal(valid('HostedMcpConnectionsResponse', {data:[],access_token:'secret'}), false);
  assert.match(String(document.components.schemas.HostedMcpMessageInput!.description), /SDK/);
});
