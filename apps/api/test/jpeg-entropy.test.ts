import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateJpegEntropy } from '../src/services/jpeg-entropy.ts';
import { validateImageBinary } from '../src/services/image-validator.ts';
import { SharpImageVerifier } from '../src/services/image-verifier-node.ts';
import { imageFixture, corruptEntropyImages } from './support/image-fixtures.ts';
import { jpegCorpus, jpegSegments, replaceScanTable } from './support/jpeg-corpus.ts';
import { strictJpegOracle } from './support/jpeg-oracle.ts';
import { maximumImageFixtures } from './support/image-maximum-fixtures.ts';
for (const row of jpegCorpus) test('JPEG entropy genuine oracle corpus: ' + row.name, async () => {
  if (row.name === 'progressive-restart-partial') {
    // Pinned upstream loops resetInterval blocks without clipping the last noninterleaved group.
    assert.throws(() => strictJpegOracle(row.bytes), (error: any) => error.name === 'TypeError' && /undefined/.test(error.message));
  } else {
    const decoded = strictJpegOracle(row.bytes);
    assert.equal(decoded.width, row.width);
    assert.equal(decoded.height, row.height);
  }
  // CMYK remains an offlinecodec corpus; directAPIadmission rejects it cheaply.
  const cmyk = row.name.includes('cmyk');
  if (cmyk) assert.throws(() => validateImageBinary(row.bytes, 'image/jpeg'), (error: any) => error.code === 'JPEG_COLOR_MODEL_UNSUPPORTED');
  const dimensions = cmyk ? {
    width: row.width,
    height: row.height,
    contentType: 'image/jpeg' as const
  } : validateImageBinary(row.bytes, 'image/jpeg');
  const metrics = await validateJpegEntropy(row.bytes);
  assert.ok(metrics.presenceBytes <= 10 * 1024 * 1024);
  await new SharpImageVerifier().verify({
    bytes: row.bytes,
    ...dimensions
  }, new AbortController().signal);
});
const gray = jpegCorpus.find(row => row.name === 'grayscale-single-baseline')!.bytes;
const progressive = jpegCorpus.find(row => row.name === 'grayscale-single-progressive')!.bytes;
const restart = jpegCorpus.find(row => row.name === 'progressive-restart')!.bytes;
function invalidCases() {
  const cases: Array<{
    name: string;
    bytes: Buffer;
  }> = corruptEntropyImages().filter(r => r.contentType === 'image/jpeg');
  const dc = replaceScanTable(gray, () => true, 12);
  cases.push({
    name: 'DC-category12',
    bytes: dc
  });
  const zrl = Buffer.from(gray); // Mutate only AC; retain the valid zero-category DC table.
  const acTable = jpegSegments(zrl).find(s => s.marker === 196 && zrl[s.data] === 16)!;
  zrl.fill(0xf0, acTable.data + 17, acTable.end);
  const baselineScan = jpegSegments(zrl).find(s => s.marker === 218)!;
  zrl[baselineScan.end] = 0;
  cases.push({
    name: 'AC-zero-run-overflow',
    bytes: zrl
  });
  const eob = replaceScanTable(progressive, (s, b) => b[s.end - 3]! > 0 && b[s.end - 1]! >>> 4 === 0, 0x10);
  cases.push({
    name: 'EOB-overrun',
    bytes: eob
  });
  const refine = replaceScanTable(progressive, (s, b) => b[s.end - 3]! > 0 && b[s.end - 1]! >>> 4 > 0, 2);
  cases.push({
    name: 'refinement-category2',
    bytes: refine
  });
  const padding = Buffer.from(gray);
  const scan = jpegSegments(padding).find(s => s.marker === 218)!;
  padding[scan.entropyEnd! - 1] = padding[scan.entropyEnd! - 1]! & 254;
  cases.push({
    name: 'non-one-padding',
    bytes: padding
  });
  cases.push({
    name: 'surplus-entropy',
    bytes: Buffer.concat([gray.subarray(0, gray.length - 2), Buffer.from([0]), gray.subarray(gray.length - 2)])
  });
  const badRestart = Buffer.from(restart);
  let index = badRestart.indexOf(Buffer.from([255, 208]));
  assert.ok(index >= 0);
  badRestart[index + 1] = 215;
  cases.push({
    name: 'wrong-restart-sequence',
    bytes: badRestart
  });
  const missingRestart = Buffer.concat([restart.subarray(0, index), restart.subarray(index + 2)]);
  cases.push({
    name: 'missing-restart',
    bytes: missingRestart
  });
  const spectral = Buffer.from(progressive);
  const refinement = jpegSegments(spectral).find(s => s.marker === 218 && spectral[s.end - 3]! > 0 && spectral[s.end - 1]! >>> 4 > 0)!;
  spectral[refinement.end - 1] = 0x30;
  cases.push({
    name: 'invalid-spectral-approximation',
    bytes: spectral
  });
  const firstScan = jpegSegments(progressive).find(s => s.marker === 218)!;
  cases.push({
    name: 'duplicate-first-scan',
    bytes: Buffer.concat([progressive.subarray(0, progressive.length - 2), progressive.subarray(firstScan.markerStart, firstScan.entropyEnd), Buffer.from([255, 217])])
  });
  const segment = Buffer.from(gray);
  segment.writeUInt16BE(65535, 4);
  cases.push({
    name: 'oversized-segment',
    bytes: segment
  });
  const stuffed = Buffer.from(jpegCorpus.find(row => row.name === 'baseline-444')!.bytes);
  const entropy = jpegSegments(stuffed).find(s => s.marker === 218)!;
  index = stuffed.indexOf(Buffer.from([255, 0]), entropy.end);
  assert.ok(index >= entropy.end && index < entropy.entropyEnd!);
  stuffed[index + 1] = 209;
  cases.push({
    name: 'invalid-stuffing-restart',
    bytes: stuffed
  });
  return cases;
}
for (const row of invalidCases()) test('JPEG entropy rejects bounded malformed scan: ' + row.name, async () => {
  await assert.rejects(validateJpegEntropy(row.bytes), (error: any) => error.name === 'ImageValidationError' && error.code === 'MALFORMED_IMAGE');
});
test('JPEG entropy bounded deterministic differential mutations against pinned strict pixel oracle', async t => {
  const results: Array<{
    name: string;
    offset: number;
    mask: number;
    ours: boolean;
    oracle: boolean;
    reason?: string;
    native?: boolean;
  }> = [];
  for (const name of ['baseline-420', 'progressive-444', 'progressive-restart', 'custom-spectral-refinement']) {
    const row = jpegCorpus.find(r => r.name === name)!;
    const scans = jpegSegments(row.bytes).filter(s => s.marker === 218);
    const positions: number[] = [];
    for (const scan of scans) for (let p = scan.end; p < scan.entropyEnd!; p++) if (row.bytes[p] !== 255 && row.bytes[p - 1] !== 255) positions.push(p);
    for (let i = 0; i < 16; i++) for (const mask of [1, 16, 128]) {
      const offset = positions[(i * 7919 + 17) % positions.length]!;
      const bytes = Buffer.from(row.bytes);
      bytes[offset] = bytes[offset]! ^ mask;
      let ours = false,
        oracle = false,
        reason: string | undefined;
      try {
        validateImageBinary(bytes, 'image/jpeg');
        await validateJpegEntropy(bytes);
        ours = true;
      } catch (error) {
        reason = error instanceof Error ? error.message : 'unknown';
      }
      try {
        strictJpegOracle(bytes);
        oracle = true;
      } catch {}
      const result: {
        name: string;
        offset: number;
        mask: number;
        ours: boolean;
        oracle: boolean;
        reason?: string;
        native?: boolean;
      } = {
        name,
        offset,
        mask,
        ours,
        oracle,
        ...(reason ? {
          reason
        } : {})
      };
      if (!ours && oracle) {
        try {
          const dimensions = validateImageBinary(bytes, 'image/jpeg');
          await new SharpImageVerifier().verify({
            bytes,
            ...dimensions
          }, new AbortController().signal);
          result.native = true;
        } catch {
          result.native = false;
        }
      }
      results.push(result);
    }
  }
  const unsafe = results.filter(row => row.ours && !row.oracle);
  const stricter = results.filter(row => !row.ours && row.oracle);
  if (process.env['FLOWBOARD_JPEG_EVIDENCE_PATH']) await fs.writeFile(process.env['FLOWBOARD_JPEG_EVIDENCE_PATH'], JSON.stringify({
    purpose: 'Bounded192entropy-bit mutations; not universal decoder equivalence.',
    count: results.length,
    unsafeComparedToStrictOracle: unsafe.length,
    stricterThanOracle: stricter.length,
    results
  }, null, 2) + '\n');
  t.diagnostic(JSON.stringify({
    mutations: results.length,
    unsafe: unsafe.length,
    stricter: stricter.length
  }));
  assert.deepEqual(unsafe, []);
});
test('JPEG entropy validates20MP maximum supported cases with bounded bitsets and aborts before work', async t => {
  for await (const row of maximumImageFixtures()) if (row.contentType === 'image/jpeg') {
    const metrics = await validateJpegEntropy(row.bytes);
    assert.ok(metrics.presenceBytes <= 10 * 1024 * 1024);
    t.diagnostic(row.name + ' ' + JSON.stringify(metrics));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(validateJpegEntropy(imageFixture('jpeg').bytes, controller.signal), (error: any) => error.status === 503);
});
