'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { useSession } from '@/lib/session';

/**
 * Account menu: who is signed in (read only), Settings, Sign out. A menu button pattern: arrow keys move, Escape closes and returns focus
 * to the trigger, Tab closes. The popover is fixed-positioned from the trigger so a narrow icon-only rail cannot clip it.
 * `placement="rail"` opens beside and above the trigger; `placement="top"` opens below it, right-aligned.
 */
export function UserMenu({ placement, className, label, children }: { placement: 'rail' | 'top'; className?: string; label: string; children: ReactNode }) {
  const { state, signOut } = useSession();
  const actor = state.status === 'ready' ? state.session.actor : null;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  const show = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      setPos(placement === 'rail'
        ? { left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), bottom: Math.max(8, window.innerHeight - r.top + 6) }
        : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 });
    }
    setOpen(true);
  };
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) requestAnimationFrame(() => trigger.current?.focus()); };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('resize', onResize); };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { event.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') setOpen(false);
  };

  if (!actor) return null;
  return (
    <div className="user-menu" ref={root}>
      <button ref={trigger} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); show(); } }}>
        {children}
      </button>
      {open && (
        <div className="user-menu-list" id={id} role="menu" aria-label="Account" style={pos} onKeyDown={onKeyDown}>
          <div className="user-menu-who" role="presentation">
            <Avatar id={actor.id} name={actor.displayName} />
            <span><strong>{actor.displayName}</strong><small>{actor.email}</small></span>
          </div>
          <Link className="action-menu-item" role="menuitem" href="/settings?tab=account" onClick={() => setOpen(false)}><Icon name="settings" /><span>Settings</span></Link>
          <button className="action-menu-item" type="button" role="menuitem" disabled={busy} onClick={() => { setBusy(true); void signOut(); }}><Icon name="arrow-right" /><span>{busy ? 'Signing out…' : 'Sign out'}</span></button>
        </div>
      )}
    </div>
  );
}
