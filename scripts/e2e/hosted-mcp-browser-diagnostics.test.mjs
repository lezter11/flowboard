import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { safeBrowserError } from './hosted-mcp-browser-diagnostics.mjs';

test('diagnostics exclude arbitrary names, messages and stack text in case/setup reports', () => {
  const secret = 'synthetic-secret-code-token-cookie-provider-body';
  const error = { name: secret, message: secret, stack: `${secret}\n at ${secret} (/private/${secret}/hosted-mcp-browser.mjs:217:9) ${secret}` };
  const projection = safeBrowserError(error);
  assert.deepEqual(projection, { errorType: 'Error', sourceFrame: { file: 'hosted-mcp-browser.mjs', line: 217, column: 9 } });
  const report = { results: [{ id: 'HUI-synthetic', status: 'fail', ...projection }], setupFailure: projection };
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('diagnostics have fixed types and bounded optional numeric locations', () => {
  assert.deepEqual(safeBrowserError({ name: 'TimeoutError', stack: 'at task (/tmp/hosted-mcp-browser.mjs:550:4)' }), { errorType: 'TimeoutError', sourceFrame: { file: 'hosted-mcp-browser.mjs', line: 550, column: 4 } });
  for (const value of [null, undefined, {}, 'secret', { name: 'toString' }, { name: 'Error-secret' }, { name: 'Error', stack: 12 }, { stack: 'hosted-mcp-browser.mjs:1:1-secret' }, { stack: 'at (/tmp/hosted-mcp-browser.mjs:999999999999:1)' }]) assert.deepEqual(safeBrowserError(value), { errorType: 'Error' });
});

test('changing name/stack accessors are read once and cannot bypass projection', () => {
  let nameReads = 0, stackReads = 0;
  const error = { get name() { return ++nameReads === 1 ? 'Error' : 'synthetic-secret'; }, get stack() { return ++stackReads === 1 ? 'at (/tmp/hosted-mcp-browser.mjs:2:3)' : 'synthetic-secret'; } };
  assert.deepEqual(safeBrowserError(error), { errorType: 'Error', sourceFrame: { file: 'hosted-mcp-browser.mjs', line: 2, column: 3 } });
  assert.equal(nameReads, 1);
  assert.equal(stackReads, 1);
  assert.deepEqual(safeBrowserError({ get name() { throw new Error('synthetic-secret'); }, get stack() { throw new Error('synthetic-secret'); } }), { errorType: 'Error' });
});

test('actual runner launch selection preserves overrides and Darwin while Linux uses managed Chromium', async () => {
  const source = await fs.readFile(new URL('./hosted-mcp-browser.mjs', import.meta.url), 'utf8');
  const selection = source.match(/  const executablePath =[^\n]+\n  browser = await chromium\.launch\([^\n]+/);
  assert.ok(selection, 'Expected bounded launch statements');
  for (const [platform, override, expected] of [['linux', undefined, undefined], ['win32', undefined, undefined], ['darwin', undefined, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], ['linux', '/custom/browser', '/custom/browser'], ['darwin', '/custom/browser', '/custom/browser']]) {
    let observed;
    await vm.runInNewContext(`(async () => { ${selection[0]} })()`, { process: { platform, env: { FLOWBOARD_CHROME_EXECUTABLE: override } }, chromium: { launch: async options => { observed = options; } }, browser: undefined });
    assert.equal(observed.headless, true);
    assert.equal(observed.executablePath, expected);
    assert.equal(Object.hasOwn(observed, 'executablePath'), expected !== undefined);
  }
  assert.match(source, /status: 'fail', \.\.\.safeBrowserError\(error\)/);
  assert.match(source, /report\.setupFailure = safeBrowserError\(error\)/);
});
