'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardSnapshotData, CardSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { boardQueryOptions } from '@/lib/queries';
import { daysUntil } from '@/lib/dates';
import { EMPTY_FILTERS, filtersActive, neighbours, optimisticMove, sortedCards, toneFor, type Filters } from '@/lib/board-model';
import { can, normalizeRole, ROLE_META } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toasts';
import { useShell } from '@/components/shell/shell-context';
import { CardDetailDrawer } from '@/components/board/card-detail-drawer';
import { BoardColumn, type DropTarget } from './board-column';
import { MoveDialog } from './move-dialog';
import type { CardStyle } from './board-card';

export function BoardView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const shell = useShell();
  const { state } = useSession();
  const boardId = params.get('id');
  const cardId = params.get('card');
  const view: 'board' | 'list' = params.get('view') === 'list' ? 'list' : 'board';
  const cardStyle: CardStyle = params.get('cards') === 'glass' ? 'glass' : 'focus';

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [menu, setMenu] = useState<null | 'assignee' | 'due'>(null);
  const [composerColumn, setComposerColumn] = useState<string | null>(null);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');
  const [moveCard, setMoveCard] = useState<CardSummary | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const boardQuery = useQuery(boardQueryOptions(boardId));
  const snapshot = boardQuery.data;
  const boardKey = useMemo(() => ['board', boardId] as const, [boardId]);
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: boardKey }), [queryClient, boardKey]);

  const people = useMemo(() => new Map<string, PersonDisplay>((snapshot?.people ?? []).map((p) => [p.id, p])), [snapshot]);
  const columns = useMemo(() => [...(snapshot?.columns ?? [])].sort((a, b) => a.position - b.position), [snapshot]);
  const project = state.status === 'ready' ? state.session.accessibleProjects.find((p) => p.id === snapshot?.board.projectId) : undefined;
  const role = normalizeRole(project?.role);
  const canEdit = can(role, 'edit') && !snapshot?.board.isArchived;
  const canMove = can(role, 'move') && !snapshot?.board.isArchived;
  const filtering = filtersActive(filters);

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
      const hay = [card.title, card.key ?? '', card.descriptionExcerpt ?? '', ...card.assigneeIds.map((id) => people.get(id)?.displayName ?? '')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.assignees.length) {
      const wantsUnassigned = filters.assignees.includes('unassigned');
      const wantsPerson = filters.assignees.some((id) => id !== 'unassigned');
      const hit = card.assigneeIds.some((id) => filters.assignees.includes(id));
      if (!(wantsUnassigned && card.assigneeIds.length === 0) && !(wantsPerson && hit)) return false;
    }
    if (filters.due !== 'any') {
      const done = columns.find((c) => c.id === card.columnId)?.category === 'done';
      if (done) return false;
      if (filters.due === 'none') return !card.dueDate;
      if (!card.dueDate) return false;
      const days = daysUntil(card.dueDate)!;
      if (filters.due === 'overdue' && days >= 0) return false;
      if (filters.due === 'soon' && (days < 0 || days > 7)) return false;
    }
    return true;
  }, [filters, people, columns]);

  const moveMutation = useMutation({
    mutationFn: ({ card, toColumnId, index }: { card: CardSummary; toColumnId: string; index: number }) => {
      const { previousCardId, nextCardId } = neighbours(columns.find((c) => c.id === toColumnId), card.id, index);
      return api.moveCard(card.id, {
        toColumnId,
        previousCardId,
        nextCardId,
        expectedVersion: card.version,
        expectedBoardVersion: snapshot!.board.structureVersion,
      });
    },
    onMutate: async ({ card, toColumnId, index }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardSnapshotData>(boardKey);
      if (previous) queryClient.setQueryData<BoardSnapshotData>(boardKey, optimisticMove(previous, card, toColumnId, index));
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
      toast(describeError(error), { tone: 'danger', icon: 'alert' });
    },
    onSettled: refresh,
  });

  const performMove = useCallback((card: CardSummary, toColumnId: string, index: number) => {
    const from = columns.find((c) => c.id === card.columnId);
    const dest = columns.find((c) => c.id === toColumnId);
    if (!dest) return;
    const source = sortedCards(from!);
    const at = source.findIndex((c) => c.id === card.id);
    const origin = { previousCardId: source[at - 1]?.id ?? null, nextCardId: source[at + 1]?.id ?? null };
    moveMutation.mutate({ card, toColumnId, index }, {
      onSuccess: () => {
        // The trigger may now live in another column; keep keyboard focus on the moved card.
        window.setTimeout(() => document.querySelector<HTMLElement>(`.card[data-card-id="${card.id}"] .card-open`)?.focus({ preventScroll: true }), 400);
        toast(`${card.title} moved to ${dest.name}`, {
          icon: 'move',
          undo: () => {
            const latest = queryClient.getQueryData<BoardSnapshotData>(boardKey)?.columns.flatMap((c) => c.cards).find((c) => c.id === card.id);
            const structure = queryClient.getQueryData<BoardSnapshotData>(boardKey)?.board.structureVersion ?? snapshot!.board.structureVersion;
            api.moveCard(card.id, {
              toColumnId: card.columnId,
              previousCardId: origin.previousCardId,
              nextCardId: origin.nextCardId,
              expectedVersion: latest?.version ?? card.version + 1,
              expectedBoardVersion: structure,
            }).then(() => { toast('Move undone.'); refresh(); }).catch((error) => { toast(describeError(error), { tone: 'danger', icon: 'alert' }); refresh(); });
          },
        });
      },
    });
  }, [columns, moveMutation, toast, queryClient, boardKey, snapshot, refresh]);

  const addCard = useCallback(async (columnId: string, title: string, priority: string) => {
    if (!snapshot) return;
    setQuickAddBusy(true);
    setQuickAddError('');
    try {
      const res = await api.createCard(snapshot.board.id, {
        title,
        description: '',
        priority: priority as CardSummary['priority'],
        columnId,
        dueDate: null,
        assigneeIds: [],
        expectedBoardVersion: snapshot.board.structureVersion,
      });
      const column = columns.find((c) => c.id === columnId);
      setComposerColumn(null);
      refresh();
      toast(`Card added to ${column?.name ?? 'column'}`, {
        icon: 'check',
        undo: () => {
          const board = queryClient.getQueryData<BoardSnapshotData>(boardKey)?.board ?? snapshot.board;
          api.softDeleteCard(res.data.id, { expectedVersion: res.data.version ?? 1, expectedBoardVersion: board.structureVersion })
            .then(() => { toast('Card removed.'); refresh(); })
            .catch((error) => { toast(describeError(error), { tone: 'danger', icon: 'alert' }); refresh(); });
        },
      });
    } catch (error) {
      setQuickAddError(describeError(error));
      refresh();
    } finally {
      setQuickAddBusy(false);
    }
  }, [snapshot, columns, refresh, toast, queryClient, boardKey]);

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
  const onDragOverZone = (columnId: string, event: DragEvent<HTMLElement>) => {
    if (!dragRef.current || !canMove || filtering) return;
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
    if (!id || !canMove || filtering) return;
    event.preventDefault();
    const card = columns.flatMap((c) => c.cards).find((c) => c.id === id);
    const index = indexFromPointer(event.currentTarget, event);
    clearDrag();
    if (card) performMove(card, columnId, index);
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
    const cardId = cardEl.dataset.cardId;
    if (!cardId) return;
    cardEl.setAttribute('data-touch-drag', 'pending');
    cardEl.setAttribute('draggable', 'false'); // keep native drag from competing with the long-press
    const state = { cardId, x: event.clientX, y: event.clientY, timer: null as number | null, active: false, ghost: null as HTMLElement | null, cardEl };
    touchRef.current = state;
    state.timer = window.setTimeout(() => {
      state.active = true;
      dragRef.current = cardId;
      setDragId(cardId);
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
    const card = columns.flatMap((c) => c.cards).find((c) => c.id === t.cardId);
    const index = hit ? indexFromY(hit.column, event.clientY) : 0;
    endTouch();
    if (hit && card) performMove(card, hit.columnId, index);
  };

  const openCard = (card: CardSummary, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    const next = new URLSearchParams(params.toString());
    next.set('card', card.id);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const closeCard = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('card');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    const target = returnFocus.current;
    requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
  }, [params, pathname, router]);

  if (!boardId) {
    return <section className="state-note"><h1>No board selected</h1><Link className="btn" href="/projects">Back to projects</Link></section>;
  }
  if (boardQuery.isPending) return <div role="status" className="state-note">Loading board…</div>;
  if (boardQuery.isError || !snapshot) {
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

  const board = snapshot.board;
  const allCards = columns.flatMap((c) => c.cards);
  const total = snapshot.totals.activeCardCount;
  const notDone = allCards.filter((c) => columns.find((col) => col.id === c.columnId)?.category !== 'done');
  const overdue = snapshot.totals.overdueCount ?? notDone.filter((c) => c.dueDate && (daysUntil(c.dueDate) ?? 0) < 0).length;
  const soon = snapshot.totals.dueSoonCount ?? notDone.filter((c) => c.dueDate && (daysUntil(c.dueDate) ?? -1) >= 0 && (daysUntil(c.dueDate) ?? 99) <= 7).length;
  const visibleCount = allCards.filter(matches).length;
  const selectedAssignees = filters.assignees;
  const assignable = snapshot.people.filter((p) => p.activeInProject);
  const quickAddFirst = columns[0]?.id ?? null;

  const openComposer = (columnId: string, trigger?: HTMLElement) => {
    if (!canEdit) return;
    if (trigger) returnFocus.current = trigger;
    setQuickAddError('');
    setComposerColumn(columnId);
  };

  return (
    <>
      <section className="board-head" aria-labelledby="boardTitle">
        <div className="board-title-row">
          <div className="board-heading">
            <button className="icon-btn menu-btn" ref={shell.menuRef} type="button" aria-label={shell.navVisible ? 'Hide navigation' : 'Show navigation'} aria-controls="rail" aria-expanded={shell.navVisible} title={shell.navVisible ? 'Hide navigation' : 'Show navigation'} onClick={shell.toggleNav}>
              <Icon name="menu" />
            </button>
            <h1 id="boardTitle" title={board.name}>{board.name}</h1>
            {board.isArchived && <span id="boardReadOnly">Archived · read-only</span>}
          </div>
          <div className="board-actions">
            {can(role, 'invite') && (
              <button className="icon-btn share-control" type="button" aria-label="Share board (coming soon)" title="Sharing is coming soon" aria-disabled="true" onClick={(event) => event.preventDefault()}>
                <Icon name="user-plus" />
              </button>
            )}
            <div className="view-switch" role="group" aria-label="Card view" data-view={view}>
              <button type="button" aria-label="List view" aria-pressed={view === 'list'} aria-controls="board" onClick={() => setParam('view', 'list')}>
                <Icon name="list" /><span className="view-label">List</span>
              </button>
              <button type="button" aria-label="Board view" aria-pressed={view === 'board'} aria-controls="board" onClick={() => setParam('view', null)}>
                <Icon name="board" /><span className="view-label">Board</span>
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{view === 'list' ? 'List' : 'Board'} view</span>
            <Link className="btn" href={`/project?id=${encodeURIComponent(board.projectId)}`} title="Browse projects and their boards">
              <Icon name="folder" /><span className="action-label">Projects</span>
            </Link>
            {canEdit && (
              <button className="btn primary" type="button" aria-label="Add card" title="Add card" onClick={(event) => { if (filtering) setFilters(EMPTY_FILTERS); if (quickAddFirst) openComposer(quickAddFirst, event.currentTarget); }}>
                <Icon name="plus" /><span className="action-label">Add card</span>
              </button>
            )}
            <button className="icon-btn" id="fullscreenBtn" ref={shell.fullscreenRef} type="button" aria-pressed={shell.fullscreen} aria-label={shell.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={shell.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void shell.toggleFullscreen()}>
              <Icon name="maximize" className="fullscreen-enter" />
              <Icon name="minimize" className="fullscreen-exit" />
            </button>
          </div>
        </div>

        <div className="toolbar" aria-label="Board tools" ref={toolbarRef}>
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
                  <Avatar id={person.id} name={person.displayName} /> {person.displayName}
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
          <div className="board-status" role="group" aria-label="All cards on this board, before filters">
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
      </section>

      <section
        className={`board${view === 'list' ? ' is-list' : ''}`}
        id="board"
        data-card-style={cardStyle}
        aria-label={`${board.name} ${view === 'list' ? 'list' : 'board'}`}
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerCancel={endTouch}
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            shown={sortedCards(column).filter(matches)}
            filtering={filtering}
            view={view}
            cardStyle={cardStyle}
            people={people}
            canEdit={canEdit}
            canMove={canMove}
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
        <span>{!canMove ? 'Open a card to view its details' : view === 'list' ? 'Use Move to change a card’s column' : 'Drag cards, or use Move for keyboard and filtered views'}</span>
      </footer>

      <MoveDialog
        card={moveCard}
        columns={columns}
        busy={moveMutation.isPending}
        onClose={() => { setMoveCard(null); const t = returnFocus.current; requestAnimationFrame(() => t?.isConnected && t.focus({ preventScroll: true })); }}
        onConfirm={(card, toColumnId, position) => {
          setMoveCard(null);
          const dest = columns.find((c) => c.id === toColumnId);
          const count = dest ? sortedCards(dest).filter((c) => c.id !== card.id).length : 0;
          performMove(card, toColumnId, position === 'top' ? 0 : count);
        }}
      />

      {cardId && (
        <CardDetailDrawer
          key={cardId}
          cardId={cardId}
          summary={allCards.find((c) => c.id === cardId) ?? null}
          columns={columns}
          people={people}
          role={role}
          boardName={board.name}
          structureVersion={board.structureVersion}
          onClose={closeCard}
          onChanged={refresh}
          onRequestMove={(card) => { setMoveCard(card); }}
        />
      )}
    </>
  );
}
