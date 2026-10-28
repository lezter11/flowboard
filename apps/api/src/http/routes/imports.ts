import fs from 'node:fs';
import { Hono } from 'hono';
import {
  idempotencyKeySchema,
  commitImportInputSchema,
  updateImportMappingsInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  getImportTemplatePath,
  createCardImport,
  getCardImportStatus,
  updateImportMappings,
  commitCardImport,
  cancelCardImport,
  getImportReport,
} from '../../adapters/imports.ts';
import { HttpError } from '../errors.ts';
import { lockBoardAccess } from '../../adapters/board-grants-foundation.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const importsRoutes = new Hono();

function requireIdempotencyKey(keyHeader: string | undefined): string {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  return keyHeader;
}

// 1. GET /import/template: Download official Excel template (IMP-01)
const handleDownloadTemplate = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const boardId = c.req.param('boardId');
  if (boardId) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await lockBoardAccess(client, boardId, actor.id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  const templatePath = getImportTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw HttpError.notFound('Import template file not found.', 'NOT_FOUND');
  }

  const fileBuffer = fs.readFileSync(templatePath);
  return new Response(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Flowboard_Card_Import_Template.xlsx"',
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'private, no-cache',
    },
  });
};

importsRoutes.get('/import/template', authMiddleware, handleDownloadTemplate);
importsRoutes.get('/boards/:boardId/card-import-template', authMiddleware, handleDownloadTemplate);
importsRoutes.get('/boards/:boardId/import-template', authMiddleware, handleDownloadTemplate);

// 2. POST /boards/:boardId/imports: Upload spreadsheet, validate and create preview (IMP-02, IMP-03, IMP-04, IMP-05)
const handleCreateImport = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const boardId = c.req.param('boardId');
  const contentType = c.req.header('content-type') ?? '';

  let fileBuffer: Buffer;
  let defaultColumnId: string | undefined;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.parseBody();
    const file = formData['file'];
    defaultColumnId = formData['defaultColumnId'] as string | undefined;

    if (!file) {
      throw HttpError.badRequest('Missing file in form data.', 'MISSING_FILE');
    }

    if (typeof file === 'object' && 'arrayBuffer' in file) {
      const arrayBuf = await (file as Blob).arrayBuffer();
      fileBuffer = Buffer.from(arrayBuf);
    } else if (Buffer.isBuffer(file)) {
      fileBuffer = file;
    } else {
      throw HttpError.badRequest('Invalid uploaded file format.', 'INVALID_FILE');
    }
  } else {
    // Binary octet stream or raw body
    const arrayBuf = await c.req.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuf);
    defaultColumnId = c.req.query('defaultColumnId') || c.req.header('x-default-column-id');
  }

  if (!defaultColumnId) {
    throw HttpError.badRequest('Default column ID is required.', 'MISSING_DEFAULT_COLUMN');
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const importStatus = await createCardImport(client, {
      boardId,
      fileBuffer,
      defaultColumnId,
      actorId: actor.id,
    });
    await client.query('COMMIT');
    return c.json({ data: importStatus }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

importsRoutes.post('/boards/:boardId/imports', authMiddleware, handleCreateImport);
importsRoutes.post('/boards/:boardId/card-imports', authMiddleware, handleCreateImport);

// 3. GET /imports/:importId: Inspect import status and preview rows (IMP-05)
const handleGetImport = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const importId = c.req.param('importId');
  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;
  const cursor = c.req.query('cursor') || undefined;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = await getCardImportStatus(client, importId, actor.id, { limit, cursor });
    await client.query('COMMIT');
    return c.json({ data: status }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

importsRoutes.get('/imports/:importId', authMiddleware, handleGetImport);
importsRoutes.get('/card-imports/:importId', authMiddleware, handleGetImport);

// 4. POST /imports/:importId/mappings: Update column status mappings
const handleUpdateMappings = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const importId = c.req.param('importId');
  const rawBody = await c.req.json();
  const input = parseOrThrow(updateImportMappingsInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const status = await updateImportMappings(client, importId, actor.id, input);
    await client.query('COMMIT');
    return c.json({ data: status }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

importsRoutes.post('/imports/:importId/mappings', authMiddleware, handleUpdateMappings);
importsRoutes.post('/card-imports/:importId/mappings', authMiddleware, handleUpdateMappings);

// 5. POST /imports/:importId/commit: Explicit atomic confirmation (IMP-06)
const handleCommitImport = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const importId = c.req.param('importId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(commitImportInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch import target metadata to verify idempotency scope
    const impRes = await client.query<{ project_id: string; board_id: string }>(
      'SELECT project_id, board_id FROM card_imports WHERE id = $1 FOR SHARE',
      [importId],
    );

    if (impRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
    }

    const impMeta = impRes.rows[0]!;
    const methodPath = `/api/v1/imports/${importId}/commit`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      impMeta.project_id,
      'manager',
      idempotencyKey,
      methodPath,
      rawBody,
      impMeta.board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await commitCardImport(client, importId, actor.id, input);
    const responsePayload = { data: result };

    await saveReceipt(
      client,
      actor.id,
      'project',
      impMeta.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responsePayload,
    );

    await client.query('COMMIT');
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

importsRoutes.post('/imports/:importId/commit', authMiddleware, handleCommitImport);
importsRoutes.post('/card-imports/:importId/commit', authMiddleware, handleCommitImport);

// 6. DELETE /imports/:importId: Cancel import preview (IMP-10)
const handleCancelImport = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const importId = c.req.param('importId');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cancelCardImport(client, importId, actor.id);
    await client.query('COMMIT');
    return c.json({ data: result }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

importsRoutes.delete('/imports/:importId', authMiddleware, handleCancelImport);
importsRoutes.delete('/card-imports/:importId', authMiddleware, handleCancelImport);

// 7. GET /imports/:importId/report: Download safe outcome report (IMP-09)
const handleGetReport = async (c: any) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const importId = c.req.param('importId');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const csvContent = await getImportReport(client, importId, actor.id);
    await client.query('COMMIT');
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="import-report-${importId}.csv"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

importsRoutes.get('/imports/:importId/report', authMiddleware, handleGetReport);
importsRoutes.get('/card-imports/:importId/report', authMiddleware, handleGetReport);
