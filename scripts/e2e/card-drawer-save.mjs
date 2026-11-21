import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { startSyntheticApi } from './server.mjs';

const proof = [];
const exported = path.resolve(process.env.FLOWBOARD_DRAWER_WEB_EXPORT ?? fileURLToPath(new URL('../../apps/web/.next-drawer-save', import.meta.url)));
const evidence = process.env.FLOWBOARD_DRAWER_BROWSER_RESULT;
assert(evidence, 'Choose a path for the Chrome evidence.');
const api = await startSyntheticApi();
const mime = { '.txt': 'text/x-component', '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
    if (request.headers.rsc && !path.extname(filename)) {
      filename = pathname === '/' ? path.join(filename, 'index.txt') : `${filename}.txt`;
    } else {
      try { if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html'); }
      catch { filename += '.html'; }
    }
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
  await api.pool.query('UPDATE boards SET description=$1 WHERE id=$2', ['Previously saved notes  ', fixture.board.id]);
  await api.pool.query('UPDATE projects SET brief=$1 WHERE id=$2', ['Previously saved brief  ', fixture.project.id]);
  const href = `${origin}/board?id=${encodeURIComponent(fixture.board.id)}&card=${encodeURIComponent(cardId)}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.FLOWBOARD_CHROME_EXECUTABLE ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const errors = [];
  const external = [];
  async function open(role, width) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'flowboard_session', value: fixture.people[role].session.id, domain: '127.0.0.1', path: '/', sameSite: 'Lax', httpOnly: true }]);
    await context.route(url => url.origin !== origin && !['blob:', 'data:'].includes(url.protocol), route => {
      const url = new URL(route.request().url());
      external.push({ origin: url.origin, referer: route.request().headers()['referer'] ?? null });
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(href);
    return { page, context, drawer: page.getByRole('dialog', { name: /Card details/ }) };
  }

  const { page, drawer } = await open('owner', 1280);
  const alertDialog = page.getByRole('alertdialog');
  const unsaved = page.getByRole('alertdialog', { name: 'Leave with unsaved changes?' });
  const closePrompt = page.getByRole('alertdialog', { name: 'Close this card?' });
  const title = drawer.getByRole('textbox', { name: 'Card title' });
  const status = drawer.getByLabel('Status', { exact: true });
  const composer = drawer.getByRole('combobox', { name: 'Write a comment' });
  const save = drawer.getByRole('button', { name: 'Save changes', exact: true });
  const close = () => drawer.getByRole('button', { name: 'Close card details' }).click();
  const openCard = async () => {
    await expect(page).not.toHaveURL(/[?&]card=/);
    await page.locator(`[data-card-id="${cardId}"] .card-open`).click();
  };
  const projects = () => page.getByRole('link', { name: 'Projects', exact: true }).last().click();
  const activity = () => drawer.getByRole('tab', { name: 'Activity' }).click();
  const closeCleanly = async () => {
    await close();
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]card=/);
    await expect(alertDialog).toHaveCount(0);
  };
  function deferPost(matches) {
    let arrive, release;
    const arrived = new Promise(resolve => { arrive = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const handler = async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      arrive();
      try {
        const failure = await waiting;
        if (failure) return route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY', message: 'Synthetic unavailable', requestId: 'synthetic' } } });
        return route.continue();
      } finally { await page.unroute(matches, handler); }
    };
    return page.route(matches, handler).then(() => ({ arrived, release }));
  }

  await expect(title).toHaveValue('Regression card 01');
  await closeCleanly();
  const switchBoard = async (name, id) => {
    await page.locator('.board-switcher-btn').click();
    await page.getByRole('group', { name: 'Boards in this project' }).getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${id}(?:&|$)`));
    await expect(alertDialog).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
  };
  await switchBoard(fixture.hiddenBoard.name, fixture.hiddenBoard.id);
  await switchBoard(fixture.board.name, fixture.board.id);
  await openCard();
  await expect(title).toHaveValue('Regression card 01');
  await title.fill('Temporary draft');
  await expect(save).toBeEnabled();
  await title.fill('Regression card 01');
  await closeCleanly();
  await switchBoard(fixture.hiddenBoard.name, fixture.hiddenBoard.id);
  await switchBoard(fixture.board.name, fixture.board.id);
  proof.push('Switching between boards after closing an untouched or reverted card shows no draft prompt');
  await projects();
  await expect(page).toHaveURL(/\/projects(?:[/?]|$)/);
  await expect(unsaved).toHaveCount(0);
  proof.push('Untouched board with persisted trailing whitespace navigates without a draft warning');
  await page.locator(`a[href="/project?id=${fixture.project.id}"]:visible`).first().click();
  await expect(page.getByRole('button', { name: 'Edit brief' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Board and columns' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Board and columns' }).getByLabel('Description')).toHaveValue(/^Previously saved notes\s+$/);
  await expect(page.locator('#panel-board button[type=submit]')).toBeDisabled();
  await projects();
  await expect(page).toHaveURL(/\/projects(?:[/?]|$)/);
  await expect(unsaved).toHaveCount(0);
  proof.push('Untouched project brief and board settings with saved whitespace allow navigation');
  await page.locator(`a[href="/board?id=${fixture.board.id}"]:visible`).first().click();
  await openCard();
  const commentsEndpoint = `**/api/v1/cards/${cardId}/comments`;
  const pendingComment = await deferPost(commentsEndpoint);
  await composer.fill('Post independently of card fields');
  await drawer.getByRole('button', { name: 'Post comment' }).click();
  await pendingComment.arrived;
  await expect(drawer.getByRole('button', { name: 'Posting…' })).toBeDisabled();
  assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), false);
  await closeCleanly();
  await openCard();
  await expect(drawer.getByRole('button', { name: 'Posting…' })).toBeDisabled();
  const posted = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith(`/cards/${cardId}/comments`));
  pendingComment.release();
  assert.equal((await posted).status(), 201);
  await expect(drawer.getByText('Post independently of card fields', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  await expect(save).toBeDisabled();
  await expect(drawer.getByText(/entries loaded/i)).toHaveCount(0);
  proof.push('A delayed comment survives immediate close and reopen, commits once and clears the draft without Save changes');

  const failedComment = await deferPost(commentsEndpoint);
  await composer.fill('Retry this comment after a failed response');
  await drawer.getByRole('button', { name: 'Post comment' }).click();
  await failedComment.arrived;
  await closeCleanly();
  failedComment.release(true);
  await openCard();
  await expect(composer).toHaveValue('Retry this comment after a failed response');
  await drawer.getByRole('button', { name: 'Retry original request' }).click();
  await expect(drawer.getByText('Retry this comment after a failed response', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  proof.push('Failed background comment restores its text on reopen and can retry the original operation');

  const originalComment = drawer.getByRole('article').filter({ hasText: 'Post independently of card fields' });
  await originalComment.getByRole('button', { name: 'Edit your comment' }).click();
  await closeCleanly();
  await openCard();
  await expect(drawer.getByRole('button', { name: 'Discard comment edit' })).toHaveCount(0);
  await originalComment.getByRole('button', { name: 'Delete your comment', exact: false }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete this comment?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer.getByRole('button', { name: 'Review deletion' })).toHaveCount(0);
  await closeCleanly();
  proof.push('Opening an untouched comment edit and cancelling deletion with Escape create no draft warning');

  await openCard();
  const moveEndpoint = `**/api/v1/cards/${cardId}/move`;
  const pendingMove = await deferPost(moveEndpoint);
  await status.selectOption(fixture.columns[1].id);
  await pendingMove.arrived;
  await expect(drawer.getByText('Moving card…', { exact: true })).toBeVisible();
  await closeCleanly();
  const moved = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith(`/cards/${cardId}/move`));
  pendingMove.release();
  assert.equal((await moved).status(), 200);
  await openCard();
  await expect(status).toHaveValue(fixture.columns[1].id);
  await expect(save).toBeDisabled();
  assert.equal((await fixture.call('owner', 'GET', `/api/v1/cards/${cardId}`)).data.columnId, fixture.columns[1].id);
  proof.push('Selecting status independently commits a real move even when the drawer closes during the request');

  await expect(drawer.getByRole('button', { name: 'Choose images', exact: true })).toBeEnabled();
  const mixedPaste = await composer.evaluate(element => {
    const payload = new DataTransfer();
    payload.setData('text/plain', 'Keep clipboard text');
    payload.items.add(new File([new Uint8Array([1, 2, 3])], 'inline.png', { type: 'image/png' }));
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: payload, bubbles: true, cancelable: true }));
  });
  assert.equal(mixedPaste, true);
  await expect(drawer.getByRole('list', { name: 'Images being added' })).toHaveCount(0);
  const pendingPhoto = await deferPost('**/api/v1/image-uploads/*/finalize');
  const image = await sharp({ create: { width: 40, height: 32, channels: 3, background: '#e24b58' } }).png().toBuffer();
  await drawer.getByLabel('Choose images to add').setInputFiles({ name: 'drawer-photo.png', mimeType: 'image/png', buffer: image });
  await pendingPhoto.arrived;
  await closeCleanly();
  const finalized = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/finalize'));
  pendingPhoto.release();
  assert.ok((await finalized).ok());
  await expect(page.locator(`[data-card-id="${cardId}"] [title="1 private images"]`)).toBeVisible();
  await openCard();
  await expect(drawer.getByRole('button', { name: 'Open image drawer photo' })).toBeVisible();
  await expect(save).toBeDisabled();
  await activity();
  await expect(drawer.getByText(/added an image/i)).toBeVisible();
  await expect(drawer.getByText(/entries loaded/i)).toHaveCount(0);
  proof.push('Photo finalizes after close, refreshes the board image badge and activity, and does not intercept mixed text paste');

  await title.fill('Unsaved title');
  await status.selectOption(fixture.columns[2].id);
  await expect(status).toBeEnabled();
  await expect(title).toHaveValue('Unsaved title');
  await expect(save).toBeEnabled();
  assert.equal((await fixture.call('owner', 'GET', `/api/v1/cards/${cardId}`)).data.columnId, fixture.columns[2].id);
  await close();
  await expect(closePrompt).toBeVisible();
  await closePrompt.getByRole('button', { name: 'Close and keep drafts' }).click();
  await expect(drawer).toHaveCount(0);
  await projects();
  await expect(page).toHaveURL(/\/projects(?:[/?]|$)/);
  await expect(unsaved).toHaveCount(0);
  await page.goBack();
  await openCard();
  await expect(title).toHaveValue('Unsaved title');
  await drawer.getByRole('button', { name: 'Discard', exact: true }).click();
  await closeCleanly();
  proof.push('Real field edits survive independent moves and reopening, with no repeat navigation warning after keeping them');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(evidence, JSON.stringify({ browser: 'Chrome', assertions: proof, runtime: 'Static export with local Hono API, synthetic sessions and disposable PostgreSQL', external, errors }, null, 2) + '\n');
  console.log(proof.join('\n'));
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await api.close();
}
