import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root = new URL('../../../../../', import.meta.url);
const hosted = await fs.readFile(new URL('scripts/e2e/hosted-mcp-browser.mjs', root), 'utf8');
const legacy = await fs.readFile(new URL('scripts/e2e/diagnostic.mjs', root), 'utf8');
const hostedLaunch = hosted.split('\n').find(line => line.includes('browser = await chromium.launch('));
const legacyLines = legacy.split('\n');
const legacyIndex = legacyLines.findIndex(line => line.includes('const executablePath='));
assert.ok(hostedLaunch); assert.ok(legacyIndex >= 0);
async function options(code, platform, env = {}) {
  return new vm.Script(`(async () => { let browser; ${code}; return browser; })()`).runInNewContext({ process: { platform, env }, chromium: { launch: async value => value } });
}
const result = {};
for (const platform of ['linux', 'darwin', 'win32']) {
  result[platform] = { hosted: await options(hostedLaunch, platform), legacy: await options(legacyLines.slice(legacyIndex, legacyIndex + 2).join('\n'), platform) };
}
const override = '/explicit/test-browser';
result.override = { hosted: await options(hostedLaunch, 'linux', { FLOWBOARD_CHROME_EXECUTABLE: override }), legacy: await options(legacyLines.slice(legacyIndex, legacyIndex + 2).join('\n'), 'linux', { FLOWBOARD_CHROME_EXECUTABLE: override }) };
assert.equal(result.linux.hosted.executablePath, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
assert.equal(Object.hasOwn(result.linux.legacy, 'executablePath'), false);
assert.equal(result.override.hosted.executablePath, override);
assert.equal(result.override.legacy.executablePath, override);
console.log(JSON.stringify({ kind: 'Source-derived option evaluation with a capturing launch stub; not actual Linux/browser execution', revision: 'e5c5687aadfac676699e35015477d2c3d4df72b3', hostedLine: hosted.split('\n').findIndex(line => line === hostedLaunch) + 1, hostedSourceSha256: crypto.createHash('sha256').update(hosted).digest('hex'), result }, null, 2));
