import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = '/Users/shubham/.codex/worktrees/mcp-uat-repair/Flowboard';
const { build } = await import(`${root}/node_modules/esbuild/lib/main.js`);
const { chromium } = await import(`${root}/node_modules/@playwright/test/index.mjs`);
const files = ['apps/web/src/components/integrations/mcp-prompt-help.tsx', 'apps/web/src/components/integrations/connections-panel.tsx', 'apps/web/src/styles/connections.css', 'docs/HOSTED_MCP_QUICKSTART.md'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));
const before = await hashes();
const js = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {McpPromptHelp} from './apps/web/src/components/integrations/mcp-prompt-help.tsx'; createRoot(document.getElementById('root')).render(<McpPromptHelp/>);`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await build({ entryPoints: [path.join(root, 'apps/web/src/app/globals.css')], bundle: true, write: false, loader: { '.png': 'dataurl', '.svg': 'dataurl' } });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.outputFiles[0].text}</style></head><body><main style="padding:16px;max-width:720px"><div id="root"></div></main><script>${js.outputFiles[0].text}</script></body></html>`;
const result = { kind: 'Isolated real-browser component probe; no signed-in API or deployed acceptance', checks: [], sourceBefore: before, applicationRequests: 0, externalRequests: 0, cleanup: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  result.browser = browser.version();
  for (const mode of ['success', 'failure']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 850 }, serviceWorkers: 'block' });
    await context.addInitScript(({ mode }) => { window.__copies = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { if (mode === 'failure') throw new Error('synthetic clipboard refusal'); window.__copies.push(value); } }, configurable: true }); }, { mode });
    await context.route('**/*', async route => {
      if (route.request().url() === 'http://127.0.0.1:45001/prompt') await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      else { result.externalRequests++; await route.abort(); }
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:45001/prompt');
    const disclosure = page.locator('summary');
    await disclosure.waitFor();
    assert.equal(await page.locator('details').getAttribute('open'), null);
    await disclosure.focus(); await page.keyboard.press('Enter');
    await page.getByLabel('Sample card prompt').waitFor({ state: 'visible' });
    const prompt = await page.getByLabel('Sample card prompt').inputValue();
    assert.match(await page.locator('#cardPromptHelp').textContent(), /Browser sign-in currently supports Claude/i);
    assert.match(prompt, /Title: \[short card title\]/); assert.match(prompt, /cannot set assignees yet/); assert.match(prompt, /do not guess/); assert.match(prompt, /same operation ID and unchanged input/);
    assert.equal(await page.getByLabel('Sample card prompt').getAttribute('readonly'), '');
    await page.getByRole('button', { name: 'Copy sample prompt' }).click();
    if (mode === 'success') {
      await page.getByRole('status').filter({ hasText: 'Prompt copied.' }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__copies), [prompt]);
    } else {
      await page.getByRole('status').filter({ hasText: 'Copy was blocked.' }).waitFor();
      const selected = await page.getByLabel('Sample card prompt').evaluate(node => ({ focused: document.activeElement === node, start: node.selectionStart, end: node.selectionEnd, length: node.value.length }));
      assert.deepEqual(selected, { focused: true, start: 0, end: prompt.length, length: prompt.length });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    result.checks.push({ mode, keyboardDisclosure: true, sampleFields: true, explicitManualAssignment: true, readonly: true, clipboardBehavior: true, noHorizontalOverflowAt320: true, pageErrors: 0 });
    await page.screenshot({ path: `docs/reviews/PROD-MCP-20261105/independent-review/evidence/browser-${mode}.png`, fullPage: true });
    await context.close();
  }
  assert.equal(result.externalRequests, 0);
  result.sourceAfter = await hashes(); assert.deepEqual(result.sourceAfter, before);
  result.status = 'pass'; result.exitCode = 0;
} catch (error) { result.status = 'fail'; result.exitCode = 1; result.error = error.message; }
finally { if (browser) await browser.close(); result.cleanup = true; await fs.writeFile('docs/reviews/PROD-MCP-20261105/independent-review/evidence/browser-result.json', JSON.stringify(result, null, 2)+'\n'); }
console.log(JSON.stringify({ status: result.status, exitCode: result.exitCode, modes: result.checks.length, externalRequests: result.externalRequests, cleanup: result.cleanup, error: result.error }));
process.exitCode = result.exitCode;
