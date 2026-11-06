// Same-origin API proxy for Cloudflare Pages (owned by Deployment).
// The browser calls /api/* on the Pages host; this Function forwards it to the
// Worker so the session cookie is first-party and SameSite=Lax keeps working.

import { proxyApiRequest, type PagesApiEnv } from '../../src/lib/pages-api-proxy.ts';

export const onRequest = (context: { request: Request; env: PagesApiEnv }): Promise<Response> =>
  proxyApiRequest(context.request, context.env);
