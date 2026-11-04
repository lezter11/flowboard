import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const helperUrl = new URL('../scripts/dependency-patches.mjs', import.meta.url);
const vendorUrl = new URL('../vendor-patches/fast-xml-parser-5.11.2/', import.meta.url);
const hash = (bytes: string | Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
async function api() {
  const module = await import(helperUrl.href).catch(() => null);
  assert.ok(module, 'The dependency patch helper must be implemented.');
  return module;
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-dependency-patch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const packageRoot = path.join(dir, 'node_modules/fast-xml-parser');
  const manifestPath = path.join(dir, 'apps/api/vendor-patches/fast-xml-parser-5.11.2/manifest.json');
  await fs.cp(vendorUrl, path.dirname(manifestPath), { recursive: true });
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const file of [manifest.packageJson.path, manifest.esmEntry.path, manifest.license.path, ...manifest.files.map((f: { path: string }) => f.path)]) {
    const target = path.join(packageRoot, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let bytes = await fs.readFile(new URL('../../../node_modules/fast-xml-parser/' + file, import.meta.url), 'utf8');
    const record = manifest.files.find((f: { path: string }) => f.path === file);
    if (record && hash(bytes) === record.patchedSha256) {
      const patch = JSON.parse(await fs.readFile(path.join(path.dirname(manifestPath), record.patch), 'utf8'));
      bytes = bytes.replace(patch.after, patch.before);
    }
    await fs.writeFile(target, bytes);
  }
  const lockfilePath = path.join(dir, 'package-lock.json');
  await fs.writeFile(lockfilePath, JSON.stringify({ lockfileVersion: 3, packages: { [manifest.lockEntry]: { version: manifest.version, integrity: manifest.integrity, resolved: manifest.resolved } } }));
  const options = { packageRoot, lockfilePath, manifestPath };
  return { dir, manifest, options, file: (name: string) => path.join(packageRoot, name) };
}

test('dependency patches: apply succeeds and a second apply leaves files untouched', async t => {
  const helper = await api(), f = await fixture(t);
  await assert.rejects(helper.verifyDependencyPatches(f.options));
  await helper.applyDependencyPatches(f.options);
  await helper.verifyDependencyPatches(f.options);
  const before = await Promise.all(f.manifest.files.map((r: { path: string }) => fs.stat(f.file(r.path), { bigint: true })));
  await helper.applyDependencyPatches(f.options);
  for (const [i, r] of f.manifest.files.entries()) {
    assert.equal(hash(await fs.readFile(f.file(r.path))), r.patchedSha256);
    assert.equal((await fs.stat(f.file(r.path), { bigint: true })).mtimeNs, before[i].mtimeNs);
  }
});
test('dependency patches: recognized partial application is rejected by verify and completed by apply', async t => {
  const helper = await api(), f = await fixture(t), record = f.manifest.files[0];
  const patch = JSON.parse(await fs.readFile(path.join(path.dirname(f.options.manifestPath), record.patch), 'utf8'));
  await fs.writeFile(f.file(record.path), (await fs.readFile(f.file(record.path), 'utf8')).replace(patch.before, patch.after));
  await assert.rejects(helper.verifyDependencyPatches(f.options));
  await helper.applyDependencyPatches(f.options);
  await helper.verifyDependencyPatches(f.options);
});
test('dependency patches: an unknown later file prevents every write', async t => {
  const helper = await api(), f = await fixture(t), [first, second] = f.manifest.files;
  const before = await fs.readFile(f.file(first.path));
  await fs.appendFile(f.file(second.path), '\nunknown drift');
  await assert.rejects(helper.applyDependencyPatches(f.options));
  assert.deepEqual(await fs.readFile(f.file(first.path)), before);
});
for (const mutation of ['version', 'integrity', 'entrypoint', 'license', 'manifest', 'patch']) {
  test(`dependency patches: ${mutation} drift fails closed`, async t => {
    const helper = await api(), f = await fixture(t);
    if (mutation === 'version' || mutation === 'entrypoint') {
      const json = JSON.parse(await fs.readFile(f.file('package.json'), 'utf8'));
      if (mutation === 'version') json.version = '5.11.3';
      else json.exports['.'].import.default = './lib/fxp.cjs';
      await fs.writeFile(f.file('package.json'), JSON.stringify(json));
    } else if (mutation === 'integrity') await fs.writeFile(f.options.lockfilePath, JSON.stringify({ packages: { [f.manifest.lockEntry]: { version: f.manifest.version, integrity: 'sha512-unknown' } } }));
    else if (mutation === 'license') await fs.appendFile(f.file(f.manifest.license.path), 'changed');
    else if (mutation === 'manifest') await fs.writeFile(f.options.manifestPath, '{malformed');
    else await fs.writeFile(path.join(path.dirname(f.options.manifestPath), f.manifest.files[0].patch), '{malformed');
    const before = await fs.readFile(f.file(f.manifest.files[0].path));
    await assert.rejects(helper.applyDependencyPatches(f.options));
    assert.deepEqual(await fs.readFile(f.file(f.manifest.files[0].path)), before);
  });
}
test('dependency patches: symlinked targets are refused without modifying the outside file', async t => {
  const helper = await api(), f = await fixture(t), record = f.manifest.files[0], outside = path.join(f.dir, 'outside.js');
  await fs.rename(f.file(record.path), outside);
  const before = await fs.readFile(outside);
  await fs.symlink(outside, f.file(record.path));
  await assert.rejects(helper.applyDependencyPatches(f.options));
  assert.deepEqual(await fs.readFile(outside), before);
});
test('dependency patches: worker maps require both patched ESM contents and refuse CJS or ambiguous/missing sources', async t => {
  const helper = await api(), f = await fixture(t);
  await helper.applyDependencyPatches(f.options);
  const sources = f.manifest.files.map((r: { path: string }) => '../../../node_modules/fast-xml-parser/' + r.path);
  const sourcesContent = await Promise.all(f.manifest.files.map((r: { path: string }) => fs.readFile(f.file(r.path), 'utf8')));
  const map = path.join(f.dir, 'worker.js.map');
  await fs.writeFile(map, JSON.stringify({ version: 3, sources, sourcesContent }));
  await helper.verifyWorkerSourceMap(map, f.options);
  await fs.writeFile(map, JSON.stringify({ version: 3, sources: [...sources, '../sdk/optional-source.ts'], sourcesContent: [...sourcesContent, null] }));
  await helper.verifyWorkerSourceMap(map, f.options);
  for (const invalid of [
    { version: 3, sources: sources.slice(1), sourcesContent: sourcesContent.slice(1) },
    { version: 3, sources, sourcesContent: [sourcesContent[0] + 'drift', sourcesContent[1]] },
    { version: 3, sources, sourcesContent: [null, sourcesContent[1]] },
    { version: 3, sources: [...sources, sources[0]], sourcesContent: [...sourcesContent, sourcesContent[0]] },
    { version: 3, sources: [...sources, '../node_modules/fast-xml-parser/lib/fxp.cjs'], sourcesContent: [...sourcesContent, 'CJS'] },
    { version: 3, sources, sourcesContent: null },
  ]) {
    await fs.writeFile(map, JSON.stringify(invalid));
    await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
  }
  await fs.writeFile(map, '{malformed');
  await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
});
test('dependency patches: CJS URL fragments and escaped names fail closed without widening target paths', async t => {
  const helper = await api(), f = await fixture(t);
  await helper.applyDependencyPatches(f.options);
  const sources = f.manifest.files.map((r: { path: string }) => '../../../node_modules/fast-xml-parser/' + r.path);
  const sourcesContent = await Promise.all(f.manifest.files.map((r: { path: string }) => fs.readFile(f.file(r.path), 'utf8')));
  const map = path.join(f.dir, 'escaped-worker.js.map');
  for (const cjs of [
    '../node_modules/fast-xml-parser/lib/fxp.cjs#fragment',
    '../node_modules/fast-xml-parser/lib/fxp.cjs?query#fragment',
    '../node_modules/fast-xml-parser/lib/fxp.cjs#fragment?query',
    '../node_modules/fast%2Dxml-parser/lib/fxp%2Ecjs',
    '../node_modules/%66ast-xml-parser/lib/fxp.%63js',
    '../node_modules/fast-xml-parser%2Flib%2Ffxp.cjs',
    '../node_modules/fast-xml-parser%5Clib%5Cfxp.cjs',
    '../node_modules/fast-xml-parser/lib/fxp.cjs%23fragment',
    '../node_modules/fast-xml-parser/lib/fxp%252Ecjs',
    '../node_modules/fast-xml-parser/lib/fxp.cjs%invalid',
  ]) {
    await fs.writeFile(map, JSON.stringify({ version: 3, sources: [...sources, cjs], sourcesContent: [...sourcesContent, 'CJS'] }));
    await assert.rejects(helper.verifyWorkerSourceMap(map, f.options), cjs);
  }
  await fs.writeFile(map, JSON.stringify({ version: 3, sources: [sources[0].replace('validator', '%76alidator'), sources[1]], sourcesContent }));
  await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
  await fs.writeFile(map, JSON.stringify({ version: 3, sources: sources.map((source: string) => source + '?query#fragment'), sourcesContent }));
  await helper.verifyWorkerSourceMap(map, f.options);
  const relative = f.manifest.files.map((r: { path: string }) => r.path);
  await fs.writeFile(map, JSON.stringify({ version: 3, sourceRoot: '../../node_modules/fast-xml-parser/', sources: relative, sourcesContent }));
  await helper.verifyWorkerSourceMap(map, f.options);
  await fs.writeFile(map, JSON.stringify({ version: 3, sourceRoot: '../../node_modules/fast-xml-parser/', sources: [...relative, 'lib/fxp.cjs'], sourcesContent: [...sourcesContent, 'CJS'] }));
  await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
  await fs.writeFile(map, JSON.stringify({ version: 3, sourceRoot: '../../node_modules/%66ast-xml-parser/', sources: [...relative, 'lib/fxp.%63js#fragment'], sourcesContent: [...sourcesContent, 'CJS'] }));
  await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
  for (const sourceRoot of ['../../node_modules/untrusted-parser/', 'https://untrusted.example/node_modules/fast-xml-parser/', 123]) {
    await fs.writeFile(map, JSON.stringify({ version: 3, sourceRoot, sources: relative, sourcesContent }));
    await assert.rejects(helper.verifyWorkerSourceMap(map, f.options));
  }
});
test('dependency patches: explicit CLI apply/verify works in an offline ignore-scripts fixture and fails on unpatched bytes', async t => {
  await api();
  const f = await fixture(t), script = path.join(f.dir, 'apps/api/scripts/dependency-patches.mjs');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile(helperUrl, script);
  const run = (mode: string) => spawnSync(process.execPath, [script, mode], { env: { NODE_ENV: 'test', npm_config_ignore_scripts: 'true', npm_config_offline: 'true' }, encoding: 'utf8' });
  assert.notEqual(run('--verify').status, 0);
  assert.equal(run('--apply').status, 0);
  assert.equal(run('--verify').status, 0);
  assert.equal(run('--apply').status, 0);
});
