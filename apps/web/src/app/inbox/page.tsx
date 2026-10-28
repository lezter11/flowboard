'use client';

import React, { useState } from 'react';
import { Inbox, CheckCircle2, MessageSquare, UserCheck, Bell, Sparkles } from 'lucide-react';
import { MOCK_PEOPLE } from '@/lib/mock-data';

interface NotificationItem {
  id: string;
  type: 'mention' | 'assigned' | 'system';
  title: string;
  cardKey: string;
  senderId: string;
  time: string;
  read: boolean;
}

export default function InboxPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: 'n1',
      type: 'mention',
      title: 'mentioned you in a comment on "Finalize homepage copy"',
      cardKey: 'DEV-101',
      senderId: 'david',
      time: '20 mins ago',
      read: false,
    },
    {
      id: 'n2',
      type: 'assigned',
      title: 'assigned you to "Migrate PostgreSQL schema with idempotency checks"',
      cardKey: 'DEV-102',
      senderId: 'alice',
      time: '2 hours ago',
      read: false,
    },
    {
      id: 'n3',
      type: 'system',
      title: 'Sample preview notification',
      cardKey: 'SYS-01',
      senderId: 'charlie',
      time: '5 hours ago',
      read: false,
    },
  ]);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Inbox className="w-6 h-6 text-accent" />
            Inbox & Notifications
          </h1>
          <p className="text-xs text-muted mt-1">
            Sample inbox for Brand Fashion. Read status changes in this browser view only.
          </p>
        </div>
        <button
          type="button"
          disabled={notifications.every((item) => item.read)}
          onClick={markAllRead}
          className="text-xs font-semibold text-accent hover:text-accent-hover disabled:opacity-50 focus-visible:outline-2 transition-colors"
        >
          Mark preview items read
        </button>
      </div>

      <div className="space-y-3">
        {notifications.map((n) => {
          const sender = MOCK_PEOPLE[n.senderId] || MOCK_PEOPLE.alice;
          return (
            <div
              key={n.id}
              className={`p-4 rounded-xl border flex items-start gap-4 transition-all ${
                n.read
                  ? 'bg-surface border-line text-muted opacity-80'
                  : 'bg-surface border-line shadow-xs hover:border-line-strong'
              }`}
            >
              <span className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${sender?.avatarTone}`}>
                {sender?.initials}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-ink">
                    {sender?.name}
                  </span>
                  <span className="text-[11px] text-faint">{n.time}</span>
                </div>
                <p className="text-xs text-ink-soft mt-0.5">
                  {n.title}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-3 text-faint font-semibold">
                    {n.cardKey}
                  </span>
                  {!n.read && (
                    <span className="w-2 h-2 rounded-full bg-accent" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
