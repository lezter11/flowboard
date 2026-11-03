'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/lib/guarded-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/session';
import { useMemoryValue, useMemoryCommand, useMemoryDirty } from '@/lib/use-memory-draft';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';
import { ErrorNote } from '@/components/ui/error-note';
import { QuotaPanel } from '@/components/ui/quota-panel';
import { quotaAdvice, type QuotaAdvice } from '@/lib/quota-messages';
import type { Role } from '@/lib/roles';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

/**
 * Create a board in a project (Owner and Manager). POST /projects/:pid/boards gives it the five default columns.
 * One Idempotency-Key per attempt: a retry after a lost response replays the same board instead of making a second one;
 * editing the form starts a new attempt. On success the user lands on the new board.
 */
export function NewBoardDialog({ projectId, role, open, onClose, readOnly = false }: { readOnly?: boolean; projectId: string; role: Role; open: boolean; onClose: () => void }) {
  const canCreate = !readOnly && (role === 'owner' || role === 'manager');
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const {state}=useSession();const actorId=state.status==='ready'?state.session.actor.id:'';
  const scope=['create-board',actorId,projectId];
  const [name,setName]=useMemoryValue([...scope,'name'],'');const [description,setDescription]=useMemoryValue([...scope,'description'],'');
  const command=useMemoryCommand<{name:string;description?:string}>([...scope,'command']);
  const clearDirty=useMemoryDirty([...scope,'dirty'],!!name||!!description||command.unresolved());
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<QuotaAdvice | null>(null);


  useEffect(()=>{if(open){setError('');setFailure(null);setAdvice(null);}},[open]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !canCreate || !actorId) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a board name.'); return; }
    if (trimmed.length > NAME_MAX) { setError(`Board names can be up to ${NAME_MAX} characters.`); return; }
    setBusy(true);
    setError(''); setFailure(null);
    try {
      const body: { name: string; description?: string } = { name: trimmed };
      if (description.trim()) body.description = description.trim();
      const created = await command.run(body,(original,key)=>api.createBoard(projectId,original,key));
      await queryClient.invalidateQueries({ queryKey: ['boards', projectId] });
      toast('Board created', { icon: 'check' });
      setName('');setDescription('');clearDirty();onClose();
      router.push(`/board?id=${encodeURIComponent(created.data.id)}`);
    } catch (err) {

      // At the board limit: explain calmly. A Manager gets no number (the server sends none), the Owner gets the way out.
      const quota = err instanceof ApiError ? quotaAdvice(err, { role, projectId }) : null;
      if (quota) { setAdvice(quota); void queryClient.invalidateQueries({ queryKey: ['boards', projectId] }); }
      else setFailure(err);
    } finally { setBusy(false); }
  };

  const edit = <T,>(set: (value: T) => void) => (value: T) => { setError(''); setFailure(null); setAdvice(null); set(value); };

  return (
    <DialogLayer open={open} onClose={onClose} labelledBy="newBoardTitle" className="wide">
      <div className="dialog-head">
        <div className="dialog-head-copy"><h2 id="newBoardTitle">New board</h2><p>Boards keep their own columns, cards and access inside this project. It starts with five columns.</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close new board dialog"><Icon name="x" /></button>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          <div className="dialog-field">
            <label htmlFor="newBoardName">Board name</label>
            <input className="control" id="newBoardName" type="text" maxLength={NAME_MAX} autoComplete="off" placeholder="e.g. Marketing" data-autofocus required readOnly={!actorId||!canCreate || busy || command.unresolved()} aria-invalid={error ? true : undefined} aria-describedby={error ? 'newBoardError' : undefined} value={name} onChange={(event) => edit(setName)(event.target.value)} />
          </div>
          <div className="dialog-field">
            <label htmlFor="newBoardDescription">Description <span className="field-optional">(optional)</span></label>
            <textarea className="control textarea" id="newBoardDescription" rows={3} maxLength={DESCRIPTION_MAX} readOnly={!actorId||!canCreate || busy || command.unresolved()} placeholder="What is this board for?" value={description} onChange={(event) => edit(setDescription)(event.target.value)} />
          </div>
          {!canCreate && <p className="hint" role="status">You cannot create a board in this project now. Your draft is kept.</p>}
          {advice && <QuotaPanel advice={advice} role="alert" onNavigate={onClose} />}
          {error && <ErrorNote text={error} />}
          <p className="field-help">Closing keeps this draft in this tab. {command.unresolved()?'The earlier request may have succeeded; retry its original request before editing.':''}</p>{failure != null && <ErrorNote error={failure} ctx={{ role, projectId }} focusOnMount onRetry={() => void submit()} />}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Close and keep draft</button><button className="btn" type="button" disabled={busy||command.unresolved()} onClick={()=>{setName('');setDescription('');clearDirty();onClose();}}>Discard draft</button>
          <button className="btn primary" type="submit" disabled={busy || !canCreate || !actorId}>{busy ? 'Creating…' : command.unresolved()?'Retry original board request':'Create board'}</button>
        </footer>
      </form>
    </DialogLayer>
  );
}
