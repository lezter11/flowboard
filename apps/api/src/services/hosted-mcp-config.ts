import type { Context } from 'hono';
import { HttpError } from '../http/errors.ts';

export const HOSTED_MCP_PATH = '/api/v1/mcp';
export const HOSTED_OAUTH_PATH = `${HOSTED_MCP_PATH}/oauth`;
export const HOSTED_CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export interface HostedMcpConfig {
  origin: string;
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
}

/** Request host and forwarded headers deliberately never participate in issuer selection. */
export function getHostedMcpConfig(c: Context, originOverride?: string): HostedMcpConfig {
  const env = c.env as { APP_ORIGIN?: string } | undefined;
  const raw = originOverride ?? env?.APP_ORIGIN ?? process.env['APP_ORIGIN'];
  let url: URL;
  try { url = new URL(raw ?? ''); } catch { throw new HttpError(503,'CONFIG_ERROR','Hosted MCP public origin is not configured.'); }
  const isolatedLoopbackOverride=originOverride!==undefined && process.env['NODE_ENV']==='test'
    && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    && (url.protocol==='http:'||url.protocol==='https:');
  if ((!isolatedLoopbackOverride && (url.protocol !== 'https:' || url.port || ![url.origin,`${url.origin}/`].includes(raw!))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new HttpError(503,'CONFIG_ERROR','Hosted MCP public origin must be an HTTPS origin.');
  }
  const origin=url.origin;
  return {origin,issuer:origin,resource:`${origin}${HOSTED_MCP_PATH}`,authorizationEndpoint:`${origin}${HOSTED_OAUTH_PATH}/authorize`,tokenEndpoint:`${origin}${HOSTED_OAUTH_PATH}/token`,registrationEndpoint:`${origin}${HOSTED_OAUTH_PATH}/register`,revocationEndpoint:`${origin}${HOSTED_OAUTH_PATH}/revoke`};
}
