'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';
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
export function NewBoardDialog({ projectId, role, open, onClose }: { projectId: string; role: Role; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<QuotaAdvice | null>(null);
  const attempt = useRef<string | null>(null);

  useEffect(() => { if (open) { setName(''); setDescription(''); setError(''); setAdvice(null); attempt.current = null; } }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a board name.'); return; }
    if (trimmed.length > NAME_MAX) { setError(`Board names can be up to ${NAME_MAX} characters.`); return; }
    setBusy(true);
    setError('');
    attempt.current ??= `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const body: { name: string; description?: string } = { name: trimmed };
      if (description.trim()) body.description = description.trim();
      const created = await api.createBoard(projectId, body, attempt.current);
      await queryClient.invalidateQueries({ queryKey: ['boards', projectId] });
      toast('Board created', { icon: 'check' });
      onClose();
      router.push(`/board?id=${encodeURIComponent(created.data.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) attempt.current = null;
      // At the board limit: explain calmly. A Manager gets no number (the server sends none), the Owner gets the way out.
      const quota = err instanceof ApiError ? quotaAdvice(err, { role, projectId }) : null;
      if (quota) { setAdvice(quota); void queryClient.invalidateQueries({ queryKey: ['boards', projectId] }); }
      else setError(err instanceof ApiError && err.status === 409 && err.code !== 'READ_ONLY_CONTEXT' ? 'A board with that name already exists in this project. Pick another name.' : describeError(err, { role, projectId }));
    } finally { setBusy(false); }
  };

  const edit = <T,>(set: (value: T) => void) => (value: T) => { attempt.current = null; setError(''); setAdvice(null); set(value); };

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
            <input className="control" id="newBoardName" type="text" maxLength={NAME_MAX} autoComplete="off" placeholder="e.g. Marketing" data-autofocus required aria-invalid={error ? true : undefined} aria-describedby={error ? 'newBoardError' : undefined} value={name} onChange={(event) => edit(setName)(event.target.value)} />
          </div>
          <div className="dialog-field">
            <label htmlFor="newBoardDescription">Description <span className="field-optional">(optional)</span></label>
            <textarea className="control textarea" id="newBoardDescription" rows={3} maxLength={DESCRIPTION_MAX} placeholder="What is this board for?" value={description} onChange={(event) => edit(setDescription)(event.target.value)} />
          </div>
          {advice && <QuotaPanel advice={advice} role="alert" onNavigate={onClose} />}
          {error && <p className="form-error" id="newBoardError" role="alert">{error}</p>}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create board'}</button>
        </footer>
      </form>
    </DialogLayer>
  );
}
