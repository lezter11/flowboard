'use client';

import { Calendar, ChevronLeft, ChevronRight, MessageSquare, Paperclip } from 'lucide-react';
import type { CardSummary, PersonDisplay } from '@flowboard/contracts';

interface KanbanCardProps {
  card: CardSummary;
  isDone: boolean;
  people: Map<string, PersonDisplay>;
  onClick: () => void;
  onMovePrev?: () => void;
  onMoveNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  busy?: boolean;
}

const priorityColors: Record<CardSummary['priority'], string> = {
  urgent: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-blue-50 text-blue-700 border-blue-200',
  low: 'bg-emerald-50 text-[var(--dot-completed)] border-emerald-200',
  none: 'bg-surface-3 text-muted border-line',
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function KanbanCard({ card, isDone, people, onClick, onMovePrev, onMoveNext, prevLabel, nextLabel, busy }: KanbanCardProps) {
  return (
    <article
      className={`group relative rounded-xl border p-3.5 shadow-sm transition-all duration-150 ${
        isDone ? 'bg-surface border-[var(--palette-pastel-green)]' : 'bg-surface border-line hover:border-line-strong hover:shadow-md'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${card.title}`}
        aria-haspopup="dialog"
        className="absolute inset-0 z-10 rounded-xl cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {card.priority !== 'none' && !isDone && (
        <span className={`mb-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${priorityColors[card.priority]}`}>
          {card.priority}
        </span>
      )}
      {isDone && (
        <span className="mb-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold badge-completed border">Completed</span>
      )}
      <h3 className="text-sm font-semibold leading-snug tracking-tight mb-2 text-ink line-clamp-3">{card.title}</h3>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/60 text-xs text-muted">
        <div className="flex items-center gap-2.5 flex-wrap">
          {card.dueDate && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium">
              <Calendar className="w-3 h-3" aria-hidden="true" />
              {card.dueDate}
            </span>
          )}
          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <MessageSquare className="w-3 h-3 text-faint" aria-hidden="true" />
              {card.commentCount}
            </span>
          )}
          {card.imageCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <Paperclip className="w-3 h-3 text-faint" aria-hidden="true" />
              {card.imageCount}
            </span>
          )}
        </div>
        <div className="flex items-center -space-x-1.5 shrink-0">
          {card.assigneeIds.map((id) => {
            const person = people.get(id);
            const name = person?.displayName ?? 'Unknown member';
            return (
              <span key={id} title={name} className="w-5 h-5 rounded-full bg-[#684b7c] text-white text-[9px] font-bold flex items-center justify-center border-2 border-surface">
                {initials(name)}
              </span>
            );
          })}
        </div>
      </div>
      <div className="relative z-20 mt-2 flex justify-between gap-2">
        <button type="button" disabled={!onMovePrev || busy} onClick={onMovePrev} aria-label={prevLabel ? `Move ${card.title} to ${prevLabel}` : 'No previous column'} title={prevLabel ? `Move to ${prevLabel}` : undefined} className="rounded-lg border border-line p-1 text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-2">
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" disabled={!onMoveNext || busy} onClick={onMoveNext} aria-label={nextLabel ? `Move ${card.title} to ${nextLabel}` : 'No next column'} title={nextLabel ? `Move to ${nextLabel}` : undefined} className="rounded-lg border border-line p-1 text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-2">
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
