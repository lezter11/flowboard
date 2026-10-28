'use client';

import type { DragEvent } from 'react';
import type { CardSummary, PersonDisplay } from '@flowboard/contracts';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { dueInfo } from '@/lib/dates';

export type CardStyle = 'focus' | 'glass';

interface Props {
  card: CardSummary;
  done: boolean;
  view: 'board' | 'list';
  cardStyle: CardStyle;
  people: Map<string, PersonDisplay>;
  canMove: boolean;
  draggable: boolean;
  dragging: boolean;
  onOpen: (card: CardSummary, trigger: HTMLElement) => void;
  onMove: (card: CardSummary, trigger: HTMLElement) => void;
  onDragStart: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

const cap = (value: string) => value[0]!.toUpperCase() + value.slice(1);

/** One card; markup and classes follow cardHTML() in design/flowboard-ui/board.js. */
export function BoardCard({ card, done, view, cardStyle, people, canMove, draggable, dragging, onOpen, onMove, onDragStart, onDragEnd }: Props) {
  const list = view === 'list';
  const glass = !list && cardStyle === 'glass';
  const due = dueInfo(card.dueDate, done);
  const names = card.assigneeIds.map((id) => people.get(id)?.displayName ?? 'Unknown member');

  const key = card.key ? <span className="card-key">{card.key}</span> : null;
  const deadline = due ? (
    <span className={`due is-${due.state}`} title={due.detail}>
      <Icon name="calendar" />
      <time dateTime={card.dueDate ?? undefined}>{due.label}</time>
    </span>
  ) : null;
  const priority = card.priority !== 'none' ? (
    <span className={`card-priority priority-${card.priority}`} data-tooltip={`${card.priority} priority`}>{cap(card.priority)}</span>
  ) : null;

  const assignees = card.assigneeIds.length ? (
    <span className="assignee-group" role="group" aria-label={`Assigned to ${names.join(', ')}`}>
      <span className="avatar-stack" aria-hidden="true">
        {card.assigneeIds.slice(0, 2).map((id) => <Avatar key={id} id={id} name={people.get(id)?.displayName ?? 'Unknown member'} />)}
        {card.assigneeIds.length > 2 && <span className="avatar" title={`${card.assigneeIds.length - 2} more assignees`}>+{card.assigneeIds.length - 2}</span>}
      </span>
      <span className="assignee-names" aria-hidden="true">{names[0]!.split(' ')[0]}{card.assigneeIds.length > 1 ? ` +${card.assigneeIds.length - 1}` : ''}</span>
    </span>
  ) : (
    <span className="assignee-group" role="group" aria-label="Unassigned">
      <span className="avatar empty" title="Unassigned" aria-hidden="true"><Icon name="users" className="icon-sm" /></span>
      <span className="assignee-names" aria-hidden="true">Unassigned</span>
    </span>
  );

  const meta = (
    <>
      {card.commentCount > 0 && (
        <span className="meta-chip" title={`${card.commentCount} comments`}>
          <Icon name="message" /><span className="sr-only">Comments: </span>{card.commentCount}
        </span>
      )}
      {card.imageCount > 0 && (
        <span className="meta-chip" title={`${card.imageCount} private images`}>
          <Icon name="image" /><span className="sr-only">Private images: </span>{card.imageCount}
        </span>
      )}
    </>
  );

  const moveButton = canMove ? (
    <button className="card-move" type="button" aria-label={`Move card: ${card.title}`} title="Move card" onClick={(event) => { event.stopPropagation(); onMove(card, event.currentTarget); }}>
      <Icon name="move" />
    </button>
  ) : null;

  const header = list ? (<>{key}{priority}{moveButton}</>)
    : glass ? (<>{key}{key ? null : <span className="card-head-spacer" />}{moveButton ? <span className="card-action-tray">{moveButton}</span> : null}</>)
    : (<>{priority}<span className="card-head-spacer" />{deadline}{moveButton}</>);
  const footer = list ? (<>{deadline}{meta}<span className="spacer" />{assignees}</>) : (<>{assignees}<span className="spacer" />{meta}{glass ? null : key}</>);

  return (
    <article
      className={`card card--${list ? 'list' : cardStyle}${dragging ? ' is-dragging' : ''}`}
      data-card-id={card.id}
      aria-labelledby={`card-title-${card.id}`}
      draggable={draggable || undefined}
      onDragStart={draggable ? (event) => onDragStart(card, event) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <div className="card-head">{header}</div>
      <div className="card-body" onClick={(event) => { const trigger = event.currentTarget.querySelector<HTMLElement>('.card-open'); if (trigger) onOpen(card, trigger); }}>
        <h3 className="card-title" id={`card-title-${card.id}`}>
          <button className="card-open" type="button" data-tooltip={card.title} onClick={(event) => { event.stopPropagation(); onOpen(card, event.currentTarget); }}>{card.title}</button>
        </h3>
        {card.descriptionExcerpt ? <p className="card-desc">{card.descriptionExcerpt}</p> : null}
        {glass && (priority || deadline) ? <div className="card-signals">{priority}{deadline}</div> : null}
        <div className="card-meta">{footer}</div>
      </div>
    </article>
  );
}
