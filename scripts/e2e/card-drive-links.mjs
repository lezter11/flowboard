import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startSyntheticApi } from './server.mjs';

const api = await startSyntheticApi();
const proof = [];
const exported = path.resolve(process.env.FLOWBOARD_DRIVE_WEB_EXPORT ?? fileURLToPath(new URL('../../apps/web/.next-drive-export', import.meta.url)));
const evidence = process.env.FLOWBOARD_DRIVE_BROWSER_RESULT;
assert(evidence, 'Choose a path for the Chrome evidence.');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      const headers = { ...request.headers, host: '127.0.0.1:44931' };
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request;
      const upstream = await fetch('http://127.0.0.1:44931' + request.url, { method: request.method, headers, body, ...(body && { duplex: 'half' }) });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    let filename = path.resolve(exported, '.' + decodeURIComponent(pathname));
    assert(filename.startsWith(exported + path.sep) || filename === exported);
    try { if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html'); }
    catch { filename += '.html'; }
    const content = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream' });
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
let browser;
try {
  const fixture = await api.fixture();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cardId = fixture.cards[0].id;
  const href = `${origin}/board?id=${encodeURIComponent(fixture.board.id)}&card=${encodeURIComponent(cardId)}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.FLOWBOARD_CHROME_EXECUTABLE ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const errors = [];
  const external = [];
  let nativeUploadRequests = 0;
  async function open(role, width) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'flowboard_session', value: fixture.people[role].session.id, domain: '127.0.0.1', path: '/', sameSite: 'Lax', httpOnly: true }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/v1/documents/') || url.pathname.endsWith('/documents')) nativeUploadRequests++;
      if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
      external.push({ origin: url.origin, referer: route.request().headers()['referer'] ?? null });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Synthetic Drive destination</p>' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(href);
    return { page, context, drawer: page.getByRole('dialog', { name: /Card details/ }) };
  }

  const owner = await open('owner', 320);
  const section = owner.drawer.getByRole('region', { name: 'Documents' });
  const add = section.getByRole('button', { name: 'Add link' });
  await expect(add).toBeVisible({ timeout: 15000 });
  await expect(owner.drawer.getByRole('button', { name: 'Choose images', exact: true })).toBeVisible();
  const trigger = owner.drawer.getByRole('button', { name: 'Assign', exact: true });
  await trigger.click();
  await expect(owner.drawer.getByRole('searchbox', { name: 'Search people by name' })).toBeFocused();
  await owner.drawer.getByRole('searchbox', { name: 'Search people by name' }).press('Escape');
  await expect(trigger).toBeFocused();
  await add.click();
  const name = section.getByLabel('Document name');
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  const url = section.getByLabel('Google Drive link');
  await name.fill('Quarterly checklist');
  await url.fill('https://drive.google.com.example.invalid/file/d/check/view');
  await section.getByRole('button', { name: 'Add to card' }).click();
  await expect(section.getByRole('alert')).toContainText('Google Drive');
  await expect(section.getByRole('list')).toHaveCount(0);
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/synthetic_sheet/edit?usp=sharing#gid=0';
  await url.fill(sheetUrl);
  await section.getByRole('button', { name: 'Add to card' }).click();
  const link = section.getByRole('link', { name: /Quarterly checklist/ });
  await expect(link).toBeVisible();
  assert.equal(external.length, 0, 'adding a link does not fetch it');
  const order = await owner.drawer.evaluate((drawer) => {
    const docs = drawer.querySelector('.document-links');
    const comments = drawer.querySelector('#commentsTab');
    return Boolean(docs.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(order, true);
  async function save({ page, drawer }) {
    const next = page.waitForResponse(res => res.request().method() === 'PATCH' && new URL(res.url()).pathname === `/api/v1/cards/${cardId}`);
    await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal((await next).status(), 200);
    await expect(drawer.getByText('All changes saved')).toBeVisible();
  }
  await save(owner);
  await owner.page.reload();
  await expect(link).toHaveAttribute('href', sheetUrl);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(section.getByText('Google Sheets')).toBeVisible();
  assert.equal(external.length, 0, 'viewing the drawer does not fetch link previews');
  const popup = owner.page.waitForEvent('popup');
  await link.click();
  const driveTab = await popup;
  await expect(driveTab.getByText('Synthetic Drive destination')).toBeVisible();
  assert.equal(await driveTab.evaluate(() => window.opener), null);
  assert.deepEqual(external, [{ origin: 'https://docs.google.com', referer: null }]);
  await driveTab.close();
  assert(await owner.drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  proof.push('320 px editor with real API and PostgreSQL: safe input, save/reload, explicit open without opener/referrer, assignment picker and images');

  const viewer = await open('viewer', 1024);
  const readOnly = viewer.drawer.getByRole('region', { name: 'Documents' });
  await expect(readOnly.getByRole('link', { name: /Quarterly checklist/ })).toBeVisible();
  await expect(readOnly.getByRole('button')).toHaveCount(0);
  proof.push('1024 px viewer with actual grant can see saved link and has no controls');
  await viewer.context.close();
  await section.getByRole('button', { name: 'Remove link Quarterly checklist' }).click();
  await save(owner);
  await owner.page.reload();
  await expect(add).toBeVisible();
  await expect(section.getByRole('link')).toHaveCount(0);
  const emptied = await open('viewer', 1024);
  await expect(emptied.drawer.getByRole('textbox', { name: 'Card title' })).toBeVisible();
  await expect(emptied.drawer.getByRole('region', { name: 'Documents' })).toHaveCount(0);
  proof.push('Removal persists after reload and empty Documents is hidden for a viewer');
  assert.deepEqual(errors, []);
  assert.equal(nativeUploadRequests, 0);
  await fs.writeFile(evidence, JSON.stringify({ browser: 'Chrome', assertions: proof, runtime: 'Static export with live local Hono API, synthetic sessions and disposable PostgreSQL', unauthorizedExternalRequests: 0, nativeUploadRequests, errors }, null, 2) + '\n');
  console.log(proof.join('\n'));
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await api.close();
}
