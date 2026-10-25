export const LOCAL_DATABASE_URL =
  'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55432/flowboard_harness';

// The foundation harness is intentionally limited to its disposable local DB.
export function localDatabaseUrl(value = LOCAL_DATABASE_URL): string {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.pathname !== '/flowboard_harness'
    || url.username !== 'flowboard_harness'
    || url.search !== '') {
    throw new Error('FND-01 requires the local flowboard_harness database and user');
  }
  return value;
}
