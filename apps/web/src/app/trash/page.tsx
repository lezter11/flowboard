'use client';

import React from 'react';
import { Trash2, RotateCcw, Clock, AlertTriangle } from 'lucide-react';
import { MOCK_PEOPLE } from '@/lib/mock-data';

interface TrashedCard {
  id: string;
  key: string;
  title: string;
  boardName: string;
  deletedBy: string;
  deletedAt: string;
  expiresInHours: number;
}

export default function TrashPage() {
  const trashedCards: TrashedCard[] = [
    {
      id: 'trash_1',
      key: 'MKT-299',
      title: 'Deprecated summer campaign ad banners',
      boardName: 'Marketing Board',
      deletedBy: 'charlie',
      deletedAt: '8 hours ago',
      expiresInHours: 16,
    },
    {
      id: 'trash_2',
      key: 'DEV-098',
      title: 'Legacy REST endpoint documentation',
      boardName: 'Developers Board',
      deletedBy: 'alice',
      deletedAt: '18 hours ago',
      expiresInHours: 6,
    },
  ];

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
      <div className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
          <Trash2 className="w-6 h-6 text-danger" />
          Project Card Trash
        </h1>
        <p className="text-xs text-muted mt-1">
          Sample trash entries only. The live 24-hour restore deadline and permissions require a reviewed backend connection.
        </p>
      </div>

      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <span>
          <strong>Preview only:</strong> The times below are illustrative. No purge or restore action is connected.
        </span>
      </div>

      <p id="restore-unavailable" className="text-xs text-muted">Restore is unavailable until the backend review gate passes.</p>
      <div className="space-y-3">
        {trashedCards.map((c) => {
          const actor = MOCK_PEOPLE[c.deletedBy] || MOCK_PEOPLE.alice;
          return (
            <div
              key={c.id}
              className="p-4 rounded-xl border border-line bg-surface shadow-xs flex items-center justify-between gap-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface-3 text-faint">
                    {c.key}
                  </span>
                  <span className="text-xs text-muted font-medium">
                    {c.boardName}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-ink truncate">
                  {c.title}
                </h3>
                <p className="text-[11px] text-muted">
                  Deleted by <strong>{actor?.name}</strong> • {c.deletedAt}
                </p>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-danger bg-danger-soft px-2.5 py-1 rounded-lg">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{c.expiresInHours}h left</span>
                </div>

                <button
                  type="button"
                  disabled
                  aria-describedby="restore-unavailable"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs font-semibold text-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-accent" />
                  Restore
                </button>
              </div>
            </div>
          );
        })}

        {trashedCards.length === 0 && (
          <div className="p-12 text-center text-muted text-xs border border-dashed border-line rounded-xl">
            Trash is empty. All active cards are safe.
          </div>
        )}
      </div>
    </div>
  );
}
