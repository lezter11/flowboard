'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import Link from 'next/link';
import { useSession } from '@/lib/session';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const boardRoute = pathname === '/board';
  const searchQuery = params.get('q') ?? '';
  const { state, refetch } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);
  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    requestAnimationFrame(() => document.getElementById('mobile-menu-trigger')?.focus());
  };
  useEffect(() => {
    if (!mobileMenuOpen) return;
    document.getElementById('mobile-menu-close')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        requestAnimationFrame(() => document.getElementById('mobile-menu-trigger')?.focus());
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);
  const updateSearch = (query: string) => {
    const next = new URLSearchParams(params.toString());
    if (query) next.set('q', query); else next.delete('q');
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  };
  if (pathname === '/signin' || pathname === '/invitation' || pathname === '/invitations/accept') {
    return <>{children}</>;
  }
  let content = children;
  if (state.status === 'loading') {
    content = <div role="status" className="flex-1 p-12 text-sm text-muted">Loading your session...</div>;
  } else if (state.status === 'signedOut') {
    content = (
      <div className="flex-1 p-6 sm:p-10 max-w-xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-ink">You are signed out</h1>
        <p className="mt-2 text-sm text-muted">Your session ended or you have not signed in yet. Sign in to see your projects and boards.</p>
        <Link href="/signin" className="mt-5 inline-flex rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-surface focus-visible:outline-2">Sign in</Link>
      </div>
    );
  } else if (state.status === 'error') {
    content = (
      <div role="alert" className="flex-1 p-6 sm:p-10 max-w-xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-ink">Flowboard is unreachable</h1>
        <p className="mt-2 text-sm text-muted">{state.message}</p>
        <button type="button" onClick={refetch} className="mt-5 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink focus-visible:outline-2">Try again</button>
      </div>
    );
  }
  return <div className="flex min-h-screen bg-canvas text-ink">
    {mobileMenuOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={closeMobileMenu} />}
    <Sidebar mobileOpen={mobileMenuOpen} onClose={closeMobileMenu} />
    <div inert={mobileMenuOpen} className="flex-1 flex flex-col min-w-0"><Topbar searchQuery={searchQuery} onSearchChange={updateSearch} showSearch={boardRoute} onOpenMenu={() => setMobileMenuOpen(true)} menuOpen={mobileMenuOpen} /><main className="flex-1 flex flex-col min-w-0 overflow-y-auto">{content}</main></div>
  </div>;
}
