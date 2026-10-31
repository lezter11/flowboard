'use client';

import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import * as m from 'motion/react-m';
import type { CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { Icon } from '@/components/ui/icon';
import { toneFor } from '@/lib/board-model';
import { BoardCard, type CardStyle } from './board-card';

export interface DropTarget { columnId: string; index: number }

interface Props {
  column: ColumnSummary;
  shown: CardSummary[];
  filtering: boolean;
  view: 'board' | 'list';
  cardStyle: CardStyle;
  people: Map<string, PersonDisplay>;
  canEdit: boolean;
  canMove: boolean;
  /** Merged view: each card answers to its own board's permissions. Defaults to `canMove`. */
  canMoveCard?: (card: CardSummary) => boolean;
  cardChip?: (card: CardSummary) => { name: string; tone: number } | null;
  addBoards?: { id: string; name: string }[];
  addBoardId?: string;
  onAddBoard?: (boardId: string) => void;
  addNote?: string;
  dragId: string | null;
  drop: DropTarget | null;
  composerOpen: boolean;
  quickAddBusy: boolean;
  quickAddError: string;
  onOpenComposer: (columnId: string, trigger: HTMLElement) => void;
  onCloseComposer: () => void;
  onQuickAdd: (columnId: string, title: string, priority: string) => void;
  onOpenCard: (card: CardSummary, trigger: HTMLElement) => void;
  onMoveCard: (card: CardSummary, trigger: HTMLElement) => void;
  onDragStart: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOverZone: (columnId: string, event: DragEvent<HTMLElement>) => void;
  onDragLeaveColumn: (columnId: string, event: DragEvent<HTMLElement>) => void;
  onDropZone: (columnId: string, event: DragEvent<HTMLElement>) => void;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export function BoardColumn(props: Props) {
  const { column, shown, filtering, view, cardStyle, people, canEdit, canMove, dragId, drop, composerOpen } = props;
  const tone = toneFor(column);
  const cardMovable = (card: CardSummary) => (props.canMoveCard ? props.canMoveCard(card) : canMove);
  const isCompleted = column.category === 'done';
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [error, setError] = useState('');

  const collapse = isCompleted && !filtering && !expanded && shown.length > 5;
  const visible = collapse ? shown.slice(0, 5) : shown;
  const hiddenCount = shown.length - visible.length;
  const total = column.activeCardCount;
  const countLabel = filtering ? `${shown.length} of ${total} cards` : `${total} cards`;
  const unloaded = Math.max(0, column.matchingCardCount - column.cards.length);
  const isDropTarget = drop?.columnId === column.id;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError('Enter a card title first.'); return; }
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) { setError('Choose Low, Medium, High, or Urgent before adding this card.'); return; }
    props.onQuickAdd(column.id, title.trim(), priority);
  };
  const reset = () => { setTitle(''); setPriority(''); setError(''); props.onCloseComposer(); };
  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
    else if (event.key === 'Escape') { event.preventDefault(); reset(); }
  };

  // Cards other than the dragged one decide the drop index; the line renders before that card.
  const others = visible.filter((c) => c.id !== dragId);
  const lineBefore = isDropTarget && drop ? others[drop.index]?.id ?? null : null;
  const lineAtEnd = isDropTarget && drop ? drop.index >= others.length : false;
  const line = <div className="drop-line" aria-hidden="true" />;

  return (
    <section
      className={`column${isDropTarget ? ' is-drop-target' : ''}`}
      data-column-id={column.id}
      data-tone={tone}
      aria-labelledby={`colTitle-${column.id}`}
      onDragOver={(event) => props.onDragOverZone(column.id, event)}
      onDrop={(event) => props.onDropZone(column.id, event)}
      onDragLeave={(event) => props.onDragLeaveColumn(column.id, event)}
    >
      <header className="column-head">
        <span className="column-dot" aria-hidden="true" />
        <h2 className="column-title" id={`colTitle-${column.id}`}>{column.name}</h2>
        <span className="column-count" title={countLabel} aria-label={countLabel}>{filtering ? shown.length : total}</span>
        <div className="column-actions">
          {canEdit && (
            <button className="icon-btn" type="button" aria-label={`Add a card to ${column.name}`} title="Add a card" onClick={(event) => props.onOpenComposer(column.id, event.currentTarget)}>
              <Icon name="plus" />
            </button>
          )}
        </div>
      </header>
      <div className="column-body">
        <div className="column-cards" data-drop-zone={column.id}>
          {visible.map((card) => (
            <m.div
              key={card.id}
              layout="position"
              layoutId={`card-${card.id}`}
              transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
            >
              {lineBefore === card.id && line}
              <BoardCard
                card={card}
                done={isCompleted}
                view={view}
                cardStyle={cardStyle}
                people={people}
                canMove={cardMovable(card)}
                chip={props.cardChip?.(card) ?? null}
                draggable={cardMovable(card) && !filtering && view === 'board'}
                dragging={dragId === card.id}
                onOpen={props.onOpenCard}
                onMove={props.onMoveCard}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
              />
            </m.div>
          ))}
          {lineAtEnd && line}
          {visible.length === 0 && !isDropTarget && (
            <div className={`column-empty${filtering && total > 0 ? ' no-match' : ''}`}>
              <Icon name={filtering && total > 0 ? 'search' : 'board'} />
              {filtering && total > 0 ? <><strong>No cards match</strong><span>Try clearing a filter.</span></> : <><strong>No cards yet</strong><span>Add the first card to this column.</span></>}
            </div>
          )}
        </div>
        {unloaded > 0 && !filtering && <p className="column-more-note" style={{ fontSize: 12, color: 'var(--muted)', padding: '2px 4px' }}>Showing the first {column.cards.length} of {column.matchingCardCount} cards.</p>}
        {hiddenCount > 0 ? (
          <button className="show-more" type="button" onClick={() => setExpanded(true)}><Icon name="chevron-down" />Show {hiddenCount} more</button>
        ) : isCompleted && !filtering && expanded && shown.length > 5 ? (
          <button className="show-more" type="button" onClick={() => setExpanded(false)}><Icon name="chevron-down" />Show less</button>
        ) : null}
        {canEdit && (composerOpen ? (
          <div className="quick-add">
            <form className="quick-add-form" onSubmit={submit}>
              <label className="sr-only" htmlFor={`quickAdd-${column.id}`}>New card title in {column.name}</label>
              <textarea id={`quickAdd-${column.id}`} rows={2} maxLength={200} placeholder="Card title…" value={title} data-autofocus onKeyDown={keydown} onChange={(event) => { setTitle(event.target.value); setError(''); }} autoFocus />
              <label className="quick-add-priority-label" htmlFor={`quickAddPriority-${column.id}`}>Priority <span aria-hidden="true">*</span></label>
              <select className={`quick-add-priority${priority ? ` priority-${priority}` : ''}`} id={`quickAddPriority-${column.id}`} aria-required="true" aria-describedby={`quickAddPriorityError-${column.id}`} value={priority} onChange={(event) => { setPriority(event.target.value); setError(''); }}>
                <option value="">Choose a priority</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}
              </select>
              {props.addBoards && props.addBoards.length > 0 && (
                <>
                  <label className="quick-add-priority-label" htmlFor={`quickAddBoard-${column.id}`}>Board</label>
                  <select className="quick-add-priority" id={`quickAddBoard-${column.id}`} value={props.addBoardId} onChange={(event) => props.onAddBoard?.(event.target.value)}>
                    {props.addBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {props.addNote && <p className="quick-add-note" role="status">{props.addNote}</p>}
                </>
              )}
              <p className="quick-add-error" id={`quickAddPriorityError-${column.id}`} role="alert" hidden={!(error || props.quickAddError)}>{error || props.quickAddError}</p>
              <div className="quick-add-actions">
                <span className="hint">Choose a priority · Enter to add · Esc to cancel</span>
                <button className="btn ghost sm" type="button" onClick={reset}>Cancel</button>
                <button className="btn primary sm" type="submit" disabled={props.quickAddBusy}>{props.quickAddBusy ? 'Adding…' : 'Add card'}</button>
              </div>
            </form>
          </div>
        ) : (
          <div className="quick-add">
            <button className="quick-add-trigger" type="button" onClick={(event) => props.onOpenComposer(column.id, event.currentTarget)}><Icon name="plus" />Add a card</button>
          </div>
        ))}
      </div>
    </section>
  );
}
