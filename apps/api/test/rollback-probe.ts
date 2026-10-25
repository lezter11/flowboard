import { sql } from 'kysely';
import type { HarnessDatabase } from '../src/adapters/postgres.ts';

export async function rollbackProbe(db: HarnessDatabase) {
  // Pin the whole probe to one session: temporary tables are session-local.
  return db.connection().execute(async (session) => {
    await sql`create temporary table flowboard_rollback_probe (marker text not null)
      on commit preserve rows`.execute(session);
    const count = async () => {
      const result = await sql<{ count: number }>`select count(*)::integer as count
        from pg_temp.flowboard_rollback_probe`.execute(session);
      return result.rows[0]!.count;
    };
    const injectedFailure = new Error('Intentional FND-01 rollback');
    let seenInside = 0;
    try {
      try {
        await session.transaction().execute(async (transaction) => {
          await sql`insert into pg_temp.flowboard_rollback_probe (marker)
            values (${'synthetic card move'})`.execute(transaction);
          const result = await sql<{ count: number }>`select count(*)::integer as count
            from pg_temp.flowboard_rollback_probe`.execute(transaction);
          seenInside = result.rows[0]!.count;
          throw injectedFailure;
        });
      } catch (error) {
        if (error !== injectedFailure) throw error;
      }
      const afterRollback = await count();
      // Positive control proves the zero count isn't caused by broken inserts.
      await session.transaction().execute(async (transaction) => {
        await sql`insert into pg_temp.flowboard_rollback_probe (marker)
          values (${'synthetic committed control'})`.execute(transaction);
      });
      const afterCommit = await count();
      if (seenInside !== 1 || afterRollback !== 0 || afterCommit !== 1) {
        throw new Error('Rollback/commit probe failed');
      }
      return { seenInside, afterRollback, afterCommit };
    } finally {
      await sql`drop table pg_temp.flowboard_rollback_probe`.execute(session);
    }
  });
}
