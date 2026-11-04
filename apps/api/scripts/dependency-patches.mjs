import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultManifest = fileURLToPath(new URL('../vendor-patches/fast-xml-parser-5.11.2/manifest.json', import.meta.url));
const defaultLock = fileURLToPath(new URL('../../../package-lock.json', import.meta.url));
const expectedPaths = ['src/validator.js', 'src/xmlparser/OrderedObjParser.js'];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`DEPENDENCY_PATCH_VERIFICATION_FAILED: ${message}`); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function json(file, label) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { fail(`${label} is missing or malformed.`); }
}
async function packageFile(packageRoot, relative) {
  if (typeof relative !== 'string' || relative.startsWith('/') || relative.includes('\\')
      || relative.split('/').some(part => !part || part === '.' || part === '..')) fail('Unsafe package file path.');
  const file = path.join(packageRoot, relative);
  const info = await fs.lstat(file).catch(() => fail(`Required package file ${relative} is missing.`));
  if (!info.isFile() || await fs.realpath(file) !== file) fail(`Package file ${relative} must be a regular in-package file.`);
  return { file, bytes: await fs.readFile(file), mode: info.mode };
}
async function load(options = {}) {
  const manifestPath = options.manifestPath ?? defaultManifest;
  const manifest = await json(manifestPath, 'Patch manifest');
  if (!manifest || manifest.schemaVersion !== 1 || manifest.package !== 'fast-xml-parser' || manifest.version !== '5.11.2'
      || manifest.lockEntry !== 'node_modules/fast-xml-parser' || typeof manifest.integrity !== 'string'
      || !manifest.integrity.startsWith('sha512-') || typeof manifest.resolved !== 'string'
      || !Array.isArray(manifest.files) || manifest.files.length !== 2
      || manifest.files.some((record, i) => record?.path !== expectedPaths[i]
        || !isHash(record.upstreamSha256) || !isHash(record.patchedSha256) || !isHash(record.patchSha256)
        || !/^[a-z-]+\.patch\.json$/.test(record.patch))) fail('Patch manifest does not describe the pinned two-file ESM backport.');
  for (const [name, expected] of [['packageJson', 'package.json'], ['esmEntry', 'src/fxp.js'], ['license', 'LICENSE']]) {
    if (manifest[name]?.path !== expected || !isHash(manifest[name]?.sha256)) fail(`Invalid ${name} provenance.`);
  }
  const lockfilePath = options.lockfilePath ?? defaultLock;
  const lock = await json(lockfilePath, 'Package lock');
  const locked = lock.packages?.[manifest.lockEntry];
  if (lock.lockfileVersion !== 3 || locked?.version !== manifest.version
      || locked?.integrity !== manifest.integrity || locked?.resolved !== manifest.resolved) fail('Pinned lock version, registry provenance or integrity differs.');
  const resolvedEntry = options.packageRoot ? undefined : fileURLToPath(import.meta.resolve('fast-xml-parser'));
  const packageRoot = await fs.realpath(options.packageRoot ?? path.dirname(path.dirname(resolvedEntry)));
  const expectedRoot = await fs.realpath(path.join(path.dirname(lockfilePath), manifest.lockEntry));
  if (packageRoot !== expectedRoot) fail('Selected ESM package does not match the pinned lock entry.');
  for (const name of ['packageJson', 'esmEntry', 'license']) {
    const record = manifest[name], value = await packageFile(packageRoot, record.path);
    if (sha256(value.bytes) !== record.sha256) fail(`${name} provenance differs from the pinned package.`);
  }
  const pkg = await json(path.join(packageRoot, 'package.json'), 'Dependency package metadata');
  if (pkg.name !== manifest.package || pkg.version !== manifest.version || pkg.type !== 'module'
      || pkg.exports?.['.']?.import?.default !== './src/fxp.js') fail('Expected exact version and ESM entrypoint.');
  if (resolvedEntry && await fs.realpath(resolvedEntry) !== path.join(packageRoot, manifest.esmEntry.path)) fail('Node selected an unsupported parser entrypoint.');
  const files = [];
  for (const record of manifest.files) {
    const patchPath = path.join(path.dirname(manifestPath), record.patch);
    const patchBytes = await fs.readFile(patchPath).catch(() => fail('Tracked patch is missing.'));
    if (sha256(patchBytes) !== record.patchSha256) fail('Tracked patch provenance differs.');
    const patch = await json(patchPath, 'Tracked patch');
    if (patch.schemaVersion !== 1 || typeof patch.before !== 'string' || !patch.before
        || typeof patch.after !== 'string' || !patch.after || patch.before === patch.after) fail('Tracked patch is malformed.');
    const value = await packageFile(packageRoot, record.path), actual = sha256(value.bytes);
    if (![record.upstreamSha256, record.patchedSha256].includes(actual)) fail(`Unknown bytes in ${record.path}; reinstall the pinned dependency.`);
    if (actual === record.upstreamSha256) {
      const source = value.bytes.toString('utf8');
      if (source.split(patch.before).length !== 2) fail(`Patch context differs in ${record.path}.`);
      const patched = Buffer.from(source.replace(patch.before, patch.after));
      if (sha256(patched) !== record.patchedSha256) fail(`Tracked patch output differs in ${record.path}.`);
      files.push({ ...value, record, patched, applied: false });
    } else files.push({ ...value, record, applied: true });
  }
  return { manifest, files };
}
function result(target, changedFiles = []) {
  return { package: target.manifest.package, version: target.manifest.version,
    files: target.files.map(file => ({ path: file.record.path, sha256: file.record.patchedSha256 })), changedFiles };
}

/** Explicit installation/build tooling only. No request-time patching or network. */
export async function applyDependencyPatches(options = {}) {
  const target = await load(options), changed = [];
  // Validate every target before the first write. Recognized interrupted states
  // can be completed; unknown bytes never cause another file to be modified.
  for (const file of target.files) if (!file.applied) {
    if (sha256(await fs.readFile(file.file)) !== file.record.upstreamSha256) fail('Dependency changed during patch application.');
    const temporary = `${file.file}.flowboard-${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, file.patched, { flag: 'wx', mode: file.mode });
      await fs.rename(temporary, file.file);
    } finally { await fs.rm(temporary, { force: true }); }
    changed.push(file.record.path);
  }
  await verifyDependencyPatches(options);
  return result(target, changed);
}
export async function verifyDependencyPatches(options = {}) {
  const target = await load(options);
  if (target.files.some(file => !file.applied)) fail('ESM backport is missing or partial; run dependency-patches.mjs --apply explicitly.');
  return result(target);
}
export async function verifyWorkerSourceMap(mapPath, options = {}) {
  await verifyDependencyPatches(options);
  const target = await load(options), info = await fs.stat(mapPath).catch(() => fail('Worker source map is missing.'));
  if (info.size > 64 * 1024 * 1024) fail('Worker source map exceeds the verification bound.');
  const map = await json(mapPath, 'Worker source map');
  if (!map || map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)
      || map.sources.length !== map.sourcesContent.length || map.sections
      || map.sources.some(source => typeof source !== 'string')
      || map.sourcesContent.some(source => source !== null && typeof source !== 'string')) fail('Worker map must contain aligned source contents.');
  if (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string') fail('Worker sourceRoot must be a file-path string.');
  const stripUrlSuffix = source => source.replaceAll('\\', '/').split(/[?#]/)[0];
  const sourceRoot = stripUrlSuffix(map.sourceRoot ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(sourceRoot) || sourceRoot.startsWith('//')) fail('URI or network source roots are unsupported.');
  const sources = map.sources.map(source => {
    const file = stripUrlSuffix(source);
    if (/^[a-z][a-z0-9+.-]*:/i.test(file)) {
      // Wrangler's virtual Node builtins are absolute module identities. They
      // are not relative to sourceRoot and never identify the parser package.
      if (!file.startsWith('node-built-in-modules:')) fail('Unsupported Worker source URI.');
      return file;
    }
    return path.posix.normalize(path.posix.isAbsolute(file) ? file : path.posix.join(sourceRoot, file));
  });
  const decodedSources = sources.map(source => {
    let decoded;
    try { decoded = decodeURIComponent(source); }
    catch { fail('Worker source path has malformed percent escapes.'); }
    // A single URL decoding pass is supported. Ambiguous nested encodings fail
    // closed rather than conceal a module name behind another decoding layer.
    if (/%[a-f0-9]{2}/i.test(decoded)) fail('Worker source path has nested percent escapes.');
    return path.posix.normalize(stripUrlSuffix(decoded));
  });
  if (decodedSources.some(source => /(?:^|\/)fast-xml-parser\/.*\.cjs$/i.test(source))) fail('Worker includes unsupported fast-xml-parser CJS code.');
  for (const file of target.files) {
    const suffix = `/node_modules/fast-xml-parser/${file.record.path}`;
    const indexes = sources.flatMap((source, i) => source.endsWith(suffix) || source === suffix.slice(1) ? [i] : []);
    if (indexes.length !== 1 || typeof map.sourcesContent[indexes[0]] !== 'string'
        || sha256(map.sourcesContent[indexes[0]]) !== file.record.patchedSha256) fail(`Worker must include exactly the patched ${file.record.path}.`);
  }
  return { ...result(target), workerSourceMapVerified: true };
}

const invokedFile = process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => undefined);
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  try {
    const [mode, file, ...extra] = process.argv.slice(2);
    let output;
    if (mode === '--apply' && process.argv.length === 3) output = await applyDependencyPatches();
    else if (mode === '--verify' && process.argv.length === 3) output = await verifyDependencyPatches();
    else if (mode === '--verify-worker' && file && !extra.length) output = await verifyWorkerSourceMap(file);
    else fail('Usage: --apply | --verify | --verify-worker <worker.js.map>.');
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'Dependency patch verification failed.') + '\n');
    process.exitCode = 1;
  }
}
