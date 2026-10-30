import { ApiError } from '@/lib/api';

/** Turns an API failure into a short, user-facing sentence. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session ended. Sign in again.';
    if (error.status === 403) return 'You do not have permission to do that.';
    if (error.code === 'STALE_VERSION' || error.code === 'CONFLICT') return 'Someone else changed this. The latest version has been loaded; try again.';
    if (error.status === 503 && error.code === 'CONFIG_ERROR') return 'This feature is not available right now. Try again later.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function isStale(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'STALE_VERSION' || error.code === 'CONFLICT');
}

/** Image upload failures: storage that is not configured answers 503 CONFIG_ERROR, which is not the user's doing and not retryable by them. */
export function describeImageError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503 && error.code === 'CONFIG_ERROR') return 'Image uploads are not available right now.';
  return describeError(error);
}
