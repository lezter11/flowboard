#!/usr/bin/env node
// Stages the Cloudflare Pages Functions for a deploy, including every local module they import.
//
// Usage: node scripts/stage-pages-functions.mjs <webRoot> <stageDir>
//   webRoot   the apps/web folder (contains functions/)
//   stageDir  the folder the Pages upload is built in (receives functions/ and any imported files)
//
// Why: functions/_middleware.ts imports ../src/lib/return-path. A hand-written copy list left that
// file out and the Pages build failed (UAT, 2026-10-29). This script follows every relative import
// from functions/ and copies each file to the same path relative to webRoot, so the staged tree
// mirrors the source tree. It fails loudly instead of skipping anything:
//   - an import that cannot be resolved to a file
//   - an import that resolves outside webRoot (it would not be staged next to the functions)
// Bare specifiers (npm packages) are not copied; wrangler bundles them from node_modules.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const [, , webRootArg, stageDirArg] = process.argv;
if (!webRootArg || !stageDirArg) {
  console.error('usage: node scripts/stage-pages-functions.mjs <webRoot> <stageDir>');
  process.exit(2);
}

const webRoot = resolve(webRootArg);
const stageDir = resolve(stageDirArg);
const functionsDir = join(webRoot, 'functions');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];
// Matches `import ... from '...'`, `export ... from '...'` and `import('...')`.
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full));
    else if (SOURCE_EXTENSIONS.includes(extname(entry))) files.push(full);
  }
  return files;
}

function resolveRelativeImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

const problems = [];
const toStage = new Set();
const queue = listSourceFiles(functionsDir);

for (const file of queue) toStage.add(file);

while (queue.length > 0) {
  const file = queue.shift();
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue; // npm package or absolute URL: not staged by this script
    const target = resolveRelativeImport(file, specifier);
    const where = `${relative(webRoot, file)} imports '${specifier}'`;
    if (!target) {
      problems.push(`${where}: does not resolve to a file`);
      continue;
    }
    const inside = target === webRoot || target.startsWith(webRoot + sep);
    if (!inside) {
      problems.push(`${where}: resolves outside ${webRoot} (${target})`);
      continue;
    }
    if (!toStage.has(target)) {
      toStage.add(target);
      queue.push(target);
    }
  }
}

if (problems.length > 0) {
  console.error('stage-pages-functions: refusing to stage, unresolved imports:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const staged = [];
for (const file of [...toStage].sort()) {
  const rel = relative(webRoot, file);
  const destination = join(stageDir, rel);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(file, destination);
  staged.push(rel);
}

console.log(`stage-pages-functions: staged ${staged.length} file(s) into ${stageDir}`);
for (const rel of staged) console.log(`  ${rel}`);
