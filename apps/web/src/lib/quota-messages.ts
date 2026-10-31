import { QUOTA_EXCEEDED_CODE } from '@flowboard/contracts';
import { CATALOGUE, describeFailureOf, type Ctx, type Failure } from './error-catalogue.ts';

/** Kept for the dialogs that show a limit panel; the words live in error-catalogue.ts. */
export interface FailureLike { status: number; code: string; message?: string; details?: unknown; requestId?: string | null; retryAfter?: number | null }
export type QuotaContext = Ctx;

export interface QuotaAdvice {
  title: string;
  body: string;
  action: { label: string; href: string } | null;
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

const asFailure = (f: FailureLike): Failure => ({ status: f.status, code: f.code, details: f.details, requestId: f.requestId, retryAfter: f.retryAfter });

/** Calm explanation for a refused create, from the catalogue. The limit is always named; a count only when the server sent one. */
export function quotaAdvice(failure: FailureLike, ctx: QuotaContext = {}): QuotaAdvice | null {
  if (!parseQuota(failure)) return null;
  const d = describeFailureOf(asFailure(failure), ctx);
  return { title: d.title, body: d.body, action: d.action?.href ? { label: d.action.label, href: d.action.href } : null };
}

/** Seconds to wait from a 429: details first, then the Retry-After header. Null when the server named none. */
export function retryAfterSeconds(failure: FailureLike): number | null {
  if (failure.status !== 429) return null;
  const details = failure.details as { retryAfterSeconds?: unknown } | undefined;
  const fromDetails = typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  const s = fromDetails ?? failure.retryAfter ?? null;
  return s !== null && Number.isFinite(s) && s > 0 ? Math.ceil(s) : null;
}

export function waitText(seconds: number | null, what: string): string {
  return describeFailureOf({ status: 429, code: 'RATE_LIMITED', ...(seconds !== null ? { details: { retryAfterSeconds: seconds } } : {}) }, { doing: what }).body;
}

/** One sentence for a code the catalogue knows, else null so the caller can use its own default. */
export function friendlyMessage(failure: FailureLike, ctx: QuotaContext = {}): string | null {
  if (failure.status === 429 || CATALOGUE[failure.code]) return describeFailureOf(asFailure(failure), ctx).body;
  return null;
}
