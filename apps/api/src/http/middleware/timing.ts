import type { MiddlewareHandler } from 'hono';

export const timingMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  try {
    await next();
  } finally {
    const elapsed = (performance.now() - start).toFixed(2);
    const metric = `app;dur=${elapsed}`;
    const existing = c.res.headers.get('Server-Timing');
    c.header('Server-Timing', existing ? `${existing}, ${metric}` : metric);
  }
};
