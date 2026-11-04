/** Build-time wire bindings; protocol payloads remain distinct from the browser API. */
import { z } from 'zod';
import type { SchemaBinding } from './schemas.ts';

const callback = z.literal('https://claude.ai/api/mcp/auth_callback');
const text = (max: number) => z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/);
const url = z.string().url();
const scope = text(256);
const scopes = z.array(z.enum(['projects:read','boards:read','cards:read','cards:create']));
const rpcId = z.union([z.string(), z.number()]);
const bindings: Record<string, SchemaBinding> = {};
function bind(name: string, schema: z.ZodType, source: string, notes?: string) {
  bindings[name] = {schema, io: /Input|Query/.test(name) ? 'input' : 'output', source, ...(notes ? {notes} : {})};
}
const oauth = 'apps/api/src/http/routes/hosted-oauth.ts';
const mcp = 'apps/api/src/services/hosted-mcp-transport.ts; apps/api/src/http/routes/hosted-mcp.ts';
const app = 'apps/api/src/http/app.ts';
bind('HostedOAuthAuthorizeQuery', z.object({client_id:text(2048),redirect_uri:callback,resource:url,response_type:z.literal('code'),code_challenge_method:z.literal('S256'),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),scope:scope.optional(),state:text(1024).optional()}), oauth,
  'Resource must equal configured APP_ORIGIN plus /api/v1/mcp. Unknown scopes, response_mode and duplicate recognized fields are rejected by the mounted handler; total URL bound8192 bytes. GET creates a browser-bound pending request, never a grant.');
bind('HostedOAuthRegisterInput', z.object({redirect_uris:z.tuple([callback]),client_name:text(100).optional(),token_endpoint_auth_method:z.literal('none').optional(),response_types:z.tuple([z.literal('code')]).optional(),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).min(1).max(2).optional()}), oauth,
  'If grant_types is supplied it must include authorization_code. Public registration is unverified self-asserted metadata, not proof of Anthropic identity.');
bind('HostedOAuthRegisterResponse', z.object({client_id:z.string(),client_id_issued_at:z.number().int(),client_name:z.string(),redirect_uris:z.tuple([callback]),token_endpoint_auth_method:z.literal('none'),grant_types:z.tuple([z.literal('authorization_code'),z.literal('refresh_token')]),response_types:z.tuple([z.literal('code')])}).strict(), oauth);
const tokenCommon = {client_id:text(2048),resource:url};
bind('HostedOAuthTokenInput', z.discriminatedUnion('grant_type', [
  z.object({...tokenCommon,grant_type:z.literal('authorization_code'),code:text(128),redirect_uri:callback,code_verifier:text(128)}),
  z.object({...tokenCommon,grant_type:z.literal('refresh_token'),refresh_token:text(128),scope:scope.optional()}),
]), oauth, 'Form-urlencoded public client exchange. No client_secret accepted. Handler rejects duplicate recognized fields and checks exact resource, callback, client, PKCE and live grant binding. Scope narrowing is validated at runtime.');
bind('HostedOAuthRevokeInput', z.object({token:text(256),client_id:text(2048)}), oauth, 'Unknown tokens and wrong-client tokens do not disclose existence. token_type_hint is ignored.');
bind('HostedOAuthTokenResponse', z.object({access_token:z.string().regex(/^flw_mcp_access_[a-f0-9]{64}$/),token_type:z.literal('Bearer'),expires_in:z.number().int().min(1).max(900),refresh_token:z.string().regex(/^flw_mcp_refresh_[a-f0-9]{64}$/).optional(),scope:z.string()}).strict(), 'apps/api/src/adapters/hosted-oauth.ts:issueTokens', 'Unwrapped OAuth response. Access lifetime may be shorter near the absolute connection expiry; refresh credential appears only with offline consent.');
bind('HostedOAuthError', z.object({error:z.string().min(1)}).strict(), oauth, 'Unwrapped OAuth error, including consent/session errors raised as HostedOAuthError. Global failures can retain the separately documented API/Worker error shapes.');
bind('HostedMcpAuthorizationQuery', z.object({projectCursor:text(4096).optional()}), oauth);
bind('HostedMcpResourceMetadata', z.object({resource:url,resource_name:z.literal('Flowboard'),authorization_servers:z.tuple([url]),bearer_methods_supported:z.tuple([z.literal('header')]),scopes_supported:scopes}).strict(), app, 'Issuer and resource come only from validated APP_ORIGIN, never request Host or forwarded headers.');
bind('HostedOAuthServerMetadata', z.object({issuer:url,authorization_endpoint:url,token_endpoint:url,registration_endpoint:url,revocation_endpoint:url,response_types_supported:z.tuple([z.literal('code')]),grant_types_supported:z.tuple([z.literal('authorization_code'),z.literal('refresh_token')]),token_endpoint_auth_methods_supported:z.tuple([z.literal('none')]),code_challenge_methods_supported:z.tuple([z.literal('S256')]),authorization_response_iss_parameter_supported:z.literal(true),client_id_metadata_document_supported:z.literal(true),scopes_supported:z.array(z.enum(['projects:read','boards:read','cards:read','cards:create','offline_access']))}).strict(), app);
bind('HostedMcpMessageInput', z.object({jsonrpc:z.literal('2.0'),id:rpcId.optional(),method:z.string(),params:z.unknown().optional()}).passthrough(), mcp,
  'One JSON-RPC request or notification; no batches, max128KiB and depth32. Method-specific params are intentionally unknown here and validated by the installed MCP SDK and tool contracts; this is not an unrestricted fallback for a missing schema. SDK accepts supported protocol versions including2025-11-25.');
const rpcError = z.object({jsonrpc:z.literal('2.0'),id:rpcId.nullable(),error:z.object({code:z.number().int(),message:z.string(),data:z.unknown().optional()}).passthrough()}).passthrough();
bind('HostedMcpError', rpcError, mcp);
bind('HostedMcpResponse', z.union([z.object({jsonrpc:z.literal('2.0'),id:rpcId,result:z.unknown()}).passthrough(),rpcError]), mcp,
  'Unwrapped JSON-RPC result/error. Method-specific result and error data are intentionally unknown and governed by installed SDK/tool schemas. Notifications receive empty202; persistent SSE and sessions are not supported.');
export const HOSTED_MCP_OPENAPI_SCHEMAS = bindings;
