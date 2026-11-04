// Prepared local Chrome runner. Do not interpret syntax validity as UI acceptance.
// This file owns only a random synthetic schema, its browser contexts and child processes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.FLOWBOARD_HOSTED_UI_RUN !== '1') {
  console.log(JSON.stringify({ status: 'prepared-not-executed', reason: 'Explicit local test enablement and backend gate are required.' }));
  process.exit(0);
}
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.FLOWBOARD_HOSTED_UI_BACKEND_ACCEPTED, 'yes');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const reviewRoot = path.join(root, 'docs/reviews/HOSTED-MCP-20261104');
const gate = path.resolve(process.env.FLOWBOARD_HOSTED_UI_BACKEND_GATE ?? '');
assert.ok(gate.startsWith(reviewRoot + path.sep), 'Use the current hosted MCP backend review record.');
assert.ok((await fs.stat(gate)).isFile());
const webOrigin = 'http://127.0.0.1:44942';
const apiOrigin = 'http://127.0.0.1:44941';
const callback = 'https://claude.ai/api/mcp/auth_callback';
const mcp = '/api/v1/mcp';
const out = path.join(reviewRoot, 'ui/runs', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(out, { recursive: true });
await fs.copyFile(fileURLToPath(import.meta.url), path.join(out, 'runner-source.mjs'));
const report = {
  kind: 'Actual Chrome against local synthetic OAuth-route composition; not hosted/provider or mounted transport approval',
  start: new Date().toISOString(), results: [], network: [], blockedOrigins: [], console: [], expectedRefusalConsole: [],
  backendGate: path.relative(root, gate), sourceBefore: {}, sourceAfter: {},
};
const sourcePaths = [
  'packages/contracts/src/hosted-mcp.ts', 'apps/api/src/http/routes/hosted-oauth.ts',
  'apps/api/src/adapters/hosted-oauth.ts', 'apps/api/src/http/safe-next.ts',
  'apps/api/src/http/routes/google-auth.ts', 'apps/web/src/app/connect/page.tsx',
  'apps/web/src/app/settings/page.tsx', 'apps/web/src/lib/api.ts',
  'apps/web/src/lib/return-path.ts', 'apps/web/src/components/shell/app-shell.tsx',
  'apps/web/src/components/shell/session-gate.tsx', 'apps/web/functions/_middleware.ts',
];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p => [p, crypto.createHash('sha256').update(await fs.readFile(path.join(root, p))).digest('hex')])));
const save = () => fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const { chromium, expect } = await import('@playwright/test');
const { Hono } = await import('hono');
const { serve } = await import('@hono/node-server');
const { createHostedOAuthRoutes } = await import('../../../../apps/api/src/http/routes/hosted-oauth.ts');
const { verifyHostedAccessToken } = await import('../../../../apps/api/src/adapters/hosted-oauth.ts');
const { startSyntheticApi } = await import('../../../../scripts/e2e/server.mjs');
const oldFetch = globalThis.fetch;
const previousEnv = Object.fromEntries(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'FRONTEND_URL'].map(k => [k, process.env[k]]));
Object.assign(process.env, { GOOGLE_CLIENT_ID: 'synthetic-local.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-local-only', GOOGLE_REDIRECT_URI: webOrigin + '/api/v1/auth/google/callback', FRONTEND_URL: webOrigin });
let googlePerson, api, server, web, browser, currentCase = 'setup';
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
  try {
    await task();
    assert.equal(report.console.length, consoleAt, 'Unexpected console/page error.');
    report.results.push({ id, status: 'pass' });
  } catch (error) {
    // An assertion may contain callback URLs or secrets. Persist its type only.
    report.results.push({ id, status: 'fail', errorType: error?.name ?? 'Error' });
  }
  console.log(JSON.stringify(report.results.at(-1)));
  await save();
}
async function tab(fixture, role = 'owner', signedIn = true) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
  contexts.push(context);
  const state = { callback: null, decisions: [], responses: [] };
  if (signedIn) await context.addCookies([{ name: 'flowboard_session', value: fixture.people[role].session.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.origin + url.pathname === callback) {
      state.callback = { code: url.searchParams.get('code'), error: url.searchParams.get('error'), issuer: url.searchParams.get('iss') };
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic callback intercepted</h1><p>No request was sent to the external service.</p>' });
    }
    if (url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth') {
      const target = new URL('/api/v1/auth/google/callback', webOrigin);
      target.searchParams.set('code', 'synthetic-local-code');
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      const escaped = target.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<h1>Synthetic Google sign-in</h1><a href="${escaped}">Continue as synthetic teammate</a>` });
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
    const expected404 = currentCase === 'HUI-05-expired-and-malformed-request'
      && /Failed to load resource: the server responded with a status of 404/.test(text)
      && typeof location === 'string' && location.startsWith(webOrigin + mcp + '/authorization-requests/');
    const event = { case: currentCase, type: msg.type(), diagnosticOrCredentialPattern: diagnostic.test(text) };
    if (expected404 && !event.diagnosticOrCredentialPattern) report.expectedRefusalConsole.push(event);
    else report.console.push(event);
  });
  page.on('pageerror', error => report.console.push({ case: currentCase, type: 'pageerror', diagnosticOrCredentialPattern: diagnostic.test(error.message) }));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) report.network.push({ case: currentCase, method: response.request().method(), path: safePath(response.url()), status: response.status() });
  });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/decision')) {
      const value = request.postDataJSON();
      state.decisions.push({ decision: value.decision, projectId: value.projectId, keys: Object.keys(value).sort(), csrfPresent: typeof value.csrfToken === 'string' });
    }
  });
  return { context, page, state };
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
  // UI-boundary composition only. Replace this wrapper with the final createApp test hook
  // before reporting mounted app/transport integration acceptance.
  const overlay = new Hono();
  overlay.use('*', async (c, next) => { c.set('pool', api.pool); await next(); });
  overlay.route('', createHostedOAuthRoutes({ publicOrigin: webOrigin }));
  overlay.all('*', c => fetch('http://127.0.0.1:44931' + new URL(c.req.url).pathname + new URL(c.req.url).search, new Request(c.req.raw, { redirect: 'manual' })));
  server = serve({ fetch: overlay.fetch, hostname: '127.0.0.1', port: 44941 });
  web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', '44942', '-H', '127.0.0.1'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_URL: apiOrigin, NEXT_DIST_DIR: '.next-hosted-mcp-ui', NEXT_EXPORT: 'false', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
  const deadline = Date.now() + 90_000;
  for (;;) { try { if ((await fetch(webOrigin + '/signin')).ok) break; } catch {} if (Date.now() > deadline) throw new Error('Startup deadline'); await pause(300); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.FLOWBOARD_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  report.browser = await browser.version();
  const fixture = await api.fixture();
  googlePerson = fixture.people.owner.user;
  await check('HUI-01-synthetic-Google-safe-next', async () => {
    const t = await begin(fixture, 'owner', { signedIn: false });
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    const href = new URL(await t.page.locator('#googleSignIn').getAttribute('href'), webOrigin);
    assert.equal(href.origin, webOrigin);
    assert.equal(href.searchParams.get('next'), '/connect?request=' + t.requestId);
    await t.page.locator('#googleSignIn').click();
    await t.page.getByRole('link', { name: 'Continue as synthetic teammate', exact: true }).click();
    await expect(t.page.getByLabel('Choose one project', { exact: true })).toBeVisible();
    assert.equal(new URL(t.page.url()).pathname, '/connect');
    assert.equal(new URL(t.page.url()).searchParams.get('request'), t.requestId);
    await cleanDom(t.page);
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
    await api.pool.query("UPDATE mcp_oauth_authorization_requests SET created_at=clock_timestamp()-INTERVAL '20 minutes',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE request_hash=$1", [crypto.createHash('sha256').update(t.requestId).digest('hex')]);
    await t.page.goto(t.url, { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    await cleanDom(t.page);
    await t.page.goto(webOrigin + '/connect?request=bad&request=duplicate', { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('heading', { name: 'Connection request unavailable', exact: true })).toBeVisible();
    assert.equal(t.state.decisions.length, 0);
  });
  for (const role of ['owner', 'manager', 'member', 'viewer']) await check('HUI-06-' + role + '-consent-personal-navigation', async () => {
    const t = await open(await begin(fixture, role));
    assert.equal(t.view.projects.find(p => p.id === fixture.project.id)?.role, role);
    await allow(t, fixture.project.id);
    await t.page.goto(webOrigin + '/settings?tab=connections', { waitUntil: 'networkidle' });
    await expect(t.page.getByRole('tab', { name: 'Connections', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(t.page.locator('[data-testid="connection-list"]')).toContainText('Synthetic unverified client');
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
} catch (error) {
  report.setupFailure = { errorType: error?.name ?? 'Error' };
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
