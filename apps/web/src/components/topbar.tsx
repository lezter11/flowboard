'use client';

import { useState, useRef } from 'react';
import { Search, Menu, Moon, Sun, X, LogOut } from 'lucide-react';
import { useSession } from '@/lib/session';

interface Props { searchQuery: string; onSearchChange: (query: string) => void; showSearch: boolean; onOpenMenu: () => void; menuOpen: boolean }

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function Topbar({ searchQuery, onSearchChange, showSearch, onOpenMenu, menuOpen }: Props) {
  const { state, signOut } = useSession();
  const [isDark, setIsDark] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleTheme = () => { const next = !isDark; setIsDark(next); if (next) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme'); };
  const actor = state.status === 'ready' ? state.session.actor : null;
  return <header className="min-h-14 border-b border-line bg-surface/80 backdrop-blur-md px-3 sm:px-6 py-2 flex items-center justify-between gap-3 sticky top-0 z-30"><button id="mobile-menu-trigger" type="button" onClick={onOpenMenu} aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded={menuOpen} className="md:hidden rounded-lg p-2 text-ink hover:bg-surface-3 focus-visible:outline-2"><Menu className="w-5 h-5" /></button><div className="flex-1 max-w-xl">{showSearch && <div className="relative"><Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" /><input ref={searchRef} type="search" aria-label="Filter loaded cards by title" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Filter cards on this board" className="w-full rounded-xl border border-line bg-surface-2 pl-9 pr-9 py-1.5 text-xs text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent" />{searchQuery && <button type="button" aria-label="Clear card filter" onClick={() => { onSearchChange(''); searchRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink focus-visible:outline-2"><X className="w-4 h-4" /></button>}</div>}</div><div className="flex items-center gap-2 sm:gap-3"><button type="button" onClick={toggleTheme} aria-label={isDark ? 'Use light theme' : 'Use dark theme'} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface-3 focus-visible:outline-2">{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>{actor && <><span title={actor.email} className="hidden sm:inline max-w-[10rem] truncate text-[11px] font-semibold text-muted">{actor.displayName}</span><span aria-hidden="true" className="w-7 h-7 rounded-full bg-[#684b7c] text-white text-xs font-bold flex items-center justify-center">{initials(actor.displayName)}</span><button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-3 focus-visible:outline-2"><LogOut className="w-3.5 h-3.5" aria-hidden="true" />Sign out</button></>}</div></header>;
}
