import type { MiddlewareHandler } from 'hono';

export const REQUEST_ID_HEADER = 'x-request-id';

// Valid request ID: ASCII printable non-whitespace characters, 8 to 64 chars
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{8,64}$/;

export function isValidRequestId(id: string | undefined): id is string {
  return typeof id === 'string' && REQUEST_ID_REGEX.test(id);
}

export const correlationMiddleware: MiddlewareHandler<{
  Variables: { requestId: string };
}> = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);
  await next();
  c.header(REQUEST_ID_HEADER, requestId);
};
