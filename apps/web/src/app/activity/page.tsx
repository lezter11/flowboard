'use client';

import React from 'react';
import { Activity, Plus, MoveRight, CheckCircle2, MessageSquare, Paperclip } from 'lucide-react';
import { MOCK_PEOPLE } from '@/lib/mock-data';

interface ActivityRecord {
  id: string;
  actorId: string;
  action: string;
  target: string;
  time: string;
  icon: React.ReactNode;
}

export default function ActivityPage() {
  const activities: ActivityRecord[] = [
    {
      id: 'act_1',
      actorId: 'alice',
      action: 'marked as completed',
      target: 'Migrate PostgreSQL schema with idempotency checks (DEV-102)',
      time: '1 hour ago',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
    },
    {
      id: 'act_2',
      actorId: 'david',
      action: 'moved to In Progress',
      target: 'Scaffold Next.js App Router and Tailwind tokens (DEV-101)',
      time: '3 hours ago',
      icon: <MoveRight className="w-4 h-4 text-blue-600" />,
    },
    {
      id: 'act_3',
      actorId: 'charlie',
      action: 'added 2 private attachments to',
      target: 'Finalize Autumn Lookbook photography & color palette (MKT-301)',
      time: '5 hours ago',
      icon: <Paperclip className="w-4 h-4 text-purple-600" />,
    },
    {
      id: 'act_4',
      actorId: 'alice',
      action: 'created new card',
      target: 'Production health monitoring and alerting webhooks (OPS-203)',
      time: '1 day ago',
      icon: <Plus className="w-4 h-4 text-accent" />,
    },
  ];

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
      <div className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
          <Activity className="w-6 h-6 text-accent" />
          Project Activity Timeline
        </h1>
        <p className="text-xs text-muted mt-1">
          Sample activity for Brand Fashion. Verified project history requires a reviewed backend connection.
        </p>
      </div>

      <div className="relative pl-6 border-l-2 border-line space-y-6">
        {activities.map((act) => {
          const actor = MOCK_PEOPLE[act.actorId] || MOCK_PEOPLE.alice;
          return (
            <div key={act.id} className="relative group">
              {/* Dot on timeline */}
              <div className="absolute -left-[31px] top-1 p-1 bg-surface rounded-full border border-line shadow-xs">
                {act.icon}
              </div>

              <div className="p-4 rounded-xl border border-line bg-surface shadow-xs space-y-1">
                <div className="flex items-center justify-between text-xs text-muted">
                  <div className="flex items-center gap-2 font-medium">
                    <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center ${actor?.avatarTone}`}>
                      {actor?.initials}
                    </span>
                    <strong className="text-ink">{actor?.name}</strong>
                    <span>{act.action}</span>
                  </div>
                  <span className="text-[11px] text-faint">{act.time}</span>
                </div>
                <p className="text-xs font-semibold text-ink pl-7">
                  {act.target}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
