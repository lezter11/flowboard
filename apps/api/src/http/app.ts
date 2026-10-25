import { Hono } from 'hono';

export function createApp(probeDatabase: () => Promise<void>) {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/health/live', (c) => c.json({ data: { status: 'ok' } }));
  app.get('/health/ready', async (c) => {
    try {
      await probeDatabase();
      return c.json({ data: { status: 'ready' } });
    } catch {
      return c.json({ error: {
        code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.',
        requestId: c.get('requestId'),
      } }, 503);
    }
  });
  app.notFound((c) => c.json({ error: {
    code: 'NOT_FOUND', message: 'Route not found.', requestId: c.get('requestId'),
  } }, 404));
  app.onError((_error, c) => c.json({ error: {
    code: 'INTERNAL_ERROR', message: 'Request failed.', requestId: c.get('requestId'),
  } }, 500));
  return app;
}
