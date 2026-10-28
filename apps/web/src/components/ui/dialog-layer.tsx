'use client';

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const first = layer?.querySelector<HTMLElement>('[data-autofocus]') ?? layer?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
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
      const target = returnTo.current;
      requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-layer" ref={layerRef} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`dialog${className ? ` ${className}` : ''}`} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </div>
    </div>
  );
}
