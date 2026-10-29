'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

export type MenuItem =
  | { kind: 'button'; label: string; icon: string; onSelect: () => void; disabled?: boolean; hint?: string }
  | { kind: 'link'; label: string; icon: string; href: string };

/**
 * One overflow ("...") menu: a real menu button pattern. Arrow keys, Home/End and type-to-focus move between items, Escape closes and
 * returns focus to the trigger, Tab closes. The trigger is 44 px square on touch screens (.action-menu-trigger).
 */
export function ActionMenu({ label, items, triggerRef, extra }: { label: string; items: MenuItem[]; triggerRef?: Ref<HTMLButtonElement>; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    const first = root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) requestAnimationFrame(() => button.current?.focus()); };
  const move = (event: React.KeyboardEvent) => {
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { event.preventDefault(); nodes[(i + nodes.length) % nodes.length]?.focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(nodes.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className="action-menu" ref={root}>
      <button
        className="icon-btn action-menu-trigger"
        type="button"
        ref={(node) => { button.current = node; if (typeof triggerRef === 'function') triggerRef(node); else if (triggerRef) (triggerRef as { current: HTMLButtonElement | null }).current = node; }}
        aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="action-menu-list" id={id} role="menu" aria-label={label} onKeyDown={move}>
          {items.map((item) => item.kind === 'link' ? (
            <Link key={item.label} className="action-menu-item" role="menuitem" href={item.href} onClick={() => setOpen(false)}><Icon name={item.icon} /><span>{item.label}</span></Link>
          ) : (
            <button key={item.label} className="action-menu-item" type="button" role="menuitem" aria-disabled={item.disabled || undefined} title={item.hint}
              onClick={() => { if (item.disabled) return; close(true); item.onSelect(); }}>
              <Icon name={item.icon} /><span>{item.label}</span>{item.hint && <small>{item.hint}</small>}
            </button>
          ))}
          {extra}
        </div>
      )}
    </div>
  );
}
