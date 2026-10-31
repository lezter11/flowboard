'use client';

import { pickFocusTarget } from '@/lib/inert-lock';
import { projectAccess } from '@/lib/project-access';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRememberLocation } from '@/lib/last-location';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardSnapshotData, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { toastFailure } from '@/lib/toast-failure';
import { describeError } from '@/lib/errors';
import { boardQueryOptions } from '@/lib/queries';
import { daysUntil } from '@/lib/dates';
import { EMPTY_FILTERS, filtersActive, neighbours, optimisticMove, sortedCards, toneFor, type Filters } from '@/lib/board-model';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { formatBoardsParam, parseBoardsParam, readMemory, resolveSelection, sectionPermissions, showSwitcher, writeMemory } from '@/lib/board-selection';
import { BoardSwitcher } from './board-switcher';
import { addTarget, addableBoards, boardTone, cardBoardMap, mergeColumns, planMove, type MergeSource, type MergedColumn } from '@/lib/board-merge';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { formatPersonName } from '@/lib/person-name';
import { NewBoardDialog } from '@/components/ui/new-board-dialog';
import { EditBoardDialog } from '@/components/ui/edit-board-dialog';
import { InviteDialog } from '@/components/ui/invite-dialog';
import { ColumnsDialog } from './columns-dialog';
import { ActionMenu } from '@/components/ui/action-menu';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toasts';
import { PollAge, usePolling, usePollHold, usePollKeys } from '@/components/polling';
import { useShell } from '@/components/shell/shell-context';
import { CardDetailDrawer } from '@/components/board/card-detail-drawer';
import { BoardColumn, type DropTarget } from './board-column';
import { MoveDialog } from './move-dialog';
import type { CardStyle } from './board-card';

/** Cards in display order. A merged column is already ordered (board, then position); a single board sorts as it always did. */
const displayCards = (column: ColumnSummary, merged: boolean) => (merged ? column.cards : sortedCards(column));

interface WorkspaceProps { boardIds: string[]; toolbarLead?: ReactNode }

/**
 * One board, or several merged into one set of columns (matched by column name). With one board every rule below
 * collapses to the old single-board behaviour. In a merged view each card still belongs to exactly one board: edits,
 * moves, comments, versions, permissions and polling all go through that board.
 */
function BoardWorkspace({ boardIds, toolbarLead }: WorkspaceProps) {
  const merged = boardIds.length > 1;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const shell = useShell();
  const { state } = useSession();
  const cardId = params.get('card');
  const view: 'board' | 'list' = params.get('view') === 'list' ? 'list' : 'board';
  const cardStyle: CardStyle = params.get('cards') === 'glass' ? 'glass' : 'focus';

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // "/" focuses the card search (same as the rail's Search cards); the rail sends ?search=1 when it opens a board first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || el?.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')) return;
      event.preventDefault();
      document.getElementById('searchInput')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const wantsSearch = params.get('search') === '1';
  useEffect(() => {
    if (!wantsSearch) return;
    const timer = window.setTimeout(() => {
      document.getElementById('searchInput')?.focus();
      const next = new URLSearchParams(window.location.search); next.delete('search');
      window.history.replaceState(null, '', `${pathname}?${next.toString()}`);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [wantsSearch, pathname]);
  const [menu, setMenu] = useState<null | 'assignee' | 'due'>(null);
  const [composerColumn, setComposerColumn] = useState<string | null>(null);
  const [addBoardPick, setAddBoardPick] = useState<string | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [editBoardOpen, setEditBoardOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');
  const [moveCard, setMoveCard] = useState<CardSummary | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [dropHint, setDropHint] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dropHint) return;
    const timer = window.setTimeout(() => setDropHint(''), 6000);
    return () => window.clearTimeout(timer);
  }, [dropHint]);

  const { pokeSoon } = usePolling();
  const boardQueries = useQueries({ queries: boardIds.map((id) => boardQueryOptions(id)) });
  const boardQuery = boardQueries[0]!;
  const snapshot = boardQuery.data;
  const boardId = boardIds[0]!;
  useRememberLocation(snapshot?.board.projectId, snapshot?.board.id ?? null);
  const boardKey = useMemo(() => ['board', boardId] as const, [boardId]);
  const refresh = useCallback((id?: string) => {
    if (id) void queryClient.invalidateQueries({ queryKey: ['board', id] });
    else for (const each of boardIds) void queryClient.invalidateQueries({ queryKey: ['board', each] });
    pokeSoon(1000);
  }, [queryClient, boardIds, pokeSoon]);

  usePollKeys(boardIds.map((id) => ['board', id] as const), true);

  const project = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === snapshot?.board.projectId) : undefined;
  const role = normalizeRole(project?.role);
  const projectArchived = !!project?.isArchived;
  const lostOf = (q: (typeof boardQueries)[number]) => q.error instanceof ApiError && [401, 403, 404].includes(q.error.status);

  // Boards that have data and are still reachable; a board that failed or vanished never blanks the others.
  const live = boardQueries.map((q, i) => ({ id: boardIds[i]!, index: i, query: q, data: q.data, lost: q.isError && lostOf(q) })).filter((b) => b.data && !b.lost);
  const dataKey = live.map((b) => `${b.id}:${b.query.dataUpdatedAt}`).join('|');
  const boardInfo = useMemo(() => {
    const map = new Map<string, { id: string; name: string; index: number; snap: BoardSnapshotData; canEdit: boolean; canMove: boolean; isArchived: boolean }>();
    for (const b of live) {
      const archived = !!b.data!.board.isArchived || projectArchived;
      const perms = sectionPermissions(can(role, 'edit'), can(role, 'move'), !!b.data!.board.isArchived, projectArchived);
      map.set(b.id, { id: b.id, name: b.data!.board.name, index: b.index, snap: b.data!, isArchived: archived, ...perms });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, role, projectArchived]);
  const infos = [...boardInfo.values()];
  const sources: MergeSource[] = useMemo(() => infos.map((i) => ({ id: i.id, name: i.name, isArchived: i.isArchived, columns: i.snap.columns })), [infos]);
  const columns: MergedColumn[] = useMemo(() => (sources.length ? mergeColumns(sources) : []), [sources]);
  const boardOfCard = useMemo(() => cardBoardMap(sources), [sources]);
  const cardIndex = useMemo(() => {
    const map = new Map<string, { card: CardSummary; boardId: string; column: MergedColumn }>();
    for (const column of columns) for (const card of column.cards) map.set(card.id, { card, boardId: boardOfCard.get(card.id) ?? boardId, column });
    return map;
  }, [columns, boardOfCard, boardId]);
  const people = useMemo(() => {
    const map = new Map<string, PersonDisplay>();
    for (const i of infos) for (const p of i.snap.people) if (!map.has(p.id) || p.activeInProject) map.set(p.id, p);
    return map;
  }, [infos]);
  const canEditCard = useCallback((card: CardSummary) => boardInfo.get(boardOfCard.get(card.id) ?? boardId)?.canEdit ?? false, [boardInfo, boardOfCard, boardId]);
  const canMoveCard = useCallback((card: CardSummary) => boardInfo.get(boardOfCard.get(card.id) ?? boardId)?.canMove ?? false, [boardInfo, boardOfCard, boardId]);
  const addBoards = useMemo(() => addableBoards(infos, (i) => i.canEdit), [infos]);
  const addBoardId = addBoards.find((b) => b.id === addBoardPick)?.id ?? addBoards[0]?.id ?? null;
  const canEdit = addBoards.length > 0;
  const canMove = infos.some((i) => i.canMove);
  const filtering = filtersActive(filters);
  const chipFor = (card: CardSummary) => {
    if (!merged) return null;
    const info = boardInfo.get(boardOfCard.get(card.id) ?? '');
    return info ? { name: info.name, tone: boardTone(info.index) } : null;
  };

  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!(event.target as Element).closest('.filter-wrap')) setMenu(null); };
    document.addEventListener('click', onDown);
    return () => document.removeEventListener('click', onDown);
  }, []);

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const matches = useCallback((card: CardSummary) => {
    const q = filters.q.trim().toLowerCase();
    if (q) {
      const hay = [card.title, card.key ?? '', card.descriptionExcerpt ?? '', ...card.assigneeIds.map((id) => formatPersonName(people.get(id)))].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.assignees.length) {
      const wantsUnassigned = filters.assignees.includes('unassigned');
      const wantsPerson = filters.assignees.some((id) => id !== 'unassigned');
      const hit = card.assigneeIds.some((id) => filters.assignees.includes(id));
      if (!(wantsUnassigned && card.assigneeIds.length === 0) && !(wantsPerson && hit)) return false;
    }
    if (filters.due !== 'any') {
      const done = cardIndex.get(card.id)?.column.category === 'done';
      if (done) return false;
      if (filters.due === 'none') return !card.dueDate;
      if (!card.dueDate) return false;
      const days = daysUntil(card.dueDate)!;
      if (filters.due === 'overdue' && days >= 0) return false;
      if (filters.due === 'soon' && (days < 0 || days > 7)) return false;
    }
    return true;
  }, [filters, people, cardIndex]);

  const snapOf = useCallback((id: string) => queryClient.getQueryData<BoardSnapshotData>(['board', id]), [queryClient]);

  const moveMutation = useMutation({
    mutationFn: ({ card, boardId: id, toColumnId, index }: { card: CardSummary; boardId: string; toColumnId: string; index: number }) => {
      const snap = snapOf(id)!;
      const { previousCardId, nextCardId } = neighbours(snap.columns.find((c) => c.id === toColumnId), card.id, index);
      return api.moveCard(card.id, {
        toColumnId,
        previousCardId,
        nextCardId,
        expectedVersion: card.version,
        expectedBoardVersion: snap.board.structureVersion,
      });
    },
    onMutate: async ({ card, boardId: id, toColumnId, index }) => {
      await queryClient.cancelQueries({ queryKey: ['board', id] });
      const previous = queryClient.getQueryData<BoardSnapshotData>(['board', id]);
      if (previous) queryClient.setQueryData<BoardSnapshotData>(['board', id], optimisticMove(previous, card, toColumnId, index));
      return { previous, id };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['board', context.id], context.previous);
      toastFailure(toast, error);
    },
    onSettled: (_data, _error, vars) => refresh(vars.boardId),
  });

  // Do not swap the board under a drag or an optimistic move; the poll result is applied after the drop.
  usePollHold(dragId !== null || moveMutation.isPending);

  /** Moves a card inside its own board: `toColumnId` is that board's own column id, `index` counts that column's cards without the moving one. */
  const performMove = useCallback((card: CardSummary, id: string, toColumnId: string, index: number) => {
    const snap = snapOf(id);
    if (!snap) return;
    const from = snap.columns.find((c) => c.id === card.columnId);
    const dest = snap.columns.find((c) => c.id === toColumnId);
    if (!dest || !from) return;
    const source = sortedCards(from);
    const at = source.findIndex((c) => c.id === card.id);
    const origin = { previousCardId: source[at - 1]?.id ?? null, nextCardId: source[at + 1]?.id ?? null };
    moveMutation.mutate({ card, boardId: id, toColumnId, index }, {
      onSuccess: () => {
        // The trigger may now live in another column; keep keyboard focus on the moved card.
        window.setTimeout(() => document.querySelector<HTMLElement>(`.card[data-card-id="${card.id}"] .card-open`)?.focus({ preventScroll: true }), 400);
        toast(`${card.title} moved to ${dest.name}`, {
          icon: 'move',
          undo: () => {
            const latestSnap = snapOf(id);
            const latest = latestSnap?.columns.flatMap((c) => c.cards).find((c) => c.id === card.id);
            const structure = latestSnap?.board.structureVersion ?? snap.board.structureVersion;
            api.moveCard(card.id, {
              toColumnId: card.columnId,
              previousCardId: origin.previousCardId,
              nextCardId: origin.nextCardId,
              expectedVersion: latest?.version ?? card.version + 1,
              expectedBoardVersion: structure,
            }).then(() => { toast('Move undone.'); refresh(id); }).catch((error) => { toastFailure(toast, error); refresh(id); });
          },
        });
      },
    });
  }, [moveMutation, toast, snapOf, refresh]);

  /** A card dropped on a (merged) column: map it to its own board's column of that name, or say why not. */
  const dropCard = useCallback((cardIdToMove: string, columnId: string, index: number) => {
    const entry = cardIndex.get(cardIdToMove);
    const target = columns.find((c) => c.id === columnId);
    if (!entry || !target || !boardInfo.get(entry.boardId)?.canMove) return;
    const info = boardInfo.get(entry.boardId)!;
    const others = displayCards(target, merged).filter((c) => c.id !== cardIdToMove);
    const plan = planMove({ card: entry.card, boardId: entry.boardId, boardName: info.name, target, others, index, boardOf: (id) => boardOfCard.get(id) });
    if (!plan.ok) { setDropHint(plan.hint); return; }
    setDropHint('');
    performMove(entry.card, plan.boardId, plan.toColumnId, plan.index);
  }, [cardIndex, columns, boardInfo, merged, boardOfCard, performMove]);

  const addCard = useCallback(async (columnId: string, title: string, priority: string) => {
    const info = boardInfo.get(addBoardId ?? '');
    const column = columns.find((c) => c.id === columnId);
    if (!info || !column) return;
    const target = merged ? addTarget(info.snap.columns, column.name) : { columnId, columnName: column.name, fallback: false };
    if (!target) return;
    setQuickAddBusy(true);
    setQuickAddError('');
    try {
      const res = await api.createCard(info.id, {
        title,
        description: '',
        priority: priority as CardSummary['priority'],
        columnId: target.columnId,
        dueDate: null,
        assigneeIds: [],
        expectedBoardVersion: info.snap.board.structureVersion,
      });
      setComposerColumn(null);
      refresh(info.id);
      toast(merged ? `Card added to ${info.name}, in ${target.columnName}${target.fallback ? ` (it has no “${column.name}” column)` : ''}` : `Card added to ${target.columnName}`, {
        icon: 'check',
        undo: () => {
          const board = snapOf(info.id)?.board ?? info.snap.board;
          api.softDeleteCard(res.data.id, { expectedVersion: res.data.version ?? 1, expectedBoardVersion: board.structureVersion })
            .then(() => { toast('Card removed.'); refresh(info.id); })
            .catch((error) => { toastFailure(toast, error); refresh(info.id); });
        },
      });
    } catch (error) {
      setQuickAddError(describeError(error));
      refresh(info.id);
    } finally {
      setQuickAddBusy(false);
    }
  }, [boardInfo, addBoardId, columns, merged, refresh, toast, snapOf]);

  // Drag and drop: the position comes from the pointer; the API receives previous/next neighbours.
  // The dragged id lives in a ref so dragover/drop work even before React re-renders; state only drives visuals.
  const dragRef = useRef<string | null>(null);
  const onDragStart = (card: CardSummary, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.id);
    dragRef.current = card.id;
    requestAnimationFrame(() => setDragId(dragRef.current));
  };
  const clearDrag = () => { dragRef.current = null; setDragId(null); setDrop(null); };
  const indexFromY = (zone: HTMLElement, clientY: number) => {
    const others = Array.from(zone.querySelectorAll<HTMLElement>('.card')).filter((el) => el.dataset.cardId !== dragRef.current);
    for (let i = 0; i < others.length; i += 1) {
      const rect = others[i]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return others.length;
  };
  const indexFromPointer = (zone: HTMLElement, event: DragEvent<HTMLElement>) => indexFromY(zone, event.clientY);
  const draggedMovable = () => { const entry = dragRef.current ? cardIndex.get(dragRef.current) : null; return !!entry && canMoveCard(entry.card); };
  const onDragOverZone = (columnId: string, event: DragEvent<HTMLElement>) => {
    if (!dragRef.current || !draggedMovable() || filtering) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const index = indexFromPointer(event.currentTarget, event);
    setDrop((current) => (current?.columnId === columnId && current.index === index ? current : { columnId, index }));
  };
  const onDragLeaveColumn = (columnId: string, event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDrop((current) => (current?.columnId === columnId ? null : current));
  };
  const onDropZone = (columnId: string, event: DragEvent<HTMLElement>) => {
    const id = dragRef.current;
    if (!id || !draggedMovable() || filtering) return;
    event.preventDefault();
    const index = indexFromPointer(event.currentTarget, event);
    clearDrag();
    dropCard(id, columnId, index);
  };

  // Proposed enhancement (docs/UI_PARITY_REPORT.md P-033): long-press drag for touch screens, opt-in with ?touchdrag=1.
  // HTML5 drag-and-drop does not start from touch, so this drives the same drop state from pointer events.
  // The Move dialog stays the default touch path.
  const touchEnabled = params.get('touchdrag') === '1' && canMove && !filtering && view === 'board';
  const touchRef = useRef<{ cardId: string; x: number; y: number; timer: number | null; active: boolean; ghost: HTMLElement | null; cardEl: HTMLElement } | null>(null);
  const endTouch = useCallback(() => {
    const t = touchRef.current;
    if (!t) return;
    if (t.timer) window.clearTimeout(t.timer);
    t.ghost?.remove();
    t.cardEl.removeAttribute('data-touch-drag');
    t.cardEl.setAttribute('draggable', 'true');
    touchRef.current = null;
    dragRef.current = null;
    setDragId(null);
    setDrop(null);
  }, []);
  useEffect(() => {
    if (!touchEnabled) return;
    // Once a drag is active the page must not scroll under the finger.
    const block = (event: TouchEvent) => { if (touchRef.current?.active) event.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => { document.removeEventListener('touchmove', block); endTouch(); };
  }, [touchEnabled, endTouch]);
  const touchTarget = (x: number, y: number) => {
    const column = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('section.column');
    return column ? { column, columnId: column.dataset.columnId ?? '' } : null;
  };
  const onBoardPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!touchEnabled || event.pointerType !== 'touch') return;
    const target = event.target as HTMLElement;
    const cardEl = target.closest<HTMLElement>('.card');
    if (!cardEl || target.closest('button.card-move')) return;
    const touchedId = cardEl.dataset.cardId;
    if (!touchedId) return;
    const touched = cardIndex.get(touchedId);
    if (!touched || !canMoveCard(touched.card)) return;
    cardEl.setAttribute('data-touch-drag', 'pending');
    cardEl.setAttribute('draggable', 'false'); // keep native drag from competing with the long-press
    const state = { cardId: touchedId, x: event.clientX, y: event.clientY, timer: null as number | null, active: false, ghost: null as HTMLElement | null, cardEl };
    touchRef.current = state;
    state.timer = window.setTimeout(() => {
      state.active = true;
      dragRef.current = touchedId;
      setDragId(touchedId);
      navigator.vibrate?.(10);
      const rect = cardEl.getBoundingClientRect();
      const ghost = cardEl.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: '0', pointerEvents: 'none', zIndex: '120', opacity: '0.92', boxShadow: 'var(--shadow-lg)', transform: 'rotate(1.5deg)' });
      ghost.removeAttribute('data-card-id');
      ghost.removeAttribute('draggable');
      document.body.appendChild(ghost);
      state.ghost = ghost;
      cardEl.setAttribute('data-touch-drag', 'active');
    }, 380);
  };
  const onBoardPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const t = touchRef.current;
    if (!t || event.pointerType !== 'touch') return;
    if (!t.active) {
      if (Math.hypot(event.clientX - t.x, event.clientY - t.y) > 10) endTouch(); // the finger is scrolling
      return;
    }
    if (t.ghost) {
      t.ghost.style.transform = `translate(${event.clientX - t.x}px, ${event.clientY - t.y}px) rotate(1.5deg)`;
    }
    const hit = touchTarget(event.clientX, event.clientY);
    if (!hit) { setDrop(null); return; }
    const index = indexFromY(hit.column, event.clientY);
    setDrop((current) => (current?.columnId === hit.columnId && current.index === index ? current : { columnId: hit.columnId, index }));
  };
  const onBoardPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const t = touchRef.current;
    if (!t || event.pointerType !== 'touch') return;
    if (!t.active) { endTouch(); return; }
    const hit = touchTarget(event.clientX, event.clientY);
    const touchedId = t.cardId;
    const index = hit ? indexFromY(hit.column, event.clientY) : 0;
    endTouch();
    if (hit) dropCard(touchedId, hit.columnId, index);
  };

  const openCard = (card: CardSummary, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    const next = new URLSearchParams(params.toString());
    next.set('card', card.id);
    if (merged) next.set('cardBoard', boardOfCard.get(card.id) ?? boardId);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const closeCard = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('card');
    next.delete('cardBoard');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    // A deep link (?card=) has no remembered trigger: fall back to the card's own button, then the board heading.
    const remembered = returnFocus.current;
    const closing = cardId;
    requestAnimationFrame(() => pickFocusTarget(
      remembered,
      () => (closing ? document.querySelector<HTMLElement>(`.card[data-card-id="${CSS.escape(closing)}"] .card-open`) : null),
      () => document.getElementById('boardTitle'),
    )?.focus({ preventScroll: true }));
  }, [params, pathname, router, cardId]);

  if (boardQueries.every((q) => q.isPending)) return <div role="status" className="state-note">Loading board…</div>;
  const lostAccess = boardQuery.error instanceof ApiError && [401, 403, 404].includes(boardQuery.error.status);
  // A failed background poll keeps the board on screen (the status banner explains it); only a lost board or a first-load failure replaces it.
  // The session is polled: removed from the project while looking at its board.
  if (snapshot && state.status === 'ready' && projectAccess(state.session.accessibleProjects, snapshot.board.projectId).kind === 'removed') {
    return (
      <section role="alert" className="board-unavailable" style={{ display: 'block' }}>
        <h1>You no longer have access</h1>
        <p>You were removed from this project, so its boards are not available to you anymore.</p>
        <Link className="btn" href="/projects">Back to projects</Link>
      </section>
    );
  }
  if (!infos.length || (!merged && (!snapshot || (boardQuery.isError && lostAccess)))) {
    const status = boardQuery.error instanceof ApiError ? boardQuery.error.status : 0;
    return (
      <section role="alert" className="board-unavailable" style={{ display: 'block' }}>
        <h1>{status === 401 ? 'You are signed out' : 'Board unavailable'}</h1>
        <p>{status === 401 ? 'Sign in to open this board.' : status === 403 || status === 404 ? 'This board is not available to your current account or project.' : describeError(boardQuery.error)}</p>
        {status === 401 ? <Link className="btn" href="/signin">Sign in</Link> : <Link className="btn" href="/projects">Back to projects</Link>}
        {status !== 401 && status !== 403 && status !== 404 && <button type="button" className="btn" onClick={() => void boardQuery.refetch()}>Try again</button>}
      </section>
    );
  }

  const first = infos[0]!;
  const primarySnap = first.snap;
  // An archived project freezes every board in it, exactly like an archived board.
  const board = projectArchived ? { ...primarySnap.board, isArchived: true } : primarySnap.board;
  const allCards = columns.flatMap((c) => c.cards);
  const total = merged ? infos.reduce((n, i) => n + i.snap.totals.activeCardCount, 0) : primarySnap.totals.activeCardCount;
  const notDone = allCards.filter((c) => cardIndex.get(c.id)?.column.category !== 'done');
  const sumTotal = (key: 'overdueCount' | 'dueSoonCount', fallback: number) => (infos.every((i) => i.snap.totals[key] != null) ? infos.reduce((n, i) => n + (i.snap.totals[key] ?? 0), 0) : fallback);
  const overdue = sumTotal('overdueCount', notDone.filter((c) => c.dueDate && (daysUntil(c.dueDate) ?? 0) < 0).length);
  const soon = sumTotal('dueSoonCount', notDone.filter((c) => c.dueDate && (daysUntil(c.dueDate) ?? -1) >= 0 && (daysUntil(c.dueDate) ?? 99) <= 7).length);
  const visibleCount = allCards.filter(matches).length;
  const selectedAssignees = filters.assignees;
  const assignable = [...people.values()].filter((p) => p.activeInProject);
  const quickAddFirst = columns[0]?.id ?? null;
  const unhealthy = boardQueries.map((q, i) => ({ id: boardIds[i]!, name: boardInfo.get(boardIds[i]!)?.name ?? 'A board', lost: q.isError && lostOf(q), error: q.isError })).filter((b) => b.error);
  const addNoteFor = (column: ColumnSummary) => {
    if (!merged || !addBoardId) return '';
    const info = boardInfo.get(addBoardId);
    const t = info ? addTarget(info.snap.columns, column.name) : null;
    return info && t?.fallback ? `${info.name} has no “${column.name}” column. The card will go to its first column, “${t.columnName}”.` : '';
  };
  const moveInfo = moveCard ? boardInfo.get(boardOfCard.get(moveCard.id) ?? boardId) : null;
  const moveColumns = moveInfo ? [...moveInfo.snap.columns].sort((a, b) => a.position - b.position) : [];
  const drawerInfo = cardId ? boardInfo.get(params.get('cardBoard') ?? boardOfCard.get(cardId) ?? boardId) ?? first : null;

  const openComposer = (columnId: string, trigger?: HTMLElement) => {
    if (!canEdit) return;
    if (trigger) returnFocus.current = trigger;
    setQuickAddError('');
    setComposerColumn(columnId);
  };

  return (
    <>
      <NewBoardDialog projectId={board.projectId} role={role} open={newBoardOpen} onClose={() => setNewBoardOpen(false)} />
      {can(role, 'invite') && !board.isArchived && <InviteDialog projectId={board.projectId} projectName={project?.name ?? 'this project'} actorRole={role} open={inviteOpen} onClose={() => setInviteOpen(false)} />}
      {!merged && can(role, 'manageBoard') && <ColumnsDialog boardId={board.id} open={columnsOpen} onClose={() => setColumnsOpen(false)} />}
      {!merged && role === 'owner' && <EditBoardDialog board={board} open={editBoardOpen} onClose={() => setEditBoardOpen(false)} />}
      <section className="board-head" aria-labelledby="boardTitle">
        <div className="board-title-row">
          <div className="board-heading">
            <button className="icon-btn menu-btn" ref={shell.menuRef} type="button" aria-label={shell.navVisible ? 'Hide navigation' : 'Show navigation'} aria-controls="rail" aria-expanded={shell.navVisible} title={shell.navVisible ? 'Hide navigation' : 'Show navigation'} onClick={shell.toggleNav}>
              <Icon name="menu" />
            </button>
            <h1 id="boardTitle" tabIndex={-1} title={merged ? infos.map((i) => i.name).join(', ') : board.name}>{merged ? `${infos.length} boards merged` : board.name}</h1>
            <PollAge />
            {board.isArchived && !merged && <span id="boardReadOnly">{projectArchived ? 'Project archived · read-only' : 'Archived · read-only'}</span>}
            {!merged && role === 'owner' && !board.isArchived && (
              <button className="icon-btn edit-board-btn" type="button" aria-label="Edit board name and description" title="Edit board" onClick={() => setEditBoardOpen(true)}>
                <Icon name="edit" />
              </button>
            )}
          </div>
          <div className="board-actions">
            <div className="view-switch" role="group" aria-label="Card view" data-view={view}>
              <button type="button" aria-label="List view" aria-pressed={view === 'list'} aria-controls="board" onClick={() => setParam('view', 'list')}>
                <Icon name="list" /><span className="view-label">List</span>
              </button>
              <button type="button" aria-label="Board view" aria-pressed={view === 'board'} aria-controls="board" onClick={() => setParam('view', null)}>
                <Icon name="board" /><span className="view-label">Board</span>
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{view === 'list' ? 'List' : 'Board'} view</span>
            {canEdit && (
              <button className="btn primary" type="button" aria-label="Add card" title="Add card" onClick={(event) => { if (filtering) setFilters(EMPTY_FILTERS); if (quickAddFirst) openComposer(quickAddFirst, event.currentTarget); }}>
                <Icon name="plus" /><span className="action-label">Add card</span>
              </button>
            )}
            <ActionMenu
              label="Board actions"
              triggerRef={shell.fullscreenRef}
              items={[
                ...(can(role, 'manageBoard') && !board.isArchived ? [{ kind: 'button' as const, label: 'New board', icon: 'plus', onSelect: () => setNewBoardOpen(true) }] : []),
                ...(!merged && can(role, 'manageBoard') && !board.isArchived ? [{ kind: 'button' as const, label: 'Edit columns', icon: 'columns', onSelect: () => setColumnsOpen(true) }] : []),
                { kind: 'link' as const, label: 'Project overview', icon: 'folder', href: `/project?id=${encodeURIComponent(board.projectId)}` },
                ...(can(role, 'invite') && !board.isArchived ? [{ kind: 'button' as const, label: 'Invite people', icon: 'user-plus', onSelect: () => setInviteOpen(true) }] : []),
                { kind: 'button' as const, label: shell.fullscreen ? 'Exit fullscreen' : 'Fullscreen', icon: shell.fullscreen ? 'minimize' : 'maximize', onSelect: () => shell.toggleFullscreen() },
              ]}
            />
          </div>
        </div>

        {!merged && board.description && <p className="board-description" id="boardDescription">{board.description}</p>}

        {merged && (
          <ul className="board-legend" aria-label="Boards in this view">
            {boardIds.map((id, i) => {
              const info = boardInfo.get(id);
              const bad = unhealthy.find((u) => u.id === id);
              return (
                <li key={id} className="board-legend-item" data-tone={boardTone(i)}>
                  <i aria-hidden="true" />
                  <span className="board-legend-name">{info?.name ?? 'Board'}</span>
                  <span className="board-legend-count">{info ? `${info.snap.totals.activeCardCount} cards` : ''}</span>
                  {info && !can(role, 'edit') ? <span className="role-chip">{ROLE_META[role].label}</span> : null}
                  {info?.isArchived ? <span className="role-chip">Read-only</span> : null}
                  {bad ? <span className="board-legend-warn" role="status">{bad.lost ? 'No longer available' : 'Could not refresh'}</span> : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="toolbar" aria-label="Board tools" ref={toolbarRef}>
          {toolbarLead}
          <div className={`search-field${filters.q ? ' has-value' : ''}`}>
            <Icon name="search" className="icon-sm" />
            <label className="sr-only" htmlFor="searchInput">Search cards</label>
            <input id="searchInput" type="search" placeholder="Search…" autoComplete="off" value={filters.q} onChange={(event) => setFilters((f) => ({ ...f, q: event.target.value }))} />
            <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setFilters((f) => ({ ...f, q: '' }))}><Icon name="x" className="icon-sm" /></button>
          </div>

          <div className="filter-wrap">
            <button className={`filter-btn${selectedAssignees.length ? ' has-active' : ''}`} type="button" aria-label={`Filter by assignee${selectedAssignees.length ? `, ${selectedAssignees.length} selected` : ''}`} title="Filter by assignee" aria-expanded={menu === 'assignee'} aria-controls="assigneeMenu" onClick={() => setMenu((m) => (m === 'assignee' ? null : 'assignee'))}>
              <Icon name="users" /><span className="sr-only">Assignees</span>
              <span className="badge" hidden={selectedAssignees.length === 0}>{selectedAssignees.length}</span>
              <Icon name="chevron-down" className="icon-sm" />
            </button>
            <div className="filter-menu" id="assigneeMenu" hidden={menu !== 'assignee'}>
              <h2>Assigned to</h2>
              {assignable.map((person) => (
                <label key={person.id} className="filter-option">
                  <input type="checkbox" checked={selectedAssignees.includes(person.id)} onChange={(event) => setFilters((f) => ({ ...f, assignees: event.target.checked ? [...f.assignees, person.id] : f.assignees.filter((id) => id !== person.id) }))} />{' '}
                  <Avatar id={person.id} name={formatPersonName(person)} /> {formatPersonName(person)}
                </label>
              ))}
              <label className="filter-option">
                <input type="checkbox" checked={selectedAssignees.includes('unassigned')} onChange={(event) => setFilters((f) => ({ ...f, assignees: event.target.checked ? [...f.assignees, 'unassigned'] : f.assignees.filter((id) => id !== 'unassigned') }))} />{' '}
                <span className="avatar empty" aria-hidden="true"><Icon name="users" /></span> Unassigned
              </label>
              <div className="divider" />
              <button className="filter-option" type="button" onClick={() => setFilters((f) => ({ ...f, assignees: [] }))}>Clear assignee filter</button>
            </div>
          </div>

          <div className="filter-wrap">
            <button className={`filter-btn${filters.due !== 'any' ? ' has-active' : ''}`} type="button" aria-label="Filter by due date" title="Filter by due date" aria-expanded={menu === 'due'} aria-controls="dueMenu" onClick={() => setMenu((m) => (m === 'due' ? null : 'due'))}>
              <Icon name="calendar" /><span className="sr-only">Due date</span>
              <span className="badge" hidden={filters.due === 'any'}>1</span>
              <Icon name="chevron-down" className="icon-sm" />
            </button>
            <div className="filter-menu" id="dueMenu" hidden={menu !== 'due'}>
              <h2>Due date</h2>
              {([['any', 'Any date'], ['overdue', 'Overdue'], ['soon', 'Due in 7 days'], ['none', 'No due date']] as const).map(([value, label]) => (
                <label key={value} className="filter-option"><input type="radio" name="dueFilter" checked={filters.due === value} onChange={() => setFilters((f) => ({ ...f, due: value }))} /> {label}</label>
              ))}
            </div>
          </div>

          <button className="clear-filters" type="button" hidden={!filtering} onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</button>
          <div className="toolbar-spacer" />
          {view === 'board' && (
            <label className="card-style-control">
              <span>Cards</span>
              <select aria-label="Card appearance" value={cardStyle} onChange={(event) => setParam('cards', event.target.value === 'glass' ? 'glass' : null)}>
                <option value="focus">Focus</option>
                <option value="glass">Soft glass</option>
              </select>
            </label>
          )}
          <div className="board-status" role="group" aria-label="All cards in this view, before filters">
            <div className="summary-overview"><h2><span>{total}</span> cards</h2></div>
            <div className="distribution" role="group" aria-label={columns.map((c) => `${c.name}: ${c.activeCardCount}`).join(', ')}>
              {columns.filter((c) => c.activeCardCount > 0).map((c) => {
                const detail = `${c.name}\n${c.activeCardCount} card${c.activeCardCount === 1 ? '' : 's'} · ${Math.round((c.activeCardCount / Math.max(total, 1)) * 1000) / 10}% of all ${total} cards`;
                return <span key={c.id} className={`dist-${toneFor(c)}`} style={{ flex: c.activeCardCount }} tabIndex={0} role="img" aria-label={detail} data-tooltip={detail} />;
              })}
            </div>
            <div className="summary-health">
              {overdue > 0 && <span className="summary-note is-overdue" role="img" tabIndex={0} aria-label={`${overdue} overdue card${overdue === 1 ? '' : 's'}`} data-tooltip={`${overdue} overdue card${overdue === 1 ? '' : 's'}`}><Icon name="clock-alert" /><span>{overdue}</span></span>}
              {soon > 0 && <span className="summary-note" role="img" tabIndex={0} aria-label={`${soon} cards due in the next 7 days`} data-tooltip={`${soon} cards due in the next 7 days`}><Icon name="calendar-clock" /><span>{soon}</span></span>}
            </div>
          </div>
          <span className={`filter-hint${filtering && canMove && view === 'board' ? ' is-visible' : ''}`}><Icon name="move" className="icon-sm" /> Use Move</span>
          <span className="result-note" aria-live="polite" hidden={!filtering}><strong>{visibleCount}</strong> of {allCards.length} match</span>
        </div>
        <p className="drop-hint" role="status" hidden={!dropHint}>{dropHint}</p>
      </section>

      <section
        className={`board${view === 'list' ? ' is-list' : ''}`}
        id="board"
        data-card-style={cardStyle}
        aria-label={`${merged ? 'Merged boards' : board.name} ${view === 'list' ? 'list' : 'board'}`}
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerCancel={endTouch}
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            shown={displayCards(column, merged).filter(matches)}
            filtering={filtering}
            view={view}
            cardStyle={cardStyle}
            people={people}
            canEdit={canEdit}
            canMove={canMove}
            canMoveCard={canMoveCard}
            cardChip={chipFor}
            addBoards={merged ? addBoards.map((b) => ({ id: b.id, name: b.name })) : undefined}
            addBoardId={addBoardId ?? undefined}
            onAddBoard={setAddBoardPick}
            addNote={addNoteFor(column)}
            dragId={dragId}
            drop={drop}
            composerOpen={composerColumn === column.id}
            quickAddBusy={quickAddBusy}
            quickAddError={composerColumn === column.id ? quickAddError : ''}
            onOpenComposer={openComposer}
            onCloseComposer={() => { setComposerColumn(null); const t = returnFocus.current; requestAnimationFrame(() => t?.isConnected && t.focus({ preventScroll: true })); }}
            onQuickAdd={(columnId, title, priority) => void addCard(columnId, title, priority)}
            onOpenCard={openCard}
            onMoveCard={(card, trigger) => { returnFocus.current = trigger; setMoveCard(card); }}
            onDragStart={onDragStart}
            onDragEnd={clearDrag}
            onDragOverZone={onDragOverZone}
            onDragLeaveColumn={onDragLeaveColumn}
            onDropZone={onDropZone}
          />
        ))}
      </section>
      {columns.length === 0 && <p className="state-note">This board has no columns yet.</p>}

      <footer className="board-foot">
        <span className="foot-role">{ROLE_META[role].label} · {ROLE_META[role].description}</span>
        <span className="sep" aria-hidden="true" />
        <span>{!canMove ? 'Open a card to view its details' : view === 'list' ? 'Use Move to change a card’s column' : merged ? 'Drag a card to another column of its own board, or use Move' : 'Drag cards, or use Move for keyboard and filtered views'}</span>
      </footer>

      <MoveDialog
        card={moveCard}
        columns={moveColumns}
        busy={moveMutation.isPending}
        onClose={() => { setMoveCard(null); const t = returnFocus.current; requestAnimationFrame(() => t?.isConnected && t.focus({ preventScroll: true })); }}
        onConfirm={(card, toColumnId, position) => {
          setMoveCard(null);
          const dest = moveColumns.find((c) => c.id === toColumnId);
          const count = dest ? sortedCards(dest).filter((c) => c.id !== card.id).length : 0;
          performMove(card, moveInfo?.id ?? boardId, toColumnId, position === 'top' ? 0 : count);
        }}
      />

      {cardId && drawerInfo && (
        <CardDetailDrawer
          key={cardId}
          cardId={cardId}
          summary={cardIndex.get(cardId)?.card ?? null}
          columns={[...drawerInfo.snap.columns].sort((a, b) => a.position - b.position)}
          people={people}
          role={projectArchived ? 'viewer' : role}
          boardName={drawerInfo.name}
          structureVersion={drawerInfo.snap.board.structureVersion}
          onClose={closeCard}
          onChanged={() => refresh(drawerInfo.id)}
          onRequestMove={(card) => { setMoveCard(card); }}
        />
      )}
    </>
  );
}

/**
 * Chooses which boards to show: one board as before, or two to six merged into one set of columns (BoardWorkspace).
 */
export function BoardView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useSession();
  const idParam = params.get('id');
  const boardsParam = params.get('boards');
  const view: 'board' | 'list' = params.get('view') === 'list' ? 'list' : 'board';
  const cardStyle: CardStyle = params.get('cards') === 'glass' ? 'glass' : 'focus';
  const shell = useShell();

  const firstId = parseBoardsParam(boardsParam)[0] ?? idParam;
  const firstBoard = useQuery(boardQueryOptions(firstId));
  const projectId = firstBoard.data?.board.projectId ?? null;
  const signedIn = state.status === 'ready';
  const boardsQuery = useQuery({
    queryKey: ['boards', projectId],
    queryFn: async () => (await api.listProjectBoards(projectId!)).data,
    enabled: !!projectId && signedIn,
  });
  usePollKeys([['boards', projectId]], !!projectId && signedIn);
  const boards = boardsQuery.data ?? null;
  const defaultBoardId = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === projectId)?.defaultBoardId ?? null : null;
  const [remembered, setRemembered] = useState<string[]>([]);
  const [memoryReady, setMemoryReady] = useState(false);
  useEffect(() => { if (projectId) { setRemembered(readMemory(projectId)); setMemoryReady(true); } }, [projectId]);

  // Until the board list and the memory are known, the single ?id= is used: today's behaviour, no waiting.
  const selection = useMemo(
    () => resolveSelection({ idParam, boardsParam, remembered, boards: memoryReady ? boards : null, defaultBoardId }),
    [idParam, boardsParam, remembered, boards, memoryReady, defaultBoardId],
  );

  const write = useCallback((ids: string[], extra?: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(window.location.search);
    next.set('id', ids[0]!);
    if (ids.length > 1) next.set('boards', formatBoardsParam(ids)); else next.delete('boards');
    next.delete('card'); next.delete('cardBoard');
    extra?.(next);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router]);
  // The latest choice is kept in a ref: router.replace lands a moment later, and a second quick click must build on the first.
  const latest = useRef<string[]>(selection);
  const selectionKey = formatBoardsParam(selection);
  useEffect(() => { latest.current = selection; }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = useCallback((ids: string[]) => { latest.current = ids; setRemembered(ids.length >= 2 ? ids : []); if (projectId) writeMemory(projectId, ids); write(ids); }, [projectId, write]);
  const update = useCallback((fn: (previous: string[]) => string[]) => choose(fn(latest.current)), [choose]);

  // Normalise the address bar once the list is known (stale ids dropped, remembered view restored) without adding history entries.
  const canonical = formatBoardsParam(selection);
  useEffect(() => {
    if (!memoryReady || !boards || !selection.length) return;
    const current = parseBoardsParam(boardsParam);
    const wantsParam = selection.length > 1;
    const same = wantsParam ? formatBoardsParam(current) === canonical && idParam === selection[0] : !boardsParam && idParam === selection[0];
    if (!same) write(selection);
    if (projectId && wantsParam) writeMemory(projectId, selection);
  }, [memoryReady, boards, selection, canonical, boardsParam, idParam, projectId, write]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (!selection.length) {
    return <section className="state-note"><h1>No board selected</h1><Link className="btn" href="/projects">Back to projects</Link></section>;
  }
  const switcher = showSwitcher(boards) && boards
    ? <BoardSwitcher boards={boards} selected={selection} onSwitch={(id) => choose([id])} onChange={update} />
    : null;

  return <BoardWorkspace key={formatBoardsParam(selection)} boardIds={selection} toolbarLead={switcher} />;
}
