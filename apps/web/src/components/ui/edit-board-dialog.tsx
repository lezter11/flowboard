'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Board } from '@flowboard/contracts';
import { useSession } from '@/lib/session';
import { memoryDrafts } from '@/lib/memory-drafts';
import { useMemoryValue, useMemoryRef, useMemoryDirty } from '@/lib/use-memory-draft';
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
export function EditBoardDialog({ board, open, onClose, readOnly = false }: { readOnly?: boolean; board: Pick<Board, 'id' | 'projectId' | 'name' | 'description' | 'snapshotVersion'>; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const {state}=useSession();const actorId=state.status==='ready'?state.session.actor.id:'';const scope=['edit-board',actorId,board.projectId,board.id];
  const [name,setName]=useMemoryValue([...scope,'name'],board.name);
  const [description,setDescription]=useMemoryValue([...scope,'description'],board.description??'');
  const [version,setVersion]=useMemoryValue([...scope,'version'],board.snapshotVersion);
  const [conflict,setConflict]=useMemoryValue([...scope,'conflict'],false);
  const baseline=useMemoryRef([...scope,'baseline'],()=>({name:board.name,description:board.description??'',version:board.snapshotVersion}));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const protection=memoryDrafts.protectFields(scope,{actorId,projectId:board.projectId,boardId:board.id},{name:{scope:[...scope,'name'],base:()=>baseline.current.name,empty:''},description:{scope:[...scope,'description'],base:()=>baseline.current.description,empty:''}},()=>{baseline.current={name:'',description:'',version:0};setVersion(0);setConflict(true);});
  useEffect(()=>{const restored=protection.restore({name:board.name,description:board.description??''});if(restored){baseline.current={name:board.name,description:board.description??'',version:board.snapshotVersion};setVersion(board.snapshotVersion);setConflict(restored.retained);return;}const prev=baseline.current;const dirty=name.trim()!==prev.name||description.trim()!==prev.description;if(!dirty||(name.trim()===board.name&&description.trim()===(board.description??''))){setName(board.name);setDescription(board.description??'');setVersion(board.snapshotVersion);setConflict(false);baseline.current={name:board.name,description:board.description??'',version:board.snapshotVersion};}else if(board.snapshotVersion!==version)setConflict(true);},[board.id,board.name,board.description,board.snapshotVersion]);

  const dirty = name.trim() !== board.name || description.trim() !== (board.description ?? '');
  const clearDirty=useMemoryDirty([...scope,'dirty'],dirty);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['board', board.id] }),
    queryClient.invalidateQueries({ queryKey: ['boards', board.projectId] }),
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || readOnly || !actorId || conflict || !dirty) return;
    if (!name.trim()) { setError('Enter a board name.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.updateBoard(board.id, {
        ...(name.trim() !== board.name ? { name: name.trim() } : {}),
        ...(description.trim() !== (board.description ?? '') ? { description: description.trim() || null } : {}),
        expectedVersion: version,
      });
      await refresh();
      toast('Board saved', { icon: 'check' });
      clearDirty();onClose();
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
            <input className="control" id="editBoardName" type="text" maxLength={100} autoComplete="off" data-autofocus required readOnly={readOnly || busy || !actorId} value={name} onChange={(event) => { setError(''); setName(event.target.value); }} />
          </div>
          <div className="dialog-field">
            <label htmlFor="editBoardDescription">Description <span className="field-optional">(optional)</span></label>
            <textarea className="control textarea" id="editBoardDescription" rows={3} maxLength={2000} readOnly={readOnly || busy || !actorId} value={description} onChange={(event) => { setError(''); setDescription(event.target.value); }} />
          </div>
          {readOnly && <p className="hint" role="status">This board is read-only. Your draft is kept until it can be edited again.</p>}
          {conflict&&<div className="note warn"><p>The board changed. Your values are kept. Current: {board.name} · {board.description??'No description'}</p><button className="btn sm" type="button" onClick={()=>{setVersion(board.snapshotVersion);setConflict(false);baseline.current={name:board.name,description:board.description??'',version:board.snapshotVersion};}}>Use latest version, keep my values</button></div>}<p className="field-help">Closing keeps this draft in this tab.</p>{error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Close and keep draft</button><button className="btn" type="button" disabled={busy} onClick={()=>{setName(board.name);setDescription(board.description??'');setVersion(board.snapshotVersion);setConflict(false);baseline.current={name:board.name,description:board.description??'',version:board.snapshotVersion};clearDirty();}}>Discard draft</button>
          <button className="btn primary" type="submit" disabled={busy || readOnly || !actorId || conflict || !dirty}>{busy ? 'Saving…' : 'Save board'}</button>
        </footer>
      </form>
    </DialogLayer>
  );
}
