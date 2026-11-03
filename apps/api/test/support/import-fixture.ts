import fs from 'node:fs';
import type pg from 'pg';
import { createCardImport, getImportTemplatePath } from '../../src/adapters/imports.ts';

/** Exercise a genuine parsed empty preview, rather than invent a ready state/digest. */
export async function createEmptyImport(pool: pg.Pool, boardId: string, defaultColumnId: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const preview = await createCardImport(client, {
      boardId, defaultColumnId, actorId, fileBuffer: fs.readFileSync(getImportTemplatePath()),
    });
    await client.query('COMMIT');
    return preview;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
