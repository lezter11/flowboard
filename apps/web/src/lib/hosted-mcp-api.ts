import {
  hostedMcpAuthorizationViewSchema, hostedMcpDecisionResponseSchema, hostedMcpConnectionsResponseSchema,
  type HostedMcpDecisionInput,
} from '@flowboard/contracts';
import { ApiError } from './api.ts';

const ROOT = '/api/v1/mcp';
const OAUTH_CODES: Record<string, string> = {
  login_required: 'MCP_LOGIN_REQUIRED', access_denied: 'MCP_ACCESS_DENIED',
  invalid_request: 'MCP_REQUEST_UNAVAILABLE', connection_limit_reached: 'MCP_CONNECTION_LIMIT',
};

async function request<T>(path: string, parse: (value: unknown) => T, options: RequestInit = {}, expectedStatus = 200): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    const retry = response.headers.get('retry-after');
    const retryAfter = retry && /^\d+$/.test(retry) ? Math.min(Number(retry), 3600) : null;
    if (response.ok && response.status !== expectedStatus) throw new ApiError(502, 'MCP_INVALID_RESPONSE', 'Unexpected connection status.');
    if (response.status === 204) return parse(undefined);
    let value: unknown;
    try { value = await response.json(); }
    catch (error) { if (controller.signal.aborted) throw error; value = null; }
    if (!response.ok) {
      const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const code = typeof body.error === 'string' ? OAUTH_CODES[body.error] : undefined;
      throw new ApiError(response.status,
        response.status === 429 ? 'RATE_LIMITED' : code ?? (response.status === 401 ? 'MCP_LOGIN_REQUIRED' : 'MCP_REQUEST_FAILED'),
        'Flowboard could not complete the connection request.', undefined, undefined, retryAfter);
    }
    try { return parse(value); }
    catch { throw new ApiError(502, 'MCP_INVALID_RESPONSE', 'Flowboard returned an unusable connection response.'); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Flowboard could not be reached.');
  } finally { clearTimeout(deadline); }
}

export const hostedMcpApi = {
  async authorization(requestId: string, projectCursor?: string) {
    const query = projectCursor ? `?${new URLSearchParams({ projectCursor })}` : '';
    return request(`${ROOT}/authorization-requests/${encodeURIComponent(requestId)}${query}`, value => hostedMcpAuthorizationViewSchema.parse(value).data);
  },
  async decide(requestId: string, input: HostedMcpDecisionInput) {
    return request(`${ROOT}/authorization-requests/${encodeURIComponent(requestId)}/decision`, value => hostedMcpDecisionResponseSchema.parse(value).data,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  },
  async connections() {
    return request(`${ROOT}/connections`, value => hostedMcpConnectionsResponseSchema.parse(value).data);
  },
  async disconnect(connectionId: string) {
    return request(`${ROOT}/connections/${encodeURIComponent(connectionId)}`, () => undefined, { method: 'DELETE' }, 204);
  },
  async connectorUrl() {
    return request('/.well-known/oauth-protected-resource/api/v1/mcp', value => {
      const resource = value && typeof value === 'object' && 'resource' in value ? value.resource : null;
      if (typeof resource !== 'string') throw new Error('Missing connector URL.');
      const url = new URL(resource);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== ROOT) throw new Error('Invalid connector URL.');
      return url.href;
    });
  },
};
