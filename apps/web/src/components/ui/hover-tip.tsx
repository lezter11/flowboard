'use client';

import { useEffect, useRef } from 'react';

/** Shared hover/keyboard-focus tooltip for [data-tooltip] and [title]; ported from board-interactions.js. */
export function HoverTip() {
  const tipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    let owner: Element | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissed: Element | null = null;
    const triggerFor = (node: EventTarget | null) => (node instanceof Element ? node.closest('[data-tooltip], [title]') : null);
    const hide = () => {
      clearTimeout(hideTimer);
      if (owner) {
        const ids = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tip.id);
        if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
        else owner.removeAttribute('aria-describedby');
      }
      owner = null;
      tip.hidden = true;
    };
    const show = (trigger: Element | null) => {
      if (!trigger?.isConnected || trigger === dismissed || trigger.closest('[inert], [hidden]')) return;
      const content = trigger.getAttribute('title') || (trigger as HTMLElement).dataset.tooltip;
      if (!content) return;
      hide();
      owner = trigger;
      (trigger as HTMLElement).dataset.tooltip = content;
      trigger.removeAttribute('title');
      tip.textContent = content;
      const ids = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(tip.id);
      trigger.setAttribute('aria-describedby', [...ids].join(' '));
      tip.hidden = false;
      const anchor = trigger.getBoundingClientRect();
      const rect = tip.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, window.innerWidth - rect.width - 8));
      const top = anchor.bottom + rect.height + 8 <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - rect.height - 6);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const enter = (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerType === 'touch') return;
      if (tip.contains(e.target as Node)) { clearTimeout(hideTimer); return; }
      const trigger = triggerFor(e.target);
      if (!trigger || trigger.contains(e.relatedTarget as Node | null)) return;
      clearTimeout(hideTimer);
      if (trigger === owner && !tip.hidden) return;
      if (trigger === dismissed) return;
      dismissed = null;
      show(trigger);
    };
    const leave = (event: Event) => {
      const e = event as PointerEvent;
      const trigger = triggerFor(e.target);
      if (trigger?.contains(e.relatedTarget as Node | null) || tip.contains(e.relatedTarget as Node | null)) return;
      if (trigger === dismissed) dismissed = null;
      if (trigger !== owner && !tip.contains(e.target as Node)) return;
      if (owner?.contains(e.relatedTarget as Node | null)) return;
      hideTimer = setTimeout(() => { if (owner?.contains(document.activeElement)) return; hide(); }, 160);
    };
    const focusin = (event: FocusEvent) => {
      dismissed = null;
      const trigger = triggerFor(event.target);
      if (trigger) show(trigger); else hide();
    };
    const focusout = (event: FocusEvent) => { if (!owner?.contains(event.relatedTarget as Node | null)) hide(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { const previous = owner; hide(); dismissed = previous; } };
    document.addEventListener('pointerover', enter, true);
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('focusin', focusin);
    document.addEventListener('focusout', focusout);
    document.addEventListener('keydown', keydown);
    document.addEventListener('click', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', enter, true);
      document.removeEventListener('pointerout', leave, true);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('click', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return <div id="boardHoverTip" ref={tipRef} role="tooltip" hidden />;
}
