'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { quotaAdvice, retryAfterSeconds, waitText, type QuotaAdvice } from '@/lib/quota-messages';
import { usageText, type ProjectUsage } from '@/lib/project-groups';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

/** Calm explanation with the way out: never a dead end, never a disabled button without a reason. */
function QuotaPanel({ advice, role, onNavigate }: { advice: QuotaAdvice; role: 'status' | 'alert'; onNavigate: () => void }) {
  return (
    <div className="quota-panel" role={role} id="projectQuota">
      <span className="quota-panel-icon" aria-hidden="true"><Icon name="folder" /></span>
      <div>
        <strong>{advice.title}</strong>
        <p>{advice.body}</p>
        <p className="quota-panel-links">
          {advice.action && <Link className="btn sm" href={advice.action.href} onClick={onNavigate}>{advice.action.label}</Link>}
          <Link className="btn ghost sm" href="/projects?tab=archived" onClick={onNavigate}>See archived projects</Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Create a project of your own (POST /api/v1/projects, no container named). The button that opens this is always visible;
 * at the limit it opens an explanation with the way out instead of the form. One Idempotency-Key per attempt: a retry after
 * a lost answer replays the same project; editing the form starts a new attempt. A refusal keeps what was typed.
 */
export function NewProjectDialog({ open, onClose, usage }: { open: boolean; onClose: () => void; usage: ProjectUsage | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [advice, setAdvice] = useState<QuotaAdvice | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<string | null>(null);

  useEffect(() => { if (open) { setName(''); setDescription(''); setError(''); setAdvice(null); attempt.current = null; } }, [open]);

  const atCap = !!usage?.atCap;
  const capAdvice: QuotaAdvice | null = atCap && usage
    ? { title: `You have ${usageText(usage)}`, body: `That is your limit of active projects. Archive a project to free a slot, then create another.`, action: { label: 'Choose a project to archive', href: '/projects' } }
    : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a project name.'); return; }
    if ([...trimmed].length > NAME_MAX) { setError(`Project names can be up to ${NAME_MAX} characters.`); return; }
    setBusy(true);
    setError('');
    attempt.current ??= `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const created = await api.createOwnProject({ name: trimmed, ...(description.trim() ? { description: description.trim() } : {}) }, attempt.current);
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast(`Project “${trimmed}” created`, { icon: 'check' });
      onClose();
      router.push(`/project?id=${encodeURIComponent(created.data.id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const quota = quotaAdvice(err);
        if (quota) { setAdvice(quota); void queryClient.invalidateQueries({ queryKey: ['session'] }); }
        else if (err.status === 429) setError(waitText(retryAfterSeconds(err), 'creating projects'));
        else setError(describeError(err));
        // A refusal is a final answer for this attempt; the next press is a new attempt.
        if (err.status >= 400 && err.status < 500 && err.status !== 0) attempt.current = null;
      } else setError(describeError(err));
    } finally { setBusy(false); }
  };

  const edit = <T,>(set: (value: T) => void) => (value: T) => { attempt.current = null; setError(''); set(value); };
  const showPanel = advice ?? capAdvice;

  return (
    <DialogLayer open={open} onClose={onClose} labelledBy="newProjectTitle" describedBy="newProjectHint" className="wide">
      <div className="dialog-head">
        <div className="dialog-head-copy"><h2 id="newProjectTitle">{showPanel && !advice ? 'You are at your project limit' : 'Create a project'}</h2><p id="newProjectHint">{usage && !atCap ? `${usageText(usage)} used. ` : ''}Creating a project does not create a board or invite people. Add boards from the project page.</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close create project dialog"><Icon name="x" /></button>
      </div>
      {showPanel && !advice ? (
        <>
          <div className="dialog-body"><QuotaPanel advice={showPanel} role="status" onNavigate={onClose} /></div>
          <footer className="dialog-foot"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Close</button></footer>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="dialog-body">
            <div className="dialog-field">
              <label htmlFor="newProjectName">Project name</label>
              <input className={`control${error && !name.trim() ? ' is-invalid' : ''}`} id="newProjectName" type="text" maxLength={NAME_MAX} autoComplete="off" placeholder="e.g. My Fashion" required data-autofocus value={name} onChange={(event) => edit(setName)(event.target.value)} aria-invalid={error && !name.trim() ? true : undefined} aria-describedby={error ? 'newProjectError' : undefined} />
            </div>
            <div className="dialog-field">
              <label htmlFor="newProjectDescription">Description <span className="field-optional">(optional)</span></label>
              <textarea className="control textarea" id="newProjectDescription" maxLength={DESCRIPTION_MAX} placeholder="What is this project for?" value={description} onChange={(event) => edit(setDescription)(event.target.value)} />
            </div>
            {advice && <QuotaPanel advice={advice} role="alert" onNavigate={onClose} />}
            {error && <p className="form-error" id="newProjectError" role="alert">{error}</p>}
          </div>
          <footer className="dialog-foot">
            <span className="spacer" />
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
          </footer>
        </form>
      )}
    </DialogLayer>
  );
}
