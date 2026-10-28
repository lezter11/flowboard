'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Filter, Maximize2, Minimize2, Plus, RotateCcw, RefreshCw } from 'lucide-react';
import { MOCK_BOARDS, MOCK_COLUMNS, MOCK_PROJECT, INITIAL_MOCK_CARDS, type MockCard, type MockBoard } from '@/lib/mock-data';
import { api, type ApiError } from '@/lib/api';
import { KanbanCard } from './kanban-card';
import { CardDetailDialog } from './card-detail-dialog';
import { AddCardDialog } from './add-card-dialog';

const STORAGE_KEY = 'flowboard-preview-cards-v1';

interface BoardViewProps {
  boardId?: string;
  projectId?: string;
}

export function BoardView({ boardId, projectId }: BoardViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const currentBoardId = boardId ?? params.get('board') ?? 'unified';
  const combined = currentBoardId === 'unified';
  const searchQuery = params.get('q') ?? '';

  const [cards, setCards] = useState<MockCard[]>(INITIAL_MOCK_CARDS);
  const [boards, setBoards] = useState<MockBoard[]>(MOCK_BOARDS);
  const [projectName, setProjectName] = useState(MOCK_PROJECT.name);
  const [activeProjectId, setActiveProjectId] = useState(projectId ?? MOCK_PROJECT.id);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedCard, setSelectedCard] = useState<MockCard | null>(null);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const boardRootRef = useRef<HTMLDivElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Synchronize fullscreen
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === boardRootRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === boardRootRef.current) await document.exitFullscreen();
      else await boardRootRef.current?.requestFullscreen();
    } catch {
      setNotice('Fullscreen is unavailable in this browser.');
    }
  };

  // Attempt to load live backend data if session exists
  const loadLiveData = useCallback(async () => {
    try {
      setIsLoadingLive(true);
      const session = await api.getSession();
      if (!session?.data?.actor) {
        setIsLiveConnected(false);
        return;
      }

      setIsLiveConnected(true);
      const targetProjectId = projectId || session.data.accessibleProjects[0]?.id || MOCK_PROJECT.id;
      setActiveProjectId(targetProjectId);

      // Fetch live project boards
      const boardListRes = await api.listProjectBoards(targetProjectId);
      const rawBoards = boardListRes?.data;
      if (Array.isArray(rawBoards) && rawBoards.length > 0) {
        const liveBoards: MockBoard[] = [
          {
            id: 'unified',
            projectId: targetProjectId,
            previewAccessible: true,
            name: 'Unified View (All Boards)',
            slug: 'unified',
            description: '1-Click Master Rollup across all team boards in this project',
          },
          ...rawBoards.map((b) => ({
            id: b.id,
            projectId: targetProjectId,
            previewAccessible: true,
            name: b.name,
            slug: b.id,
            description: 'Team Kanban workflow',
          })),
        ];
        setBoards(liveBoards);

        // Fetch snapshots for cards
        const targetBoards = combined
          ? rawBoards
          : rawBoards.filter((b) => b.id === currentBoardId);

        if (targetBoards.length > 0) {
          const snapshots = await Promise.allSettled(
            targetBoards.map((b) => api.getBoardSnapshot(b.id))
          );

          const liveCards: MockCard[] = [];
          snapshots.forEach((snapResult, index) => {
            if (snapResult.status === 'fulfilled' && snapResult.value?.data) {
              const snap = snapResult.value.data;
              const b = targetBoards[index]!;
              snap.columns.forEach((col) => {
                let mappedCol: MockCard['columnId'] = 'col_todo';
                if (col.category === 'active') mappedCol = 'col_progress';
                else if (col.category === 'done') mappedCol = 'col_done';

                col.cards.forEach((c) => {
                  liveCards.push({
                    id: c.id,
                    key: c.id.substring(0, 8).toUpperCase(),
                    title: c.title,
                    description: '',
                    boardId: b.id,
                    boardName: b.name,
                    columnId: mappedCol,
                    priority: c.priority,
                    assigneeIds: c.assigneeIds || [],
                    dueDate: c.dueDate || null,
                    commentCount: c.commentCount || 0,
                    imageCount: c.imageCount || 0,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
                  });
                });
              });
            }
          });

          if (liveCards.length > 0 || !combined) {
            setCards(liveCards);
          }
        }
      }
    } catch {
      // Offline fallback: keep mock cards
      setIsLiveConnected(false);
    } finally {
      setIsLoadingLive(false);
      setReady(true);
    }
  }, [combined, currentBoardId, projectId]);

  // Initial load: restore session cache or load live
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCards(parsed.filter((item): item is MockCard =>
            !!item && typeof item === 'object' && typeof item.id === 'string'
          ));
        }
      }
    } catch { /* Fallback to mock cards */ }

    void loadLiveData();
  }, [loadLiveData]);

  // Cache cards to session storage
  useEffect(() => {
    if (ready && !isLiveConnected) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    }
  }, [cards, isLiveConnected, ready]);

  const activeBoard = boards.find((board) => board.id === currentBoardId);
  const boardIds = useMemo(() => new Set(boards.map((b) => b.id)), [boards]);
  const available = !!activeBoard && (combined || boardIds.has(currentBoardId));

  const visibleCards = useMemo(() => cards.filter((card) => {
    if (!combined && card.boardId !== currentBoardId) return false;
    if (priorityFilter !== 'all' && card.priority !== priorityFilter) return false;
    const q = searchQuery.trim().toLocaleLowerCase();
    return !q || [card.title, card.key, card.description, ...(card.tags ?? [])].some((value) => value.toLocaleLowerCase().includes(q));
  }), [cards, combined, currentBoardId, priorityFilter, searchQuery]);

  if (!available) {
    return (
      <div className="flex-1 p-8 max-w-3xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-ink">Board unavailable</h1>
        <p className="mt-2 text-sm text-muted">This board is not in the selected project or is not available to your role.</p>
        <button type="button" onClick={() => router.push('/')} className="mt-4 text-accent underline focus-visible:outline-2">
          Back to all boards
        </button>
      </div>
    );
  }

  const updateCard = async (updated: MockCard) => {
    setCards((previous) => previous.map((card) => card.id === updated.id ? updated : card));
    setSelectedCard(null);

    if (isLiveConnected) {
      try {
        await api.updateCard(updated.id, {
          title: updated.title,
          description: updated.description,
          priority: updated.priority,
          dueDate: updated.dueDate,
          assigneeIds: updated.assigneeIds,
          expectedVersion: 1,
        });
        setNotice('Card updated and saved to server.');
      } catch {
        setNotice('Card updated in local preview (server sync pending).');
      }
    } else {
      setNotice('Card changes are in this browser session only.');
    }
    restoreDialogFocus();
  };

  const addCard = async (card: MockCard) => {
    setCards((previous) => [card, ...previous]);

    if (isLiveConnected && card.boardId && card.boardId !== 'unified') {
      try {
        await api.createCard(card.boardId, {
          title: card.title,
          description: card.description,
          priority: card.priority,
          columnId: card.columnId,
          dueDate: card.dueDate,
          assigneeIds: card.assigneeIds,
          expectedBoardVersion: 1,
        });
        setNotice('Card created and saved to server.');
        void loadLiveData();
      } catch {
        setNotice('Card added to this browser preview only.');
      }
    } else {
      setNotice('Card added to this browser session preview only.');
    }
  };

  const restoreDialogFocus = () => {
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };

  const openAddCard = () => {
    dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsAddCardOpen(true);
  };

  const closeAddCard = () => {
    setIsAddCardOpen(false);
    restoreDialogFocus();
  };

  const openCard = (card: MockCard) => {
    if (combined) {
      router.push(`/boards/${encodeURIComponent(card.boardId)}?card=${encodeURIComponent(card.id)}`);
    } else {
      dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelectedCard(card);
    }
  };

  const closeCard = () => {
    setSelectedCard(null);
    if (cardFromLink) router.replace(`/boards/${encodeURIComponent(currentBoardId)}`);
    restoreDialogFocus();
  };

  const cardsByColumn = MOCK_COLUMNS.map((column) => ({
    column,
    items: visibleCards.filter((card) => card.columnId === column.id),
  }));

  const cardFromLink = params.get('card');
  const detailCard = selectedCard ?? (!combined && cardFromLink ? visibleCards.find((card) => card.id === cardFromLink) ?? null : null);

  return (
    <div
      ref={boardRootRef}
      className={`flex-1 flex flex-col p-4 sm:p-6 mx-auto w-full space-y-5 overflow-y-auto bg-canvas ${
        isFullscreen ? 'max-w-none h-dvh' : 'max-w-7xl'
      }`}
    >
      {/* Header with Project info and Live Connection Indicator */}
      <div className="border-b border-line pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {projectName} · {isLiveConnected ? 'Connected to API' : 'Local preview'}
            </p>
            {isLiveConnected && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                Live
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">
            {combined ? 'All boards' : activeBoard.name}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {combined
              ? 'One-project view of the boards shown in this preview. Open a card on its source board to edit it.'
              : activeBoard.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isLoadingLive && (
            <span title="Syncing...">
              <RefreshCw className="h-4 w-4 animate-spin text-muted" />
            </span>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit board fullscreen' : 'Enter board fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Use full screen'}
            className="rounded-xl border border-line bg-surface p-2.5 text-ink hover:bg-surface-3 focus-visible:outline-2"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {!combined && (
            <button
              type="button"
              onClick={openAddCard}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-[var(--accent-ink)] font-semibold text-xs hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Plus className="w-4 h-4" />
              Add card
            </button>
          )}
        </div>
      </div>

      {/* Board Selector Tabs and Filter Controls */}
      <div className="flex flex-wrap justify-between gap-3 text-xs">
        <nav aria-label="Project boards" className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-surface-3 border border-line">
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              aria-current={currentBoardId === board.id ? 'page' : undefined}
              onClick={() => router.push(board.id === 'unified' ? '/' : `/boards/${encodeURIComponent(board.id)}`)}
              className={`px-3 py-1.5 rounded-lg font-semibold hover:bg-surface focus-visible:outline-2 transition-all ${
                currentBoardId === board.id ? 'bg-surface text-ink shadow-xs' : 'text-muted'
              }`}
            >
              {board.id === 'unified' ? 'All boards (Unified)' : board.name}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <label htmlFor="priority-filter" className="flex items-center gap-1 text-muted">
            <Filter className="w-4 h-4" />
            Priority
          </label>
          <select
            id="priority-filter"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink"
          >
            <option value="all">All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">None</option>
          </select>
          {priorityFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setPriorityFilter('all')}
              aria-label="Clear priority filter"
              className="p-2 text-muted hover:text-ink focus-visible:outline-2"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p role="status" className="rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      )}

      {/* Matching Card Counters: Todo / Progress / Done (Done strictly pastel green #eaf6ed / #166534 / #b8f2c8) */}
      <div className="grid grid-cols-3 gap-3" aria-label="Matching card counts">
        <div className="p-3 rounded-xl border border-line bg-surface">
          <p className="text-[11px] uppercase text-muted font-bold">Matching cards</p>
          <p className="text-xl font-extrabold text-ink">{visibleCards.length}</p>
        </div>
        <div className="p-3 rounded-xl border border-line bg-surface">
          <p className="text-[11px] uppercase text-muted font-bold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            In progress
          </p>
          <p className="text-xl font-extrabold text-blue-600">{cardsByColumn[1]?.items.length ?? 0}</p>
        </div>
        <div className="p-3 rounded-xl border badge-completed">
          <p className="text-[11px] uppercase text-[var(--dot-completed)] font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Done
          </p>
          <p className="text-xl font-extrabold text-[var(--dot-completed)]">{cardsByColumn[2]?.items.length ?? 0}</p>
        </div>
      </div>

      {/* Kanban Board Columns: Column Done is strictly column-completed pastel green */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start flex-1">
        {cardsByColumn.map(({ column, items }) => (
          <section
            key={column.id}
            aria-label={`${column.name}, ${items.length} cards`}
            className={`rounded-2xl border p-3.5 flex flex-col min-h-[360px] ${
              column.id === 'col_done'
                ? 'column-completed'
                : column.id === 'col_progress'
                ? 'bg-[#dceefa]/40 border-sky-200'
                : 'bg-surface-2 border-line'
            }`}
          >
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider px-1 mb-3 flex justify-between">
              <span>{column.name}</span>
              <span>{items.length}</span>
            </h2>

            <div className="space-y-3 flex-1">
              {items.map((card) => (
                <div key={card.id}>
                  {combined && <p className="mb-1 text-[11px] font-semibold text-muted">{card.boardName}</p>}
                  <KanbanCard card={card} onClick={() => openCard(card)} />
                </div>
              ))}
              {items.length === 0 && (
                <p className="p-8 text-center text-muted text-xs border border-dashed border-line rounded-xl">
                  No matching cards
                </p>
              )}
            </div>

            {!combined && (
              <button
                type="button"
                onClick={openAddCard}
                className="w-full mt-3 py-2 rounded-xl border border-dashed border-line text-xs font-semibold text-muted hover:text-ink hover:bg-surface focus-visible:outline-2"
              >
                + Add card
              </button>
            )}
          </section>
        ))}
      </div>

      <CardDetailDialog
        key={detailCard?.id ?? 'none'}
        card={detailCard}
        isOpen={!!detailCard}
        onClose={closeCard}
        onUpdateCard={updateCard}
        portalContainer={boardRootRef.current}
      />
      <AddCardDialog
        isOpen={isAddCardOpen}
        onClose={closeAddCard}
        onAddCard={addCard}
        activeBoardId={currentBoardId}
        portalContainer={boardRootRef.current}
      />
    </div>
  );
}
