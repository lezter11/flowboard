import { QUOTA_EXCEEDED_CODE } from '@flowboard/contracts';
import type { Role } from '@/lib/roles';

/** Dependency-free view of an API failure, so these rules are testable without the browser. */
export interface FailureLike { status: number; code: string; message: string; details?: unknown }

export interface QuotaAdvice {
  /** Short heading, e.g. "You have reached your project limit". */
  title: string;
  /** What happened and what to do next. Never contains a number the caller may not see. */
  body: string;
  /** The way out, when the caller can take it themselves. */
  action: { label: string; href: string } | null;
}

export interface QuotaContext {
  /** The caller's role in the project the action targets (omit for creating an own project). */
  role?: Role;
  projectId?: string;
}

/** Tolerant on purpose: the server may add scopes (…_total) and the remedy "none" before the contract lists them. */
export interface QuotaDetails { scope: string; limit: number; current?: number; remedy: string }

export function parseQuota(failure: FailureLike): QuotaDetails | null {
  if (failure.status !== 409 || failure.code !== QUOTA_EXCEEDED_CODE) return null;
  const d = failure.details as Partial<Record<keyof QuotaDetails, unknown>> | null | undefined;
  if (!d || typeof d.scope !== 'string') return null;
  const limit = typeof d.limit === 'number' && d.limit > 0 ? d.limit : 0;
  const current = typeof d.current === 'number' && d.current >= 0 ? d.current : undefined;
  return { scope: d.scope, limit, ...(current !== undefined ? { current } : {}), remedy: typeof d.remedy === 'string' ? d.remedy : 'none' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Calm explanation for a refused create. Numbers appear only when the server sent `current` (it does so only for people
 * who may already see that count), so a Manager never learns how many boards they cannot see.
 */
export function quotaAdvice(failure: FailureLike, ctx: QuotaContext = {}): QuotaAdvice | null {
  const quota = parseQuota(failure);
  if (!quota) return null;
  const project = ctx.projectId ? `/project?id=${encodeURIComponent(ctx.projectId)}` : '/projects';
  const known = quota.current !== undefined;
  switch (quota.scope) {
    case 'owned_projects':
    case 'owned_projects_total':
      return {
        title: 'You have reached your project limit',
        body: quota.scope === 'owned_projects_total'
          ? 'You have created as many projects as one account can, archived ones included.'
          : `You have ${plural(quota.current ?? quota.limit, 'active project', 'active projects')}${known ? '' : ' at the limit'}. Archive a project to free a slot, then create another.`,
        action: quota.scope === 'owned_projects_total' ? null : { label: 'Choose a project to archive', href: '/projects' },
      };
    case 'boards_per_project':
    case 'boards_per_project_total': {
      if (ctx.role === 'owner' && quota.scope === 'boards_per_project') {
        return { title: 'This project is at its board limit', body: `It has ${plural(quota.current ?? quota.limit, 'active board', 'active boards')}. Archive a board you no longer need, then create the new one.`, action: { label: 'Open the project', href: project } };
      }
      return { title: 'This project is at its board limit', body: 'This project has reached its board limit. Ask the project Owner to archive a board.', action: null };
    }
    case 'members':
      return ctx.role === 'owner' || ctx.role === 'manager'
        ? { title: 'This project is full', body: `${known ? `It has ${plural(quota.current!, 'member', 'members')}, the limit.` : 'It has reached its member limit.'} Remove a member you no longer need, then add the new one.`, action: { label: 'Open people', href: '/people' } }
        : { title: 'This project is full', body: 'This project has reached its member limit. Ask the project Owner.', action: null };
    case 'pending_invitations':
      return ctx.role === 'owner' || ctx.role === 'manager'
        ? { title: 'Too many pending invitations', body: `${known ? `${plural(quota.current!, 'invitation is', 'invitations are')} waiting, the limit.` : 'The project has reached its pending-invitation limit.'} Revoke one that is no longer needed, then invite again.`, action: { label: 'Open people', href: '/people' } }
        : { title: 'Too many pending invitations', body: 'The project has reached its pending-invitation limit. Ask the project Owner.', action: null };
    default:
      return { title: 'That is over the limit', body: 'This would go over a limit that applies to your account. Nothing was changed.', action: null };
  }
}

/** Seconds to wait from a 429, preferring details.retryAfterSeconds. Null when the server named none. */
export function retryAfterSeconds(failure: FailureLike): number | null {
  if (failure.status !== 429) return null;
  const details = failure.details as { retryAfterSeconds?: unknown } | undefined;
  const seconds = typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export function waitText(seconds: number | null, what: string): string {
  if (seconds === null) return `You are ${what} too quickly. Wait a moment and try again.`;
  if (seconds >= 90) return `You are ${what} too quickly. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  return `You are ${what} too quickly. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}
