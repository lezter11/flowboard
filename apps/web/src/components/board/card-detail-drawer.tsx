'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { cardDraftSessions, cardFieldsDirty, cardFieldsInput, type CardDraft } from '@/lib/card-drafts';
import { discardRefusedRows } from '@/lib/feed-state';
import { pageInertLock, pickFocusTarget } from '@/lib/inert-lock';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityItem, Card, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { toastFailure } from '@/lib/toast-failure';
import { describeError, describeFailure, isStale } from '@/lib/errors';
import { ErrorNote } from '@/components/ui/error-note';
import { usePollKeys } from '@/components/polling';
import { dueInfo, relativeTime } from '@/lib/dates';
import { describeActivity } from '@/lib/activity';
import { ActivityDetails } from './activity-details';
import { can, ROLE_META, normalizeRole, type Role } from '@/lib/roles';
import { useAssignablePeople, useProjectPeople } from '@/lib/assignee-people';
import { EMPTY_ASSIGNEES, MAX_ASSIGNEES, NO_ACCESS_HINT, assignableList, canAddAssignee, describeIneligible, ineligibleFromFailure, peopleLoadError, ineligibleIds, namesFor, noBoardAccess, pickerState, saveBarText } from '@/lib/assignees';
import { Icon } from '@/components/ui/icon';
import { CardImages } from './card-images';
import { CardDocumentLinks } from './card-document-links';
import { formatPersonName } from '@/lib/person-name';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/avatar';
import { CardComments } from './card-comments';
import { commentSessions } from '@/lib/comment-state';
import { useCursorFeed } from '@/lib/cursor-feed';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { useToast } from '@/components/ui/toasts';

interface Props {
  cardId: string;
  expectedBoardId: string;
  asOfDate?:string|null;
  columns: ColumnSummary[];
  people: Map<string, PersonDisplay>;
  role: Role;
  boardName: string;
  structureVersion: number;
  onClose: () => void;
  onChanged: () => void;
  onRequestMove: (card: CardSummary) => void;
}

type Draft = CardDraft;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Card detail drawer; markup follows index.html #cardDrawer and detail.js. */
export function CardDetailDrawer(props: Props) {
  const { cardId, columns, people, role, boardName, structureVersion, onClose, onChanged } = props;
  const { state: sessionState } = useSession();
  const draftActorId = sessionState.status === 'ready' ? sessionState.session.actor.id : '';
  const cardKey=useMemo(()=>['card',cardId,draftActorId] as const,[cardId,draftActorId]);
  const client=useQueryClient();
  const cardQuery = useQuery({
    queryKey: cardKey,
    queryFn: async ({signal}) => (await api.getCard(cardId,signal)).data,
    enabled:!!draftActorId,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  usePollKeys([cardKey],!!draftActorId);
  useEffect(()=>{discardRefusedRows(client,cardKey,cardQuery.error);},[client,cardKey,cardQuery.error]);
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const dirtyRef = useRef(false);
  const commentSession = useMemo(() => commentSessions.forCard(draftActorId, cardId), [draftActorId, cardId]);
  const commentDirty = useSyncExternalStore(commentSession.subscribe, commentSession.hasUnsaved, commentSession.hasUnsaved);
  const [confirm, setConfirm] = useState<null | 'discard' | 'delete'>(null);

  useEffect(() => {
    const remembered=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const release=pageInertLock.acquire(document.querySelector('.app'));
    const raf = requestAnimationFrame(() => setOpen(true));
    document.body.style.overflow = 'hidden';
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = ''; release(); requestAnimationFrame(()=>pickFocusTarget(remembered,()=>document.querySelector<HTMLElement>(`.card[data-card-id="${CSS.escape(cardId)}"] .card-open`),()=>document.getElementById('boardTitle'))?.focus({preventScroll:true})); };
  }, []);

  useEffect(()=>{if(!open)return;const frame=requestAnimationFrame(()=>panelRef.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[open]);

  const finishClose = useCallback(() => {
    commentSession.close();
    setOpen(false);
    window.setTimeout(onClose, 200);
  }, [commentSession, onClose]);
  const requestClose = useCallback(() => { if (dirtyRef.current || commentSession.hasUnsaved()) setConfirm('discard'); else finishClose(); }, [finishClose, commentSession]);

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

  const denied=cardQuery.error instanceof ApiError&&[401,403,404].includes(cardQuery.error.status);
  const wrongBoard = !!cardQuery.data && cardQuery.data.boardId !== props.expectedBoardId;
  const visibleCard = draftActorId && !denied && !wrongBoard ? cardQuery.data : undefined;
  const gone = wrongBoard || (cardQuery.error instanceof ApiError && [403, 404].includes(cardQuery.error.status));
  const trashed = !!visibleCard && (visibleCard.state !== 'active' || visibleCard.deletedAt !== null);
  const card = trashed ? undefined : visibleCard;
  const toast = useToast();
  const leftRef = useRef(false);
  useEffect(() => {
    if (leftRef.current || !open || !(gone || trashed) || dirtyRef.current || commentDirty) return;
    leftRef.current = true;
    setConfirm(null);
    toast(trashed ? 'This card was moved to the trash.' : 'This card was removed or you no longer have access to it.', { icon: 'alert' });
    onChanged();
    finishClose();
  }, [gone, trashed, open, commentDirty, toast, onChanged, finishClose]);

  if(typeof document==='undefined')return null;
  return createPortal(
    <>
      <div className={`scrim${open ? ' is-open' : ''}`} id="drawerScrim" onClick={requestClose} />
      <aside
        ref={panelRef}
        className={`drawer${open ? ' is-open' : ''}`}
        id="cardDrawer"
        role="dialog"
        aria-modal="true"
        aria-label={card ? `Card details: ${card.title}` : 'Card details'}
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {card ? (
          <DrawerBody
            key={card.id}
            card={card}
            asOfDate={props.asOfDate??null}
            columns={columns}
            people={people}
            role={role}
            boardName={boardName}
            dirtyRef={dirtyRef}
            requestClose={requestClose}
            requestDelete={() => setConfirm('delete')}
            onRequestMove={props.onRequestMove}
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
              {gone || trashed ? <p role="alert" className="field-error">{trashed ? 'This card was moved to the trash.' : 'This card is no longer available on this board.'}{(dirtyRef.current || commentDirty) && ' Your drafts are kept in this tab.'}</p> : cardQuery.isError && <p role="alert" className="field-error">{describeError(cardQuery.error)}</p>}
            </div>
          </>
        )}
      </aside>

      <DiscardDeleteDialog
        kind={confirm}
        onCancel={() => setConfirm(null)}
        card={card ?? null}
        structureVersion={structureVersion}
        onDiscard={() => {
          cardDraftSessions.acknowledge(draftActorId, cardId);
          commentSession.acknowledge();
          dirtyRef.current = false;
          setConfirm(null);
          finishClose();
        }}
        onDeleted={() => { setConfirm(null); dirtyRef.current = false; onChanged(); finishClose(); }}
      />
    </>, document.body
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
          <h2 id="confirmTitle">{isDelete ? 'Delete this card?' : 'Close this card?'}</h2>
          <p className="confirm-copy" id="confirmCopy">{isDelete ? `“${card?.title ?? 'This card'}” moves to the trash and can be restored for 24 hours. Comments, images and document links stay with it.` : 'Your unsaved card fields and comment drafts stay in this tab when you reopen the card. Reloading or closing the tab can lose them.'}</p>
        </div>
      </div>
      <footer className="dialog-foot">
        <span className="spacer" />
        <button className="btn" type="button" onClick={onCancel} data-autofocus>{isDelete ? 'Cancel' : 'Keep editing'}</button>
        <button className="btn danger" type="button" disabled={busy} onClick={isDelete ? () => void remove() : onDiscard}>{isDelete ? 'Delete' : 'Close and keep drafts'}</button>
      </footer>
    </DialogLayer>
  );
}

function DrawerBody({ card, asOfDate, columns, people, role, boardName, dirtyRef, requestClose, requestDelete, onRequestMove, onSaved }: {
  card: Card; asOfDate:string|null; columns: ColumnSummary[]; people: Map<string, PersonDisplay>; role: Role; boardName: string;
  dirtyRef: React.MutableRefObject<boolean>; requestClose: () => void; requestDelete: () => void; onRequestMove: (card: CardSummary) => void; onSaved: () => void;
}) {
  const toast = useToast();
  const {state}=useSession();const actorId=state.status==='ready'?state.session.actor.id:'';
  const session=useMemo(()=>cardDraftSessions.forCard(actorId,card),[actorId,card.id]);
  const snapshot=useSyncExternalStore(session.subscribe,session.get,session.get);
  useEffect(()=>session.observe(card),[card,session]);
  const {base,draft,conflict}=snapshot;
  const setDraft=(patch:Partial<Omit<Draft, 'columnId'>>)=>session.edit(patch);
  const unresolved=session.fields.unresolved()||session.move.unresolved();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const editable = !!actorId&&can(role, 'edit')&&!unresolved;
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const assignButton = useRef<HTMLButtonElement>(null);
  const assignSearch = useRef<HTMLInputElement>(null);
  const assignPanel = useRef<HTMLDivElement>(null);
  const assignPanelId = useId();
  const closeAssignees = useCallback(() => { setAssignOpen(false); setAssigneeFilter(''); }, []);
  useEffect(() => {
    if (!assignOpen || !editable) return;
    assignSearch.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.some((item) => item === assignPanel.current || item === assignButton.current)) closeAssignees();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [assignOpen, editable, closeAssignees]);
  useEffect(() => { if (!editable) closeAssignees(); }, [editable, closeAssignees]);
  const fieldsDirty=cardFieldsDirty(draft,base);
  const dirty=fieldsDirty||session.fields.unresolved()||session.move.unresolved()&&!snapshot.movingTo;
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  const set = <K extends keyof Omit<Draft, 'columnId'>>(key: K, value: Draft[K]) => setDraft({ [key]: value });

  const status = snapshot.movingTo ?? snapshot.moveInput?.toColumnId ?? base.columnId;
  const currentColumn = columns.find((c) => c.id === base.columnId);
  const moving = snapshot.movingTo !== null;
  const done = currentColumn?.category === 'done';
  const due = dueInfo(draft.dueDate || null, done,asOfDate);
  // Candidates come from the card's own project, not from the board snapshot (which only knows people already on cards).
  const projectPeople = useAssignablePeople(card.projectId, card.boardId, editable);
  // Owners and Managers also see who is blocked only by a missing board grant (the project-wide list minus the board's).
  const canSeeBlocked = editable && (role === 'owner' || role === 'manager');
  const projectWide = useProjectPeople(card.projectId, canSeeBlocked);
  const blocked = useMemo(() => (canSeeBlocked && projectPeople.isSuccess && projectWide.isSuccess ? noBoardAccess(projectWide.data, projectPeople.data) : []), [canSeeBlocked, projectWide.data, projectWide.isSuccess, projectPeople.data, projectPeople.isSuccess]);
  const assignable = useMemo(() => assignableList(projectPeople.data), [projectPeople.data]);
  const picker = pickerState(projectPeople, assignable);
  const normalizedFilter = assigneeFilter.trim().toLocaleLowerCase();
  const matchesFilter = (person: PersonDisplay) => formatPersonName(person).toLocaleLowerCase().includes(normalizedFilter);
  const shownAssignable = assignable.filter(matchesFilter);
  const shownBlocked = blocked.filter(matchesFilter);
  const names = useMemo(() => namesFor(namesFor(people, projectWide.data), projectPeople.data), [people, projectWide.data, projectPeople.data]);
  // Cards saved before viewers were refused may still list one (or someone since removed). The server rejects them on save, so say so up front.
  const ineligible = ineligibleIds(draft.assigneeIds, assignable, projectPeople.isSuccess, people);

  const [assigneeFailure, setAssigneeFailure] = useState<{ ids: string[]; error: unknown } | null>(null);
  const [saveFailure, setSaveFailure] = useState<unknown>(null);
  const save = useMutation({
    // Status movement is deliberately a separate operation; a field save never performs a hidden move.
    mutationFn: async (override?: string[]) => {
      const { fieldInput, draft, version, base } = session.get();
      const input = fieldInput ?? cardFieldsInput(draft, version, override, base);
      session.intent({fieldInput:input});
      return session.fields.run(input,(original,key)=>api.updateCard(card.id,original,key));
    },
    onSuccess: (res) => {session.fieldsSaved(res.data.version, res.data.documentLinks);setError('');setSaveFailure(null);setAssigneeFailure(null);toast('Card fields saved',{icon:'check'});onSaved();},
    onError: (err) => {
      if(!session.fields.unresolved())session.intent({fieldInput:null});
      const refused = err instanceof ApiError ? ineligibleFromFailure(err) : null;
      if (refused) {
        setAssigneeFailure({ ids: refused.length ? refused : draft.assigneeIds.filter((id) => !assignable.some((p) => p.id === id)), error: err });
        setSaveFailure(null); setError('');
        void projectPeople.refetch();
        return;
      }
      setAssigneeFailure(null); setError('');
      setSaveFailure(err); onSaved(); },
  });

  const statusMove = useMutation({
    mutationFn: async (columnId: string) => {
      const { moveInput, version } = session.get();
      session.beginMove(columnId);
      if (moveInput) return session.move.retry((original, key) => api.moveCard(card.id, original, key));
      const { data: placement } = await api.getCardPlacement(card.boardId, columnId, { movingCardId: card.id, at: 'last' });
      const input = { toColumnId: placement.toColumnId, previousCardId: placement.previousCardId, nextCardId: placement.nextCardId,
        expectedVersion: version, expectedBoardVersion: placement.structureVersion };
      session.intent({ moveInput: input });
      return session.move.run(input, (original, key) => api.moveCard(card.id, original, key));
    },
    onSuccess: (res) => { session.moved(res.data.version); toast('Card status moved', { icon: 'move' }); onSaved(); },
    onError: (error) => {
      session.moveFailed();
      toast(session.move.unresolved() ? 'Check the card to retry the status move.' : describeError(error), { icon: 'alert' });
      onSaved();
    },
  });
  const selectStatus = (columnId: string) => {
    if (!actorId || !can(role, 'move') || columnId === base.columnId || session.get().movingTo || save.isPending || unresolved) return;
    statusMove.mutate(columnId);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if(!actorId||!can(role,'edit')||save.isPending||moving||session.move.unresolved())return;
    if(session.fields.unresolved()){save.mutate(undefined);return;}
    if(conflict){setError('Review the current card version before saving. Your edits are kept.');return;}
    if (!draft.title.trim() || draft.title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); return; }
    if (draft.description.length > 20000) { setError('Description must be 20,000 characters or fewer.'); return; }
    if (ineligible.length > 0) { setError('Remove the assignees marked “can’t be assigned” first. Only owners, managers and members can be assigned.'); return; }
    setError(''); setSaveFailure(null); setAssigneeFailure(null);
    save.mutate(undefined);
  };
  const failedNames = (assigneeFailure?.ids ?? []).map((id) => formatPersonName(names.get(id), 'A person'));
  const removeAndSave = () => { const keep = draft.assigneeIds.filter((id) => !(assigneeFailure?.ids ?? []).includes(id)); setDraft({ assigneeIds: keep }); setAssigneeFailure(null); setError(''); setSaveFailure(null); save.mutate(keep); };
  const ownerName = [...names.values()].find((p) => p.scopedRole === 'owner')?.displayName ?? null;
  const noteCtx = { role, ownerName, names: failedNames, boardName, item: card.title, resource: 'card' } as const;

  return (
    <>
      <header className="drawer-head">
        <div className="drawer-crumb">{card.key && <><strong>{card.key}</strong><span className="sep">/</span></>}<span>{boardName}</span></div>
        <div className="drawer-head-actions">
          {can(role, 'move') && (
            <button className="btn ghost sm" type="button" aria-label="Move card" disabled={unresolved||save.isPending||moving} onClick={() => {
              const current = session.get();
              onRequestMove({ ...card, columnId: current.base.columnId, version: current.version });
            }}><Icon name="move" /><span aria-hidden="true">Move</span></button>
          )}
          {can(role, 'manageBoard') && (
            <button className="btn ghost sm danger-ghost" type="button" aria-label="Delete card" disabled={unresolved||save.isPending||moving} onClick={requestDelete}><Icon name="trash" /><span aria-hidden="true">Delete</span></button>
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
            <select className="control" id="detailStatus" value={status} disabled={!actorId||!can(role, 'move')||unresolved||save.isPending||moving} onChange={(event) => selectStatus(event.target.value)}>
              {!columns.some((c)=>c.id===status)&&<option value={status} disabled>Unavailable column</option>}{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {moving && <p className="field-help" role="status">Moving card…</p>}
            {session.move.unresolved() && !moving && can(role, 'move') && <button className="btn sm" type="button" onClick={() => statusMove.mutate(status)}>Retry status move</button>}
            {statusMove.error&&<ErrorNote error={statusMove.error} focusOnMount />}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="detailPriority">Priority</label>
            <select className="control" id="detailPriority" value={draft.priority} disabled={!editable} onChange={(event) => set('priority', event.target.value as Card['priority'])}>
              <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field assignee-field" onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.relatedTarget !== assignButton.current && !assignPanel.current?.contains(event.relatedTarget)) closeAssignees();
          }} onKeyDown={(event) => {
            if (event.key !== 'Escape' || !assignOpen) return;
            event.preventDefault(); event.stopPropagation(); closeAssignees(); assignButton.current?.focus();
          }}>
            <span className="field-label">Assignees</span>
            <div className="assignee-control">
              <div className="assignee-chips">
                {draft.assigneeIds.length === 0 && <span className="hint">Unassigned</span>}
                {draft.assigneeIds.map((id) => {
                  const name = formatPersonName(names.get(id), 'Unknown member');
                  return (
                    <span key={id} className="assignee-chip" title={ineligible.includes(id) ? 'This person can no longer be assigned to cards' : undefined}>
                      <Avatar id={id} name={name} avatarUrl={names.get(id)?.avatarUrl} />
                      {name}{ineligible.includes(id) && <span className="role-mini"> · can’t be assigned</span>}
                      {editable && <button className="remove-assignee" type="button" aria-label={`Unassign ${name}`} onClick={() => set('assigneeIds', draft.assigneeIds.filter((a) => a !== id))}><Icon name="x" /></button>}
                    </span>
                  );
                })}
              </div>
              {editable && (
                <>
                  <button ref={assignButton} className="add-assignee" type="button" aria-expanded={assignOpen} aria-controls={assignPanelId} onClick={() => assignOpen ? closeAssignees() : setAssignOpen(true)}><Icon name="plus" />Assign</button>
                  {assignOpen && <div ref={assignPanel} className="assignee-menu" id={assignPanelId} role="group" aria-labelledby={`${assignPanelId}-title`}>
                    <div className="assignee-menu-head">
                      <div className="menu-title" id={`${assignPanelId}-title`}>Assign people</div>
                      <span className="assignee-selection-count">{draft.assigneeIds.length} of {MAX_ASSIGNEES} selected</span>
                    </div>
                    <input ref={assignSearch} type="search" className="control assignee-search" placeholder="Search by name" aria-label="Search people by name" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} />
                    <div className="assignee-results">
                      {picker === 'loading' && <div className="menu-note" role="status">Loading people…</div>}
                      {picker === 'error' && <div className="menu-note" role="alert">{peopleLoadError(projectPeople.error as { code?: string } | null)} {(projectPeople.error as { code?: string } | null)?.code === 'BOARD_REQUIRED' ? <button className="btn sm" type="button" onClick={() => window.location.reload()}>Reload</button> : <button className="btn sm" type="button" onClick={() => void projectPeople.refetch()}>Try again</button>}</div>}
                      {picker === 'empty' && <div className="menu-note" role="status">{EMPTY_ASSIGNEES}</div>}
                      {picker === 'ready' && shownAssignable.length === 0 && shownBlocked.length === 0 && <div className="menu-note" role="status">No matching people.</div>}
                      {picker === 'ready' && shownAssignable.map((person) => {
                        const checked = draft.assigneeIds.includes(person.id);
                        return (
                          <label key={person.id} className={`assignee-option${checked ? ' is-selected' : ''}`}>
                            <input type="checkbox" checked={checked} disabled={!checked && !canAddAssignee(draft.assigneeIds.length)} onChange={(event) => set('assigneeIds', event.target.checked ? [...draft.assigneeIds, person.id] : draft.assigneeIds.filter((a) => a !== person.id))} />
                            <Avatar id={person.id} name={formatPersonName(person)} avatarUrl={person.avatarUrl} />
                            <span className="assignee-option-name" title={formatPersonName(person)}>{formatPersonName(person)}</span>
                            {person.scopedRole && <span className="role-mini">{person.scopedRole}</span>}
                          </label>
                        );
                      })}
                      {shownBlocked.length > 0 && (
                        <div className="assignee-blocked" aria-label="No access to this board">
                          <div className="menu-title">No access to this board</div>
                          {shownBlocked.map((person) => (
                            <div key={person.id} className="assignee-option is-disabled" aria-disabled="true">
                              <Avatar id={person.id} name={formatPersonName(person)} avatarUrl={person.avatarUrl} />
                              <span className="assignee-option-name" title={formatPersonName(person)}>{formatPersonName(person)}</span>
                              {person.scopedRole && <span className="role-mini">{person.scopedRole}</span>}
                            </div>
                          ))}
                          <div className="menu-note">{NO_ACCESS_HINT} {role === 'owner' ? <Link href={`/people?project=${encodeURIComponent(card.projectId)}`}>Open People for this project</Link> : 'Ask the project Owner.'}</div>
                        </div>
                      )}
                    </div>
                    <div className="menu-note assignee-menu-foot">Viewer roles can’t be assigned. Apply selections with Save changes.</div>
                  </div>}
                </>
              )}
            </div>
            {assigneeFailure && (
              <ErrorNote className="assignee-failure" error={assigneeFailure.error} ctx={noteCtx} focusOnMount>
                {failedNames.length > 0 && <div className="error-note-actions"><button className="btn sm" type="button" disabled={save.isPending} onClick={removeAndSave}>Remove them and save</button></div>}
              </ErrorNote>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="detailDue">Due date</label>
            <div className="date-row">
              <input className="control" id="detailDue" type="date" value={draft.dueDate} disabled={!editable} onChange={(event) => set('dueDate', event.target.value)} />
              {editable && draft.dueDate && <button className="icon-btn" type="button" aria-label="Clear due date" title="Clear due date" onClick={() => set('dueDate', '')}><Icon name="x" className="icon-sm" /></button>}
            </div>
            <span className={`due-flag${due?.state === 'overdue' ? '' : ' ok'}`}>
              {!draft.dueDate ? 'No due date' : due?.state === 'overdue' ? due.detail ?? 'Overdue' : due?.state === 'done' ? 'Completed column · date kept for history' : 'Calendar date only · no time zone'}
            </span>
          </div>
        </div>

        <section className="detail-section">
          <div className="section-head"><h2>Description</h2></div>
          <label className="sr-only" htmlFor="detailDescription">Description</label>
          <textarea className="detail-desc" id="detailDescription" maxLength={20000} placeholder="Add context, links or acceptance notes…" value={draft.description} readOnly={!editable} onChange={(event) => set('description', event.target.value)} />
        </section>

        <CardImages cardId={card.id} boardId={card.boardId} role={role} count={card.imageCount} />

        {card.documentLinks !== undefined && <CardDocumentLinks
          links={can(role, 'edit') ? draft.documentLinks : base.documentLinks}
          editable={!!actorId && can(role, 'edit')}
          disabled={!editable || save.isPending || moving}
          onChange={(links) => set('documentLinks', links)}
        />}

        <section className="detail-section" aria-label="Discussion and activity">
          <div className="tabs" role="tablist" aria-label="Card discussion" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'comments' : event.key === 'End' ? 'activity' : tab === 'comments' ? 'activity' : 'comments';
            setTab(next); document.getElementById(next === 'comments' ? 'commentsTab' : 'activityTab')?.focus();
          }}>
            <button className="tab" id="commentsTab" type="button" role="tab" aria-selected={tab === 'comments'} tabIndex={tab === 'comments' ? 0 : -1} aria-controls="commentsPanel" onClick={() => setTab('comments')}>Comments <span className="count">{card.commentCount}</span></button>
            <button className="tab" id="activityTab" type="button" role="tab" aria-selected={tab === 'activity'} tabIndex={tab === 'activity' ? 0 : -1} aria-controls="activityPanel" onClick={() => setTab('activity')}>Activity</button>
          </div>
          <div hidden={tab !== 'comments'} className="tab-panel" id="commentsPanel" role="tabpanel" aria-labelledby="commentsTab">
              <CardComments cardId={card.id} projectId={card.projectId} boardId={card.boardId} people={people} role={role} onChanged={onSaved} />
            </div>
            <div hidden={tab !== 'activity'} className="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab">
              <CardActivity cardId={card.id} people={people} />
            </div>
        </section>
        {conflict && <div role="status" className="field-note conflict-note"><p>Updated by someone else. Your edits are kept; review the current values before saving.</p><p>Current title: {base.title} · priority: {base.priority} · due: {base.dueDate||'none'} · status: {columns.find((c)=>c.id===base.columnId)?.name??'unavailable'}</p><details><summary>Current saved description, assignees and documents</summary><p style={{whiteSpace:'pre-wrap'}}>{base.description||'No description'}</p><p>{base.assigneeIds.map((id)=>formatPersonName(names.get(id),'Unknown member')).join(', ')||'Unassigned'}</p><p>{base.documentLinks.map((link) => link.title).join(', ') || 'No document links'}</p></details><button className="btn sm" type="button" disabled={unresolved} onClick={()=>session.review()}>Use latest version, keep my edits</button></div>}
        {error && <ErrorNote text={error} />}
        {saveFailure != null && <ErrorNote error={saveFailure} ctx={noteCtx} focusOnMount onRetry={() => submit()} />}
      </div>

      <footer className="drawer-foot">
        {editable || can(role, 'move') ? (
          <>
            <span className={`save-state${save.isError && dirty ? ' is-error' : dirty ? ' is-dirty' : ''}`} role="status" aria-live="polite"><span className="dot" /> {session.fields.unresolved() && !save.isPending ? 'Original field save needs retry' : saveBarText({ saving: save.isPending, failed: save.isError && fieldsDirty, dirty:fieldsDirty, reason: save.isError ? describeFailure(save.error, noteCtx).title : undefined })}</span>
            <div className="foot-actions">
              <button className="btn ghost" type="button" disabled={!dirty||unresolved||save.isPending||moving} onClick={() => {session.discard();setError('');setSaveFailure(null);}}>Discard</button>
              <button className="btn primary" type="button" disabled={!actorId||!can(role,'edit')||(!fieldsDirty&&!session.fields.unresolved())||save.isPending||moving||session.move.unresolved()||(conflict&&!session.fields.unresolved())} onClick={() => submit()}>{save.isPending ? 'Saving…' : session.fields.unresolved() ? 'Retry original field save' : save.isError && fieldsDirty ? 'Try again' : 'Save changes'}</button>
            </div>
          </>
        ) : (
          <div className="readonly-foot"><Icon name="lock" />Read-only</div>
        )}
      </footer>
    </>
  );
}

function CardActivity({ cardId, people }: { cardId: string; people: Map<string, PersonDisplay> }) {
  const { state } = useSession();
  const actorId = state.status === 'ready' ? state.session.actor.id : '';
  const queryClient = useQueryClient();
  const queryKey = ['card-activity', cardId, actorId] as const;
  const feed = useCursorFeed<ActivityItem>(queryKey, (cursor, signal) => api.listCardActivity(cardId, 50, cursor, signal));
  usePollKeys([queryKey]);
  const unavailable = feed.error && typeof feed.error === 'object' && 'status' in feed.error && [401, 403, 404].includes(Number(feed.error.status));
  const stale = feed.error && typeof feed.error === 'object' && 'code' in feed.error && feed.error.code === 'STALE_CURSOR';
  const items = unavailable ? [] : feed.items;
  return (
    <div className="activity-list" aria-busy={feed.isFetching}>
      {feed.isPending && <p className="hint" role="status">Loading history…</p>}
      {stale ? <ErrorNote text="The history list changed. Your drafts are kept."><button className="btn sm" type="button" onClick={() => void queryClient.resetQueries({ queryKey, exact: true })}>Reload history</button></ErrorNote> : feed.isError && <ErrorNote error={feed.error} onRetry={() => void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())} />}
      {feed.isSuccess && !items.length && <p className="hint"><Icon name="info" />No recorded history for this card yet.</p>}
      {items.map((event) => {
        const view = describeActivity(event);
        const name = formatPersonName(event.actor ?? people.get(event.actorId), 'Former member');
        return <article key={event.id} className="activity-item">
          <span className="activity-icon"><Icon name={view.icon} /></span>
          <div className="activity-main"><div className="activity-text"><strong>{name}</strong> {view.text}</div><ActivityDetails item={event} /><time className="activity-time" dateTime={event.createdAt}>{relativeTime(event.createdAt)}</time></div>
        </article>;
      })}
      {!unavailable && !stale && feed.hasNextPage && <button className="btn sm" type="button" disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Loading history…' : 'Load more history'}</button>}
    </div>
  );
}
