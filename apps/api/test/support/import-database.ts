/** Optional separate import DB locally; canonical loopback harness in ordinary CI.
 * Tests create/drop only their own random schema, never reset public/shared tables.
 * Every runner must explicitly select a disposable instance, never the dev default.
 */
export function importTestDatabaseUrl(): string {
  const value = process.env['FLOWBOARD_IMPORT_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!value) throw new Error('Import tests require an explicit disposable database URL.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username !== 'flowboard_harness'
      || !['/flowboard_import_test', '/flowboard_harness'].includes(url.pathname)
      || !url.port || ['55432','55479'].includes(url.port)
      || url.search !== '') throw new Error('Import tests require a disposable local import/harness database and user.');
  return value;
}
