'use client';

import Link from 'next/link';
import type { QuotaAdvice } from '@/lib/quota-messages';
import { Icon } from '@/components/ui/icon';

/** Calm explanation with the way out: never a dead end, never a disabled button without a reason. */
export function QuotaPanel({ advice, role, onNavigate, archivedLink = false }: { advice: QuotaAdvice; role: 'status' | 'alert'; onNavigate: () => void; archivedLink?: boolean }) {
  return (
    <div className="quota-panel" role={role}>
      <span className="quota-panel-icon" aria-hidden="true"><Icon name="folder" /></span>
      <div>
        <strong>{advice.title}</strong>
        <p>{advice.body}</p>
        <p className="quota-panel-links">
          {advice.action && <Link className="btn sm" href={advice.action.href} onClick={onNavigate}>{advice.action.label}</Link>}
          {archivedLink && <Link className="btn ghost sm" href="/projects?tab=archived" onClick={onNavigate}>See archived projects</Link>}
        </p>
      </div>
    </div>
  );
}

