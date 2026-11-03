'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pageInertLock, drawerInertLock, dialogStack } from '@/lib/inert-lock';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// One lock for the whole page: nested dialogs share it, so the app stays inert until the last one closes.
const appLock = pageInertLock;

/** The prototype's .dialog-layer: a modal with focus trap, Escape to close and focus return. */
export function DialogLayer({ open, onClose, labelledBy, describedBy, className, role = 'dialog', children }: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // Parents pass a fresh onClose every render; the effect must only depend on `open` or it would
  // restore focus to the trigger on each re-render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    if(!layer)return;
    const stackEntry=dialogStack.push(layer);
    // Remember what had focus before the dialog opened. A development double-invoke runs this again with focus already inside the dialog; keep the first answer.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !layer?.contains(active)) returnTo.current = active instanceof HTMLElement ? active : null;
    // Rail, top bar and page become inert (no focus, no screen-reader browsing); the layer is portalled outside `.app` so it stays live.
    const releaseInert = appLock.acquire(document.querySelector('.app'));
    const releaseDrawer=drawerInertLock.acquire(document.getElementById('cardDrawer'));
    const first = layer?.querySelector<HTMLElement>('[data-autofocus]') ?? layer?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if(!stackEntry.isTop())return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !layer) return;
      const items = Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      const a = items[0];
      const z = items[items.length - 1];
      if (!a || !z) return;
      if (event.shiftKey && document.activeElement === a) { event.preventDefault(); z.focus(); }
      else if (!event.shiftKey && document.activeElement === z) { event.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const wasTop=stackEntry.release();
      releaseDrawer();
      releaseInert();
      const target = returnTo.current;
      // Only restore focus once the dialog has really left the page (not on a development double-invoke).
      requestAnimationFrame(() => { if (layer?.isConnected) return; if (wasTop&&target?.isConnected&&!target.closest('[inert]')&&(!dialogStack.top()||dialogStack.top()?.contains(target))) target.focus({ preventScroll: true }); });
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="dialog-layer" ref={layerRef} onMouseDown={(event) => { if (event.target === event.currentTarget&&dialogStack.top()===event.currentTarget) onClose(); }}>
      <div className={`dialog${className ? ` ${className}` : ''}`} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
