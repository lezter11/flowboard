import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startSyntheticApi } from './server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.FLOWBOARD_BROWSER_REPORT_DIR ?? path.join(root, 'artifacts/browser');
try { await fs.access(path.join(output, 'results.json')); throw new Error('Preserve prior browser evidence; choose a new FLOWBOARD_BROWSER_REPORT_DIR.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(output, { recursive: true });
const { chromium, expect } = await import(process.env.FLOWBOARD_PLAYWRIGHT_MODULE ?? '@playwright/test');
const api = await startSyntheticApi();
let web, browser;
const observations = { kind: 'local synthetic diagnostic, not feature approval', results: [] };
try {
  const fixture = await api.fixture();
  web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', '44932', '-H', '127.0.0.1'], {
    cwd: path.join(root, 'apps/web'), env: { ...process.env, API_URL: 'http://127.0.0.1:44931',
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next', NEXT_EXPORT: 'false', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const webLog = await fs.open(path.join(output, 'next.log'), 'w');
  web.stdout.on('data', (chunk) => void webLog.write(chunk));
  web.stderr.on('data', (chunk) => void webLog.write(chunk));
  const deadline = Date.now() + 90_000;
  while (true) {
    try { if ((await fetch('http://127.0.0.1:44932/signin')).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Local Next startup deadline exceeded.');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const executablePath=process.env.FLOWBOARD_CHROME_EXECUTABLE ?? (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath?{executablePath}:{}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata' });
  const blockedOrigins = new Set();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedOrigins.add(url.origin);
    return route.abort();
  });
  await context.addCookies([{ name: 'flowboard_session', value: fixture.people.owner.session.id,
    domain: '127.0.0.1', path: '/', sameSite: 'Lax', httpOnly: true }]);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:44932/board?id=${encodeURIComponent(fixture.board.id)}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByText('Regression card 01', { exact: true }).first().waitFor({ timeout: 30_000 });
  observations.results.push({ name: 'Owner board with actual session and API', status: 'observed',
    firstCardVisible: true, finalSeededCardVisible: await page.getByText('Regression card 24', { exact: true }).count(),
    loadMoreControls: await page.getByRole('button', { name: /load more/i }).count() });
  await page.screenshot({ path: path.join(output, 'owner-board.png'), fullPage: true });
  if (process.env.FLOWBOARD_BROWSER_BOARD_FLOWS === 'true') {
    const cardsPath=`/api/v1/boards/${fixture.board.id}/cards`;
    const continuation=page.waitForResponse(r=>new URL(r.url()).pathname===cardsPath && new URL(r.url()).searchParams.has('cursor'));
    await page.getByRole('button',{name:/load more/i}).first().click();
    assert.equal((await continuation).status(),200);
    await expect(page.getByText('Regression card 24',{exact:true})).toBeVisible();
    observations.results.push({name:'Column continuation loads the previously off-page 24th card',status:'pass'});
    const filtered=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/boards/${fixture.board.id}` && new URL(r.url()).searchParams.get('titleQuery')==='Regression card 24');
    await page.getByRole('searchbox',{name:'Search cards'}).fill('Regression card 24');
    assert.equal((await filtered).status(),200);
    await expect(page.getByText('Regression card 24',{exact:true})).toBeVisible();
    await expect(page.getByText('Regression card 01',{exact:true})).toHaveCount(0);
    observations.results.push({name:'Server title search reaches a card beyond the initial page',status:'pass'});
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    await expect(page.getByText('Regression card 01',{exact:true})).toBeVisible();
    let creates=0;
    const recordCreate=r=>{if(r.method()==='POST' && new URL(r.url()).pathname===cardsPath)creates++;};page.on('request',recordCreate);
    const originalColumn=page.locator(`[data-column-id="${fixture.columns[0].id}"]`);
    await originalColumn.getByRole('button',{name:`Add a card to ${fixture.columns[0].name}`,exact:true}).click();
    await originalColumn.getByRole('textbox',{name:`New card title in ${fixture.columns[0].name}`,exact:true}).fill('Unsent draft across a column filter');
    await originalColumn.getByRole('combobox').selectOption('urgent');
    await page.getByRole('combobox',{name:'Filter by column',exact:true}).selectOption({label:fixture.columns[1].name});
    await expect(originalColumn).toHaveCount(0);
    await page.getByRole('combobox',{name:'Filter by column',exact:true}).selectOption('');
    const draft=originalColumn.getByRole('textbox',{name:`New card title in ${fixture.columns[0].name}`,exact:true});
    if(!await draft.count())await originalColumn.getByRole('button',{name:`Add a card to ${fixture.columns[0].name}`,exact:true}).click();
    await expect(draft).toHaveValue('Unsent draft across a column filter');
    await expect(originalColumn.getByRole('combobox')).toHaveValue('urgent');
    assert.equal(creates,0,'Filtering must not implicitly create the draft');page.off('request',recordCreate);
    await originalColumn.getByRole('button',{name:'Cancel',exact:true}).click();
    observations.results.push({name:'Unsent quick-add title and chosen priority survive column filter unmount without POST',status:'pass'});
  }
  await page.getByText('Regression card 01', { exact: true }).first().click();
  const drawer = page.getByRole('dialog').first();
  await drawer.waitFor({ timeout: 10_000 });
  await expect.poll(async () => {
    const bounds = await drawer.boundingBox();
    return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1441;
  }, { timeout: 10_000 }).toBe(true);
  observations.results.push({ name: 'Card detail dialog opens', status: 'observed', dialogs: await page.getByRole('dialog').count(),
    assignControls: await page.getByRole('button', { name: /assign/i }).count() });
  await page.screenshot({ path: path.join(output, 'owner-card.png'), fullPage: true });
  if (process.env.FLOWBOARD_BROWSER_FLOWS === 'true') {
    await drawer.getByText('Assign', { exact: true }).click();
    await drawer.getByRole('checkbox', { name: /Synthetic owner/ }).check();
    await drawer.getByText('Assign', { exact: true }).click();
    await drawer.getByLabel('Priority', { exact: true }).selectOption('urgent');
    await drawer.getByLabel('Due date', { exact: true }).fill('2026-12-15');
    const save = drawer.getByRole('button', { name: 'Save changes', exact: true });
    await expect(save).toBeEnabled();
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/v1/cards/${fixture.cards[0].id}`);
    await save.click();
    assert.equal((await response).status(), 200);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    const saved = await api.pool.query('SELECT priority,due_date::text AS due FROM cards WHERE id=$1', [fixture.cards[0].id]);
    const assigned = await api.pool.query('SELECT user_id FROM card_assignees WHERE card_id=$1', [fixture.cards[0].id]);
    assert.equal(saved.rows[0].priority, 'urgent');
    assert.equal(saved.rows[0].due, '2026-12-15');
    assert.deepEqual(assigned.rows.map((r) => r.user_id), [fixture.people.owner.user.id]);
    observations.results.push({ name: 'Owner self-assignment/priority/date Save reaches real PostgreSQL', status: 'pass' });

    const commentPath = `/api/v1/cards/${fixture.cards[0].id}/comments`;
    let dropped = false;
    const keys = [];
    const routeFailures = [];
    await page.route(`**${commentPath}`, async (route) => {
      try {
        if (route.request().method() !== 'POST') return await route.continue();
        keys.push(route.request().headers()['idempotency-key']);
        const result = await route.fetch();
        if (!dropped && result.status() === 201) { dropped = true; return await route.abort('failed'); }
        return await route.fulfill({ response: result });
      } catch (error) {
        routeFailures.push(error.name);
        await route.abort('failed').catch(() => {});
      }
    });
    const text = `Browser response-loss comment ${crypto.randomUUID()}`;
    await drawer.getByRole('combobox', { name: 'Write a comment', exact: true }).fill(text);
    await drawer.getByRole('button', { name: 'Post comment', exact: true }).click();
    const replayResponse = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === commentPath);
    await drawer.getByRole('button', { name: 'Retry original request', exact: true }).click({ timeout: 15_000 });
    assert.equal((await replayResponse).status(), 201);
    await expect(drawer.getByRole('button', { name: 'Post comment', exact: true })).toBeVisible();
    await expect(drawer.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
    const comments = await api.pool.query('SELECT id FROM comments WHERE card_id=$1 AND body=$2', [fixture.cards[0].id, text]);
    assert.equal(comments.rowCount, 1);
    assert.ok(dropped && keys.length === 2 && keys[0] === keys[1]);
    observations.results.push({ name: 'Comment committed response loss then original-key retry has one effect', status: 'pass' });
    await page.unrouteAll({ behavior: 'wait' });
    assert.equal(routeFailures.length, 0);
    const article = drawer.getByRole('article', { name: /Comment by Synthetic owner/ }).filter({ hasText: text });
    await article.getByRole('button', { name: 'Edit your comment', exact: true }).click();
    const edit = drawer.getByRole('region', { name: 'Edit your comment', exact: true });
    await edit.getByRole('combobox', { name: 'Edit your comment', exact: true }).fill(`${text} edited`);
    await edit.getByRole('button', { name: 'Save comment', exact: true }).click();
    await expect(drawer.getByText(`${text} edited`, { exact: true })).toBeVisible();
    observations.results.push({ name: 'Author edits own comment through real API', status: 'pass' });
    await page.screenshot({ path: path.join(output, 'comment-flows.png'), fullPage: true });
  }
  if(process.env.FLOWBOARD_BROWSER_EXTENDED==='true') {
    // Read-only DOM inspection verifies the real portal/inert/focus behavior.
    assert.equal(await drawer.evaluate(element=>!!document.querySelector('main')?.closest('[inert]') && !element.closest('[inert]')),true);
    for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(element=>element.contains(document.activeElement)),true);}
    observations.results.push({name:'Drawer portal makes background inert and keeps keyboard focus inside',status:'pass'});
    await page.setViewportSize({width:360,height:800});
    await expect.poll(async()=>{const r=await drawer.boundingBox();return !!r&&r.x>=0&&r.x+r.width<=361;}).toBe(true);
    assert.equal(await drawer.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
    await page.screenshot({path:path.join(output,'narrow-card.png'),fullPage:true});
    observations.results.push({name:'Card detail fits a360px viewport without its own horizontal overflow',status:'pass'});
    await page.setViewportSize({width:1440,height:1000});
    await drawer.getByRole('button',{name:'Close card details',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'Move card: Regression card 01',exact:true}).click();
    const moveDialog=page.getByRole('dialog',{name:'Move card',exact:true});
    await moveDialog.locator(`input[value="${fixture.columns[1].id}"]`).check();
    await moveDialog.getByLabel('Position',{exact:true}).selectOption('last');
    const moved=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/v1/cards/${fixture.cards[0].id}/move`);
    await moveDialog.getByRole('button',{name:'Move card',exact:true}).click();assert.equal((await moved).status(),200);
    await expect(moveDialog).toHaveCount(0);
    assert.equal((await api.pool.query('SELECT column_id FROM cards WHERE id=$1',[fixture.cards[0].id])).rows[0].column_id,fixture.columns[1].id);
    const undone=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/v1/cards/${fixture.cards[0].id}/move-undo`);
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await undone).status(),200);
    assert.equal((await api.pool.query('SELECT column_id FROM cards WHERE id=$1',[fixture.cards[0].id])).rows[0].column_id,fixture.columns[0].id);
    observations.results.push({name:'Click Move and dedicated Undo restore the actual original populated column',status:'pass'});
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    await page.getByRole('tab',{name:'Workspace',exact:true}).click();
    const name=page.getByRole('textbox',{name:'Workspace name',exact:true});await expect(name).toBeVisible();
    const originalName=await name.inputValue();await name.fill('Unsent workspace browser traversal draft');
    await page.goBack();await expect(page.getByText('Regression card 01',{exact:true}).first()).toBeVisible();
    await page.goForward();await page.getByRole('tab',{name:'Workspace',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Workspace name',exact:true})).toHaveValue('Unsent workspace browser traversal draft');
    assert.equal((await api.pool.query('SELECT name FROM workspaces WHERE id=$1',[fixture.project.workspaceId])).rows[0].name,originalName);
    await page.getByRole('button',{name:'Discard workspace changes',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Workspace name',exact:true})).toHaveValue(originalName);
    observations.results.push({name:'Native Back/Forward restores the unsent workspace draft with no database write; explicit Discard clears it',status:'pass'});
  }
  if (process.env.FLOWBOARD_BROWSER_ROLE_FLOWS === 'true') {
    for (const role of ['owner','manager','member','viewer']) {
      const isolated=await browser.newContext({viewport:{width:1440,height:1000}});
      await isolated.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
      await isolated.addCookies([{name:'flowboard_session',value:fixture.people[role].session.id,domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);
      const tab=await isolated.newPage();let directoryRequests=0;
      tab.on('request',r=>{if(new URL(r.url()).pathname===`/api/v1/projects/${fixture.project.id}/members`)directoryRequests++;});
      await tab.goto(`http://127.0.0.1:44932/people?project=${encodeURIComponent(fixture.project.id)}`,{waitUntil:'networkidle'});
      if (['owner','manager'].includes(role)) {
        await expect(tab.getByRole('heading',{name:'Project team',exact:true})).toBeVisible();
        await expect(tab.getByText('Synthetic member',{exact:true})).toBeVisible();
        assert.ok(directoryRequests>0);
      } else {
        await expect(tab.getByRole('heading',{name:'People unavailable',exact:true})).toBeVisible();
        await expect(tab.getByText('Synthetic owner',{exact:true})).toHaveCount(0);
        assert.equal(directoryRequests,0,'Unauthorized UI must not fetch full directory');
        await tab.goto(`http://127.0.0.1:44932/board?id=${fixture.board.id}`,{waitUntil:'networkidle'});
        await tab.getByText('Regression card 01',{exact:true}).first().click();
        const details=tab.getByRole('dialog').first();await expect(details.getByText('Synthetic full card description',{exact:true})).toBeVisible();
        if(role==='viewer') await expect(details.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
        else {
          await details.getByText('Assign',{exact:true}).click();
          await expect(details.getByRole('checkbox',{name:/Synthetic member/})).toBeVisible();
        }
      }
      observations.results.push({name:`${role}: People directory rule and permitted board access`,status:'pass',directoryRequests});
      await isolated.close();
    }
  }
  observations.blockedExternalOrigins = [...blockedOrigins];
  observations.browser = await browser.version();
  observations.runStatus = 'passed';
  console.log(JSON.stringify(observations));
} catch(error) {
  observations.runStatus='failed';
  observations.failure={name:error.name,message:String(error.message).split('\n')[0].slice(0,500)};
  throw error;
} finally {
  if (browser) await browser.close();
  if (web) {
    web.kill('SIGTERM');
    await new Promise((resolve) => {
      if (web.exitCode !== null) return resolve();
      web.once('exit', resolve);
      setTimeout(() => { if (web.exitCode === null) web.kill('SIGKILL'); resolve(); }, 5000).unref();
    });
  }
  await api.close();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(observations, null, 2) + '\n');
}
