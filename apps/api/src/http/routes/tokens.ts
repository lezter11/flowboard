import { Hono } from 'hono';
import {
  createTokenInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from '../../adapters/tokens.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const tokensRoutes = new Hono();

// 1. POST /api/v1/tokens: Mint new Personal Access Token (Session cookie required)
tokensRoutes.post('/api/v1/tokens', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  // Tokens cannot mint other tokens (least privilege)
  if (c.get('authType') === 'token') {
    throw HttpError.forbidden('Personal access tokens cannot create new tokens.');
  }

  const rawBody = await c.req.json();
  const input = parseOrThrow(createTokenInputSchema, rawBody);

  const pool = getPool();

  // If token is scoped to a project, verify actor has active membership in that project
  if (input.projectId) {
    const memRes = await pool.query<{ id: string }>(
      `SELECT id FROM project_memberships
       WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
      [input.projectId, actor.id],
    );
    if (memRes.rows.length === 0) {
      throw HttpError.forbidden('You do not have access to the specified project.');
    }
  }

  const result = await createPersonalAccessToken(pool, {
    userId: actor.id,
    name: input.name,
    scopes: input.scopes,
    projectId: input.projectId,
    expiresInDays: input.expiresInDays,
  });

  return c.json({ data: result }, 201);
});

// 2. GET /api/v1/tokens: List active Personal Access Tokens for current user
tokensRoutes.get('/api/v1/tokens', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const pool = getPool();
  const tokens = await listPersonalAccessTokens(pool, actor.id);
  return c.json({ data: tokens }, 200);
});

// 3. DELETE /api/v1/tokens/:tokenId: Revoke Personal Access Token
tokensRoutes.delete('/api/v1/tokens/:tokenId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const tokenId = c.req.param('tokenId');
  const pool = getPool();
  const revoked = await revokePersonalAccessToken(pool, tokenId, actor.id);

  if (!revoked) {
    throw HttpError.notFound('Token not found or already revoked.', 'NOT_FOUND');
  }

  return c.json({ data: { success: true } }, 200);
});
