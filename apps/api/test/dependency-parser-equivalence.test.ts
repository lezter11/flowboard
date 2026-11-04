import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import { workbook } from './support/import-workbook.ts';

test('XML backport: actual installed ESM parser retains upstream outputs, metadata and callback traces', async t => {
  const helperUrl = new URL('./support/dependency-parser-equivalence.mjs', import.meta.url);
  const { runParserBackportEquivalence } = await import(helperUrl.href);
  const result = await runParserBackportEquivalence();
  assert.equal(result.comparisons, 4230);
  assert.equal(result.metadataAndCallbackTracesCompared, true);
  t.diagnostic('4230 actual installed/upstream comparisons; metadata Symbols and callback order preserved; no resolver hooks.');
});

test('XML backport: supplied template and unchanged maximum legal workbook retain frozen bytes', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../vendor-patches/fast-xml-parser-5.11.2/manifest.json', import.meta.url), 'utf8'));
  const sha = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
  const template = await fs.readFile(new URL('../../../' + manifest.fixtures.suppliedTemplate.path, import.meta.url));
  assert.equal(sha(template), manifest.fixtures.suppliedTemplate.sha256);
  const maximum = workbook(Array.from({ length: 200 }, (_, i) => ({ externalId: `max-text-${i}`, title: 'Maximum description', description: '&'.repeat(20_000) })), { inlineStrings: true });
  assert.equal(maximum.length, manifest.fixtures.maximumEscapedDescriptions.compressedBytes);
  assert.equal(sha(maximum), manifest.fixtures.maximumEscapedDescriptions.sha256);
});
