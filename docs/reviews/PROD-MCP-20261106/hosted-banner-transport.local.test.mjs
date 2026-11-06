// Actual installed Chrome/Playwright transport, loopback-only synthetic servers.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { permittedRequest, deliverWithoutRedirect } from './hosted-banner-browser.mjs';

test('real browser transport refuses a redirect before contacting its separate target', async () => {
  let targetCalls = 0, sourceCalls = 0, sourceCredentialRequests = 0, browser;
  const target = http.createServer((_req, res) => { targetCalls++; res.end('unexpected'); });
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const source = http.createServer((req, res) => {
    sourceCalls++;
    if (req.headers.cookie || req.headers.authorization || req.headers.referer) sourceCredentialRequests++;
    if (req.url === '/signin') {
      res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/forbidden` }); res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"active":true}');
    }
  });
  try {
    await listen(target); await listen(source);
    const origin = `http://127.0.0.1:${source.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin'
      ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addCookies([{ name: 'synthetic_transport_cookie', value: 'not-real', url: origin }]);
    const results = [];
    await context.route('**/*', async route => {
      if (!permittedRequest(origin, route.request().url(), route.request().method())) return route.abort();
      results.push(await deliverWithoutRedirect(route));
    });
    const page = await context.newPage();
    await page.goto(origin + '/signin', { timeout: 10_000 }).catch(() => null);
    assert.equal(sourceCalls, 1); assert.equal(targetCalls, 0);
    assert.deepEqual(results, [{ redirectBlocked: true }]);
    // The refused navigation may still be committing Chrome's own error page.
    // A separate page isolates the successful transport case from that UI race.
    await page.close();
    const successful = await context.newPage();
    const response = await successful.goto(origin + '/release-status.json', { timeout: 10_000 });
    assert.equal(response.status(), 200);
    assert.equal(await successful.locator('body').innerText(), '{"active":true}');
    assert.equal(sourceCalls, 2); assert.equal(targetCalls, 0);
    assert.equal(sourceCredentialRequests, 0);
    assert.deepEqual(results[1], { httpError: false });
  } finally {
    await browser?.close();
    for (const server of [source, target]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
