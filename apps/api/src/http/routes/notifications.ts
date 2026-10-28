import { Hono } from 'hono';
import { getPool } from '../../adapters/postgres.ts';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../adapters/notifications.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const notificationsRoutes = new Hono();

function parseLimit(limitParam?: string): number {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

// Health check
notificationsRoutes.get('/notifications/health', (c) => c.json({ data: { status: 'ok' } }));

// 1. GET /notifications: Inbox list with pagination and unread filter (NTF-01, NTF-02)
notificationsRoutes.get('/notifications', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const limit = parseLimit(c.req.query('limit'));
  const cursor = c.req.query('cursor') || undefined;
  const unreadOnly = c.req.query('unreadOnly') === 'true';

  const pool = getPool();
  const result = await listNotifications(pool, actor.id, { limit, cursor, unreadOnly });

  return c.json({
    data: result.data,
    nextCursor: result.nextCursor,
  });
});

// 2. PATCH /notifications/:id/read: Mark individual notification read (NTF-02)
notificationsRoutes.patch('/notifications/:id/read', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const notificationId = c.req.param('id');
  const pool = getPool();
  const notification = await markNotificationRead(pool, notificationId, actor.id);

  return c.json({
    data: notification,
  });
});

// 3. POST /notifications/mark-all-read: Batch mark all unread notifications as read (NTF-02)
notificationsRoutes.post('/notifications/mark-all-read', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const pool = getPool();
  const result = await markAllNotificationsRead(pool, actor.id);

  return c.json({
    data: {
      success: true,
      count: result.count,
    },
  });
});

