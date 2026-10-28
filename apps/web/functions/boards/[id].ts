// Legacy path-style board URL (/boards/<id>). See functions/projects/[id].ts.
export const onRequest = (context: { request: Request; params: { id: string } }): Response => {
  const target = new URL('/board', context.request.url);
  target.searchParams.set('id', context.params.id);
  return Response.redirect(target.toString(), 302);
};
