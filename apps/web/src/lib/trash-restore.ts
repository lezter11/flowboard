import type { TrashRow } from '@flowboard/contracts';

/** Whether the trash action can start; the server rechecks authority and versions on submission. */
export function canInitiateTrashRestore(row: Pick<TrashRow, 'canRestore' | 'blockedReason'>, remainingMs: number, projectArchived: boolean): boolean {
  const recoverable = row.canRestore || row.blockedReason === 'destination_missing';
  return recoverable && remainingMs > 0 && !projectArchived;
}
