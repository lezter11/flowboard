'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Layers,
  Code2,
  Cpu,
  Sparkles,
  Inbox,
  Activity,
  Users,
  Trash2,
  Settings,
  ChevronDown,
  Kanban,
  FolderKanban,
  ListTodo,
  FileUp,
  X,
} from 'lucide-react';
import { MOCK_BOARDS, MOCK_PROJECT, MOCK_PEOPLE } from '@/lib/mock-data';

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentBoard = pathname.startsWith('/boards/')
    ? decodeURIComponent(pathname.split('/')[2] ?? '')
    : searchParams.get('board') || 'unified';
  const containMobileFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!mobileOpen || event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'))
      .filter((item) => item.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const boardIcons: Record<string, React.ReactNode> = {
    unified: <Layers className="w-4 h-4 text-purple-600" />,
    board_dev: <Code2 className="w-4 h-4 text-blue-600" />,
    board_ops: <Cpu className="w-4 h-4 text-emerald-600" />,
    board_mktg: <Sparkles className="w-4 h-4 text-pink-600" />,
  };

  const navItems = [
    { label: 'Projects', href: '/projects', icon: <FolderKanban className="w-4 h-4" /> },
    { label: 'My tasks', href: '/my-tasks', icon: <ListTodo className="w-4 h-4" /> },
    { label: 'Inbox', href: '/inbox', icon: <Inbox className="w-4 h-4" /> },
    { label: 'Activity', href: '/activity', icon: <Activity className="w-4 h-4" /> },
    { label: 'People', href: '/people', icon: <Users className="w-4 h-4" /> },
    { label: 'Trash', href: '/trash', icon: <Trash2 className="w-4 h-4" /> },
    { label: 'Import cards', href: '/import', icon: <FileUp className="w-4 h-4" /> },
    { label: 'Settings', href: '/settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <aside id="app-sidebar" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label={mobileOpen ? 'Navigation' : undefined} onKeyDown={containMobileFocus} className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-rail flex flex-col h-dvh shrink-0 transform transition-transform duration-200 ease-out md:sticky md:top-0 md:translate-x-0 md:visible ${mobileOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}>
      {/* Brand Header */}
      <div className="p-4 border-b border-line flex items-center justify-between">
        <Link href="/" onClick={onClose} className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#302638] flex items-center justify-center text-white shadow-xs">
            <Kanban className="w-4 h-4" />
          </div>
          <span className="font-bold text-base tracking-tight text-ink">
            Flow<span className="brand-wordmark">board</span>
          </span>
        </Link>
        <span className="hidden md:inline text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-surface-3 text-faint">
          Preview
        </span>
        <button id="mobile-menu-close" type="button" onClick={onClose} aria-label="Close navigation" className="md:hidden rounded-lg p-2 text-ink hover:bg-surface-3 focus-visible:outline-2"><X className="h-5 w-5" /></button>
      </div>

      {/* Workspace Switcher */}
      <div className="p-3 border-b border-line">
        <Link
          href="/projects"
          onClick={onClose}
          className="w-full flex items-center gap-2.5 p-2 rounded-xl bg-surface border border-line text-left shadow-xs hover:border-line-strong transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#cdb4db] to-[#ffafcc] flex items-center justify-center font-bold text-xs text-[#302638] shrink-0">
            BF
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-ink truncate leading-tight">
              {MOCK_PROJECT.name}
            </h4>
            <p className="text-[11px] text-muted truncate">Sample board context</p>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
        </Link>
      </div>

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Project Sub-Boards Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-faint">
            <span>Sample boards</span>
            <span className="text-[10px] text-muted font-normal">Preview only</span>
          </div>

          <div className="space-y-0.5">
            {MOCK_BOARDS.map((b) => {
              const isActive = (pathname === '/' || pathname.startsWith('/boards/')) && currentBoard === b.id;
              const isUnified = b.id === 'unified';

              return (
                <Link
                  key={b.id}
                  href={b.id === 'unified' ? '/' : `/boards/${encodeURIComponent(b.id)}`}
                  onClick={onClose}
                  className={`flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    isActive
                      ? 'bg-surface text-ink font-semibold shadow-xs border border-line'
                      : 'text-ink-soft hover:bg-surface/60 hover:text-ink'
                  } ${isUnified ? 'border-dashed border-purple-200' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {boardIcons[b.id] || <Layers className="w-4 h-4" />}
                    <span className="truncate">{b.name}</span>
                  </div>
                  {isUnified && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                      1-Click
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Global Navigation */}
        <div className="space-y-1">
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-faint">
            Navigation
          </div>

          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href === '/projects' && pathname.startsWith('/projects/'));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    isActive
                      ? 'bg-surface text-ink font-semibold shadow-xs border border-line'
                      : 'text-ink-soft hover:bg-surface/60 hover:text-ink'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* User Session Footer */}
      <div className="p-3 border-t border-line bg-surface/40">
        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-surface border border-line shadow-xs">
          <div className="w-7 h-7 rounded-full bg-[#684b7c] text-white flex items-center justify-center font-bold text-xs shrink-0">
            AO
          </div>
          <div className="flex-1 min-w-0">
            <h5 className="text-xs font-semibold text-ink truncate leading-tight">
              {MOCK_PEOPLE.alice?.name}
            </h5>
            <p className="text-[10px] text-muted truncate">Project Owner</p>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-500" title="Online" />
        </div>
      </div>
    </aside>
  );
}
