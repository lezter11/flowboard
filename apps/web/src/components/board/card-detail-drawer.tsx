'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Card, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { dueInfo, relativeTime } from '@/lib/dates';
import { neighbours } from '@/lib/board-model';
import { describeActivity } from '@/lib/activity';
import { can, type Role } from '@/lib/roles';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { useToast } from '@/components/ui/toasts';

interface Props {
  cardId: string;
  summary: CardSummary | null;
  columns: ColumnSummary[];
  people: Map<string, PersonDisplay>;
  role: Role;
  boardName: string;
  structureVersion: number;
  onClose: () => void;
  onChanged: () => void;
  onRequestMove: (card: CardSummary) => void;
}

interface Draft { title: string; description: string; priority: Card['priority']; dueDate: string; assigneeIds: string[]; columnId: string }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function toDraft(card: Card): Draft {
  return { title: card.title, description: card.description, priority: card.priority, dueDate: card.dueDate ?? '', assigneeIds: card.assigneeIds, columnId: card.columnId };
}

/** Card detail drawer; markup follows index.html #cardDrawer and detail.js. */
export function CardDetailDrawer(props: Props) {
  const { cardId, columns, people, role, boardName, structureVersion, onClose, onChanged } = props;
  const cardQuery = useQuery({
    queryKey: ['card', cardId],
    queryFn: async () => (await api.getCard(cardId)).data,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const dirtyRef = useRef(false);
  const [confirm, setConfirm] = useState<null | 'discard' | 'delete'>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { setOpen(true); panelRef.current?.focus({ preventScroll: true }); });
    document.body.style.overflow = 'hidden';
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = ''; };
  }, []);

  const finishClose = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, 200);
  }, [onClose]);
  const requestClose = useCallback(() => { if (dirtyRef.current) setConfirm('discard'); else finishClose(); }, [finishClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !confirm && !event.defaultPrevented) { event.preventDefault(); requestClose(); return; }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const card = cardQuery.data;
  return (
    <>
      <div className={`scrim${open ? ' is-open' : ''}`} id="drawerScrim" onClick={requestClose} />
      <aside
        ref={panelRef}
        className={`drawer${open ? ' is-open' : ''}`}
        id="cardDrawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Card details: ${card?.title ?? props.summary?.title ?? ''}`}
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {card ? (
          <DrawerBody
            key={`${card.id}:${card.version}`}
            card={card}
            columns={columns}
            people={people}
            role={role}
            boardName={boardName}
            structureVersion={structureVersion}
            dirtyRef={dirtyRef}
            requestClose={requestClose}
            requestDelete={() => setConfirm('delete')}
            onRequestMove={() => props.summary && props.onRequestMove(props.summary)}
            onSaved={() => { void cardQuery.refetch(); onChanged(); }}
          />
        ) : (
          <>
            <header className="drawer-head">
              <div className="drawer-crumb"><strong>{boardName}</strong></div>
              <div className="drawer-head-actions">
                <button className="drawer-close" type="button" onClick={requestClose} aria-label="Close card details"><Icon name="x" className="icon-lg" /></button>
              </div>
            </header>
            <div className="drawer-scroll">
              {cardQuery.isPending && <p role="status" className="hint">Loading card…</p>}
              {cardQuery.isError && <p role="alert" className="field-error">{cardQuery.error instanceof ApiError && [403, 404].includes(cardQuery.error.status) ? 'This card does not exist or you cannot open it.' : describeError(cardQuery.error)}</p>}
            </div>
          </>
        )}
      </aside>

      <DiscardDeleteDialog
        kind={confirm}
        onCancel={() => setConfirm(null)}
        card={card ?? null}
        structureVersion={structureVersion}
        onDiscard={() => { dirtyRef.current = false; setConfirm(null); finishClose(); }}
        onDeleted={() => { setConfirm(null); dirtyRef.current = false; onChanged(); finishClose(); }}
      />
    </>
  );
}

function DiscardDeleteDialog({ kind, onCancel, card, structureVersion, onDiscard, onDeleted }: {
  kind: null | 'discard' | 'delete'; onCancel: () => void; card: Card | null; structureVersion: number; onDiscard: () => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await api.softDeleteCard(card.id, { expectedVersion: card.version, expectedBoardVersion: structureVersion });
      toast('Card moved to trash.', { icon: 'trash' });
      onDeleted();
    } catch (error) {
      toast(describeError(error), { tone: 'danger', icon: 'alert' });
    } finally { setBusy(false); }
  };
  const isDelete = kind === 'delete';
  return (
    <DialogLayer open={kind !== null} onClose={onCancel} labelledBy="confirmTitle" describedBy="confirmCopy" role="alertdialog" className="confirm">
      <div className="dialog-head">
        <div className="dialog-head-copy">
          <div className="confirm-icon"><Icon name="alert" /></div>
          <h2 id="confirmTitle">{isDelete ? 'Delete this card?' : 'Discard changes?'}</h2>
          <p className="confirm-copy" id="confirmCopy">{isDelete ? 'The card moves to the trash. Comments and images stay with it.' : 'Your unsaved edits will be lost.'}</p>
        </div>
      </div>
      <footer className="dialog-foot">
        <span className="spacer" />
        <button className="btn" type="button" onClick={onCancel} data-autofocus>{isDelete ? 'Cancel' : 'Keep editing'}</button>
        <button className="btn danger" type="button" disabled={busy} onClick={isDelete ? () => void remove() : onDiscard}>{isDelete ? 'Delete' : 'Discard'}</button>
      </footer>
    </DialogLayer>
  );
}

function DrawerBody({ card, columns, people, role, boardName, structureVersion, dirtyRef, requestClose, requestDelete, onRequestMove, onSaved }: {
  card: Card; columns: ColumnSummary[]; people: Map<string, PersonDisplay>; role: Role; boardName: string; structureVersion: number;
  dirtyRef: React.MutableRefObject<boolean>; requestClose: () => void; requestDelete: () => void; onRequestMove: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const base = toDraft(card);
  const [draft, setDraft] = useState<Draft>(base);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const editable = can(role, 'edit');
  const dirty = draft.title !== base.title || draft.description !== base.description || draft.priority !== base.priority || draft.dueDate !== base.dueDate || draft.assigneeIds.join(',') !== base.assigneeIds.join(',') || draft.columnId !== base.columnId;
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const currentColumn = columns.find((c) => c.id === card.columnId);
  const draftColumn = columns.find((c) => c.id === draft.columnId);
  const done = draftColumn?.category === 'done';
  const due = dueInfo(draft.dueDate || null, done);
  const assignable = [...people.values()].filter((p) => p.activeInProject && p.assignable !== false);
  // Cards saved before viewers were refused may still list one (or someone since removed). The server rejects them on save, so say so up front.
  const ineligible = draft.assigneeIds.filter((id) => !assignable.some((p) => p.id === id));

  const save = useMutation({
    mutationFn: async () => {
      let version = card.version;
      const fieldsChanged = draft.title !== base.title || draft.description !== base.description || draft.priority !== base.priority || draft.dueDate !== base.dueDate || draft.assigneeIds.join(',') !== base.assigneeIds.join(',');
      if (fieldsChanged) {
        const res = await api.updateCard(card.id, {
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          dueDate: draft.dueDate || null,
          assigneeIds: draft.assigneeIds,
          expectedVersion: version,
        });
        version = res.data.version ?? version + 1;
      }
      if (draft.columnId !== card.columnId) {
        const { previousCardId, nextCardId } = neighbours(draftColumn, card.id, Number.MAX_SAFE_INTEGER);
        await api.moveCard(card.id, { toColumnId: draft.columnId, previousCardId, nextCardId, expectedVersion: version, expectedBoardVersion: structureVersion });
      }
    },
    onSuccess: () => { setError(''); toast('Changes saved', { icon: 'check' }); dirtyRef.current = false; onSaved(); },
    onError: (err) => { setError(describeError(err)); onSaved(); },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.title.trim() || draft.title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); return; }
    if (draft.description.length > 20000) { setError('Description must be 20,000 characters or fewer.'); return; }
    if (ineligible.length > 0) { setError('Remove the assignees marked “can’t be assigned” first. Only owners, managers and members can be assigned.'); return; }
    setError('');
    save.mutate();
  };

  return (
    <>
      <header className="drawer-head">
        <div className="drawer-crumb">{card.key && <><strong>{card.key}</strong><span className="sep">/</span></>}<span>{boardName}</span></div>
        <div className="drawer-head-actions">
          {can(role, 'move') && (
            <button className="btn ghost sm" type="button" aria-label="Move card" onClick={onRequestMove}><Icon name="move" /><span aria-hidden="true">Move</span></button>
          )}
          {can(role, 'manageBoard') && (
            <button className="btn ghost sm danger-ghost" type="button" aria-label="Delete card" onClick={requestDelete}><Icon name="trash" /><span aria-hidden="true">Delete</span></button>
          )}
          <button className="drawer-close" type="button" onClick={requestClose} aria-label="Close card details"><Icon name="x" className="icon-lg" /></button>
        </div>
      </header>

      <div className="drawer-scroll">
        <div className="detail-heading">
          <label className="sr-only" htmlFor="detailTitle">Card title</label>
          <textarea className="detail-title" id="detailTitle" rows={1} maxLength={200} value={draft.title} readOnly={!editable} onChange={(event) => set('title', event.target.value.replace(/\n/g, ' '))} />
          <div className="detail-context">
            <span className="badge">{currentColumn?.name ?? 'Column'}</span>
            <span className="dot" aria-hidden="true" />
            <span>{card.createdBy ? `Created by ${card.createdBy.displayName}` : 'Created'} {relativeTime(card.createdAt)}</span>
            <span className="dot" aria-hidden="true" />
            <span>Updated {relativeTime(card.updatedAt)}</span>
          </div>
        </div>

        <div className="detail-meta">
          <div className="field">
            <label className="field-label" htmlFor="detailStatus">Status</label>
            <select className="control" id="detailStatus" value={draft.columnId} disabled={!can(role, 'move')} onChange={(event) => set('columnId', event.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="detailPriority">Priority</label>
            <select className="control" id="detailPriority" value={draft.priority} disabled={!editable} onChange={(event) => set('priority', event.target.value as Card['priority'])}>
              <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Assignees</span>
            <div className="assignee-control">
              <div className="assignee-chips">
                {draft.assigneeIds.length === 0 && <span className="hint">Unassigned</span>}
                {draft.assigneeIds.map((id) => {
                  const name = people.get(id)?.displayName ?? 'Unknown member';
                  return (
                    <span key={id} className="assignee-chip" title={ineligible.includes(id) ? 'This person can no longer be assigned to cards' : undefined}>
                      <Avatar id={id} name={name} />
                      {name}{ineligible.includes(id) && <span className="role-mini"> · can’t be assigned</span>}
                      {editable && <button className="remove-assignee" type="button" aria-label={`Unassign ${name}`} onClick={() => set('assigneeIds', draft.assigneeIds.filter((a) => a !== id))}><Icon name="x" /></button>}
                    </span>
                  );
                })}
              </div>
              {editable && (
                <details className="assignee-picker">
                  <summary className="add-assignee"><Icon name="plus" />Assign</summary>
                  <div className="assignee-menu">
                    <div className="menu-title">Assignable project people</div>
                    {assignable.map((person) => (
                      <label key={person.id} className="assignee-option">
                        <input type="checkbox" checked={draft.assigneeIds.includes(person.id)} onChange={(event) => set('assigneeIds', event.target.checked ? [...draft.assigneeIds, person.id] : draft.assigneeIds.filter((a) => a !== person.id))} />
                        <Avatar id={person.id} name={person.displayName} />
                        {person.displayName}
                        {person.scopedRole && <span className="role-mini">{person.scopedRole}</span>}
                      </label>
                    ))}
                    <div className="menu-note">Viewers can read and be mentioned but cannot be assigned. Up to 20 assignees.</div>
                  </div>
                </details>
              )}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="detailDue">Due date</label>
            <div className="date-row">
              <input className="control" id="detailDue" type="date" value={draft.dueDate} disabled={!editable} onChange={(event) => set('dueDate', event.target.value)} />
              {editable && <button className="icon-btn" type="button" aria-label="Clear due date" title="Clear due date" onClick={() => set('dueDate', '')}><Icon name="x" className="icon-sm" /></button>}
            </div>
            <span className={`due-flag${!draft.dueDate || (due && due.state === 'overdue') ? '' : ' ok'}`}>
              {!draft.dueDate ? 'No due date' : due?.state === 'overdue' ? due.detail ?? 'Overdue' : due?.state === 'done' ? 'Completed column · date kept for history' : 'Calendar date only · no time zone'}
            </span>
          </div>
        </div>

        <section className="detail-section">
          <div className="section-head"><h2>Description</h2></div>
          <label className="sr-only" htmlFor="detailDescription">Description</label>
          <textarea className="detail-desc" id="detailDescription" maxLength={20000} placeholder="Add context, links or acceptance notes…" value={draft.description} readOnly={!editable} onChange={(event) => set('description', event.target.value)} />
          <p className="hint"><Icon name="info" /><span>Plain text. Due dates are calendar dates, not times.</span></p>
        </section>

        <section className="detail-section" aria-labelledby="imagesHeading">
          <div className="section-head"><h2 id="imagesHeading">Images</h2><span className="count">{card.imageCount}</span></div>
          <p className="hint"><Icon name="lock" />Private image upload and viewing are coming soon.</p>
        </section>

        <section className="detail-section" aria-label="Discussion and activity">
          <div className="tabs" role="tablist" aria-label="Card discussion">
            <button className="tab" id="commentsTab" type="button" role="tab" aria-selected={tab === 'comments'} aria-controls="commentsPanel" onClick={() => setTab('comments')}>Comments <span className="count">{card.commentCount}</span></button>
            <button className="tab" id="activityTab" type="button" role="tab" aria-selected={tab === 'activity'} aria-controls="activityPanel" onClick={() => setTab('activity')}>Activity</button>
          </div>
          {tab === 'comments' ? (
            <div className="tab-panel" id="commentsPanel" role="tabpanel" aria-labelledby="commentsTab">
              <Comments cardId={card.id} people={people} role={role} onPosted={() => { void queryClient.invalidateQueries({ queryKey: ['comments', card.id] }); onSaved(); }} />
            </div>
          ) : (
            <div className="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab">
              <CardActivity cardId={card.id} people={people} />
            </div>
          )}
        </section>
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>

      <footer className="drawer-foot">
        {editable || can(role, 'move') ? (
          <>
            <span className={`save-state${dirty ? ' is-dirty' : ''}`} role="status" aria-live="polite"><span className="dot" /> {save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <div className="foot-actions">
              <button className="btn ghost" type="button" disabled={!dirty || save.isPending} onClick={() => { setDraft(base); setError(''); }}>Discard</button>
              <button className="btn primary" type="button" disabled={!dirty || save.isPending} onClick={() => submit()}>Save changes</button>
            </div>
          </>
        ) : (
          <div className="readonly-foot"><Icon name="lock" />Read-only</div>
        )}
      </footer>
    </>
  );
}

function Comments({ cardId, people, role, onPosted }: { cardId: string; people: Map<string, PersonDisplay>; role: Role; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const key = useRef<string>(crypto.randomUUID());
  const list = useQuery({ queryKey: ['comments', cardId], queryFn: async () => (await api.listCardComments(cardId)).data });
  const post = useMutation({
    mutationFn: () => api.postCardComment(cardId, { body: body.trim(), mentions: [] }, key.current),
    onSuccess: () => { setBody(''); setError(''); key.current = crypto.randomUUID(); onPosted(); },
    onError: (err) => setError(describeError(err)),
  });
  const comments = (list.data ?? []).filter((c) => !c.deletedAt);
  const canComment = can(role, 'edit');
  return (
    <>
      <div className="comment-list">
        {list.isPending && <div className="comment-empty">Loading comments…</div>}
        {list.isError && <div className="comment-empty" role="alert">{describeError(list.error)}</div>}
        {list.isSuccess && comments.length === 0 && <div className="comment-empty">No comments yet.{canComment ? ' Start the discussion below.' : ''}</div>}
        {comments.map((comment) => {
          const person = comment.author ?? people.get(comment.authorId);
          const name = person?.displayName ?? 'Former member';
          return (
            <div key={comment.id} className="comment">
              <Avatar id={comment.authorId} name={name} />
              <div className="comment-main">
                <div className="comment-head">
                  <span className="comment-author">{name}</span>
                  <span className="comment-time">{relativeTime(comment.createdAt)}{comment.version > 1 ? ' · edited' : ''}</span>
                </div>
                <div className="comment-body">{comment.body}</div>
              </div>
            </div>
          );
        })}
      </div>
      {canComment ? (
        <div className="composer">
          <label className="sr-only" htmlFor="commentInput">Write a comment</label>
          <textarea id="commentInput" placeholder="Write a comment…" maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} />
          {error && <p role="alert" className="field-error">{error}</p>}
          <div className="composer-actions">
            <button className="composer-tool" type="button" disabled title="Mentions are coming soon"><Icon name="at" />Mention</button>
            <span className="spacer" />
            <button className="btn primary sm" type="button" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>{post.isPending ? 'Posting…' : 'Post comment'}</button>
          </div>
        </div>
      ) : (
        <div className="viewer-notice"><Icon name="lock" /><span>Read-only access. Viewers can read cards, comments and history but cannot post, upload or move cards.</span></div>
      )}
    </>
  );
}

function CardActivity({ cardId, people }: { cardId: string; people: Map<string, PersonDisplay> }) {
  const feed = useQuery({ queryKey: ['card-activity', cardId], queryFn: async () => (await api.listCardActivity(cardId)).data });
  if (feed.isPending) return <p className="hint">Loading history…</p>;
  if (feed.isError) return <p role="alert" className="field-error">{describeError(feed.error)}</p>;
  if (feed.data.length === 0) return <p className="hint"><Icon name="info" />No recorded history for this card yet.</p>;
  return (
    <div className="activity-list">
      {feed.data.map((event) => {
        const view = describeActivity(event);
        const name = event.actor?.displayName ?? people.get(event.actorId)?.displayName ?? 'Former member';
        return (
          <div key={event.id} className="activity-item">
            <span className="activity-icon"><Icon name={view.icon} /></span>
            <div className="activity-main">
              <div className="activity-text"><strong>{name}</strong> {view.text}</div>
              <div className="activity-time">{relativeTime(event.createdAt)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
