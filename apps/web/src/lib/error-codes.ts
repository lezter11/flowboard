/** Dependency-free error helpers, so they can be unit tested without the browser or the API client. */

/** The server rejected a write because what the user saw is out of date (card, column or board structure). */
export const STALE_CODES: readonly string[] = ['STALE_VERSION', 'STALE_BOARD_VERSION', 'CONFLICT'];
export const isStaleCode = (code: string | undefined | null): boolean => !!code && STALE_CODES.includes(code);

export const NETWORK_MESSAGE = 'Can’t reach Flowboard. Check your connection.';

/** fetch rejects with a TypeError when the network is down, blocked or the server is unreachable. A deliberate abort is not a network failure. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;
  return error instanceof TypeError;
}
