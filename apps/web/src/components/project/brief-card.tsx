'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectLink } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { describeError, isStale } from '@/lib/errors';
import { isSafeHttpsUrl, LINKS_MAX } from '@/lib/links';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';

const BRIEF_MAX = 5000;
interface Draft { key: number; title: string; url: string }

/** The project brief and up to ten pinned https links. Everyone in the project reads it; Owner and Manager edit it. Links open in a new tab with rel="noopener noreferrer" and are never previewed or fetched. */
export function BriefCard({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const links: ProjectLink[] = project.links ?? [];
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBrief(project.brief ?? '');
    setDrafts(links.map((link, index) => ({ key: index, title: link.title, url: link.url })));
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setDraft = (key: number, patch: Partial<Draft>) => { setError(''); setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d))); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleaned = drafts.map((d) => ({ title: d.title.trim(), url: d.url.trim() }));
    const bad = cleaned.findIndex((d) => !d.title || !isSafeHttpsUrl(d.url));
    if (bad >= 0) { setError(`Link ${bad + 1}: enter a title and an https:// address without a username or password.`); return; }
    setBusy(true);
    setError('');
    try {
      await api.updateProject(project.id, { brief: brief.trim() || null, links: cleaned, expectedVersion: project.version });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project', project.id] }), queryClient.invalidateQueries({ queryKey: ['session'] })]);
      toast('Brief saved', { icon: 'check' });
      setOpen(false);
    } catch (err) {
      if (isStale(err)) { await queryClient.invalidateQueries({ queryKey: ['project', project.id] }); setError('Someone else changed this project. The latest brief is loaded; check it and save again.'); }
      else setError(describeError(err));
    } finally { setBusy(false); }
  };

  const hasContent = !!project.brief || links.length > 0;
  return (
    <section className="ov-brief" aria-labelledby="briefTitle">
      <div className="ov-head">
        <h2 id="briefTitle">Brief</h2>
        {canEdit && !project.isArchived && <button className="btn sm" type="button" onClick={() => setOpen(true)}><Icon name="edit" />{hasContent ? 'Edit brief' : 'Add a brief'}</button>}
      </div>
      {!hasContent && <p className="ov-none">{canEdit ? 'Add a short brief and pin up to 10 links (specs, designs, docs) for everyone on the project.' : 'No brief has been added yet.'}</p>}
      {project.brief && <p className="ov-brief-text">{project.brief}</p>}
      {links.length > 0 && (
        <ul className="ov-links" aria-label="Pinned links">
          {links.map((link) => {
            let host = '';
            try { host = new URL(link.url).hostname; } catch { /* the API only stores https URLs */ }
            return (
              <li key={link.id}>
                <a className="ov-link" href={link.url} target="_blank" rel="noopener noreferrer">
                  <Icon name="arrow-right" /><span className="ov-link-title">{link.title}</span><span className="ov-link-host">{host}</span><span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <DialogLayer open={open} onClose={() => setOpen(false)} labelledBy="briefDialogTitle" className="wide">
        <div className="dialog-head">
          <div className="dialog-head-copy"><h2 id="briefDialogTitle">Project brief</h2><p>A short summary and pinned links for everyone on the project. Links must start with https://.</p></div>
          <button className="dialog-close" type="button" onClick={() => setOpen(false)} aria-label="Close brief dialog"><Icon name="x" /></button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="dialog-body">
            <div className="dialog-field">
              <label htmlFor="briefText">Brief</label>
              <textarea className="control textarea" id="briefText" rows={5} maxLength={BRIEF_MAX} data-autofocus placeholder="What is this project about, and what does done look like?" value={brief} onChange={(event) => { setError(''); setBrief(event.target.value); }} />
            </div>
            <fieldset className="ov-link-edit">
              <legend>Pinned links <span className="field-optional">({drafts.length} of {LINKS_MAX})</span></legend>
              {drafts.map((d, index) => (
                <div className="ov-link-row" key={d.key}>
                  <input className="control" type="text" aria-label={`Link ${index + 1} title`} maxLength={100} placeholder="Title" value={d.title} onChange={(event) => setDraft(d.key, { title: event.target.value })} />
                  <input className="control" type="url" inputMode="url" aria-label={`Link ${index + 1} address`} maxLength={2000} placeholder="https://…" value={d.url} onChange={(event) => setDraft(d.key, { url: event.target.value })} />
                  <button className="icon-btn" type="button" aria-label={`Remove link ${index + 1}`} onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}><Icon name="x" /></button>
                </div>
              ))}
              <button className="btn sm" type="button" disabled={drafts.length >= LINKS_MAX} onClick={() => setDrafts((all) => [...all, { key: Math.max(-1, ...all.map((x) => x.key)) + 1, title: '', url: '' }])}><Icon name="plus" />Add link</button>
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <footer className="dialog-foot">
            <span className="spacer" />
            <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save brief'}</button>
          </footer>
        </form>
      </DialogLayer>
    </section>
  );
}
