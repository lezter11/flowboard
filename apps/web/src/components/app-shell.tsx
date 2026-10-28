'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const boardRoute = pathname === '/' || pathname.startsWith('/boards/');
  const searchQuery = params.get('q') ?? '';
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
  return <div className="flex min-h-screen bg-canvas text-ink">
    {mobileMenuOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={closeMobileMenu} />}
    <Sidebar mobileOpen={mobileMenuOpen} onClose={closeMobileMenu} />
    <div inert={mobileMenuOpen} className="flex-1 flex flex-col min-w-0"><Topbar searchQuery={searchQuery} onSearchChange={updateSearch} showSearch={boardRoute} onOpenMenu={() => setMobileMenuOpen(true)} menuOpen={mobileMenuOpen} /><main className="flex-1 flex flex-col min-w-0 overflow-y-auto">{children}</main></div>
  </div>;
}
