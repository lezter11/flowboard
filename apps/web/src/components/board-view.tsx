'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import type { BoardSnapshotData, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { boardQueryOptions } from '@/lib/queries';
import { KanbanCard } from './kanban-card';
import { CardDetailDialog } from './card-detail-dialog';
import { AddCardDialog } from './add-card-dialog';

/** Pure client-side preview of a move; the server response replaces it on settle. */
function optimisticMove(snapshot: BoardSnapshotData, card: CardSummary, toColumnId: string): BoardSnapshotData {
  return {
    ...snapshot,
    columns: snapshot.columns.map((col) => {
      if (col.id === card.columnId && col.id !== toColumnId) {
        return {
          ...col,
          cards: col.cards.filter((c) => c.id !== card.id),
          activeCardCount: Math.max(0, col.activeCardCount - 1),
          matchingCardCount: Math.max(0, col.matchingCardCount - 1),
        };
      }
      if (col.id === toColumnId && col.id !== card.columnId) {
        const maxPosition = col.cards.reduce((max, c) => Math.max(max, c.position), 0);
        const moved: CardSummary = { ...card, columnId: toColumnId, position: maxPosition + 1000 };
        return {
          ...col,
          cards: [...col.cards, moved],
          activeCardCount: col.activeCardCount + 1,
          matchingCardCount: col.matchingCardCount + 1,
        };
      }
      return col;
    }),
  };
}

export function BoardView() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const boardId = params.get('id');
  const cardId = params.get('card');
  const filter = (params.get('q') ?? '').trim().toLocaleLowerCase();

  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeDropColumnId, setActiveDropColumnId] = useState<string | null>(null);
  const dragCounters = useRef<Record<string, number>>({});
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const boardQuery = useQuery(boardQueryOptions(boardId));
  const snapshot = boardQuery.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['board', boardId] });

  // Clean up drag indicators if drag ends outside any drop zone
  useEffect(() => {
    const onGlobalDragEnd = () => {
      setActiveDropColumnId(null);
      dragCounters.current = {};
    };
    window.addEventListener('dragend', onGlobalDragEnd);
    return () => window.removeEventListener('dragend', onGlobalDragEnd);
  }, []);

  const people = useMemo(() => new Map<string, PersonDisplay>((snapshot?.people ?? []).map((p) => [p.id, p])), [snapshot]);
  const columns = useMemo(() => [...(snapshot?.columns ?? [])].sort((a, b) => a.position - b.position), [snapshot]);

  const moveMutation = useMutation({
    mutationFn: ({ card, toColumnId }: { card: CardSummary; toColumnId: string }) => {
      const dest = columns.find((c) => c.id === toColumnId);
      const last = [...(dest?.cards ?? [])].filter((c) => c.id !== card.id).sort((a, b) => a.position - b.position).at(-1);
      return api.moveCard(card.id, {
        toColumnId,
        previousCardId: last?.id ?? null,
        nextCardId: null,
        expectedVersion: card.version,
        expectedBoardVersion: snapshot!.board.structureVersion,
      });
    },
    onMutate: async ({ card, toColumnId }) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] });
      const previous = queryClient.getQueryData<BoardSnapshotData>(['board', boardId]);
      if (previous) queryClient.setQueryData<BoardSnapshotData>(['board', boardId], optimisticMove(previous, card, toColumnId));
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['board', boardId], context.previous);
      setNotice(describeError(error));
    },
    onSuccess: (_data, { toColumnId }) => {
      setNotice(`Card moved to ${columns.find((c) => c.id === toColumnId)?.name ?? 'column'}.`);
    },
    onSettled: refresh,
  });

  if (!boardId) {
    return <div className="flex-1 p-8 text-sm text-muted">No board selected. <Link href="/projects" className="text-accent underline">Back to projects</Link></div>;
  }
  if (boardQuery.isPending) {
    return <div role="status" className="flex-1 p-12 text-sm text-muted">Loading board...</div>;
  }
  if (boardQuery.isError || !snapshot) {
    const status = boardQuery.error instanceof ApiError ? boardQuery.error.status : 0;
    return (
      <div role="alert" className="flex-1 p-8 max-w-3xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-ink">{status === 401 ? 'You are signed out' : 'Board unavailable'}</h1>
        <p className="mt-2 text-sm text-muted">
          {status === 401 ? 'Sign in to open this board.' : status === 403 || status === 404 ? 'This board does not exist or you do not have access to it.' : describeError(boardQuery.error)}
        </p>
        <div className="mt-4 flex gap-3">
          {status === 401 ? <Link href="/signin" className="text-accent underline">Sign in</Link> : <Link href="/projects" className="text-accent underline">Back to projects</Link>}
          {status !== 401 && status !== 403 && status !== 404 && <button type="button" onClick={() => void boardQuery.refetch()} className="text-accent underline">Try again</button>}
        </div>
      </div>
    );
  }

  const board = snapshot.board;
  const allCards = columns.flatMap((c) => c.cards);
  const matches = (card: CardSummary) => !filter || card.title.toLocaleLowerCase().includes(filter);
  const selectedSummary = cardId ? allCards.find((c) => c.id === cardId) ?? null : null;

  const openCard = (card: CardSummary) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(params.toString());
    next.set('card', card.id);
    router.push(`/board?${next.toString()}`, { scroll: false });
  };
  const closeCard = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('card');
    router.replace(`/board?${next.toString()}`, { scroll: false });
    const trigger = returnFocusRef.current;
    requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };

  const moveTo = (card: CardSummary, column: ColumnSummary | undefined) => {
    if (column) moveMutation.mutate({ card, toColumnId: column.id });
  };

  const handleColumnDragEnter = (columnId: string, e: React.DragEvent) => {
    e.preventDefault();
    dragCounters.current[columnId] = (dragCounters.current[columnId] || 0) + 1;
    setActiveDropColumnId(columnId);
  };

  const handleColumnDragOver = (columnId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (activeDropColumnId !== columnId) {
      setActiveDropColumnId(columnId);
    }
  };

  const handleColumnDragLeave = (columnId: string) => {
    dragCounters.current[columnId] = Math.max(0, (dragCounters.current[columnId] || 0) - 1);
    if (dragCounters.current[columnId] === 0) {
      setActiveDropColumnId((curr) => (curr === columnId ? null : curr));
    }
  };

  const handleColumnDrop = (columnId: string, e: React.DragEvent) => {
    e.preventDefault();
    dragCounters.current[columnId] = 0;
    setActiveDropColumnId(null);

    let cardIdToMove: string | null = null;
    let sourceColId: string | null = null;

    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const parsed = JSON.parse(raw);
        cardIdToMove = parsed.cardId;
        sourceColId = parsed.sourceColumnId;
      }
    } catch {}

    if (!cardIdToMove) {
      cardIdToMove = e.dataTransfer.getData('text/plain') || null;
    }

    if (!cardIdToMove) return;

    const card = allCards.find((c) => c.id === cardIdToMove);
    if (!card) return;

    const fromCol = sourceColId || card.columnId;
    if (fromCol === columnId) {
      // Dropped into original column; no movement required
      return;
    }

    moveMutation.mutate({ card, toColumnId: columnId });
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 mx-auto w-full space-y-5 bg-canvas max-w-[110rem]">
      <div className="border-b border-line pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/project?id=${encodeURIComponent(board.projectId)}`} className="text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">← Project</Link>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{board.name}</h1>
          <p className="mt-1 text-xs text-muted">{snapshot.totals.activeCardCount} cards on this board.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={refresh} aria-label="Refresh board" title="Refresh" className="rounded-xl border border-line bg-surface p-2.5 text-ink hover:bg-surface-3 focus-visible:outline-2">
            <RefreshCw className={`h-4 w-4 ${boardQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
          {!board.isArchived && columns.length > 0 && (
            <button type="button" onClick={() => { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setIsAddCardOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-[var(--accent-ink)] font-semibold text-xs hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2">
              <Plus className="w-4 h-4" /> Add card
            </button>
          )}
        </div>
      </div>

      {notice && <p role="status" className="rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-xs text-ink">{notice}</p>}
      {columns.length === 0 && <p className="text-sm text-muted">This board has no columns yet.</p>}

      <div className="flex gap-5 overflow-x-auto pb-4 items-start">
        {columns.map((column, index) => {
          const items = column.cards.filter(matches);
          const isDone = column.category === 'done';
          const isDropTarget = activeDropColumnId === column.id;
          const hidden = column.matchingCardCount - column.cards.length;

          return (
            <section
              key={column.id}
              aria-label={`${column.name}, ${column.matchingCardCount} cards`}
              onDragEnter={(e) => handleColumnDragEnter(column.id, e)}
              onDragOver={(e) => handleColumnDragOver(column.id, e)}
              onDragLeave={() => handleColumnDragLeave(column.id)}
              onDrop={(e) => handleColumnDrop(column.id, e)}
              className={`rounded-2xl border p-3.5 flex flex-col min-h-[240px] w-[19rem] shrink-0 transition-all duration-150 ${
                isDone
                  ? isDropTarget
                    ? 'column-completed border-2 border-[#b8f2c8] bg-[#eaf6ed] text-[#166534] ring-2 ring-[#b8f2c8]/60 shadow-lg'
                    : 'column-completed border border-[#b8f2c8] bg-[#eaf6ed] text-[#166534]'
                  : isDropTarget
                    ? 'bg-accent-soft/30 border-2 border-accent ring-2 ring-accent/20 shadow-lg'
                    : 'bg-surface-2 border-line'
              }`}
            >
              <h2 className={`text-xs font-bold uppercase tracking-wider px-1 mb-3 flex justify-between items-center ${isDone ? 'text-[#166534]' : 'text-ink'}`}>
                <span>{column.name}</span>
                <span
                  className={
                    isDone
                      ? 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#eaf6ed] text-[#166534] border border-[#b8f2c8]'
                      : 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-3 text-muted'
                  }
                >
                  {column.matchingCardCount}
                </span>
              </h2>

              <div className="space-y-3 flex-1">
                {isDropTarget && (
                  <div
                    className={`rounded-xl border-2 border-dashed py-3 px-4 text-center text-xs font-semibold animate-pulse transition-all ${
                      isDone
                        ? 'border-[#b8f2c8] bg-[#eaf6ed] text-[#166534]'
                        : 'border-accent/70 bg-accent-soft/50 text-accent'
                    }`}
                  >
                    Drop card in {column.name}
                  </div>
                )}

                {items.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    isDone={isDone}
                    people={people}
                    busy={moveMutation.isPending}
                    onClick={() => openCard(card)}
                    onDragEnd={() => setActiveDropColumnId(null)}
                    onMovePrev={columns[index - 1] ? () => moveTo(card, columns[index - 1]) : undefined}
                    onMoveNext={columns[index + 1] ? () => moveTo(card, columns[index + 1]) : undefined}
                    prevLabel={columns[index - 1]?.name}
                    nextLabel={columns[index + 1]?.name}
                  />
                ))}
                {items.length === 0 && !isDropTarget && (
                  <p className="p-6 text-center text-muted text-xs border border-dashed border-line rounded-xl">
                    {filter ? 'No loaded cards match' : 'No cards'}
                  </p>
                )}
                {hidden > 0 && (
                  <p className="text-center text-[11px] text-muted">
                    Showing the first {column.cards.length} of {column.matchingCardCount} cards.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {cardId && (
        <CardDetailDialog
          key={cardId}
          cardId={cardId}
          summary={selectedSummary}
          columns={columns}
          people={people}
          boardStructureVersion={board.structureVersion}
          onClose={closeCard}
          onChanged={refresh}
          onMoved={(msg) => setNotice(msg)}
        />
      )}
      <AddCardDialog
        isOpen={isAddCardOpen}
        onClose={() => { setIsAddCardOpen(false); const t = returnFocusRef.current; requestAnimationFrame(() => t?.isConnected && t.focus()); }}
        boardId={board.id}
        columns={columns}
        people={snapshot.people}
        structureVersion={board.structureVersion}
        onCreated={() => { setNotice('Card created.'); refresh(); }}
        onStale={() => { setNotice(describeError(new ApiError(409, 'STALE_VERSION', ''))); refresh(); }}
      />
    </div>
  );
}
