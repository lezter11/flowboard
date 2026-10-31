import { ApiError } from '@/lib/api';
import { PrepareError } from '@/lib/image-prepare';
import { isStaleCode } from '@/lib/error-codes';
import { describeFailureOf, type Ctx, type Described, type Failure } from '@/lib/error-catalogue';

/** The catalogue's view of any thrown value. The server's own message is never used: it is for logs. */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiError) return { status: error.status, code: error.code, details: error.details, requestId: error.requestId, retryAfter: error.retryAfter };
  return { status: error instanceof TypeError ? 0 : 500, code: error instanceof TypeError ? 'NETWORK_ERROR' : 'INTERNAL_ERROR' };
}

/** Title, body, action and reference for a failure. Use this where there is room for the full note. */
export function describeFailure(error: unknown, ctx: Ctx = {}): Described {
  if (error instanceof PrepareError) return { title: 'That image can’t be used', body: error.message, action: null, severity: 'danger', retryable: false, reference: null };
  return describeFailureOf(failureOf(error), ctx);
}

/** One sentence for tight places: the body of the full description. */
export function describeError(error: unknown, ctx: Ctx = {}): string {
  return describeFailure(error, ctx).body;
}

export function isStale(error: unknown): boolean {
  return error instanceof ApiError && isStaleCode(error.code);
}

/** Image failures: same catalogue, plus whether trying again could help. */
export function describeUploadError(error: unknown): { message: string; retryable: boolean } {
  const d = describeFailure(error);
  return { message: d.body, retryable: d.retryable };
}

export function describeImageError(error: unknown): string {
  return describeError(error);
}
