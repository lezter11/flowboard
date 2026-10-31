import { describeFailure } from '@/lib/errors';
import type { Ctx } from '@/lib/error-catalogue';

type Toast = (message: string, options?: { tone?: 'danger' | 'success'; icon?: string; action?: { label: string; onClick: () => void } }) => void;

/** A failure as a toast: catalogue sentence, and Try again (or Reload) when there is something to retry. It stays until dismissed. */
export function toastFailure(toast: Toast, error: unknown, ctx: Ctx = {}, onRetry?: () => void): void {
  const d = describeFailure(error, ctx);
  const act = d.action?.kind === 'retry' && onRetry ? { label: d.action.label, onClick: onRetry }
    : d.action?.kind === 'reload' ? { label: d.action.label, onClick: () => window.location.reload() } : undefined;
  toast(`${d.title}. ${d.body}`, { tone: 'danger', icon: 'alert', ...(act ? { action: act } : {}) });
}
