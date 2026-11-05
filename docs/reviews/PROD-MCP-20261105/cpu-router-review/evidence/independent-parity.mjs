import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';
import { HonoRequest } from 'hono/request';

const here = path.dirname(new URL(import.meta.url).pathname), root = process.cwd();
const main = root + '/apps/api/src/http/app.ts', source = await fs.readFile(main, 'utf8');
const needle = '>({ router: new TrieRouter() });';
assert.equal(source.split(needle).length, 2, 'Exactly the main app constructor is selected');
const baseline = source.replace("import { TrieRouter } from 'hono/router/trie-router';\n", '').replace(needle, '>();');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
await fs.writeFile(here + '/actual-main-source.txt', source);
await fs.writeFile(here + '/prior-smart-main-source.txt', baseline);
for (const [label, contents] of [['actual', source], ['smart', baseline]]) {
  await esbuild.build({ entryPoints: [main], outfile: here + '/' + label + '-app.mjs', bundle: true,
    platform: 'node', format: 'esm', packages: 'external',
    alias: { '@flowboard/contracts': root + '/packages/contracts/src/index.ts' },
    plugins: [{ name: 'held-router-comparison', setup(build) {
      build.onLoad({ filter: /\/http\/app\.ts$/ }, args => args.path === main ? { contents, loader: 'ts' } : undefined);
    } }], logLevel: 'warning' });
}
const { createApp: createActual } = await import('./actual-app.mjs');
const { createApp: createSmart } = await import('./smart-app.mjs');
let queries = 0;
const options = { pool: { query() { queries++; throw new Error('No database allowed'); } }, storage: null };
const actual = createActual(async () => {}, options), smart = createSmart(async () => {}, options);
assert.deepEqual(actual.routes.map(r => [r.method, r.path]), smart.routes.map(r => [r.method, r.path]));
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'BREW'];
const paths = new Set(['/', '/api/v1/mcp', '/api/v1/mcp/child', '/api/v1/mcp/oauth', '/api/v1/mcp/oauth/token', '/.well-known/oauth-authorization-server', '/health/live']);
for (const { path: template } of smart.routes) {
  const concrete = template.replace(/:([\w]+)/g, 'fixture').replaceAll('*', 'fixture');
  paths.add(concrete); paths.add(concrete + '/'); paths.add(concrete + '/extra');
}
function signature(app, method, pathname) {
  const match = app.router.match(method, pathname);
  const request = new HonoRequest(new Request('https://router-review.example' + pathname, { method }), pathname, match);
  return match[0].map((entry, index) => {
    request.routeIndex = index;
    return { routeIndex: app.routes.indexOf(entry[0][1]), params: Object.fromEntries(Object.entries(request.param()).sort(([a], [b]) => a.localeCompare(b))) };
  });
}
let representative = 0, adversarial = 0, encoded = 0;
for (const pathname of paths) for (const method of methods) {
  assert.deepEqual(signature(actual, method, pathname), signature(smart, method, pathname), method + ' ' + pathname); representative++;
}
const values = ['%62rd', '%63ol', '%2562rd', '%2F', '%252F', '%00', '%', '%ZZ', '%E0%A4%A', 'a%20b', '%F0%9F%98%80', '__proto__', 'constructor', 'a.b', 'a//b'];
for (const route of smart.routes) {
  if (!route.path.includes(':')) continue;
  const decodedPath = route.path.replace(/:([\w]+)/g, (_, key) => 'value_' + key + '%20encoded').replaceAll('*', 'fixture');
  for (const method of methods.slice(0, 7)) {
    assert.deepEqual(signature(actual, method, decodedPath), signature(smart, method, decodedPath)); encoded++;
  }
  for (const value of values) {
    const pathname = route.path.replace(/:([\w]+)/g, (_, key) => value + (value.includes('%') ? '' : '_' + key)).replaceAll('*', 'fixture');
    for (const method of methods) {
      assert.deepEqual(signature(actual, method, pathname), signature(smart, method, pathname), method + ' ' + pathname); adversarial++;
    }
  }
}
assert.equal(queries, 0);
const result = { status: 'pass', actualSourceSHA256: sha(source), reconstructedSmartSourceSHA256: sha(baseline), routeEntries: actual.routes.length,
  representativeCases: representative, decodedParameterCases: encoded, additionalAdversarialCases: adversarial, differences: 0, databaseCalls: queries,
  detail: 'Actual held source is bundled unchanged; comparison removes only the explicit router import/constructor choice. Every matched handler index/order and HonoRequest decoded param map is compared, not raw representation/key order. No database or hosted call.' };
await fs.writeFile(here + '/independent-parity.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
