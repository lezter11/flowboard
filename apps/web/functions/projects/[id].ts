// Legacy path-style project URL (/projects/<id>). Static export cannot emit pages for
// arbitrary ids, so send old links to the query-string route. Pages _redirects cannot
// place a path placeholder into a query string (it would send the literal ":id"), so
// this is a Function, owned by Deployment.
export const onRequest = (context: { request: Request; params: { id: string } }): Response => {
  const target = new URL('/project', context.request.url);
  target.searchParams.set('id', context.params.id);
  return Response.redirect(target.toString(), 302);
};
