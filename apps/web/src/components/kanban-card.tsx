'use client';

import React from 'react';
import { Calendar, MessageSquare, Paperclip, CheckSquare, CheckCircle2 } from 'lucide-react';
import { MOCK_PEOPLE, type MockCard } from '@/lib/mock-data';

interface KanbanCardProps {
  card: MockCard;
  onClick: () => void;
}

export function KanbanCard({ card, onClick }: KanbanCardProps) {
  const isDone = card.columnId === 'col_done';

  const priorityColors = {
    urgent: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-rose-50 text-rose-700 border-rose-200',
    medium: 'bg-blue-50 text-blue-700 border-blue-200',
    low: 'bg-emerald-50 text-[var(--dot-completed)] border-emerald-200',
    none: 'bg-surface-3 text-muted border-line',
  };

  return (
    <article
      className={`group relative rounded-xl border p-3.5 shadow-sm transition-all duration-150 ${
        isDone
          ? 'bg-surface border-[var(--palette-pastel-green)] hover:border-[var(--dot-completed)] hover:shadow-md'
          : 'bg-surface border-line hover:border-line-strong hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${card.title}`}
        aria-haspopup="dialog"
        className="absolute inset-0 z-10 rounded-xl cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {/* Header: Key & Priority */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-mono text-[11px] font-semibold text-faint tracking-wider">
          {card.key}
        </span>
        <div className="flex items-center gap-1.5">
          {isDone ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold badge-completed border">
              <CheckCircle2 className="w-3 h-3 text-[var(--dot-completed)]" />
              Completed
            </span>
          ) : card.priority !== 'none' ? (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                priorityColors[card.priority]
              }`}
            >
              {card.priority}
            </span>
          ) : null}
        </div>
      </div>

      {/* Title */}
      <h3 className={`text-sm font-semibold leading-snug tracking-tight mb-1 text-ink group-hover:text-accent transition-colors line-clamp-2 ${
        isDone ? 'text-ink/90' : ''
      }`}>
        {card.title}
      </h3>

      {/* Description Snippet */}
      {card.description && (
        <p className="text-xs text-muted leading-relaxed line-clamp-2 mb-3">
          {card.description}
        </p>
      )}

      {/* Meta Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/60 text-xs text-muted">
        {/* Left: Due Date & Tasks */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {card.dueDate && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                isDone
                  ? 'text-[var(--dot-completed)]'
                  : 'text-muted'
              }`}
            >
              <Calendar className="w-3 h-3" />
              {card.dueDate.slice(5)}
            </span>
          )}

          {card.taskCount && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <CheckSquare className="w-3 h-3 text-faint" />
              {card.taskCount.completed}/{card.taskCount.total}
            </span>
          )}

          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <MessageSquare className="w-3 h-3 text-faint" />
              {card.commentCount}
            </span>
          )}

          {card.imageCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <Paperclip className="w-3 h-3 text-faint" />
              {card.imageCount}
            </span>
          )}
        </div>

        {/* Right: Assignees Avatar Stack */}
        <div className="flex items-center -space-x-1.5 shrink-0">
          {card.assigneeIds.map((id) => {
            const person = MOCK_PEOPLE[id];
            if (!person) return null;
            return (
              <span
                key={id}
                title={person.name}
                className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center border-2 border-surface shadow-xs ${person.avatarTone}`}
              >
                {person.initials}
              </span>
            );
          })}
        </div>
      </div>
    </article>
  );
}
