import type pg from 'pg';

/** Keep result counts/card IDs, never a second recoverable copy of imported card content. */
export async function redactImportRows(client: pg.ClientBase, filter: {
  importId?: string;
  cardId?: string;
}): Promise<void> {
  if (!filter.importId && !filter.cardId) throw new Error('An import or card scope is required for redaction.');
  await client.query(`UPDATE card_import_rows SET title='', description=NULL, assignee_emails=NULL,
       assignee_ids=NULL, status=NULL, source_status=NULL, target_column_id=NULL,
       priority=NULL, due_date=NULL, errors=NULL, row_hash=NULL, external_id=''
     WHERE ${filter.importId ? 'import_id=$1' : 'card_id=$1'}`, [filter.importId ?? filter.cardId]);
}

/** Claim only terminal/due previews. Row locks serialize cleanup against confirmation/cancel. */
export async function cleanupExpiredImports(pool: pg.Pool, options: {
  batchSize?: number;
  asOfDate?: Date;
} = {}): Promise<{
  cleanedCount: number;
}> {
  const client = await pool.connect();
  const limit = Math.max(1, Math.min(options.batchSize ?? 25, 100));
  const now = (options.asOfDate ?? new Date()).toISOString();
  try {
    await client.query('BEGIN');
    const due = await client.query<{
      id: string;
    }>(`SELECT id FROM card_imports WHERE content_cleaned_at IS NULL AND (
         (state IN ('uploaded','validating','ready','invalid') AND expires_at <= $1)
         OR (state IN ('committed','failed','cancelled','expired') AND cleanup_after <= $1))
       ORDER BY COALESCE(cleanup_after,expires_at),id LIMIT $2 FOR UPDATE SKIP LOCKED`, [now, limit]);
    for (const row of due.rows) {
      await redactImportRows(client, {
        importId: row.id
      });
      await client.query(`UPDATE card_imports SET
        state=CASE WHEN state IN ('uploaded','validating','ready','invalid') THEN 'expired' ELSE state END,
        preview_digest=NULL, content_cleaned_at=$2, cleanup_after=NULL, updated_at=$2 WHERE id=$1`, [row.id, now]);
    }
    await client.query('COMMIT');
    return {
      cleanedCount: due.rows.length
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
