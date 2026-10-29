'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Board } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { describeError, isStale } from '@/lib/errors';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

/**
 * Rename a board or change its description. Project Owner only: callers render the trigger only for the Owner, and the
 * API answers 403 for anyone else. Saves with expectedVersion (the board's snapshotVersion); if someone else saved first the
 * latest board is reloaded, the dialog stays open and the user can review before saving again.
 */
export function EditBoardDialog({ board, open, onClose }: { board: Pick<Board, 'id' | 'projectId' | 'name' | 'description' | 'snapshotVersion'>; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setName(board.name); setDescription(board.description ?? ''); setError(''); } }, [open, board.id, board.name, board.description]);

  const dirty = name.trim() !== board.name || description.trim() !== (board.description ?? '');
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['board', board.id] }),
    queryClient.invalidateQueries({ queryKey: ['boards', board.projectId] }),
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !dirty) return;
    if (!name.trim()) { setError('Enter a board name.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.updateBoard(board.id, {
        ...(name.trim() !== board.name ? { name: name.trim() } : {}),
        ...(description.trim() !== (board.description ?? '') ? { description: description.trim() || null } : {}),
        expectedVersion: board.snapshotVersion,
      });
      await refresh();
      toast('Board saved', { icon: 'check' });
      onClose();
    } catch (err) {
      if (isStale(err)) { await refresh(); setError('Someone else changed this board. The latest version is loaded; check it and save again.'); }
      else setError(describeError(err));
    } finally { setBusy(false); }
  };

  return (
    <DialogLayer open={open} onClose={onClose} labelledBy="editBoardTitle" className="wide">
      <div className="dialog-head">
        <div className="dialog-head-copy"><h2 id="editBoardTitle">Edit board</h2><p>Only the project Owner can change a board's name or description.</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close edit board dialog"><Icon name="x" /></button>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          <div className="dialog-field">
            <label htmlFor="editBoardName">Board name</label>
            <input className="control" id="editBoardName" type="text" maxLength={100} autoComplete="off" data-autofocus required value={name} onChange={(event) => { setError(''); setName(event.target.value); }} />
          </div>
          <div className="dialog-field">
            <label htmlFor="editBoardDescription">Description <span className="field-optional">(optional)</span></label>
            <textarea className="control textarea" id="editBoardDescription" rows={3} maxLength={2000} value={description} onChange={(event) => { setError(''); setDescription(event.target.value); }} />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save board'}</button>
        </footer>
      </form>
    </DialogLayer>
  );
}
