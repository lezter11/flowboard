import { proxyApiRequest, type PagesApiEnv } from '../../../../../src/lib/pages-api-proxy.ts';
export const onRequest = (context: { request: Request; env: PagesApiEnv }) => proxyApiRequest(context.request, context.env);
