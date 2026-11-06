import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, permittedRequest, deliverWithoutRedirect } from './hosted-banner-browser.mjs';
test('only fixed UAT/production origins and safe new labels are selectable', () => {
  assert.equal(configuration(['--target', 'uat', '--label', 'first']).origin, 'https://flowboard-app-uat.pages.dev');
  assert.equal(configuration(['--target', 'production', '--label', 'first']).origin, 'https://flowboard-app.pages.dev');
  for (const bad of [[], ['--target', 'https://other.invalid', '--label', 'ok'],
    ['--target', 'uat', '--label', '../else'], ['--target', 'uat', '--label', 'x', '--extra', 'y']]) {
    assert.throws(() => configuration(bad));
  }
});
test('anonymous probe permits only fixed read paths and same-origin static assets', () => {
  const origin = 'https://flowboard-app.pages.dev';
  for (const p of ['/signin', '/release-status.json', '/api/v1/session', '/_next/static/chunk.js']) {
    assert.equal(permittedRequest(origin, origin + p, 'GET'), true);
    assert.equal(permittedRequest(origin, origin + p, 'POST'), false);
  }
  for (const url of ['https://other.invalid/release-status.json', origin + '/api/v1/cards', origin + '/api/v1/auth/google']) {
    assert.equal(permittedRequest(origin, url, 'GET'), false);
  }
});
test('anonymous request guard refuses URL credentials, query parameters and fragments', () => {
  const origin = 'https://flowboard-app.pages.dev';
  for (const url of ['https://synthetic-user:synthetic-password@flowboard-app.pages.dev/api/v1/session',
    origin + '/release-status.json?synthetic_private=1', origin + '/release-status.json#private',
    origin + '/_next/static/chunk.js?private=1']) assert.equal(permittedRequest(origin, url, 'GET'), false);
});
test('admitted transport disables redirect hops/retries and never fulfills a redirect', async () => {
  for (const status of [200, 302, 307, 503]) {
    let fulfilled = 0, aborted = 0, disposed = 0;
    const result = await deliverWithoutRedirect({
      request() { return { url: () => 'https://flowboard-app.pages.dev/signin', method: () => 'GET',
        headers: () => ({ cookie: 'SYNTHETIC', authorization: 'SYNTHETIC', referer: 'SYNTHETIC', accept: 'text/html' }) }; },
      async fulfill() { fulfilled++; }, async abort() { aborted++; },
    }, async configuration => {
      assert.deepEqual(configuration, { storageState: { cookies: [], origins: [] } });
      return { async fetch(url, options) { assert.equal(url, 'https://flowboard-app.pages.dev/signin');
        assert.deepEqual(options, { method: 'GET', headers: { accept: 'text/html' }, maxRedirects: 0, maxRetries: 0, timeout: 15_000 });
        return { status: () => status, async dispose() { disposed++; } }; }, async dispose() { disposed++; } };
    });
    assert.equal(disposed, 2);
    assert.equal(fulfilled, status >= 300 && status < 400 ? 0 : 1);
    assert.equal(aborted, status >= 300 && status < 400 ? 1 : 0);
    assert.equal(Boolean(result.redirectBlocked), status >= 300 && status < 400);
    assert.equal(Boolean(result.httpError), status >= 500);
  }
});
test('transport exceptions abort safely without copying private diagnostics', async () => {
  const result = await deliverWithoutRedirect({ async abort() {} }, async () => { throw new Error('SYNTHETIC_PRIVATE'); });
  assert.deepEqual(result, { transportFailure: true });
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
});
