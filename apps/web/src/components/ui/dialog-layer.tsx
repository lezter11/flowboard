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
  // Parents pass a fresh onClose every render; the effect must only depend on `open` or it would
  // restore focus to the trigger on each re-render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    // Remember what had focus before the dialog opened. A development double-invoke runs this again with focus already inside the dialog; keep the first answer.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !layer?.contains(active)) returnTo.current = active instanceof HTMLElement ? active : null;
    const first = layer?.querySelector<HTMLElement>('[data-autofocus]') ?? layer?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
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
      // Only restore focus once the dialog has really left the page (not on a development double-invoke).
      requestAnimationFrame(() => { if (layer?.isConnected) return; if (target?.isConnected) target.focus({ preventScroll: true }); });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-layer" ref={layerRef} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`dialog${className ? ` ${className}` : ''}`} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </div>
    </div>
  );
}
