'use client';

import { useEffect, useRef, useState } from 'react';
import type { Board } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { createRetainedCommand } from '@/lib/retained-command';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ErrorNote } from '@/components/ui/error-note';
import { useToast } from '@/components/ui/toasts';

export function BoardLifecycleDialog({ board, open, onClose, onChanged, projectArchived }: { board: Board; open: boolean; onClose: () => void; onChanged: () => void; projectArchived: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const [archive, setArchive] = useState(!board.isArchived);
  const command = useRef(createRetainedCommand<{ boardId: string; archive: boolean; expectedVersion: number }>());
  const toast = useToast();
  useEffect(() => { if (open && !command.current.unresolved()) { setArchive(!board.isArchived); setError(null); } }, [open, board.isArchived]);
  const submit = async () => {
    if (busy || projectArchived) return;
    setBusy(true); setError(null);
    try {
      await command.current.run({ boardId: board.id, archive, expectedVersion: board.snapshotVersion }, (original, key) => api.changeBoardLifecycle(original.boardId, original.archive, original.expectedVersion, key));
      toast(archive ? 'Board archived. Its cards are read-only.' : 'Board reopened.', { icon: 'check' }); onChanged(); onClose();
    } catch (failure) { setError(failure); onChanged(); }
    finally { setBusy(false); }
  };
  return <DialogLayer open={open} onClose={() => { if (!busy) onClose(); }} labelledBy="boardLifecycleTitle" describedBy="boardLifecycleCopy" role="alertdialog">
    <header className="dialog-head"><h2 id="boardLifecycleTitle">{archive ? 'Archive' : 'Reopen'} “{board.name}”?</h2></header>
    <div className="dialog-body">
      <p id="boardLifecycleCopy">{archive ? 'This board becomes read-only. Cards, comments, images and history remain. Deleted cards keep their existing 24-hour restore deadline.' : 'People with current access can work on this board again. Deleted cards keep their existing restore deadline.'}</p>
      {projectArchived && <p role="status">Reopen the project before changing its boards.</p>}
      {command.current.unresolved() && !busy && <p role="status">The earlier request may have finished. Retry that original request to confirm its outcome.</p>}
      {error != null && <ErrorNote error={error} focusOnMount />}
    </div>
    <footer className="dialog-foot"><button className="btn" type="button" data-autofocus disabled={busy} onClick={onClose}>Cancel</button><button className={`btn ${archive ? 'danger' : 'primary'}`} type="button" disabled={busy || projectArchived} onClick={() => void submit()}>{busy ? 'Working…' : command.current.unresolved() ? 'Retry original request' : archive ? 'Archive board' : 'Reopen board'}</button></footer>
  </DialogLayer>;
}
