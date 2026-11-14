import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DOCUMENT_MEDIA_TYPES } from '@flowboard/contracts';
import { scanClamdStream, ClamAvQpdfDocumentProcessor } from '../src/services/document-processor-node.ts';
import { BindingDocumentProcessor, createDocumentScannerHandler } from '../src/services/document-scanner-http.ts';
import { excelParts, wordParts } from './support/document-office-fixtures.ts';
import { zipXmlParts } from './support/import-xml-fixture.ts';

function syntheticPdf(extraCatalog = '', stream = 'q\nQ\n'.repeat(3000), extraStreamDictionary = ''): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${extraCatalog} >>`,
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} ${extraStreamDictionary} >>\nstream\n${stream}endstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(content);
  content += 'xref\n0 5\n0000000000 65535 f \n';
  for (const offset of offsets) content += `${String(offset).padStart(10, '0')} 00000 n \n`;
  content += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}

test('ClamAV INSTREAM framing carries original bytes and rejects ambiguous or failed results', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flowboard-doc-test-'));
  const socketPath = join(directory, 'scan.sock');
  const responses = [
    'stream: OK\0', 'stream: SyntheticSignature FOUND\0',
    'stream: INSTREAM size limit exceeded. ERROR\0', 'stream: OK\0other: OK\0', 'stream: OK',
  ];
  const contents = Buffer.from('synthetic input');
  const sent: Buffer[] = [];
  const server = createServer(socket => {
    const chunks: Buffer[] = [];
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const wire = Buffer.concat(chunks);
      if (wire.length !== 10 + 4 + contents.length + 4) return;
      assert.equal(wire.subarray(0, 10).toString(), 'zINSTREAM\0');
      assert.equal(wire.readUInt32BE(10), contents.length);
      assert.equal(wire.readUInt32BE(wire.length - 4), 0);
      sent.push(wire.subarray(14, wire.length - 4));
      socket.end(responses.shift() ?? '');
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    assert.equal(await scanClamdStream(socketPath, contents, AbortSignal.timeout(1500)), 'clean');
    assert.equal(await scanClamdStream(socketPath, contents, AbortSignal.timeout(1500)), 'rejected');
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(scanClamdStream(socketPath, contents, AbortSignal.timeout(1500)), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });
    }
    assert.equal(sent.length, 5);
    assert(sent.every(item => item.equals(contents)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM' && !server.listening) {
      t.skip('The execution sandbox disallows Unix sockets; run the native scanner test container.');
      return;
    }
    throw error;
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

const nativeSocket = process.env['FB_TEST_DOCUMENT_CLAMD_SOCKET'];
test('real ClamAV and qpdf accept a small readable PDF and reject malware, active content and malformed files', { skip: !nativeSocket }, async () => {
  const processor = new ClamAvQpdfDocumentProcessor({ clamSocket: nativeSocket!, qpdfPath: '/usr/bin/qpdf', prlimitPath: '/usr/bin/prlimit' });
  const key = 'a'.repeat(64);
  const handler = createDocumentScannerHandler(processor, key);
  const binding = new BindingDocumentProcessor({ fetch: handler }, key);
  const original = syntheticPdf();
  const clean = await binding.process(original, AbortSignal.timeout(18000));
  assert.equal(clean.mediaType, 'application/pdf');
  assert.equal(clean.originalByteLength, original.length);
  assert(clean.bytes.length < original.length);
  assert(clean.bytes.length < 2048);
  assert.equal(clean.sha256, createHash('sha256').update(clean.bytes).digest('hex'));

  await assert.rejects(processor.process(syntheticPdf('/OpenAction << /S /JavaScript /JS (console.println) >>'), AbortSignal.timeout(18000)), { code: 'UNSUPPORTED_DOCUMENT' });
  await assert.rejects(processor.process(syntheticPdf('/Open#41ction << /S /JavaScript /JS (console.println) >>'), AbortSignal.timeout(18000)), { code: /^(?:UNSUPPORTED_DOCUMENT|DOCUMENT_REJECTED)$/ });
  await assert.rejects(processor.process(syntheticPdf('', 'q\nQ\n', '/F (external.pdf)'), AbortSignal.timeout(18000)), { code: 'UNSUPPORTED_DOCUMENT' });
  await assert.rejects(binding.process(syntheticPdf('', 'q\n%FLOWBOARD_SYNTHETIC_AV_20261114\nQ\n'), AbortSignal.timeout(18000)), { code: 'DOCUMENT_REJECTED' });
  await assert.rejects(processor.process(Buffer.from('%PDF-1.4\nnot a pdf\n%%EOF\n'), AbortSignal.timeout(18000)), { code: 'UNSUPPORTED_DOCUMENT' });
  await assert.rejects(processor.process(Buffer.alloc(1024 * 1024 + 1), AbortSignal.timeout(18000)), { code: 'DOCUMENT_TOO_LARGE' });
  const unavailable = new ClamAvQpdfDocumentProcessor({ clamSocket: '/no-flowboard-scanner/socket', qpdfPath: '/usr/bin/qpdf', prlimitPath: '/usr/bin/prlimit' });
  await assert.rejects(unavailable.process(original, AbortSignal.timeout(18000)), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });
});

test('real ClamAV scans inside accepted Office packages and publishes the exact original bytes', { skip: !nativeSocket }, async () => {
  const native = new ClamAvQpdfDocumentProcessor({ clamSocket: nativeSocket!, qpdfPath: '/usr/bin/qpdf', prlimitPath: '/usr/bin/prlimit' });
  const key = 'a'.repeat(64);
  const processor = new BindingDocumentProcessor({ fetch: createDocumentScannerHandler(native, key) }, key);
  for (const [mediaType, parts, contentPath, endTag] of [
    [DOCUMENT_MEDIA_TYPES.docx, wordParts(), 'word/document.xml', '</w:body>'],
    [DOCUMENT_MEDIA_TYPES.xlsx, excelParts(), 'xl/worksheets/sheet1.xml', '</worksheet>'],
  ] as const) {
    const clean = zipXmlParts(parts);
    const result = await processor.process(clean, AbortSignal.timeout(5_000), mediaType);
    assert.equal(result.mediaType, mediaType);
    assert.equal(result.originalByteLength, clean.length);
    assert.deepEqual(Buffer.from(result.bytes), clean);
    assert.equal(result.sha256, createHash('sha256').update(clean).digest('hex'));

    const infected = zipXmlParts({ ...parts, [contentPath]: String(parts[contentPath]).replace(endTag,
      '<!--FLOWBOARD_SYNTHETIC_AV_20261114-->' + endTag) });
    assert.equal(infected.includes('FLOWBOARD_SYNTHETIC_AV_20261114'), false, 'The marker must be visible only inside a compressed part.');
    await assert.rejects(processor.process(infected, AbortSignal.timeout(5_000), mediaType), { code: 'DOCUMENT_REJECTED' });
  }
});
