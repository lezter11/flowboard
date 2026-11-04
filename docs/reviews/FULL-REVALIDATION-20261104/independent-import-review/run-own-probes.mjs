import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { decodeXmlText, parseXmlPart } from '../../../../apps/api/src/services/import-xml.ts';
import { workbook } from '../../../../apps/api/test/support/import-workbook.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Deliberately independent scanner: checks every original reference, never its output.
function oracle(source) {
  const builtins = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  let result = '';
  for (let i = 0; i < source.length;) {
    if (source[i] !== '&') { result += source[i++]; continue; }
    const end = source.indexOf(';', i + 1);
    if (end < 0) throw new Error('invalid');
    const ref = source.slice(i + 1, end);
    if (Object.hasOwn(builtins, ref)) result += builtins[ref];
    else {
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(ref)) throw new Error('invalid');
      const cp = ref.startsWith('#x') ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      if (!(cp === 9 || cp === 10 || cp === 13 || cp >= 32 && cp <= 0xd7ff || cp >= 0xe000 && cp <= 0xfffd || cp >= 0x10000 && cp <= 0x10ffff)) throw new Error('invalid');
      result += String.fromCodePoint(cp);
    }
    i = end + 1;
  }
  return result;
}
let seed = 20261104, checks = 0;
const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
const tokens = ['Plain', '🙂', '&amp;', '&amp;#65;', '&amp;amp;', '&amp;unknown;', '&lt;', '&gt;', '&quot;', '&apos;', '&#38;amp;', '&#x26;lt;', '&#9;', '&#10;', '&#x1F642;', '&bogus;', '&AMP;', '&amp', '&;', '&', '&#0;', '&#xD800;', '&#x110000;', '&#xFFFE;', '&#xFFFF;', '&#x1FFFF;', '&#x10FFFF;', 'amp;', ';'];
for (let n = 0; n < 30000; n++) {
  let value = '';
  for (let i = 0, length = next() % 13; i < length; i++) value += tokens[next() % tokens.length];
  let expected, failure = false;
  try { expected = oracle(value); } catch { failure = true; }
  if (failure) assert.throws(() => decodeXmlText(value), e => e.status === 422);
  else assert.equal(decodeXmlText(value), expected, value);
  checks++;
}
console.log(JSON.stringify({ phase: 'Node independent scanner comparison', checks, seed: 20261104, pass: true }));
const checkXml = (content, expected) => { const result = parseXmlPart(Buffer.from('<x>' + content + '</x>'), () => {}); assert.equal(result.text, expected); checks++; };
checkXml('&amp;#x41;', '&#x41;');
checkXml('<![CDATA[&amp;unknown;]]>&amp;#65;&#38;amp;', '&amp;unknown;&#65;&amp;');
for (const source of ['&amp;&unknown;', '&amp;\u0001', '<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>', '<x>'.repeat(65) + '</x>'.repeat(65)]) {
  assert.throws(() => parseXmlPart(Buffer.from(source.startsWith('<') ? source : '<x>'+source+'</x>'), () => {}), e => e.status === 422); checks++;
}
const configPath = path.join(dir, 'wrangler-probes.json');
await fs.writeFile(configPath, JSON.stringify({ name: 'independent-import-probes', main: path.join(dir, 'probe-worker.ts'), compatibility_date: '2026-10-19', compatibility_flags: ['nodejs_compat'] }));
const harness = createTestHarness({ workers: [{ configPath }] });
try {
  await harness.listen();
  const worker = harness.getWorker('independent-import-probes');
  const decode = async (source, expectedStatus = 200) => { const response = await worker.fetch('http://localhost/decode', { method: 'POST', body: source }); assert.equal(response.status, expectedStatus); checks++; return response.json(); };
  for (const source of ['&amp;'.repeat(20000), '&amp;#65;', '&amp;unknown;', '&#38;amp; &amp;#x41;', '&lt;&amp;']) assert.equal((await decode(source)).result, oracle(source));
  for (const source of ['&amp;'.repeat(20000)+'&unknown;', '&amp;&', '&amp;&#0;', '&amp;&#xD800;', '&amp;&#x110000;']) await decode(source, 422);
  const bytes = workbook(Array.from({ length: 200 }, (_, i) => ({ externalId: `independent-max-${i}`, title: 'Maximum description', description: '&'.repeat(20000) })), { inlineStrings: true });
  const started = performance.now();
  const response = await worker.fetch('http://localhost/parse', { method: 'POST', body: new Uint8Array(bytes).buffer });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(); assert.equal(result.totalRows, 200);
  for (const [i, row] of result.rows.entries()) { assert.equal(row.externalId, `independent-max-${i}`); assert.equal(row.description, '&'.repeat(20000)); assert.deepEqual(row.rawErrors, []); checks++; }
  console.log(JSON.stringify({ phase: 'actual local workerd legal maximum', rows: 200, descriptionLength: 20000, compressedBytes: bytes.length, elapsedMs: performance.now()-started, pass: true, limit: 'local wall time; no hosted CPU/heap inference' }));
  for (const source of ['<x>'+'<n/>'.repeat(50001)+'</x>', '<x>'+'x'.repeat(655361)+'</x>', '<x>'.repeat(65)+'</x>'.repeat(65), '<!DOCTYPE x [<!ENTITY a "a">]><x>&a;</x>', '<x>&amp;&unknown;</x>']) {
    const rejected = await worker.fetch('http://localhost/xml', { method: 'POST', body: source }); assert.equal(rejected.status, 422, await rejected.clone().text()); checks++;
  }
  assert.equal((await decode('&amp;#65;')).result, '&#65;');
  console.log(JSON.stringify({ phase: 'adversarial Node/workerd', checks, pass: true, exitCode: 0 }));
} finally { await harness.close(); }
