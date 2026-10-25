import { Hono } from 'hono';
import {
  parseOrThrow,
  updateProjectMemberInputSchema,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { updateProjectMember, removeProjectMember } from '../../adapters/members.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const membersRoutes = new Hono();

// PATCH /api/v1/projects/:projectId/members/:userId (mounted under /api/v1)
membersRoutes.patch('/projects/:projectId/members/:userId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

  const rawBody = await c.req.json();
  const body = parseOrThrow(updateProjectMemberInputSchema, rawBody);

  const pool = getPool();
  const membership = await updateProjectMember(
    pool,
    actor,
    projectId,
    userId,
    body.role,
    body.status,
    body.expectedVersion,
  );

  return c.json({ data: membership }, 200);
});

// DELETE /api/v1/projects/:projectId/members/:userId (mounted under /api/v1)
membersRoutes.delete('/projects/:projectId/members/:userId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

  const pool = getPool();
  await removeProjectMember(pool, actor, projectId, userId);

  return c.json({ data: { success: true } }, 200);
});
