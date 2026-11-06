export interface PagesApiEnv {
  API?: { fetch(request: Request): Promise<Response> };
  API_ORIGIN?: string;
}

export const OAUTH_METADATA_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/v1/mcp',
]);

/** A service binding keeps Request.url on the canonical public origin. No forwarded-host trust. */
export async function proxyApiRequest(request: Request, env: PagesApiEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const protocol = pathname === '/api/v1/mcp' || pathname.startsWith('/api/v1/mcp/') || OAUTH_METADATA_PATHS.has(pathname);
  let upstream: Response;
  if (env.API) {
    upstream = await env.API.fetch(new Request(request, { redirect: 'manual' }));
  } else if (env.API_ORIGIN && !protocol) {
    const target = new URL(request.url);
    const origin = new URL(env.API_ORIGIN);
    target.protocol = origin.protocol;
    target.host = origin.host;
    upstream = await fetch(new Request(target.toString(), new Request(request, { redirect: 'manual' })));
  } else {
    return Response.json({ error: { code: 'CONFIG_ERROR', message: 'API service binding is not configured.' } },
      { status: protocol ? 503 : 500, headers: { 'Cache-Control': 'no-store' } });
  }
  const response = new Response(upstream.body, upstream);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
