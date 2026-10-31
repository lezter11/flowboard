'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { describeFailure } from '@/lib/errors';
import { hasUnsaved } from '@/lib/unsaved';
import type { ActionKind, Ctx, Described } from '@/lib/error-catalogue';
import { Icon } from '@/components/ui/icon';

export interface ErrorNoteProps {
  /** A thrown value (ApiError or anything); described through the catalogue. */
  error?: unknown;
  /** Or an already-described note. */
  note?: Described;
  /** Plain text for local checks ("Enter a project name."): no title, no action. */
  text?: string;
  ctx?: Ctx;
  /** Move focus here when it appears (after a failed submit). Never use for background failures. */
  focusOnMount?: boolean;
  /** "Try again" (and reload-style actions that the page handles itself). */
  onRetry?: () => void;
  /** Actions the page owns: choose a file, a column, download the template. Links and reload are handled here. */
  onAction?: (kind: ActionKind) => void;
  /** Extra text under the body, e.g. which people. */
  children?: React.ReactNode;
  className?: string;
  busy?: boolean;
}

/** Copy the reference without ever throwing (clipboard can be blocked). */
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * One error note for the whole app: role="alert", what happened and what to do, one action button, and (for server faults only)
 * a small reference with a copy button. It shows catalogue text only, never the server's own message.
 */
export const ErrorNote = forwardRef<HTMLDivElement, ErrorNoteProps>(function ErrorNote({ error, note, text, ctx, focusOnMount, onRetry, onAction, children, className, busy }, outer) {
  const d: Described = text !== undefined ? { title: '', body: text, action: null, severity: 'danger', retryable: false, reference: null } : note ?? describeFailure(error, ctx);
  const inner = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!focusOnMount) return;
    inner.current?.scrollIntoView({ block: 'nearest' });
    inner.current?.focus();
  }, [focusOnMount, d.title, d.body]);

  const act = d.action;
  // Signing in must not throw away text that is not saved yet: open the sign-in page in another tab, so this page keeps it.
  const signInElsewhere = act?.kind === 'signin' && hasUnsaved();
  const run = () => {
    if (!act) return;
    if (signInElsewhere) { window.open(`/signin?state=session_ended&next=${encodeURIComponent(window.location.pathname + window.location.search)}`, '_blank', 'noopener'); return; }
    if (act.kind === 'reload') { window.location.reload(); return; }
    if (act.kind === 'retry') { onRetry?.(); return; }
    onAction?.(act.kind);
  };
  const showButton = !!act && (signInElsewhere || !(act.href && !onAction)) && !(act.kind === 'retry' && !onRetry);
  return (
    <div
      ref={(el) => { inner.current = el; if (typeof outer === 'function') outer(el); else if (outer) outer.current = el; }}
      className={`error-note${className ? ` ${className}` : ''}`}
      role="alert" tabIndex={-1} data-severity={d.severity}
    >
      <span className="error-note-icon" aria-hidden="true"><Icon name="alert" /></span>
      <div className="error-note-main">
        {d.title && <strong>{d.title}</strong>}
        <p>{d.body}</p>
        {children}
        {(act || d.reference) && (
          <div className="error-note-actions">
            {act && act.href && !onAction && act.kind !== 'reload' && !signInElsewhere && <Link className="btn sm" href={act.href}>{act.label}</Link>}
            {showButton && <button className="btn sm" type="button" disabled={busy} onClick={run}>{act!.label}</button>}
            {d.reference && (
              <span className="error-note-ref">
                Reference <code>{d.reference}</code>
                <button className="btn ghost sm" type="button" onClick={() => void copy(d.reference!).then(setCopied)} aria-label="Copy the reference">{copied ? 'Copied' : 'Copy'}</button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
