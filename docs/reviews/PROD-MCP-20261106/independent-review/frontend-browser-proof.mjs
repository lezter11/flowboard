// Actual Chrome + exported frontend with synthetic API/session/status presentation.
// No backend authentication, hosted acceptance, real account or database is exercised.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const folder = fileURLToPath(new URL('.', import.meta.url)); // Reviewer-owned output; same-depth copy of builder fixture.
const runFolder = path.join(folder, 'browser-round-' + new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(runFolder);
const root = path.resolve(folder, '../../../..');
const exported = path.join(root, 'apps/web/.next-banner-review');
const report = { kind: 'actual Chrome, exported frontend, synthetic API/session/status presentation only', cases: [], statusRequests: 0, statusCookieRequests: 0, statusRefererRequests: 0, externalBlocked: 0, unexpectedApi: 0, browserErrors: 0, cleanup: false };
let mode = 'inactive', actor = 'signedOut', browser;
const session = { actor: { id: 'synthetic', email: 'synthetic@example.invalid', displayName: 'Synthetic Person', avatarUrl: null }, ownedWorkspaces: [], accessibleProjects: [], needsName: false, suggestedFirstName: 'Synthetic', suggestedLastName: 'Person', lastLocation: null };
const stamp = '2026-11-06T00:00:00.000Z';
const project = { id: 'p', workspaceId: 'w', name: 'Synthetic project', description: null, isOwned: true, role: 'owner', isArchived: false, defaultBoardId: 'b', version: 1, createdAt: stamp, updatedAt: stamp };
const board = { id: 'b', workspaceId: 'w', projectId: 'p', name: 'Synthetic board', description: null, isArchived: false, structureVersion: 1, snapshotVersion: 1, createdAt: stamp, updatedAt: stamp };
const card = { id: 'c', workspaceId: 'w', projectId: 'p', boardId: 'b', columnId: 'col', title: 'Synthetic drawer card', description: 'Synthetic retained draft', priority: 'medium', dueDate: null, assigneeIds: [], position: 1000, version: 1, commentCount: 0, imageCount: 0, state: 'active', deletedAt: null, deletedBy: null, restoreUntil: null, createdAt: stamp, updatedAt: stamp };
const snapshot = { board, filters: {}, asOfDate: '2026-11-06', totals: { activeCardCount: 1, matchingCardCount: 1 }, people: [], columns: [{ id: 'col', name: 'Todo', color: '#64748b', category: 'todo', position: 0, activeCardCount: 1, matchingCardCount: 1, cards: [card], nextCursor: null }] };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (pathname === '/release-status.json') {
      report.statusRequests++;
      if (request.headers.cookie) report.statusCookieRequests++;
      if (request.headers.referer) report.statusRefererRequests++;
      if (mode === 'absent404' || mode === 'retired410') return json({}, mode === 'absent404' ? 404 : 410);
      if (mode === 'error') return json({}, 503);
      return json(mode === 'malformed' ? { active: 'false', message: 'SYNTHETIC_NOT_RENDERED' } : { active: mode === 'active' });
    }
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/v1/session') return actor === 'signedOut' ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ data: { ...session, needsName: actor === 'name', accessibleProjects: actor === 'board' ? [project] : [] } });
      if (actor === 'board') {
        if (pathname === '/api/v1/session/last-location') { response.writeHead(204); response.end(); return; }
        if (pathname === '/api/v1/boards/b') return json({ data: snapshot });
        if (pathname === '/api/v1/projects/p/boards') return json({ data: [board], nextCursor: null });
        if (pathname === '/api/v1/projects/p/people') return json({ data: [], nextCursor: null });
        if (pathname === '/api/v1/cards/c') return json({ data: card });
        if (pathname === '/api/v1/cards/c/comments' || pathname === '/api/v1/cards/c/activity') return json({ data: [], nextCursor: null });
        if (pathname === '/api/v1/cards/c/images') return json({ data: { items: [], count: 0, nextCursor: null } });
      }
      if (pathname === '/api/v1/projects' || pathname === '/api/v1/notifications') return json({ data: [], nextCursor: null });
      if (pathname === '/api/v1/notifications/unread-count') return json({ data: { count: 0 } });
      report.unexpectedApi++;
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }
    const safe = path.resolve(exported, '.' + decodeURIComponent(pathname));
    if (!safe.startsWith(exported + path.sep) && safe !== exported) { response.writeHead(403); response.end(); return; }
    let filename = safe;
    try { if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html'); }
    catch { filename += '.html'; }
    const content = await fs.readFile(filename);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }[path.extname(filename)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime }); response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
const contexts = [];
try {
  // Port0 allocates a new owned loopback listener; never attaches to an existing server.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  async function pageFor(width, height, theme = 'light', scale = 1) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    contexts.push(context);
    await context.addCookies([{ name: 'synthetic_banner_cookie', value: 'not-a-real-credential', url: origin }]);
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== origin) { report.externalBlocked++; return route.abort(); }
      return route.continue();
    });
    await context.addInitScript(theme => localStorage.setItem('flowboard-ui-theme', theme), theme);
    await context.addInitScript(() => {
      // Synthetic visibility adapter; tests the real component's document listener.
      window.bannerProofVisibility = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.bannerProofVisibility });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    page.on('pageerror', () => report.browserErrors++);
    return page;
  }
  async function screenshot(page, name) { await page.screenshot({ path: path.join(runFolder, name + '.png'), fullPage: false }); }
  async function bannerLayout(page) {
    return page.evaluate(() => {
      const b = document.querySelector('.release-banner').getBoundingClientRect();
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, banner: { x: b.x, y: b.y, width: b.width, bottom: b.bottom }, topbarTop: topbar?.top ?? null };
    });
  }
  const page = await pageFor(1440, 900, 'dark');
  await page.clock.install();
  await page.goto(origin + '/signin');
  await expect(page.locator('.signin-google')).toBeVisible();
  await expect(page.locator('.release-banner')).toBeHidden();
  await page.locator('.signin-google').focus();
  await page.evaluate(() => { window.bannerProofSentinel = 'kept'; });
  mode = 'active'; await page.clock.runFor(30_100);
  await expect(page.locator('.release-banner')).toHaveText('Update in progressWe’re updating Flowboard. You can keep this page open.');
  assert.equal(await page.locator('.signin-google').evaluate(node => node === document.activeElement), true);
  await screenshot(page, 'signin-active-dark');
  for (const next of ['malformed', 'error']) {
    mode = next; await page.clock.runFor(30_100);
    await expect(page.locator('.release-banner')).toBeVisible();
    assert.equal(await page.locator('body').textContent().then(text => text.includes('SYNTHETIC_NOT_RENDERED')), false);
  }
  mode = 'inactive'; await page.clock.runFor(30_100);
  await expect(page.locator('.release-banner')).toBeHidden();
  assert.equal(await page.evaluate(() => window.bannerProofSentinel), 'kept');
  report.cases.push({ name: 'initialinactive-active-invalid503retention-inactive', pass: true, forcedReloads: 0, focusPreserved: true });
  for (const absent of ['absent404', 'retired410']) {
    mode = 'active'; await page.clock.runFor(30_100); await expect(page.locator('.release-banner')).toBeVisible();
    mode = absent; await page.clock.runFor(30_100); await expect(page.locator('.release-banner')).toBeHidden();
  }
  report.cases.push({ name: 'legacy404-retired410-clear-without-reload', pass: true });
  await page.evaluate(() => { window.bannerProofVisibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenCount = report.statusRequests;
  mode = 'active'; await page.clock.runFor(60_100);
  assert.equal(report.statusRequests, hiddenCount);
  await page.evaluate(() => { window.bannerProofVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(100);
  await expect(page.locator('.release-banner')).toBeVisible();
  report.cases.push({ name: 'visibility-pauses-and-return-refreshes', pass: true, limit: 'synthetic document visibility adapter, not OS tab switching' });
  await page.close();

  mode = 'active';
  for (const [name, width, height, theme, scale] of [
    ['desktop-light', 1440, 900, 'light', 1], ['narrow-light', 320, 720, 'light', 1],
    ['narrow-dark', 320, 720, 'dark', 1], ['zoom200-reflow-dark', 640, 400, 'dark', 2],
  ]) {
    actor = 'ready';
    const shell = await pageFor(width, height, theme, scale);
    await shell.goto(origin + '/projects');
    await expect(shell.getByRole('button', { name: 'New project', exact: true }).first()).toBeVisible();
    await expect(shell.locator('.release-banner')).toBeVisible();
    const layout = await bannerLayout(shell);
    assert.ok(layout.scrollWidth <= width + 1, 'No document horizontal overflow');
    assert.ok(layout.topbarTop >= layout.banner.bottom - 1, 'Header below notice');
    if (width <= 980) {
      await shell.getByRole('button', { name: 'Show navigation', exact: true }).click();
      await expect(shell.locator('.rail')).toBeVisible();
      const bounds = await shell.locator('.rail').boundingBox();
      assert.ok(bounds.y >= layout.banner.bottom - 1 && bounds.y + bounds.height <= height + 1, 'Rail fits below notice');
      await expect(shell.locator('.rail-user')).toBeInViewport();
      await screenshot(shell, name + '-rail');
      await shell.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await expect(shell.locator('.rail')).toHaveAttribute('aria-hidden', 'true');
    }
    await shell.getByRole('button', { name: 'New project', exact: true }).first().click();
    await expect(shell.getByRole('dialog')).toBeVisible();
    await expect(shell.getByRole('button', { name: 'Close and keep draft', exact: true })).toBeInViewport();
    await expect(shell.getByRole('button', { name: 'Create project', exact: true })).toBeInViewport();
    await screenshot(shell, name + '-dialog');
    await shell.getByRole('button', { name: 'Close and keep draft', exact: true }).click();
    await screenshot(shell, name);
    report.cases.push({ name, pass: true, layout, zoomLimit: scale === 2 ? '200percent reflow equivalent:640x400CSS/deviceScaleFactor2, not browser-chrome zoom control' : null });
    await shell.close();
  }
  for (const [route, state, name] of [['/signin', 'signedOut', 'signin'], ['/connect?request=' + 'a'.repeat(43), 'signedOut', 'connect'], ['/projects', 'name', 'name-step']]) {
    actor = state;
    const bare = await pageFor(320, 720, 'light');
    await bare.goto(origin + route);
    await expect(bare.locator('.release-banner')).toBeVisible();
    if (name === 'name-step') await expect(bare.locator('.name-card')).toBeVisible();
    const layout = await bannerLayout(bare);
    assert.ok(layout.scrollWidth <= 321);
    await screenshot(bare, name + '-320');
    report.cases.push({ name: name + '-global-mount320', pass: true, layout });
    await bare.close();
  }
  for (const [width, height] of [[320, 720], [640, 400]]) {
    actor = 'board'; mode = 'active';
    const detail = await pageFor(width, height, 'dark', width === 640 ? 2 : 1);
    await detail.clock.install();
    await detail.goto(origin + '/board?id=b&card=c');
    await expect(detail.getByRole('button', { name: 'Close card details', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
    const initial = await bannerLayout(detail);
    const drawer = await detail.locator('#cardDrawer').boundingBox();
    assert.ok(drawer.y >= initial.banner.bottom - 1 && drawer.y + drawer.height <= height + 1);
    await expect(detail.getByRole('button', { name: 'Close card details', exact: true })).toBeInViewport();
    await screenshot(detail, `drawer-active-${width}`);
    mode = 'inactive'; await detail.clock.runFor(30_100);
    await expect(detail.locator('.release-banner')).toBeHidden();
    const inactive = await detail.locator('#cardDrawer').boundingBox();
    assert.ok(Math.abs(inactive.y) <= 1 && inactive.y + inactive.height <= height + 1);
    await expect(detail.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
    await screenshot(detail, `drawer-inactive-${width}`);
    await detail.getByRole('button', { name: 'Close card details', exact: true }).click();
    await detail.clock.runFor(300);
    await expect(detail.locator('#cardDrawer')).toHaveCount(0);
    report.cases.push({ name: `actual-card-drawer-active-inactive-${width}`, pass: true, limit: 'real mounted component with synthetic frontend API/session data; no backend authority or save acceptance' });
    await detail.close();
  }
  assert.equal(report.statusCookieRequests, 0);
  assert.equal(report.statusRefererRequests, 0);
  assert.equal(report.externalBlocked, 0);
  assert.equal(report.unexpectedApi, 0);
  assert.equal(report.browserErrors, 0);
} catch (error) {
  report.failure = { kind: ['Error','AssertionError','TypeError'].includes(error?.name) ? error.name : 'Error', sourceFrame: String(error?.stack ?? '').split('\n').find(line => line.includes('frontend-browser-proof.mjs:'))?.replace(root, '[repo]') };
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  report.cleanup = true;
  await fs.writeFile(path.join(runFolder, 'browser-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
