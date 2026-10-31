'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Card, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { toastFailure } from '@/lib/toast-failure';
import { describeError, isStale } from '@/lib/errors';
import { reconcileDraft } from '@/lib/draft-sync';
import { usePollKeys } from '@/components/polling';
import { dueInfo, relativeTime } from '@/lib/dates';
import { neighbours } from '@/lib/board-model';
import { describeActivity } from '@/lib/activity';
import { can, ROLE_META, normalizeRole, type Role } from '@/lib/roles';
import { useAssignablePeople, useProjectPeople } from '@/lib/assignee-people';
import { EMPTY_ASSIGNEES, MAX_ASSIGNEES, NO_ACCESS_HINT, assignableList, canAddAssignee, describeIneligible, ineligibleFromFailure, peopleLoadError, ineligibleIds, namesFor, noBoardAccess, pickerState, saveBarText } from '@/lib/assignees';
import { Icon } from '@/components/ui/icon';
import { CardImages } from './card-images';
import { formatPersonName, personAria } from '@/lib/person-name';
import { activeTrigger, applyMention, backspaceMention, finalizeMentions, highlight, rankPeople, segments, shiftMentions, type Mention, type Trigger } from '@/lib/mentions';
import { mentionCandidates, mentionEmptyText } from '@/lib/mention-ui';
import { useSession } from '@/lib/session';
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
  usePollKeys([['card', cardId], ['comments', cardId], ['card-images', cardId], ['card-activity', cardId]]);
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
  // Trashed or no longer visible while open: say so and close, instead of leaving a stale or blank drawer.
  const goneStatus = cardQuery.error instanceof ApiError && [403, 404].includes(cardQuery.error.status) ? cardQuery.error.status : 0;
  const trashed = !!card && (card.state !== 'active' || card.deletedAt !== null);
  const toast = useToast();
  const leftRef = useRef(false);
  useEffect(() => {
    if (leftRef.current || !card || !(goneStatus || trashed)) return;
    leftRef.current = true;
    toast(trashed ? 'This card was moved to the trash.' : 'This card was removed or you no longer have access to it.', { icon: 'alert' });
    dirtyRef.current = false;
    onChanged();
    finishClose();
  }, [card, goneStatus, trashed, toast, onChanged, finishClose]);

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
            key={card.id}
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
      toastFailure(toast, error);
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
  const [base, setBase] = useState<Draft>(() => toDraft(card));
  const [draft, setDraft] = useState<Draft>(base);
  const [seenVersion, setSeenVersion] = useState(card.version);
  const [conflict, setConflict] = useState(false);
  // The card changed on the server (a poll, a colleague's save). Untouched fields follow it; fields being edited keep the user's text.
  if (seenVersion !== card.version) {
    const next = toDraft(card);
    const merged = reconcileDraft(base, next, draft);
    const stillDirty = (Object.keys(next) as Array<keyof Draft>).some((k) => String(merged.draft[k]) !== String(next[k]));
    setSeenVersion(card.version);
    setBase(next);
    setDraft(merged.draft);
    setConflict((c) => (merged.conflict || c) && stillDirty);
  }
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
  // Candidates come from the card's own project, not from the board snapshot (which only knows people already on cards).
  const projectPeople = useAssignablePeople(card.projectId, card.boardId, editable);
  // Owners and Managers also see who is blocked only by a missing board grant (the project-wide list minus the board's).
  const canSeeBlocked = editable && (role === 'owner' || role === 'manager');
  const projectWide = useProjectPeople(card.projectId, canSeeBlocked);
  const blocked = useMemo(() => (canSeeBlocked && projectPeople.isSuccess ? noBoardAccess(projectWide.data, projectPeople.data) : []), [canSeeBlocked, projectWide.data, projectPeople.data, projectPeople.isSuccess]);
  const assignable = useMemo(() => assignableList(projectPeople.data), [projectPeople.data]);
  const picker = pickerState(projectPeople, assignable);
  const names = useMemo(() => namesFor(namesFor(people, projectWide.data), projectPeople.data), [people, projectWide.data, projectPeople.data]);
  // Cards saved before viewers were refused may still list one (or someone since removed). The server rejects them on save, so say so up front.
  const ineligible = ineligibleIds(draft.assigneeIds, assignable, projectPeople.isSuccess, people);

  const [assigneeFailure, setAssigneeFailure] = useState<{ ids: string[]; message: string } | null>(null);
  const assigneeErrorRef = useRef<HTMLDivElement>(null);
  const save = useMutation({
    // `override` is the assignee list for "Remove them and save", so the save does not wait for a state update.
    mutationFn: async (override?: string[]) => {
      let version = card.version;
      const assigneeIds = override ?? draft.assigneeIds;
      const fieldsChanged = draft.title !== base.title || draft.description !== base.description || draft.priority !== base.priority || draft.dueDate !== base.dueDate || assigneeIds.join(',') !== base.assigneeIds.join(',');
      if (fieldsChanged) {
        const res = await api.updateCard(card.id, {
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          dueDate: draft.dueDate || null,
          assigneeIds,
          expectedVersion: version,
        });
        version = res.data.version ?? version + 1;
      }
      if (draft.columnId !== card.columnId) {
        const { previousCardId, nextCardId } = neighbours(draftColumn, card.id, Number.MAX_SAFE_INTEGER);
        await api.moveCard(card.id, { toColumnId: draft.columnId, previousCardId, nextCardId, expectedVersion: version, expectedBoardVersion: structureVersion });
      }
    },
    onSuccess: (_r, override) => { setError(''); setAssigneeFailure(null); if (override) setDraft((d) => ({ ...d, assigneeIds: override })); setConflict(false); setDraft((d) => ({ ...d, title: d.title.trim() })); toast('Changes saved', { icon: 'check' }); dirtyRef.current = false; onSaved(); },
    onError: (err) => {
      const refused = err instanceof ApiError ? ineligibleFromFailure(err) : null;
      if (refused) {
        setAssigneeFailure({ ids: refused.length ? refused : draft.assigneeIds.filter((id) => !assignable.some((p) => p.id === id)), message: '' });
        setError('');
        void projectPeople.refetch();
        return;
      }
      setAssigneeFailure(null);
      setError(err instanceof ApiError && err.status === 404 ? 'This card was removed, so your changes could not be saved.' : isStale(err) ? 'Someone else changed this card. Their changes are loaded; review your edits and save again.' : describeError(err)); onSaved(); },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.title.trim() || draft.title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); return; }
    if (draft.description.length > 20000) { setError('Description must be 20,000 characters or fewer.'); return; }
    if (ineligible.length > 0) { setError('Remove the assignees marked “can’t be assigned” first. Only owners, managers and members can be assigned.'); return; }
    setError(''); setAssigneeFailure(null);
    save.mutate(undefined);
  };
  // Bring the refusal into view and focus it as soon as it renders, so keyboard and screen-reader users land on it.
  useEffect(() => { if (assigneeFailure) { assigneeErrorRef.current?.scrollIntoView({ block: 'nearest' }); assigneeErrorRef.current?.focus(); } }, [assigneeFailure]);
  const failedNames = (assigneeFailure?.ids ?? []).map((id) => formatPersonName(names.get(id), 'A person'));
  const removeAndSave = () => { const keep = draft.assigneeIds.filter((id) => !(assigneeFailure?.ids ?? []).includes(id)); setDraft((d) => ({ ...d, assigneeIds: keep })); setAssigneeFailure(null); setError(''); save.mutate(keep); };

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
            <span>{card.createdBy ? `Created by ${formatPersonName(card.createdBy)}` : 'Created'} {relativeTime(card.createdAt)}</span>
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
                  const name = formatPersonName(names.get(id), 'Unknown member');
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
                    {picker === 'loading' && <div className="menu-note" role="status">Loading people…</div>}
                    {picker === 'error' && <div className="menu-note" role="alert">{peopleLoadError(projectPeople.error as { code?: string } | null)} {(projectPeople.error as { code?: string } | null)?.code === 'BOARD_REQUIRED' ? <button className="btn sm" type="button" onClick={() => window.location.reload()}>Reload</button> : <button className="btn sm" type="button" onClick={() => void projectPeople.refetch()}>Try again</button>}</div>}
                    {picker === 'empty' && <div className="menu-note" role="status">{EMPTY_ASSIGNEES}</div>}
                    {assignable.map((person) => {
                      const checked = draft.assigneeIds.includes(person.id);
                      return (
                        <label key={person.id} className="assignee-option">
                          <input type="checkbox" checked={checked} disabled={!checked && !canAddAssignee(draft.assigneeIds.length)} onChange={(event) => set('assigneeIds', event.target.checked ? [...draft.assigneeIds, person.id] : draft.assigneeIds.filter((a) => a !== person.id))} />
                          <Avatar id={person.id} name={formatPersonName(person)} />
                          {formatPersonName(person)}
                          {person.scopedRole && <span className="role-mini">{person.scopedRole}</span>}
                        </label>
                      );
                    })}
                    {blocked.length > 0 && (
                      <div className="assignee-blocked" aria-label="No access to this board">
                        <div className="menu-title">No access to this board</div>
                        {blocked.map((person) => (
                          <div key={person.id} className="assignee-option is-disabled" aria-disabled="true">
                            <Avatar id={person.id} name={formatPersonName(person)} />
                            {formatPersonName(person)}
                            {person.scopedRole && <span className="role-mini">{person.scopedRole}</span>}
                          </div>
                        ))}
                        <div className="menu-note">{NO_ACCESS_HINT} {role === 'owner' ? <Link href="/people">Open board access</Link> : 'Ask the project Owner.'}</div>
                      </div>
                    )}
                    <div className="menu-note">Viewers can read and be mentioned but cannot be assigned. Up to {MAX_ASSIGNEES} assignees.</div>
                  </div>
                </details>
              )}
            </div>
            {assigneeFailure && (
              <div className="assignee-failure" role="alert" tabIndex={-1} ref={assigneeErrorRef}>
                <p>{describeIneligible(failedNames, assigneeFailure.message)}</p>
                {failedNames.length > 0 && <button className="btn sm" type="button" disabled={save.isPending} onClick={removeAndSave}>{failedNames.length === 1 ? 'Remove them and save' : 'Remove them and save'}</button>}
              </div>
            )}
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

        <CardImages cardId={card.id} role={role} count={card.imageCount} />

        <section className="detail-section" aria-label="Discussion and activity">
          <div className="tabs" role="tablist" aria-label="Card discussion">
            <button className="tab" id="commentsTab" type="button" role="tab" aria-selected={tab === 'comments'} aria-controls="commentsPanel" onClick={() => setTab('comments')}>Comments <span className="count">{card.commentCount}</span></button>
            <button className="tab" id="activityTab" type="button" role="tab" aria-selected={tab === 'activity'} aria-controls="activityPanel" onClick={() => setTab('activity')}>Activity</button>
          </div>
          {tab === 'comments' ? (
            <div className="tab-panel" id="commentsPanel" role="tabpanel" aria-labelledby="commentsTab">
              <Comments cardId={card.id} projectId={card.projectId} people={people} role={role} onPosted={() => { void queryClient.invalidateQueries({ queryKey: ['comments', card.id] }); onSaved(); }} />
            </div>
          ) : (
            <div className="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab">
              <CardActivity cardId={card.id} people={people} />
            </div>
          )}
        </section>
        {conflict && <p role="status" className="field-note conflict-note">Updated by someone else - review before saving.</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>

      <footer className="drawer-foot">
        {editable || can(role, 'move') ? (
          <>
            <span className={`save-state${save.isError && dirty ? ' is-error' : dirty ? ' is-dirty' : ''}`} role="status" aria-live="polite"><span className="dot" /> {saveBarText({ saving: save.isPending, failed: save.isError && dirty, dirty })}</span>
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

function Comments({ cardId, projectId, people, role, onPosted }: { cardId: string; projectId: string; people: Map<string, PersonDisplay>; role: Role; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<{ trigger: Trigger; caret: number } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const key = useRef<string>(crypto.randomUUID());
  const listId = useId();
  const list = useQuery({ queryKey: ['comments', cardId], queryFn: async () => (await api.listCardComments(cardId)).data });
  const post = useMutation({
    mutationFn: () => { const final = finalizeMentions(body, mentions); return api.postCardComment(cardId, { body: final.body, mentions: final.mentions }, key.current); },
    onSuccess: () => { setBody(''); setMentions([]); setPicker(null); setError(''); key.current = crypto.randomUUID(); onPosted(); },
    onError: (err) => {
      // 422 with mentions attached is almost always someone who lost access to the board since the list loaded.
      setError(err instanceof ApiError && err.status === 422 && mentions.length > 0
        ? 'One of the people you mentioned cannot be notified, probably because they no longer have access to this board. Remove that mention and try again.'
        : err instanceof ApiError && err.status === 404 ? 'This card was removed, so the comment could not be posted.' : describeError(err));
      key.current = crypto.randomUUID();
    },
  });
  // Put the caret where the inserted text ends only after React has committed that text, so fast typing cannot outrun it.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const at = pendingCaret.current; pendingCaret.current = null;
    input.current?.focus(); input.current?.setSelectionRange(at, at);
  }, [body]);
  const comments = (list.data ?? []).filter((c) => !c.deletedAt);
  const canComment = can(role, 'edit');
  // The board snapshot only lists people the card already references, so mention candidates come from the project people endpoint.
  // The server needs the card id: it limits mentions to people who can read that card's board, and answers an empty list without one.
  const { state: sessionState } = useSession();
  const actorId = sessionState.status === 'ready' ? sessionState.session.actor.id : null;
  const mentionPeople = useQuery({
    queryKey: ['project-people', projectId, 'mention', cardId],
    queryFn: async () => (await api.listProjectPeople(projectId, 'mention', { cardId })).data,
    enabled: canComment, staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  const candidates = useMemo(() => mentionCandidates(mentionPeople.data), [mentionPeople.data]);
  const candidateNames = useMemo(() => candidates.map((p) => formatPersonName(p)), [candidates]);
  const names = useMemo(() => namesFor(people, mentionPeople.data), [people, mentionPeople.data]);
  const matches = useMemo(() => (picker ? rankPeople(candidates, picker.trigger.query) : []), [candidates, picker]);

  const refreshPicker = (text: string, caret: number) => {
    const trigger = activeTrigger(text, caret, candidateNames);
    setPicker(trigger ? { trigger, caret } : null);
    setActive(0);
  };
  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setMentions((m) => shiftMentions(body, next, m));
    setBody(next); setError('');
    refreshPicker(next, event.target.selectionStart);
  };
  const choose = (person: PersonDisplay) => {
    if (!picker) return;
    const r = applyMention(body, picker.trigger, picker.caret, { id: person.id, displayName: formatPersonName(person) });
    setMentions((m) => [...shiftMentions(body, r.text, m), r.mention]);
    pendingCaret.current = r.caret;
    setBody(r.text); setPicker(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Backspace at the end of a mention removes the whole mention in one step, like a chip.
    if (event.key === 'Backspace' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const gone = backspaceMention(body, event.currentTarget.selectionStart, mentions);
      if (gone) { event.preventDefault(); setMentions((m) => shiftMentions(body, gone.text, m)); pendingCaret.current = gone.caret; setBody(gone.text); setPicker(null); return; }
    }
    if (!picker || matches.length === 0) { if (picker && event.key === 'Escape') { event.preventDefault(); setPicker(null); } return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % matches.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(matches[active]!); }
    else if (event.key === 'Escape') { event.preventDefault(); setPicker(null); }
  };
  const startMention = () => {
    const el = input.current; if (!el) return;
    const caret = el.selectionStart;
    const needsSpace = caret > 0 && !/\s/.test(body[caret - 1]!);
    const next = `${body.slice(0, caret)}${needsSpace ? ' ' : ''}@${body.slice(el.selectionEnd)}`;
    const at = caret + (needsSpace ? 1 : 0) + 1;
    setMentions((m) => shiftMentions(body, next, m));
    pendingCaret.current = at;
    setBody(next);
    refreshPicker(next, at);
  };
  const sendable = finalizeMentions(body, mentions);
  const shown = new Set(sendable.mentions.map((m) => m.userId));
  return (
    <>
      <div className="comment-list">
        {list.isPending && <div className="comment-empty">Loading comments…</div>}
        {list.isError && <div className="comment-empty" role="alert">{describeError(list.error)}</div>}
        {list.isSuccess && comments.length === 0 && <div className="comment-empty">No comments yet.{canComment ? ' Start the discussion below.' : ''}</div>}
        {comments.map((comment) => {
          const person = comment.author ?? people.get(comment.authorId);
          const name = formatPersonName(person, 'Former member');
          return (
            <div key={comment.id} className="comment">
              <Avatar id={comment.authorId} name={name} />
              <div className="comment-main">
                <div className="comment-head">
                  <span className="comment-author">{name}</span>
                  <span className="comment-time">{relativeTime(comment.createdAt)}{comment.version > 1 ? ' · edited' : ''}</span>
                </div>
                <div className="comment-body">{segments(comment.body, comment.mentions).map((part, i) => part.userId ? <mark key={i} className="mention" title={formatPersonName(names.get(part.userId), 'Former member')}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {canComment ? (
        <div className="composer">
          <label className="sr-only" htmlFor="commentInput">Write a comment</label>
          <div className="composer-field">
            <textarea
              id="commentInput" ref={input} placeholder="Write a comment… type @ to mention someone" maxLength={10000} value={body}
              role="combobox" aria-autocomplete="list" aria-expanded={!!picker && matches.length > 0} aria-controls={picker ? listId : undefined}
              aria-activedescendant={picker && matches.length > 0 ? `${listId}-${active}` : undefined}
              onChange={onChange} onKeyDown={onKeyDown}
              onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refreshPicker(body, event.currentTarget.selectionStart); }}
              onClick={(event) => refreshPicker(body, event.currentTarget.selectionStart)}
              onBlur={() => setPicker(null)}
            />
            {picker && (
              <ul className="mention-list" id={listId} role="listbox" aria-label="People you can mention" onMouseDown={(event) => event.preventDefault()}>
                {matches.length === 0 && <li className="mention-none" role="presentation">{mentionEmptyText({ loading: mentionPeople.isPending, failed: mentionPeople.isError, candidates, actorId, typed: picker.trigger.query })}</li>}
                {matches.map((person, i) => {
                  const roleLabel = ROLE_META[normalizeRole(person.scopedRole)].label;
                  return (
                    <li key={person.id} id={`${listId}-${i}`} role="option" aria-label={personAria(person, roleLabel)} aria-selected={i === active} className={`mention-option${i === active ? ' is-active' : ''}`} onClick={() => choose(person)} onMouseEnter={() => setActive(i)}>
                      <Avatar id={person.id} name={formatPersonName(person)} />
                      <span className="mention-name">{highlight(formatPersonName(person), picker.trigger.query).map((part, k) => part.hit ? <b key={k}>{part.text}</b> : <span key={k}>{part.text}</span>)}</span>
                      <small>{roleLabel}</small>
                    </li>
                  );
                })}
              </ul>
            )}
            <span className="sr-only" role="status" aria-live="polite">{picker && matches.length > 0 ? `${matches.length} ${matches.length === 1 ? 'person' : 'people'} found` : ''}</span>
          </div>
          {shown.size > 0 && <p className="hint" id="mentionNote"><Icon name="at" />{shown.size === 1 ? '1 person will be notified' : `${shown.size} people will be notified`}.</p>}
          {error && <p role="alert" className="field-error">{error}</p>}
          <div className="composer-actions">
            <button className="composer-tool" type="button" onClick={startMention} aria-label="Mention someone"><Icon name="at" />Mention</button>
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
        const name = formatPersonName(event.actor ?? people.get(event.actorId), 'Former member');
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
