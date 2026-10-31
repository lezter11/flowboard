'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Card } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { boardQueryOptions } from '@/lib/queries';
import { useAssignablePeople } from '@/lib/assignee-people';
import { EMPTY_ASSIGNEES, assignableList, canAddAssignee, pickerState } from '@/lib/assignees';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';

function AddCardScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { state } = useSession();
  const boardId = params.get('board');
  const board = useQuery(boardQueryOptions(boardId));
  const snapshot = board.data;
  const project = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === snapshot?.board.projectId) : undefined;
  const role = normalizeRole(project?.role);
  const columns = [...(snapshot?.columns ?? [])].sort((a, b) => a.position - b.position);
  // Candidates are the project's people, not the snapshot's (which lists only people already on cards, so a fresh board would offer nobody).
  const projectPeople = useAssignablePeople(snapshot?.board.projectId, true);
  const assignable = assignableList(projectPeople.data);
  const picker = pickerState(projectPeople, assignable);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(params.get('column') ?? '');
  const [priority, setPriority] = useState('');
  const [due, setDue] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ title?: string; priority?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Card | null>(null);
  const key = useState(() => crypto.randomUUID())[0];
  const dirty = !!(title || description || priority || due || assignees.length);
  const column = columns.find((c) => c.id === columnId) ?? columns[0];
  const backHref = boardId ? `/board?id=${encodeURIComponent(boardId)}` : '/projects';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Enter a title with 1 to 200 characters.';
    if (!priority) next.priority = 'Choose a priority before saving the card.';
    setErrors(next);
    if (next.title || next.priority || !snapshot || !column) return;
    setBusy(true);
    try {
      const res = await api.createCard(snapshot.board.id, {
        title: title.trim(), description: description.trim(), priority: priority as Card['priority'], columnId: column.id,
        dueDate: due || null, assigneeIds: assignees, expectedBoardVersion: snapshot.board.structureVersion,
      }, key);
      const created = await api.getCard(res.data.id);
      setSaved(created.data);
      void queryClient.invalidateQueries({ queryKey: ['board', boardId] });
    } catch (error) {
      setErrors({ form: describeError(error) });
    } finally { setBusy(false); }
  };

  if (!boardId) return <section className="state-note"><h1>Choose a board first</h1><p>Open a board and use Add card.</p><Link className="btn" href="/projects">Browse projects</Link></section>;
  if (board.isPending) return <div role="status" className="state-note">Loading board…</div>;
  if (board.isError || !snapshot) return <section role="alert" className="state-note"><h1>Board unavailable</h1><p>{describeError(board.error)}</p><Link className="btn" href="/projects">Back to projects</Link></section>;
  if (!can(role, 'edit') || snapshot.board.isArchived || project?.isArchived) {
    return <section className="state-note"><h1>You cannot create cards here</h1><p>Viewers, archived boards and archived projects are read-only.</p><Link className="btn" href={backHref}>Back to board</Link></section>;
  }

  return (
    <div id="addContent">
      <div className="page-head">
        <div className="page-head-copy">
          <p className="eyebrow">{project?.name} <span className="badge">{snapshot.board.name}</span></p>
          <h1>New card</h1>
          <p className="page-sub"><span>Create the card first, then attach images and comments</span><span className="dot" aria-hidden="true" /><span>Card ID exists before any attachment</span></p>
        </div>
        <div className="page-actions"><Link className="btn" href={backHref}><Icon name="arrow-left" />Back to board</Link></div>
      </div>
      <div className="review-bar">
        <Icon name="info" />
        <span><strong>Save-first contract.</strong> A title creates the card and returns a real card ID. Images and comments attach only after that ID exists.</span>
        <span className="spacer" />
      </div>
      <div className="steps" aria-label="Creation stages">
        <div className={`step${saved ? ' is-done' : ' is-active'}`}><span className="step-num">1</span><span className="step-copy"><strong>Card details</strong><span>Title, column and optional fields</span></span></div>
        <div className={`step${saved ? ' is-done' : ''}`}><span className="step-num">2</span><span className="step-copy"><strong>Save card</strong><span>Server returns the card ID</span></span></div>
        <div className={`step${saved ? ' is-active' : ''}`}><span className="step-num">3</span><span className="step-copy"><strong>Images and comments</strong><span>Attach to the saved card</span></span></div>
      </div>

      {saved ? (
        <section id="savedState">
          <div className="panel success-panel">
            <div className="success-head">
              <span className="success-icon"><Icon name="check" /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="eyebrow" style={{ marginBottom: 4 }}>Card saved {saved.key && <span className="badge accent">{saved.key}</span>}</p>
                <h2>{saved.title}</h2>
                <p>The card exists now. The server returned its ID, so images and comments can attach to a real record.</p>
                <div className="success-meta">
                  <span className="badge">{columns.find((c) => c.id === saved.columnId)?.name}</span>
                  <span className="badge">{saved.priority === 'none' ? 'No priority' : saved.priority}</span>
                  <span className="badge">{saved.dueDate ?? 'No due date'}</span>
                  <span className="badge">{saved.assigneeIds.length ? `${saved.assigneeIds.length} assigned` : 'Unassigned'}</span>
                </div>
              </div>
            </div>
            <div className="form-actions" style={{ padding: 14 }}>
              <Link className="btn primary" href={`/board?id=${encodeURIComponent(boardId)}&card=${encodeURIComponent(saved.id)}`}><Icon name="board" />Open card</Link>
              <Link className="btn" href={backHref}>Back to board</Link>
              <button className="btn ghost" type="button" onClick={() => router.refresh()} hidden>New card</button>
            </div>
            <div className="note" style={{ margin: 14 }}><Icon name="image" /><span>Add images and the first comment in the card drawer.</span></div>
          </div>
        </section>
      ) : (
        <form id="addCardForm" noValidate onSubmit={submit}>
          <div className="split-layout">
            <div className="stack">
              <section className="form-section" aria-labelledby="detailsTitle">
                <div className="form-section-head"><Icon name="file" /><div><h2 id="detailsTitle">Card details</h2><p>Only the title and priority are required. Everything else can be edited after saving.</p></div></div>
                <div className="form-grid">
                  <div className="field span-2">
                    <label className="field-label" htmlFor="cardTitle">Title <span className="required" aria-hidden="true">*</span></label>
                    <input className="control" id="cardTitle" type="text" maxLength={200} autoComplete="off" placeholder="What needs to be done?" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={errors.title ? true : undefined} />
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><p className="field-help">1–200 characters. Plain text; no HTML is rendered.</p><span className="char-count">{title.length} / 200</span></div>
                    <p className="form-error" role="alert" hidden={!errors.title}>{errors.title}</p>
                  </div>
                  <div className="field span-2">
                    <label className="field-label" htmlFor="cardDescription">Description <span className="faint">(optional)</span></label>
                    <textarea className="control textarea" id="cardDescription" maxLength={20000} placeholder="Add context, acceptance notes or a link to the brief." value={description} onChange={(event) => setDescription(event.target.value)} />
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><p className="field-help">Plain text, up to 20,000 characters.</p><span className="char-count">{description.length.toLocaleString()} / 20,000</span></div>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cardColumn">Column</label>
                    <select className="control" id="cardColumn" value={column?.id ?? ''} onChange={(event) => setColumnId(event.target.value)}>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    <p className="field-help">The card appears at the end of this column.</p>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="cardPriority">Priority (required)</label>
                    <select className="control" id="cardPriority" required value={priority} onChange={(event) => setPriority(event.target.value)} aria-describedby="priorityError">
                      <option value="">Choose priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                    </select>
                    <p className="form-error" id="priorityError" role="alert" hidden={!errors.priority}>{errors.priority}</p>
                  </div>
                  <div className="field span-2">
                    <label className="field-label" htmlFor="cardDue">Due date <span className="faint">(optional)</span></label>
                    <div className="date-row">
                      <input className="control" id="cardDue" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
                      <button className="icon-btn" type="button" aria-label="Clear due date" title="Clear due date" onClick={() => setDue('')}><Icon name="x" /></button>
                    </div>
                    <p className="field-help">A calendar date with no time or timezone.</p>
                  </div>
                </div>
              </section>
              <section className="form-section" aria-labelledby="assignTitle">
                <div className="form-section-head"><Icon name="users" /><div><h2 id="assignTitle">Assignees</h2><p>Only project people who can work on cards appear here. Viewers are never assignable.</p></div></div>
                <div className="check-list">
                  {picker === 'loading' && <p className="small muted" role="status">Loading people…</p>}
                  {picker === 'error' && <p className="small muted" role="alert">Could not load the project's people. <button className="btn sm" type="button" onClick={() => void projectPeople.refetch()}>Try again</button></p>}
                  {picker === 'empty' && <p className="small muted" role="status">{EMPTY_ASSIGNEES}</p>}
                  {assignable.map((person) => (
                    <label key={person.id} className="check-row">
                      <input type="checkbox" checked={assignees.includes(person.id)} disabled={!assignees.includes(person.id) && !canAddAssignee(assignees.length)} onChange={(event) => setAssignees((prev) => event.target.checked ? [...prev, person.id] : prev.filter((id) => id !== person.id))} />
                      <Avatar id={person.id} name={person.displayName} />
                      <span>{person.displayName}</span>
                      {person.scopedRole && <span className="role-mini">{ROLE_META[person.scopedRole].label}</span>}
                    </label>
                  ))}
                </div>
                <div className="selection-summary" style={{ marginTop: 8 }}>{assignees.length ? `${assignees.length} assigned` : 'Unassigned'}</div>
              </section>
              <div className="note"><Icon name="lock" /><span>Images and comments are added on the next step, after the card is saved. They are never staged against a temporary or client-only card.</span></div>
            </div>
            <aside className="stack">
              <section className="panel">
                <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">Destination</h2><p className="panel-sub">{project?.name} · {snapshot.board.name}</p></div></div>
                <div className="panel-body stack-sm">
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Project</span><span className="small">{project?.name}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Board</span><span className="small">{snapshot.board.name}</span></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Created by</span><span className="small">{state.status === 'ready' ? state.session.actor.displayName : '—'}</span></div>
                  <div className="note"><Icon name="info" /><span>The card key is assigned by the server when the card is created.</span></div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">Private by default</h2></div></div>
                <div className="panel-body stack-sm">
                  <p className="small muted" style={{ lineHeight: 1.55 }}>The card is visible only to people with a grant on {project?.name}. Adding an image does not make it public.</p>
                  <div className="note"><Icon name="image" /><span>Images use authenticated delivery. A copied image URL is not a public link.</span></div>
                </div>
              </section>
            </aside>
          </div>
          {errors.form && <div className="note danger" role="alert" style={{ marginTop: 12 }}><Icon name="x-circle" /><span>{errors.form}</span></div>}
          <div className="sticky-actions">
            <span className={`dirty-note${dirty ? ' is-dirty' : ''}`}><span className="dot" />{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
            <span className="spacer" />
            <Link className="btn" href={backHref}>Cancel</Link>
            <button className="btn primary" type="submit" disabled={busy}><Icon name="plus" />{busy ? 'Saving…' : 'Save card'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function AddCardPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading…</div>}><AddCardScreen /></Suspense>;
}
