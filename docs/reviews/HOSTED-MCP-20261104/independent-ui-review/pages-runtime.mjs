// Independent, local-only Pages runtime review. Default is preparation, never a silent pass.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_generateASSETSBinding } from 'wrangler';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../../../../apps/api/src/http/app.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const review = path.dirname(fileURLToPath(import.meta.url));
const run = process.argv.includes('--run');
assert.equal(process.env.NODE_ENV, 'test');
const out = path.join(review, run ? 'runs' : 'setup', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(out, { recursive: true });
const stage = path.join(out, 'stage');
const result = { kind: run ? 'local compiled Pages/workerd + actual Node Hono metadata + Wrangler ASSETS over copied static export; controlled cookie probe' : 'setup only; not acceptance', start: new Date().toISOString(), node: process.version, command: 'NODE_ENV=test node docs/reviews/HOSTED-MCP-20261104/independent-ui-review/pages-runtime.mjs' + (run ? ' --run' : ''), commands: [], checks: [], observedApi: [], unexpectedOrigins: [], unexpectedConsole: [], assetsDiagnostics: [], before: {}, after: {}, cleanup: false };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function files(dir) { const list = []; for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) list.push(...await files(p)); else if (e.isFile()) list.push(p); } return list.sort(); }
async function manifest() {
  const paths = [];
  for (const dir of ['apps/web/functions', 'apps/web/src', 'apps/web/out', 'apps/api/src', 'packages/contracts/src']) for (const p of await files(path.join(root, dir))) paths.push(p);
  for (const p of ['scripts/stage-pages-functions.mjs', 'apps/web/next.config.ts', 'apps/web/package.json', 'package.json', 'package-lock.json']) paths.push(path.join(root, p));
  return Object.fromEntries(await Promise.all(paths.map(async p => [path.relative(root, p), sha(await fs.readFile(p))])));
}
async function command(name, args) {
  const log = path.join(out, name + '.log');
  const handle = await fs.open(log, 'w');
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(out, 'wrangler.log') }, stdio: ['ignore', handle.fd, handle.fd] });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await handle.close(); result.commands.push({ name, args, exit, log: path.relative(root, log) }); assert.equal(exit, 0, name + ' failed');
}
const save = () => fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
let mf, absent, browser;
const assetsLifetime = new AbortController();
try {
  result.before = await manifest();
  result.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
  await command('stage', ['scripts/stage-pages-functions.mjs', 'apps/web', stage]);
  await fs.cp(path.join(root, 'apps/web/out'), path.join(stage, 'out'), { recursive: true });
  await command('compile', ['node_modules/wrangler/bin/wrangler.js', 'pages', 'functions', 'build', path.join(stage, 'functions'), '--outdir', path.join(stage, 'worker'), '--project-directory', stage, '--output-routes-path', path.join(stage, 'routes.json'), '--compatibility-date', '2026-10-19']);
  const bundled = (await files(path.join(stage, 'worker'))).find(p => p.endsWith('.js'));
  assert.ok(bundled, 'No actual Pages bundle');
  result.bundle = { file: path.relative(root, bundled), sha256: sha(await fs.readFile(bundled)) };
  const routes = JSON.parse(await fs.readFile(path.join(stage, 'routes.json'), 'utf8'));
  result.routes = routes;
  if (!run) { result.status = 'prepared-not-executed'; }
  else {
    const checks = async (name, fn) => { try { await fn(); result.checks.push({ name, status: 'pass' }); } catch (error) { result.checks.push({ name, status: 'fail', error: String(error?.message ?? error).replace(/request=[^&\s]+/g, 'request=[redacted]') }); } await save(); };
    // Use the installed Wrangler asset implementation: clean URLs, _headers and _redirects
    // come from the copied built output, not a reviewer reconstruction of their behavior.
    const logger = Object.fromEntries(['debug', 'info', 'log', 'warn', 'error'].map(level => [level, (...args) => result.assetsDiagnostics.push({ level, message: args.map(String).join(' ').slice(0,500) })]));
    const assets = await unstable_generateASSETSBinding({ directory: path.join(stage, 'out'), log: logger, signal: assetsLifetime.signal });
    // Explicit loopback origin is test-only; metadata never trusts Host/forwarded headers.
    const publicOrigin = 'http://127.0.0.1:44952';
    // Hono resolves a pool object before checking a missing bearer. This sentinel supplies
    // only that reference; any attempted database operation fails this no-DB probe.
    let databaseOperations = 0;
    const noIoPool = { query: () => { databaseOperations++; throw new Error('Unexpected DB operation in no-DB Pages probe'); }, connect: () => { databaseOperations++; throw new Error('Unexpected DB operation in no-DB Pages probe'); } };
    const app = createApp(async () => {}, { mcpPublicOrigin: publicOrigin, pool: noIoPool });
    const bridge = async request => {
      const url = new URL(request.url);
      result.observedApi.push({ path: url.pathname, canonical: url.origin === publicOrigin, method: request.method, cookiePresent: request.headers.has('cookie') });
      if (url.pathname === '/api/v1/reviewer-referrer-probe') {
        // A read-only local browser request reports only a boolean, never the header value.
        return Response.json({ referrerAbsent: !request.headers.has('referer') });
      }
      if (url.pathname === '/api/v1/reviewer-cookie-probe') {
        // Controlled upstream, exclusively for verifying byte/header forwarding. No product endpoint.
        const headers = new Headers({ 'content-type': 'application/json' });
        headers.append('set-cookie', 'review_alpha=synthetic; Path=/; HttpOnly; SameSite=Lax');
        headers.append('set-cookie', 'review_beta=synthetic; Path=/; HttpOnly; SameSite=Lax');
        return new Response(JSON.stringify({ sameUrl: request.url === publicOrigin + '/api/v1/reviewer-cookie-probe?raw=a%2Fb%2Bc', cookieIntact: request.headers.get('cookie') === 'review=synthetic', bearerIntact: request.headers.get('authorization') === 'Bearer synthetic-review-only', body: await request.text() }), { headers });
      }
      const init = { method: request.method, headers: new Headers(request.headers), redirect: 'manual' };
      if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
      return app.fetch(new Request(request.url, init));
    };
    const workerOptions = { name: 'review-pages', modules: true, scriptPath: bundled, compatibilityDate: '2026-10-19', serviceBindings: { API: bridge, ASSETS: assets }, outboundService: async () => new Response('External network refused by review harness', { status: 599 }) };
    mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 44952, workers: [workerOptions] })); await mf.ready;
    await checks('three actual compiled metadata aliases return protocol JSON without sign-in redirect', async () => {
      for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp']) {
        const before = result.observedApi.length;
        const res = await mf.dispatchFetch(publicOrigin + p, { headers: { 'x-forwarded-host': 'evil.invalid' }, redirect: 'manual' });
        assert.equal(res.status, 200, p); assert.equal(res.headers.get('location'), null); assert.equal(res.headers.get('cache-control'), 'no-store');
        const json = await res.json();
        if (p.endsWith('oauth-authorization-server')) { assert.equal(json.issuer, publicOrigin); assert.equal(json.authorization_endpoint, publicOrigin + '/api/v1/mcp/oauth/authorize'); }
        else { assert.equal(json.resource, publicOrigin + '/api/v1/mcp'); assert.deepEqual(json.authorization_servers, [publicOrigin]); }
        assert.equal(result.observedApi.length - before, 1); assert.equal(result.observedApi.at(-1).path, p); assert.equal(result.observedApi.at(-1).canonical, true);
      }
    });
    await checks('compiled direct connect and refresh serve built HTML without auth redirect', async () => {
      for (const method of ['GET', 'GET', 'HEAD']) { const before = result.observedApi.length; const res = await mf.dispatchFetch(publicOrigin + '/connect?request=' + 'a'.repeat(43), { method, redirect: 'manual' }); assert.equal(res.status, 200); assert.equal(res.headers.get('location'), null); assert.equal(res.headers.get('cache-control'), 'no-store');
        // Referrer Policy section8.1 processes supported values in order; the last wins.
        assert.equal(res.headers.get('referrer-policy')?.split(',').map(s => s.trim()).at(-1), 'no-referrer');
        if (method !== 'HEAD') assert.match(await res.text(), /connect|Loading/); assert.equal(result.observedApi.length, before); }
    });
    await checks('compiled API bridge preserves canonical URL/query/body/cookie/authorization and duplicate Set-Cookie', async () => {
      const res = await mf.dispatchFetch(publicOrigin + '/api/v1/reviewer-cookie-probe?raw=a%2Fb%2Bc', { method: 'POST', headers: { cookie: 'review=synthetic', authorization: 'Bearer synthetic-review-only' }, body: 'safe-body', redirect: 'manual' });
      assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.deepEqual(await res.json(), { sameUrl: true, cookieIntact: true, bearerIntact: true, body: 'safe-body' }); assert.equal(res.headers.getSetCookie().length, 2);
    });
    await checks('actual Hono session401 and MCP401 survive compiled Pages instead of SPA fallback', async () => {
      for (const p of ['/api/v1/session', '/api/v1/mcp']) { const res = await mf.dispatchFetch(publicOrigin + p, { redirect: 'manual' }); assert.equal(res.status, 401, p); assert.equal(res.headers.get('location'), null); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.match(res.headers.get('content-type') ?? '', /json/);
        if (p === '/api/v1/mcp') assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata="http:\/\/127\.0\.0\.1:44952\/\.well-known\/oauth-protected-resource\/api\/v1\/mcp"/);
        await res.arrayBuffer(); }
    });
    absent = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ ...workerOptions, serviceBindings: { ASSETS: assets }, bindings: { API_ORIGIN: 'https://external-refused.invalid' } }] })); await absent.ready;
    await checks('compiled protocol traffic refuses API_ORIGIN fallback without service binding', async () => {
      for (const p of ['/api/v1/mcp', '/api/v1/mcp/connections', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp']) { const res = await absent.dispatchFetch(publicOrigin + p, { redirect: 'manual' }); assert.equal(res.status, 503, p); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal((await res.json()).error.code, 'CONFIG_ERROR'); }
    });
    await checks('isolated Chrome loads and reloads built static connect at320px through compiled Pages', async () => {
      browser = await chromium.launch({ headless: true, executablePath: process.env.FLOWBOARD_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
      result.browser = await browser.version();
      const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
      await context.route('**/*', async route => { const u = new URL(route.request().url()); if (u.origin === publicOrigin || ['data:', 'blob:'].includes(u.protocol)) return route.continue(); result.unexpectedOrigins.push(u.origin); return route.abort(); });
      const page = await context.newPage();
      page.on('pageerror', e => result.unexpectedConsole.push({ type: 'pageerror', message: e.name }));
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (/401/.test(m.text())) return; result.unexpectedConsole.push({ type: m.type(), message: m.text().slice(0,300) }); } });
      for (const reload of [false, true]) { if (reload) await page.reload({ waitUntil: 'networkidle' }); else await page.goto(publicOrigin + '/connect?request=' + 'a'.repeat(43), { waitUntil: 'networkidle' }); await expect(page.getByRole('heading', { name: 'Connect to Flowboard', exact: true })).toBeVisible(); const link = page.getByRole('link', { name: 'Continue with Google', exact: true }); await expect(link).toBeVisible(); assert.equal(new URL(await link.getAttribute('href'), publicOrigin).searchParams.get('next'), '/connect?request=' + 'a'.repeat(43)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); }
      await page.screenshot({ path: path.join(out, 'built-pages-connect-320.png'), fullPage: true });
      result.chromeReferrer = await page.evaluate(async () => (await fetch('/api/v1/reviewer-referrer-probe', { cache: 'no-store' })).json());
      assert.deepEqual(result.chromeReferrer, { referrerAbsent: true }, 'Consent URL must not be sent as a referrer');
      await context.close(); assert.deepEqual(result.unexpectedOrigins, []); assert.deepEqual(result.unexpectedConsole, []);
    });
    result.databaseOperations = databaseOperations;
    assert.equal(databaseOperations, 0, 'No-DB probe unexpectedly attempted database I/O.');
    result.status = result.checks.some(c => c.status !== 'pass') ? 'fail' : 'pass';
  }
} catch (error) { result.status = 'setup-failed'; result.setupError = String(error?.message ?? error).slice(0,1000); }
finally {
  assetsLifetime.abort(); await browser?.close().catch(() => {}); await absent?.dispose().catch(() => {}); await mf?.dispose().catch(() => {});
  result.after = await manifest().catch(() => ({})); result.sourceChanges = [...new Set([...Object.keys(result.before), ...Object.keys(result.after)])].filter(p => result.before[p] !== result.after[p]);
  result.cleanup = true; result.end = new Date().toISOString(); if (result.sourceChanges.length) result.status = run ? 'invalidated-source-changed' : result.status;
  await save(); console.log(JSON.stringify({ output: path.relative(root, out), status: result.status, checks: result.checks.length, failures: result.checks.filter(c => c.status !== 'pass').length, sourceChanges: result.sourceChanges.length }));
  if (!['pass', 'prepared-not-executed'].includes(result.status)) process.exitCode = 1;
}
