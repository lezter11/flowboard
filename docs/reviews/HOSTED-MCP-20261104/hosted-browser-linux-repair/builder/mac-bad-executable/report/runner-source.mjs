// Local synthetic Chrome acceptance. A missing prerequisite or failed case exits nonzero.
// This file owns only a random synthetic schema, its browser contexts and child processes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeBrowserError } from './hosted-mcp-browser-diagnostics.mjs';

assert.equal(process.env.NODE_ENV, 'test', 'Hosted browser acceptance requires explicit test mode.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const reviewRoot = path.join(root, 'docs/reviews/HOSTED-MCP-20261104');
const webOrigin = 'http://127.0.0.1:44942';
const apiOrigin = 'http://127.0.0.1:44941';
const callback = 'https://claude.ai/api/mcp/auth_callback';
const mcp = '/api/v1/mcp';
const out = process.env.FLOWBOARD_HOSTED_UI_REPORT_DIR ?? path.join(root, 'artifacts/hosted-mcp-browser', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out);
await fs.copyFile(fileURLToPath(import.meta.url), path.join(out, 'runner-source.mjs'));
const report = {
  kind: 'Actual Chrome against mounted local synthetic app; not hosted/provider or complete MCP transport approval',
  start: new Date().toISOString(), results: [], network: [], blockedOrigins: [], console: [], expectedRefusalConsole: [], externalRequestPaths: [],
  command: 'NODE_ENV=test WRANGLER_SEND_METRICS=false node scripts/e2e/hosted-mcp-browser.mjs', sourceBefore: {}, sourceAfter: {},
};
const sourcePaths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--',
  'apps/web/src', 'apps/web/functions', 'apps/web/public', 'apps/web/test', 'apps/web/next.config.ts', 'apps/web/next-env.d.ts', 'apps/web/tsconfig.json', 'scripts/e2e/hosted-mcp-browser.mjs', 'scripts/e2e/hosted-mcp-browser-diagnostics.mjs',
  'packages/contracts/src/hosted-mcp.ts', 'apps/api/src/http/routes/hosted-oauth.ts',
  'apps/api/src/adapters/hosted-oauth.ts', 'apps/api/src/http/safe-next.ts',
  'apps/api/src/http/routes/google-auth.ts', 'apps/api/src/http/app.ts', 'apps/api/test/safe-next.test.ts', 'apps/api/test/google-connect-resume.test.ts',
], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean))].sort();
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p => [p, crypto.createHash('sha256').update(await fs.readFile(path.join(root, p))).digest('hex')])));
const save = () => fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const { chromium, expect } = await import('@playwright/test');
const { serve } = await import('@hono/node-server');
const { createApp } = await import('../../apps/api/src/http/app.ts');
const { MemoryStorageDriver } = await import('../../apps/api/src/adapters/storage.ts');
const { SharpImageVerifier } = await import('../../apps/api/src/services/image-verifier-node.ts');
const { verifyHostedAccessToken } = await import('../../apps/api/src/adapters/hosted-oauth.ts');
const { createSession, hashSessionToken } = await import('../../apps/api/src/adapters/session.ts');
const { startSyntheticApi } = await import('../../scripts/e2e/server.mjs');
const oldFetch = globalThis.fetch;
const previousEnv = Object.fromEntries(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'FRONTEND_URL'].map(k => [k, process.env[k]]));
Object.assign(process.env, { GOOGLE_CLIENT_ID: 'synthetic-local.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-local-only', GOOGLE_REDIRECT_URI: webOrigin + '/api/v1/auth/google/callback', FRONTEND_URL: webOrigin });
let googlePerson, api, server, web, browser, currentTab, currentCase = 'setup';
const contexts = [];
const diagnostic = /flw_mcp_(?:access|refresh)_[a-f0-9]{64}|flowboard_session=|client_secret|code_verifier|token_hash|csrfToken|SQLSTATE|QueryFailedError|syntax error at|at async .*\.ts:\d/;
const safePath = raw => new URL(raw).pathname.replace(/(authorization-requests|connections)\/[^/]+/g, '$1/:id');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-provider-access', token_type: 'Bearer', expires_in: 900 });
  if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
    assert.ok(googlePerson);
    return Response.json({ sub: 'synthetic-local-sub', email: googlePerson.email, email_verified: true, name: googlePerson.displayName, given_name: 'Synthetic', family_name: 'Owner' });
  }
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'Unexpected server-side external request refused.');
  return oldFetch(input, init);
};
async function check(id, task) {
  currentCase = id;
  const consoleAt = report.console.length;
  const contextAt = contexts.length;
  try {
    // Cases share a disposable fixture, not a cumulative rate-limit scenario. Real
    // limiter semantics are independently tested by the backend acceptance suite.
    if (api) await api.pool.query('DELETE FROM rate_limit_windows');
    await task();
    assert.equal(report.console.length, consoleAt, 'Unexpected console/page error.');
    report.results.push({ id, status: 'pass' });
  } catch (error) {
    report.results.push({ id, status: 'fail', ...safeBrowserError(error) });
    if (currentTab) {
      const url = new URL(currentTab.page.url());
      report.results.at(-1).page = { origin: url.origin, path: safePath(url.href) };
      if (url.origin === webOrigin) await currentTab.page.screenshot({ path: path.join(out, `${id}-failure.png`), fullPage: true }).catch(() => {});
    }
  }
  for (const context of contexts.slice(contextAt)) await context.close().catch(() => {});
  console.log(JSON.stringify(report.results.at(-1)));
  await save();
}
async function tab(fixture, role = 'owner', signedIn = true) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
  contexts.push(context);
  const state = { callback: null, decisions: [], responses: [], googleState: null, expectedStatuses: new Set(), expectNetworkLoss: false };
  if (signedIn) await context.addCookies([{ name: 'flowboard_session', value: fixture.people[role].session.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === webOrigin && url.pathname === '/api/v1/auth/google/start' && route.request().isNavigationRequest()) {
      // Playwright does not re-route every redirect in a continued navigation chain.
      // Execute the actual start once, retain its HttpOnly cookie, then make the fake
      // provider a fresh explicitly intercepted navigation instead of contacting Google.
      const started = await route.fetch({ maxRedirects: 0 });
      assert.equal(started.status(), 302);
      const provider = new URL(started.headers().location);
      assert.equal(provider.origin, 'https://accounts.google.com');
      state.googleState = provider.searchParams.get('state');
      const headers = { ...started.headers(), 'content-type': 'text/html' };
      delete headers.location;
      const escaped = provider.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      return route.fulfill({ status: 200, headers, body: `<h1>Synthetic Google handoff</h1><a href="${escaped}">Open synthetic Google sign-in</a>` });
    }
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.origin + url.pathname === callback) {
      state.callback = { code: url.searchParams.get('code'), error: url.searchParams.get('error'), issuer: url.searchParams.get('iss') };
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic callback intercepted</h1><p>No request was sent to the external service.</p>' });
    }
    report.externalRequestPaths.push({ origin: url.origin, path: url.pathname });
    if (url.origin === 'https://accounts.google.com') {
      const target = new URL('/api/v1/auth/google/callback', webOrigin);
      target.searchParams.set('code', 'synthetic-local-code');
      target.searchParams.set('state', url.searchParams.get('state') ?? state.googleState ?? '');
      const escaped = target.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      const cancelled = new URL('/api/v1/auth/google/callback', webOrigin);
      cancelled.searchParams.set('error', 'access_denied'); cancelled.searchParams.set('state', url.searchParams.get('state') ?? state.googleState ?? '');
      const deniedHref = cancelled.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<h1>Synthetic Google sign-in</h1><a href="${escaped}">Continue as synthetic teammate</a><a href="${deniedHref}">Cancel synthetic sign-in</a>` });
    }
    report.blockedOrigins.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', msg => {
    if (!['error', 'warning'].includes(msg.type())) return;
    const text = msg.text();
    const location = msg.location().url;
    const refusal = /Failed to load resource: the server responded with a status of (\d+)/.exec(text);
    const expected404 = refusal && state.expectedStatuses.has(Number(refusal[1]))
      && typeof location === 'string' && location.startsWith(webOrigin + '/api/');
    const expectedLoss = state.expectNetworkLoss && /Failed to load resource: net::ERR_FAILED/.test(text)
      && typeof location === 'string' && location.startsWith(webOrigin + mcp + '/authorization-requests/');
    const event = { case: currentCase, type: msg.type(), diagnosticOrCredentialPattern: diagnostic.test(text) };
    if ((expected404 || expectedLoss) && !event.diagnosticOrCredentialPattern) report.expectedRefusalConsole.push(event);
    else report.console.push(event);
  });
  page.on('pageerror', error => report.console.push({ case: currentCase, type: 'pageerror', diagnosticOrCredentialPattern: diagnostic.test(error.message) }));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api/v1/auth/google/start' && response.status() === 302) {
      const target = response.headers().location;
      if (target) state.googleState = new URL(target, webOrigin).searchParams.get('state');
    }
    if (url.pathname.startsWith('/api/')) report.network.push({ case: currentCase, method: response.request().method(), path: safePath(response.url()), status: response.status(), expectedRefusal: state.expectedStatuses.has(response.status()) });
  });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/decision')) {
      const value = request.postDataJSON();
      state.decisions.push({ decision: value.decision, projectId: value.projectId, keys: Object.keys(value).sort(), csrfPresent: typeof value.csrfToken === 'string' });
    }
  });
  currentTab = { context, page, state };
  return currentTab;
}
async function begin(fixture, role = 'owner', options = {}) {
  const t = await tab(fixture, role, options.signedIn !== false);
  const registration = await fetch(apiOrigin + mcp + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: options.name ?? 'Synthetic unverified client', redirect_uris: [callback] }) });
  assert.equal(registration.status, 201);
  t.clientId = (await registration.json()).client_id;
  t.verifier = crypto.randomBytes(48).toString('base64url');
  const scope = options.scope ?? 'projects:read boards:read cards:read cards:create offline_access';
  const query = new URLSearchParams({ client_id: t.clientId, redirect_uri: callback, response_type: 'code', resource: webOrigin + mcp, scope, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(t.verifier).digest('base64url') });
  const pending = await t.context.request.get(webOrigin + mcp + '/oauth/authorize?' + query, { maxRedirects: 0 });
  assert.equal(pending.status(), 302);
  const location = new URL(pending.headers().location);
  assert.equal(location.origin, webOrigin);
  assert.equal(location.pathname, '/connect');
  t.requestId = location.searchParams.get('request');
  assert.match(t.requestId, /^[A-Za-z0-9_-]{43}$/);
  t.url = location.href;
  return t;
}
async function open(t) {
  const view = t.page.waitForResponse(r => new URL(r.url()).pathname === mcp + '/authorization-requests/' + t.requestId && r.request().method() === 'GET');
  await t.page.goto(t.url, { waitUntil: 'networkidle', timeout: 60_000 });
  const response = await view;
  assert.equal(response.status(), 200);
  t.view = (await response.json()).data;
  await expect(t.page.locator('[data-page="connect"]')).toBeVisible();
  return t;
}
async function allow(t, projectId) {
  await t.page.getByLabel('Choose one project', { exact: true }).selectOption(projectId);
  await t.page.getByRole('button', { name: 'Allow connection', exact: true }).click();
  await expect(t.page.getByRole('heading', { name: 'Synthetic callback intercepted', exact: true })).toBeVisible();
  assert.ok(t.state.callback?.code);
  assert.equal(t.state.callback.issuer, webOrigin);
  assert.equal(t.state.decisions.length, 1);
  assert.deepEqual(t.state.decisions[0].keys, ['csrfToken', 'decision', 'projectId']);
  assert.equal(t.state.decisions[0].projectId, projectId);
}
async function cleanDom(page) {
  assert.equal(diagnostic.test(await page.locator('body').innerText()), false, 'Private diagnostic/credential rendered.');
  const url = new URL(page.url());
  if (url.origin === webOrigin) for (const name of ['code', 'state', 'token', 'access_token', 'refresh_token', 'redirect_uri', 'client_secret']) assert.equal(url.searchParams.has(name), false);
}
try {
  report.sourceBefore = await hashes();
  api = await startSyntheticApi();
  // The inherited helper owns the disposable schema and fixture creation. This second,
  // task-owned listener exercises the actual mounted application with its explicit test-only
  // loopback origin override; no partial OAuth overlay substitutes for application wiring.
  const mountedApp = createApp(async () => { await api.pool.query('SELECT 1'); }, {
    pool: api.pool, mcpPublicOrigin: webOrigin,
    storage: new MemoryStorageDriver(), imageVerifier: new SharpImageVerifier(),
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  server = serve({ fetch: mountedApp.fetch, hostname: '127.0.0.1', port: 44941 });
  web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', '44942', '-H', '127.0.0.1'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_URL: apiOrigin, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next', NEXT_EXPORT: 'false', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
  const deadline = Date.now() + 90_000;
  for (;;) { try { if ((await fetch(webOrigin + '/signin')).ok) break; } catch {} if (Date.now() > deadline) throw new Error('Startup deadline'); await pause(300); }
  const executablePath = process.env.FLOWBOARD_CHROME_EXECUTABLE ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  report.browser = await browser.version();
  const fixture = await api.fixture();
  googlePerson = fixture.people.owner.user;
  await check('HUI-01-synthetic-Google-safe-next', async () => {
    const t = await begin(fixture, 'owner', { signedIn: false });
    t.state.expectedStatuses.add(401);
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    const href = new URL(await t.page.locator('#googleSignIn').getAttribute('href'), webOrigin);
    assert.equal(href.origin, webOrigin);
    assert.equal(href.searchParams.get('next'), '/connect?request=' + t.requestId);
    await t.page.locator('#googleSignIn').click();
    await t.page.getByRole('link', { name: 'Open synthetic Google sign-in', exact: true }).click();
    await t.page.getByRole('link', { name: 'Continue as synthetic teammate', exact: true }).click();
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toBeVisible();
    assert.equal(new URL(t.page.url()).pathname, '/connect');
    assert.equal(new URL(t.page.url()).searchParams.get('request'), t.requestId);
    await cleanDom(t.page);
  });
  await check('HUI-01-Google-denial-retains-safe-retry', async () => {
    const t = await begin(fixture, 'owner', { signedIn: false });
    t.state.expectedStatuses.add(401);
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    await t.page.locator('#googleSignIn').click();
    await t.page.getByRole('link', { name: 'Open synthetic Google sign-in', exact: true }).click();
    await t.page.getByRole('link', { name: 'Cancel synthetic sign-in', exact: true }).click();
    await expect(t.page.locator('#signinAlert')).toContainText('Google did not give us access');
    const current = new URL(t.page.url());
    assert.equal(current.pathname, '/signin');
    assert.equal(current.searchParams.get('next'), '/connect?request=' + t.requestId);
    const retry = new URL(await t.page.locator('#googleSignIn').getAttribute('href'), webOrigin);
    assert.equal(retry.searchParams.get('next'), '/connect?request=' + t.requestId);
    await t.page.locator('#googleSignIn').click();
    await t.page.getByRole('link', { name: 'Open synthetic Google sign-in', exact: true }).click();
    await t.page.getByRole('link', { name: 'Continue as synthetic teammate', exact: true }).click();
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toBeVisible();
    assert.equal(new URL(t.page.url()).searchParams.get('request'), t.requestId);
  });
  await check('HUI-02-03-explicit-project-unverified-allow', async () => {
    const t = await open(await begin(fixture, 'owner', { name: '<img src=x onerror=alert(1)> Claude' }));
    await expect(t.page.locator('[data-testid="client-unverified"]')).toBeVisible();
    await expect(t.page.locator('[data-testid="client-identity"]')).toContainText('<img');
    await expect(t.page.locator('img[src="x"]')).toHaveCount(0);
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toHaveValue('');
    await expect(t.page.getByRole('button', { name: 'Allow connection', exact: true })).toBeDisabled();
    assert.equal(await t.page.getByRole('option', { name: 'All projects', exact: true }).count(), 0);
    await cleanDom(t.page);
    await t.page.screenshot({ path: path.join(out, 'consent-unverified.png'), fullPage: true });
    await allow(t, fixture.project.id);
  });
  await check('HUI-04-deny-without-project-no-grant', async () => {
    const t = await open(await begin(fixture));
    const before = Number((await api.pool.query('SELECT count(*) FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].count);
    await t.page.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(t.page.getByRole('heading', { name: 'Synthetic callback intercepted', exact: true })).toBeVisible();
    assert.equal(t.state.callback.error, 'access_denied');
    assert.equal(t.state.callback.code, null);
    assert.equal(t.state.decisions[0].projectId, undefined);
    assert.equal(Number((await api.pool.query('SELECT count(*) FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].count), before);
  });
  await check('HUI-05-expired-and-malformed-request', async () => {
    const t = await begin(fixture);
    t.state.expectedStatuses.add(404);
    await api.pool.query("UPDATE mcp_oauth_authorization_requests SET created_at=clock_timestamp()-INTERVAL '20 minutes',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE request_hash=$1", [crypto.createHash('sha256').update(t.requestId).digest('hex')]);
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    await cleanDom(t.page);
    await t.page.goto(webOrigin + '/connect?request=bad&request=duplicate', { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    assert.equal(t.state.decisions.length, 0);
  });
  await check('HUI-05-missing-binding-and-consumed-request', async () => {
    const pending = await begin(fixture);
    const differentBrowser = await tab(fixture);
    differentBrowser.state.expectedStatuses.add(404);
    await differentBrowser.page.goto(pending.url, { waitUntil: 'networkidle' });
    await expect(differentBrowser.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    const t = await open(pending);
    await t.page.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(t.page.getByRole('heading', { name: 'Synthetic callback intercepted', exact: true })).toBeVisible();
    t.state.expectedStatuses.add(404);
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    await expect(t.page.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0);
  });
  for (const role of ['owner', 'manager', 'member', 'viewer']) await check('HUI-06-' + role + '-consent-personal-navigation', async () => {
    const t = await open(await begin(fixture, role));
    assert.equal(t.view.projects.find(p => p.id === fixture.project.id)?.role, role);
    await allow(t, fixture.project.id);
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('tab', { name: 'Connections', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(t.page.locator('[data-testid="connection-list"]')).toContainText('Synthetic unverified client');
    await t.page.locator('.rail-user-wrap button[aria-haspopup="menu"]').click();
    await expect(t.page.getByRole('menuitem', { name: 'Connections', exact: true })).toBeVisible();
    await t.page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
    await cleanDom(t.page);
  });
  for (const offline of [true, false]) await check('HUI-07-duration-' + (offline ? 'continuing' : 'session'), async () => {
    const t = await open(await begin(fixture, 'owner', { scope: 'projects:read boards:read cards:read cards:create' + (offline ? ' offline_access' : '') }));
    assert.equal(t.view.offlineAccess, offline);
    const duration = t.page.locator('[data-testid="connection-duration"]');
    await expect(duration).toContainText(/15\s*minutes/i);
    if (offline) { await expect(duration).toContainText(/30\s*days/i); await expect(duration).toContainText(/7\s*days/i); }
    else await expect(duration).toContainText(/no continuing access|no automatic renewal/i);
    await allow(t, fixture.project.id);
  });
  await check('HUI-08-project-pagination-newest-CSRF', async () => {
    await api.pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) SELECT 'zz_hui_'||lpad(i::text,3,'0'),$1,'Paging project '||i,now(),now() FROM generate_series(1,101) i", [fixture.project.workspaceId]);
    const t = await open(await begin(fixture));
    assert.ok(t.view.nextCursor);
    await t.page.getByLabel('Choose one project', { exact: true }).selectOption(fixture.project.id);
    await t.page.getByRole('button', { name: 'Load more projects', exact: true }).click();
    await expect(t.page.getByRole('option', { name: 'Paging project 101', exact: true })).toHaveCount(1);
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toHaveValue(fixture.project.id);
    await allow(t, fixture.project.id); // A stale page-one CSRF fails this actual POST.
  });
  await check('HUI-09-same-user-replaced-session-clears-consent', async () => {
    const t = await open(await begin(fixture));
    const replacement = await createSession(fixture.people.owner.user.id, 24, api.pool);
    await t.context.addCookies([{ name: 'flowboard_session', value: replacement.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    t.state.expectedStatuses.add(403);
    await t.page.getByLabel('Choose one project', { exact: true }).selectOption(fixture.project.id);
    const refused = t.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/decision'));
    await t.page.getByRole('button', { name: 'Allow connection', exact: true }).click();
    assert.equal((await refused).status(), 403);
    await expect(t.page.locator('[data-testid="client-identity"]')).toHaveCount(0);
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toHaveCount(0);
    assert.equal(Number((await api.pool.query('SELECT count(*) FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].count), 0);
    await cleanDom(t.page);
  });
  await check('HUI-09-different-actor-clears-private-state', async () => {
    const t = await open(await begin(fixture));
    t.state.expectedStatuses.add(403);
    await t.context.addCookies([{ name: 'flowboard_session', value: fixture.people.member.session.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const refreshed = t.page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/session');
    await t.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal((await refreshed).status(), 200);
    await expect(t.page.locator('[data-testid="client-identity"]')).toHaveCount(0);
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toHaveCount(0);
    assert.equal((await t.page.locator('body').innerText()).includes(fixture.people.owner.user.email), false);
    await cleanDom(t.page);
  });
  await check('HUI-09-revoked-project-cannot-approve', async () => {
    const t = await open(await begin(fixture, 'member'));
    t.state.expectedStatuses.add(403);
    t.state.expectedStatuses.add(404);
    await t.page.getByLabel('Choose one project', { exact: true }).selectOption(fixture.project.id);
    await api.pool.query("UPDATE project_memberships SET status='removed' WHERE project_id=$1 AND user_id=$2", [fixture.project.id, fixture.people.member.user.id]);
    try {
      const refused = t.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/decision'));
      await t.page.getByRole('button', { name: 'Allow connection', exact: true }).click();
      assert.ok([403, 404].includes((await refused).status()));
      await expect(t.page.locator('[data-testid="client-identity"]')).toHaveCount(0);
      assert.equal(Number((await api.pool.query('SELECT count(*) FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].count), 0);
    } finally { await api.pool.query("UPDATE project_memberships SET status='active' WHERE project_id=$1 AND user_id=$2", [fixture.project.id, fixture.people.member.user.id]); }
  });
  await check('HUI-09-ended-session-clears-selection-and-CSRF', async () => {
    const t = await begin(fixture);
    const temporary = await createSession(fixture.people.owner.user.id, 24, api.pool);
    await t.context.addCookies([{ name: 'flowboard_session', value: temporary.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await open(t);
    await t.page.getByLabel('Choose one project', { exact: true }).selectOption(fixture.project.id);
    await api.pool.query('DELETE FROM sessions WHERE id=$1', [hashSessionToken(temporary.id)]);
    t.state.expectedStatuses.add(401);
    await t.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(t.page.locator('#googleSignIn')).toBeVisible();
    await expect(t.page.locator('[data-testid="client-identity"]')).toHaveCount(0);
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toHaveCount(0);
    assert.equal(t.state.decisions.length, 0);
  });
  await check('HUI-11-safe-fault-copy-and-retry-after', async () => {
    for (const status of [400, 401, 403, 404, 409, 429, 503]) {
      const t = await begin(fixture);
      t.state.expectedStatuses.add(status);
      await t.context.route(`**${mcp}/authorization-requests/${t.requestId}`, route => route.fulfill({ status, headers: { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '2' } : {}) }, body: JSON.stringify({ error: status === 401 ? 'login_required' : 'invalid_request', debug: 'SQLSTATE PRIVATE-DIAGNOSTIC' }) }));
      await t.page.goto(t.url, { waitUntil: 'networkidle' });
      await expect(t.page.getByRole('heading', { name: status === 404 ? 'Connection request unavailable' : 'Could not open this connection', exact: true })).toBeVisible();
      await expect(t.page.locator('[data-testid="client-identity"]')).toHaveCount(0);
      if (status === 429) {
        const reload = t.page.getByRole('button', { name: 'Reload request', exact: true });
        await expect(reload).toBeDisabled();
        await expect(reload).toBeEnabled({ timeout: 5000 });
      }
      await cleanDom(t.page);
      assert.equal(t.state.decisions.length, 0);
      await t.context.close();
    }
    const t = await begin(fixture);
    await t.context.route(`**${mcp}/authorization-requests/${t.requestId}`, route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'SQLSTATE PRIVATE-DIAGNOSTIC' }));
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Could not open this connection', exact: true })).toBeVisible();
    await cleanDom(t.page);
    assert.equal(t.state.decisions.length, 0);
  });
  await check('HUI-11-unknown-commit-does-not-blindly-repeat', async () => {
    const t = await open(await begin(fixture));
    t.state.expectNetworkLoss = true;
    await t.context.route(`**${mcp}/authorization-requests/${t.requestId}/decision`, async route => {
      const committed = await route.fetch({ maxRedirects: 0 });
      assert.equal(committed.status(), 200);
      return route.abort('failed');
    });
    await t.page.getByLabel('Choose one project', { exact: true }).selectOption(fixture.project.id);
    await t.page.getByRole('button', { name: 'Allow connection', exact: true }).click();
    await expect(t.page.getByRole('heading', { name: 'We could not confirm the result', exact: true })).toBeVisible();
    await expect(t.page.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0);
    assert.equal(Number((await api.pool.query('SELECT count(*) FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].count), 1);
    t.state.expectedStatuses.add(404);
    await t.page.reload({ waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    assert.equal(t.state.decisions.length, 1);
    await cleanDom(t.page);
  });
  await check('HUI-13-keyboard-320px-and-200percent-layout', async () => {
    const longName = 'L'.repeat(100);
    const t = await open(await begin(fixture, 'owner', { name: longName }));
    await expect(t.page.getByRole('heading', { name: `Connect ${longName} to Flowboard`, exact: true })).toBeVisible();
    await t.page.setViewportSize({ width: 320, height: 740 });
    const select = t.page.getByLabel('Choose one project', { exact: true });
    await select.focus();
    await t.page.keyboard.press('b'); // Native select type-ahead: Browser project…
    await t.page.keyboard.press('Tab');
    await expect(select).not.toHaveValue('');
    assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    for (const name of ['Deny', 'Allow connection']) {
      const button = t.page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 321 && box.height >= 44);
    }
    await t.page.screenshot({ path: path.join(out, 'consent-320px.png'), fullPage: true });
    await t.page.setViewportSize({ width: 640, height: 900 });
    await t.page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await t.page.screenshot({ path: path.join(out, 'consent-200percent.png'), fullPage: true });
    await t.page.evaluate(() => { document.documentElement.style.zoom = ''; });
    await t.page.getByRole('button', { name: 'Allow connection', exact: true }).focus();
    await t.page.keyboard.press('Enter');
    await expect(t.page.getByRole('heading', { name: 'Synthetic callback intercepted', exact: true })).toBeVisible();
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    await t.page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const trigger = t.page.locator('[data-connection-id]').first().getByRole('button', { name: 'Disconnect', exact: true });
    await trigger.focus(); await t.page.keyboard.press('Enter');
    const dialog = t.page.getByRole('dialog', { name: 'Disconnect app?', exact: true });
    await expect(dialog.getByRole('button', { name: 'Keep connection', exact: true })).toBeFocused();
    await t.page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeFocused();
    await t.page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Keep connection', exact: true })).toBeFocused();
    await t.page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await t.page.screenshot({ path: path.join(out, 'connections-320px.png'), fullPage: true });
  });
  await check('HUI-10-disconnect-removes-grant-and-access', async () => {
    const t = await open(await begin(fixture));
    await allow(t, fixture.project.id);
    const exchange = await fetch(apiOrigin + mcp + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: t.clientId, redirect_uri: callback, resource: webOrigin + mcp, code: t.state.callback.code, code_verifier: t.verifier }) });
    assert.equal(exchange.status, 200);
    const credentials = await exchange.json();
    assert.ok(await verifyHostedAccessToken(api.pool, credentials.access_token, webOrigin + mcp));
    const connectionId = (await api.pool.query('SELECT id FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].id;
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    const row = t.page.locator(`[data-connection-id="${connectionId}"]`);
    await expect(row).toContainText('Not recorded');
    await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const dialog = t.page.getByRole('dialog', { name: 'Disconnect app?', exact: true });
    await expect(dialog).toContainText(fixture.project.name);
    await t.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Disconnect', exact: true })).toBeFocused();
    await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const deleted = t.page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === mcp + '/connections/' + connectionId);
    await t.page.getByRole('dialog', { name: 'Disconnect app?', exact: true }).getByRole('button', { name: 'Disconnect', exact: true }).click();
    assert.equal((await deleted).status(), 204);
    await expect(row).toHaveCount(0);
    assert.equal(await verifyHostedAccessToken(api.pool, credentials.access_token, webOrigin + mcp), null);
    await cleanDom(t.page);
    await t.page.screenshot({ path: path.join(out, 'connections-after-disconnect.png'), fullPage: true });
  });
  await check('HUI-06-no-project-account-personal-connections', async () => {
    const t = await tab(fixture, 'outsider');
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('tab', { name: 'Connections', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(t.page.getByText('No app connections yet', { exact: true })).toBeVisible();
    await cleanDom(t.page);
  });
  await check('HUI-15-consent-to-five-mounted-tools-refresh-retry-and-disconnect', async () => {
    const t = await open(await begin(fixture));
    await allow(t, fixture.project.id);
    const redeem = await fetch(apiOrigin + mcp + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: t.clientId, redirect_uri: callback, resource: webOrigin + mcp, code: t.state.callback.code, code_verifier: t.verifier }) });
    assert.equal(redeem.status, 200);
    let credentials = await redeem.json();
    let id = 0;
    const rpc = async (method, params) => {
      const response = await mountedApp.request(webOrigin + mcp, { method: 'POST', headers: { authorization: `Bearer ${credentials.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) }) });
      assert.equal(response.status, 200);
      const value = await response.json(); assert.equal(value.error, undefined); return value.result;
    };
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-synthetic-browser-acceptance', version: '1.0' } });
    const tools = await rpc('tools/list');
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['flowboard_create_card', 'flowboard_get_board_columns', 'flowboard_list_boards', 'flowboard_list_projects', 'flowboard_search_cards'].sort());
    const tool = async (name, args = {}) => { const result = await rpc('tools/call', { name, arguments: args }); assert.notEqual(result.isError, true); return JSON.parse(result.content[0].text); };
    const projects = await tool('flowboard_list_projects');
    assert.deepEqual(projects.data.map(project => project.id), [fixture.project.id]);
    await tool('flowboard_list_boards', { projectId: fixture.project.id });
    await tool('flowboard_get_board_columns', { boardId: fixture.board.id });
    await tool('flowboard_search_cards', { projectId: fixture.project.id, query: 'Regression' });
    const input = { operationId: crypto.randomUUID(), boardId: fixture.board.id, column: fixture.columns[0].id, title: 'Hosted browser logical create', priority: 'high' };
    await tool('flowboard_create_card', input);
    const refreshed = await fetch(apiOrigin + mcp + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: t.clientId, resource: webOrigin + mcp, refresh_token: credentials.refresh_token }) });
    assert.equal(refreshed.status, 200); credentials = await refreshed.json();
    await tool('flowboard_create_card', input);
    assert.equal(Number((await api.pool.query('SELECT count(*) FROM cards WHERE board_id=$1 AND title=$2', [fixture.board.id, input.title])).rows[0].count), 1);
    const connectionId = (await api.pool.query('SELECT id FROM mcp_oauth_connections WHERE client_id=$1', [t.clientId])).rows[0].id;
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    await t.page.locator(`[data-connection-id="${connectionId}"]`).getByRole('button', { name: 'Disconnect', exact: true }).click();
    const disconnected = t.page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith('/' + connectionId));
    await t.page.getByRole('dialog', { name: 'Disconnect app?', exact: true }).getByRole('button', { name: 'Disconnect', exact: true }).click();
    assert.equal((await disconnected).status(), 204);
    const refused = await mountedApp.request(webOrigin + mcp, { method: 'POST', headers: { authorization: `Bearer ${credentials.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }) });
    assert.equal(refused.status, 401);
  });
  await check('HUI-12-console-network-and-private-response-clean', async () => {
    assert.equal(report.console.length, 0);
    assert.equal(report.blockedOrigins.length, 0);
    assert.deepEqual(report.network.filter(event => event.status >= 400 && !event.expectedRefusal), []);
  });
  const ownedGroups = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15'];
  const groupPassed = group => report.results.some(result => result.status === 'pass' && (result.id.startsWith('HUI-' + group) || (group === '03' && result.id.startsWith('HUI-02-03'))));
  report.coverage = { ownedGroups, passedGroups: ownedGroups.filter(groupPassed), independentRequired: 'HUI-14 actual compiled Pages runtime', minimumCaseCount: 24 };
  assert.equal(report.results.length >= 24, true, 'Missing required browser cases.');
  assert.deepEqual(report.coverage.passedGroups, ownedGroups, 'Missing a required passing browser group.');
} catch (error) {
  report.setupFailure = safeBrowserError(error);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (web) { web.kill('SIGTERM'); await Promise.race([new Promise(resolve => web.once('exit', resolve)), pause(10_000)]); if (web.exitCode === null) web.kill('SIGKILL'); }
  if (server) await new Promise(resolve => server.close(resolve));
  await api?.close();
  globalThis.fetch = oldFetch;
  for (const [name, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  report.sourceAfter = await hashes().catch(() => ({}));
  report.sourceChanges = Object.keys(report.sourceBefore).filter(p => report.sourceBefore[p] !== report.sourceAfter[p]);
  report.completed = new Date().toISOString();
  report.cleanup = 'Own isolated browser/servers closed; inherited helper drops its own random synthetic schema. No hosted write or external callback request.';
  await save();
  console.log(JSON.stringify({ output: path.relative(root, out), cases: report.results.length, failures: report.results.filter(r => r.status === 'fail').length, setupFailed: !!report.setupFailure, sourceChanges: report.sourceChanges.length }));
  if (report.setupFailure || report.sourceChanges.length || report.blockedOrigins.length || report.results.some(r => r.status !== 'pass')) process.exitCode = 1;
}
