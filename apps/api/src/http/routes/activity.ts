import { Hono } from 'hono';
import { getPool } from '../../adapters/postgres.ts';
import {
  listCardActivity,
  listProjectActivity,
  listWorkspaceActivity,
} from '../../adapters/activity.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const activityRoutes = new Hono();

function parseLimit(limitParam?: string): number {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

// Health check
activityRoutes.get('/activity/health', (c) => c.json({ data: { status: 'ok' } }));

// 1. GET /cards/:cardId/activity: Chronological event timeline for card (AUD-01, AUD-02)
activityRoutes.get('/cards/:cardId/activity', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const limit = parseLimit(c.req.query('limit'));
  const cursor = c.req.query('cursor') || undefined;

  const pool = getPool();
  const result = await listCardActivity(pool, cardId, actor.id, { limit, cursor });

  return c.json({
    data: result.data,
    nextCursor: result.nextCursor,
  });
});

// 2. GET /projects/:projectId/activity: Project-wide activity and access events (AUD-04)
activityRoutes.get('/projects/:projectId/activity', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const limit = parseLimit(c.req.query('limit'));
  const cursor = c.req.query('cursor') || undefined;
  const cardId = c.req.query('cardId') || undefined;
  const actorId = c.req.query('actorId') || undefined;
  const action = c.req.query('action') || undefined;
  const fromDate = c.req.query('fromDate') || undefined;
  const toDate = c.req.query('toDate') || undefined;

  const pool = getPool();
  const result = await listProjectActivity(pool, projectId, actor.id, {
    limit,
    cursor,
    cardId,
    actorId,
    action,
    fromDate,
    toDate,
  });

  return c.json({
    data: result.data,
    nextCursor: result.nextCursor,
  });
});

// 3. GET /workspaces/:workspaceId/activity: Owner cross-project activity feed (AUD-03)
activityRoutes.get('/workspaces/:workspaceId/activity', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const limit = parseLimit(c.req.query('limit'));
  const cursor = c.req.query('cursor') || undefined;
  const projectId = c.req.query('projectId') || undefined;
  const cardId = c.req.query('cardId') || undefined;
  const actorId = c.req.query('actorId') || undefined;
  const action = c.req.query('action') || undefined;
  const fromDate = c.req.query('fromDate') || undefined;
  const toDate = c.req.query('toDate') || undefined;

  const pool = getPool();
  const result = await listWorkspaceActivity(pool, workspaceId, actor.id, {
    limit,
    cursor,
    projectId,
    cardId,
    actorId,
    action,
    fromDate,
    toDate,
  });

  return c.json({
    data: result.data,
    nextCursor: result.nextCursor,
  });
});
