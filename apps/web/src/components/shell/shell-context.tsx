'use client';

import { THEME_KEY, resolveTheme } from '@/lib/theme';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

interface ShellValue {
  navVisible: boolean;
  overlay: boolean;
  navOpen: boolean;
  toggleNav: () => void;
  closeNav: (returnFocus?: boolean) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  modeStatus: string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  menuRef: React.RefObject<HTMLButtonElement | null>;
  fullscreenRef: React.RefObject<HTMLButtonElement | null>;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside ShellProvider');
  return value;
}

/** Collapsible navigation, progressive fullscreen and theme; ported from design/flowboard-ui/workspace.js. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isBoard = pathname === '/board';
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [modeStatus, setModeStatus] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const nativeSession = useRef(false);
  const pending = useRef(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenRef = useRef<HTMLButtonElement | null>(null);

  const overlay = narrow || fullscreen;
  const navVisible = overlay ? navOpen : !navCollapsed;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const sync = () => { setNarrow(media.matches); setNavOpen(false); };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // The pre-paint script already set data-theme; state follows it (and the route, when no choice is stored)
  // before anything is written back, so a dark first paint is never flipped to light.
  const themeReady = useRef(false);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(THEME_KEY); } catch { /* storage can be blocked */ }
    const next = resolveTheme(pathname, saved);
    themeReady.current = true;
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, [pathname]);

  useEffect(() => {
    if (themeReady.current) document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const body = document.body;
    body.classList.toggle('board-app', isBoard);
    body.classList.toggle('nav-collapsed', isBoard && navCollapsed);
    body.classList.toggle('nav-drawer-open', overlay && navOpen);
    body.classList.toggle('board-fullscreen', isBoard && fullscreen);
    return () => body.classList.remove('board-app', 'nav-collapsed', 'nav-drawer-open', 'board-fullscreen');
  }, [isBoard, navCollapsed, overlay, navOpen, fullscreen]);

  // Navigating closes the overlay drawer.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  const closeNav = useCallback((returnFocus = true) => {
    setNavOpen(false);
    if (returnFocus) menuRef.current?.focus({ preventScroll: true });
  }, []);

  const toggleNav = useCallback(() => {
    if (overlay) setNavOpen((open) => !open);
    else setNavCollapsed((collapsed) => !collapsed);
  }, [overlay]);

  const setFullscreenLayout = useCallback((active: boolean) => {
    setFullscreen(active);
    setNavOpen(false);
    setModeStatus(active ? 'Board expanded' : 'Board window restored');
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const root = document.documentElement;
    try {
      if (fullscreen) {
        if (document.fullscreenElement === root && typeof document.exitFullscreen === 'function') {
          try {
            await document.exitFullscreen();
            if (!document.fullscreenElement) { nativeSession.current = false; setFullscreenLayout(false); }
          } catch { setModeStatus('Use Escape to leave browser fullscreen.'); }
        } else setFullscreenLayout(false);
      } else {
        setFullscreenLayout(true);
        if (typeof root.requestFullscreen === 'function') {
          try {
            await root.requestFullscreen();
            nativeSession.current = document.fullscreenElement === root;
          } catch { setModeStatus('Board expanded to the window. Browser fullscreen is unavailable.'); }
        } else setModeStatus('Board expanded to the window.');
      }
    } finally { pending.current = false; }
  }, [fullscreen, setFullscreenLayout]);

  useEffect(() => {
    const onChange = () => {
      const root = document.documentElement;
      if (document.fullscreenElement === root) { nativeSession.current = true; setFullscreenLayout(true); }
      else if (nativeSession.current) {
        nativeSession.current = false;
        setFullscreenLayout(false);
        fullscreenRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [setFullscreenLayout]);

  // Leaving the board must not leave the page expanded.
  useEffect(() => { if (!isBoard && fullscreen) setFullscreenLayout(false); }, [isBoard, fullscreen, setFullscreenLayout]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || pending.current) return;
      if (fullscreen && !document.fullscreenElement && !navOpen && !document.querySelector('.drawer.is-open, .dialog-layer:not([hidden])')) {
        setFullscreenLayout(false);
        fullscreenRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen, navOpen, setFullscreenLayout]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const value = useMemo<ShellValue>(() => ({
    navVisible, overlay, navOpen, toggleNav, closeNav, fullscreen, toggleFullscreen, modeStatus, theme, toggleTheme, menuRef, fullscreenRef,
  }), [navVisible, overlay, navOpen, toggleNav, closeNav, fullscreen, toggleFullscreen, modeStatus, theme, toggleTheme]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

