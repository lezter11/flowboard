const base = 'https://flowboard-app-uat.pages.dev';
const paths = [
  '/', '/signin', '/project?id=audit-guessed',
  '/api/v1/session', '/api/v1/projects', '/api/v1/workspaces',
  '/api/v1/boards/audit-guessed', '/api/v1/cards/audit-guessed',
  '/api/v1/cards/audit-guessed/images', '/api/v1/images/audit-guessed/content',
  '/api/v1/image-uploads/audit-guessed/content', '/api/v1/notifications',
];
const results = [];
for (const path of paths) {
  const response = await fetch(`${base}${path}`, { method:'GET', redirect:'manual', signal:AbortSignal.timeout(10_000) });
  const body = await response.arrayBuffer();
  results.push({ path, status:response.status, bytes:body.byteLength,
    location:response.headers.get('location'), cacheControl:response.headers.get('cache-control'),
    csp:Boolean(response.headers.get('content-security-policy')),
    nosniff:response.headers.get('x-content-type-options'),
    xFrameOptions:response.headers.get('x-frame-options'),
    requestId:response.headers.get('x-request-id'),
    setCookieCount:response.headers.getSetCookie().length,
  });
}
console.log(JSON.stringify({ host:base, sentAuthentication:false, requestCount:results.length, results }));
