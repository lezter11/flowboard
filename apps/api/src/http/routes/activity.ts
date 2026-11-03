import { Hono } from 'hono';
import { activityFeedQuerySchema, projectActivityQuerySchema, cardActivityQuerySchema, parseOrThrow } from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import {
  listCardActivity,
  listProjectActivity,
  listWorkspaceActivity,
} from '../../adapters/activity.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const activityRoutes = new Hono();

// Health check
activityRoutes.get('/activity/health', (c) => c.json({ data: { status: 'ok' } }));

// 1. GET /cards/:cardId/activity: Chronological event timeline for card (AUD-01, AUD-02)
activityRoutes.get('/cards/:cardId/activity', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const { limit, cursor } = parseOrThrow(cardActivityQuerySchema, c.req.query());

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
  const options = parseOrThrow(projectActivityQuerySchema, c.req.query());
  const pool = getPool();
  const result = await listProjectActivity(pool, projectId, actor.id, options);

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
  const options = parseOrThrow(activityFeedQuerySchema, c.req.query());
  const pool = getPool();
  const result = await listWorkspaceActivity(pool, workspaceId, actor.id, options);

  return c.json({
    data: result.data,
    nextCursor: result.nextCursor,
  });
});
