import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startSyntheticApi } from '../../../../scripts/e2e/server.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
// With output:export, Next uses custom distDir as the export directory.
const out = path.join(root, 'apps/web/.next-trash-restore');
const relevant = ['apps/api/src/adapters/trash.ts', 'apps/web/src/app/trash/page.tsx', 'apps/web/src/lib/trash-restore.ts'];
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
const before = Object.fromEntries(await Promise.all(relevant.map(async file => [file, await hash(file)])));
const api = await startSyntheticApi();
let server, browser;
const results = [];
try {
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1:44932');
      if (url.pathname.startsWith('/api/')) {
        const body = Buffer.concat(await Array.fromAsync(req));
        const headers = { ...req.headers };
        delete headers.host;
        delete headers['content-length'];
        const upstream = await fetch('http://127.0.0.1:44931' + url.pathname + url.search, {
          method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}),
        });
        const responseHeaders = Object.fromEntries(upstream.headers);
        delete responseHeaders['content-encoding'];
        delete responseHeaders['content-length'];
        res.writeHead(upstream.status, responseHeaders);
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      else if (!path.extname(rel)) rel += '.html';
      const file = path.resolve(out, '.' + rel);
      if (!file.startsWith(out + '/')) { res.writeHead(403).end(); return; }
      const bytes = await fs.readFile(file);
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(bytes);
    } catch (error) { res.writeHead(500).end('Synthetic proxy error'); console.error(error.message); }
  });
  await new Promise(resolve => server.listen(44932, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const role of ['owner', 'manager']) {
    const fixture = await api.fixture();
    const version = async () => Number((await fixture.pool.query('SELECT structure_version FROM boards WHERE id=$1', [fixture.board.id])).rows[0].structure_version);
    const title = `Legacy restore ${role} destination sentinel`;
    const description = `Retain same ${role} card content`;
    const card = (await fixture.call('owner', 'POST', `/api/v1/boards/${fixture.board.id}/cards`, { title, description, columnId: fixture.columns[2].id, priority: 'high', expectedBoardVersion: await version() })).data;
    await fixture.call('owner', 'POST', `/api/v1/cards/${card.id}/delete`, { expectedVersion: card.version, expectedBoardVersion: await version() });
    const expired = (await fixture.call('owner', 'POST', `/api/v1/boards/${fixture.board.id}/cards`, { title: `Expired ${role} control`, columnId: fixture.columns[1].id, expectedBoardVersion: await version() })).data;
    await fixture.call('owner', 'POST', `/api/v1/cards/${expired.id}/delete`, { expectedVersion: expired.version, expectedBoardVersion: await version() });
    await fixture.pool.query('UPDATE cards SET restore_until=NOW()-INTERVAL \'1 second\' WHERE id=$1', [expired.id]);
    // Legacy recovery only: current normal API/DB guards prevent creating this state.
    await fixture.pool.query('ALTER TABLE columns DISABLE TRIGGER columns_retirement_guard');
    try { await fixture.pool.query('UPDATE columns SET deleted_at=NOW() WHERE id=$1', [fixture.columns[2].id]); }
    finally { await fixture.pool.query('ALTER TABLE columns ENABLE TRIGGER columns_retirement_guard'); }
    const trash = await fixture.call(role, 'GET', `/api/v1/projects/${fixture.project.id}/trash`);
    const row = trash.data.find(r => r.id === card.id);
    assert.equal(row.canRestore, false);
    assert.equal(row.blockedReason, 'destination_missing');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    await context.addCookies([{ name: 'flowboard_session', value: fixture.people[role].session.id, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = [], restores = [], pending = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.request().method() === 'POST' && response.url().endsWith(`/cards/${card.id}/restore`)) pending.push((async () => { restores.push({ status: response.status(), input: response.request().postDataJSON(), result: await response.json() }); })());
    });
    await page.goto('http://127.0.0.1:44932/trash', { waitUntil: 'networkidle' });
    const article = page.locator('article.recovery-row').filter({ hasText: title });
    await article.waitFor();
    assert.equal(await article.getByRole('button', { name: 'Restore', exact: true }).isEnabled(), true);
    assert.equal(await page.locator('article.recovery-row').filter({ hasText: expired.title }).getByRole('button', { name: 'Restore', exact: true }).isDisabled(), true);
    await article.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('heading', { name: 'Pick a column to restore into' }).waitFor();
    const options = await page.locator('#restoreColumn option').evaluateAll(nodes => nodes.map(node => ({ id: node.value, name: node.textContent })));
    assert.equal(options.some(option => option.id === fixture.columns[2].id), false);
    const chosen = fixture.columns[1].id;
    await page.getByLabel('Column', { exact: true }).selectOption(chosen);
    await page.waitForTimeout(400); // Let the existing dialog entrance motion settle for visual evidence.
    await page.screenshot({ path: path.join(directory, `browser-${role}-picker-settled.png`), fullPage: true });
    await page.getByRole('button', { name: 'Restore card', exact: true }).click();
    await article.waitFor({ state: 'detached' });
    await Promise.all(pending);
    assert.deepEqual(restores.map(r => r.status), [409, 200]);
    assert.equal(Object.hasOwn(restores[0].input, 'toColumnId'), false);
    assert.equal(restores[1].input.toColumnId, chosen);
    const restored = (await fixture.call(role, 'GET', `/api/v1/cards/${card.id}`)).data;
    assert.equal(restored.id, card.id);
    assert.equal(restored.title, title);
    assert.equal(restored.description, description);
    assert.equal(restored.columnId, chosen);
    assert.equal(restored.state, 'active');
    assert.equal((await fixture.pool.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='columns'::regclass AND tgname='columns_retirement_guard'")).rows[0].tgenabled, 'O');
    assert.deepEqual(errors, []);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(directory, `browser-${role}-restored-settled.png`), fullPage: true });
    results.push({ role, mountedRow: { canRestore: row.canRestore, blockedReason: row.blockedReason }, actualClicks: ['Restore', 'Select explicit active second column', 'Restore card'], pickerExcludesRetiredColumn: true, expiredRestoreDisabled: true, restores, canonicalRestored: { id: restored.id, title: restored.title, description: restored.description, columnId: restored.columnId, state: restored.state }, errors, retirementTriggerEnabled: true });
    await context.close();
  }
  const after = Object.fromEntries(await Promise.all(relevant.map(async file => [file, await hash(file)])));
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ evidence: 'Local real Chrome against fresh static export and mounted synthetic Node API; legacy random-schema fixture, no hosted UAT approval', before, after, staticTrashSHA256: await hash('apps/web/.next-trash-restore/trash.html'), results }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await api.close();
}
