// Same-origin API proxy for Cloudflare Pages (owned by Deployment).
// The browser calls /api/* on the Pages host; this Function forwards it to the
// Worker so the session cookie is first-party and SameSite=Lax keeps working.

interface ApiFetcher {
  fetch(request: Request): Promise<Response>;
}

interface ProxyEnv {
  API?: ApiFetcher; // service binding to the Worker (preferred)
  API_ORIGIN?: string; // fallback: https origin of the Worker
}

export const onRequest = async (context: { request: Request; env: ProxyEnv }): Promise<Response> => {
  const { request, env } = context;

  // redirect: 'manual' hands Location headers (e.g. Google OAuth) to the browser
  // instead of following them inside the proxy.
  let upstream: Response;
  if (env.API) {
    // The request keeps its Pages URL, so the Worker derives the public host
    // (OAuth redirect URI, Secure cookies) from the origin the user sees.
    upstream = await env.API.fetch(new Request(request, { redirect: 'manual' }));
  } else if (env.API_ORIGIN) {
    const target = new URL(request.url);
    const origin = new URL(env.API_ORIGIN);
    target.protocol = origin.protocol;
    target.host = origin.host;
    upstream = await fetch(new Request(target.toString(), new Request(request, { redirect: 'manual' })));
  } else {
    return Response.json(
      { error: { code: 'CONFIG_ERROR', message: 'API service binding is not configured.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Rebuild so headers are mutable; Set-Cookie values are copied individually.
  const response = new Response(upstream.body, upstream);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};
