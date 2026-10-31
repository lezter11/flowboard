/**
 * How long a toast stays (decision D5, WCAG 2.2.1). Failures never time out: they stay until dismissed or acted on.
 * Success keeps 4.5 s; a success with Undo gets 8 s. Pure so the rule is tested.
 */
export interface ToastLike { tone?: 'danger' | 'success'; undo?: unknown; action?: unknown }
export const SUCCESS_MS = 4500;
export const UNDO_MS = 8000;
/** After the pointer leaves or focus moves out. */
export const RESUME_MS = 2500;

export function toastLifetime(t: ToastLike): number | null {
  if (t.tone === 'danger' || t.action) return null;
  return t.undo ? UNDO_MS : SUCCESS_MS;
}

/** Danger toasts go to an assertive region so screen readers announce them at once; the rest stay polite. */
export const toastRegion = (t: ToastLike): 'assertive' | 'polite' => (t.tone === 'danger' ? 'assertive' : 'polite');
