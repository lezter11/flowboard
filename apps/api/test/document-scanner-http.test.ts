import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DOCUMENT_MEDIA_TYPES } from '@flowboard/contracts';
import { DocumentProcessingError, MAX_DOCUMENT_BYTES } from '../src/services/document-processor.ts';
import { BindingDocumentProcessor, createDocumentScannerHandler } from '../src/services/document-scanner-http.ts';

const key = '7'.repeat(64);
const pdf = Buffer.from('%PDF-1.4\nSynthetic fixture only\n%%EOF\n');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validResult = { bytes: pdf, mediaType: 'application/pdf' as const, originalByteLength: pdf.length, sha256: sha(pdf) };

test('the private scanner route authenticates before consuming data and maps scanner failures without details', async () => {
  let calls = 0;
  const handler = createDocumentScannerHandler({ async process(input) {
    calls++;
    assert.deepEqual(input, new Uint8Array(pdf));
    throw new DocumentProcessingError('DOCUMENT_REJECTED');
  } }, key);
  const input = (secret: string, options?: {path?: string; bytes?: Buffer; type?: string}) => new Request('https://document-processor.internal' + (options?.path ?? '/v1/pdf'), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret, 'content-type': options?.type ?? 'application/pdf' },
    body: new Uint8Array(options?.bytes ?? pdf),
  });
  assert.equal((await handler(input('8'.repeat(64)))).status, 404);
  assert.equal((await handler(input(key, { path: '/v1/pdf?user=alice' }))).status, 404);
  assert.equal((await handler(input(key, { type: 'text/html' }))).status, 415);
  assert.equal((await handler(input(key, { bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }))).status, 413);
  assert.equal(calls, 0);

  const result = await handler(input(key));
  assert.equal(result.status, 422);
  assert.equal(result.headers.get('x-flowboard-document-error'), 'DOCUMENT_REJECTED');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(await result.text(), '');
  assert.equal(calls, 1);
});

test('the Worker adapter accepts only a private bounded verified result and fails closed on all other responses', async () => {
  const handler = createDocumentScannerHandler({ async process() { return validResult; } }, key);
  const processor = new BindingDocumentProcessor({ fetch: handler }, key);
  assert.deepEqual(await processor.process(pdf, AbortSignal.timeout(1000)), { ...validResult, bytes: new Uint8Array(pdf) });

  const unverified = [
    new Response(pdf, { status: 201, headers: { 'content-type': 'application/pdf', 'x-flowboard-document-sha256': '0'.repeat(64) } }),
    new Response(pdf, { status: 302, headers: { 'location': 'https://outside.invalid' } }),
    new Response('synthetic private diagnostic', { status: 503, headers: { 'x-flowboard-document-error': 'DOCUMENT_REJECTED' } }),
    new Response(new Uint8Array(MAX_DOCUMENT_BYTES + 1), { status: 200, headers: { 'content-type': 'application/pdf', 'x-flowboard-document-sha256': sha(pdf) } }),
  ];
  for (const response of unverified) {
    const bad = new BindingDocumentProcessor({ async fetch() { return response; } }, key);
    await assert.rejects(bad.process(pdf, AbortSignal.timeout(1000)), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });
  }

  const stalled = new BindingDocumentProcessor({ async fetch() { return new Promise(() => {}); } }, key);
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(stalled.process(pdf, abort.signal), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });

  assert.throws(() => createDocumentScannerHandler({ async process() { return validResult; } }, ''), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });
});

test('private Office transport binds each request and verified response to the requested format', async () => {
  const calls: string[] = [];
  const office = Buffer.from('PK\x03\x04synthetic transport fixture');
  const handler = createDocumentScannerHandler({ async process(bytes, _signal, mediaType) {
    assert.ok(mediaType);
    calls.push(mediaType);
    return { bytes, mediaType, originalByteLength: bytes.length, sha256: sha(bytes) };
  } }, key);
  const processor = new BindingDocumentProcessor({ async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/v1/document');
    return handler(request);
  } }, key);
  const signal = AbortSignal.timeout(1_000);
  for (const type of [DOCUMENT_MEDIA_TYPES.docx, DOCUMENT_MEDIA_TYPES.xlsx]) {
    const result = await processor.process(office, signal, type);
    assert.equal(result.mediaType, type);
    assert.deepEqual(result.bytes, new Uint8Array(office));
  }
  assert.deepEqual(calls, [DOCUMENT_MEDIA_TYPES.docx, DOCUMENT_MEDIA_TYPES.xlsx]);

  const wrongType = new BindingDocumentProcessor({ async fetch() {
    return new Response(office, { headers: {
      'content-type': DOCUMENT_MEDIA_TYPES.xlsx, 'x-flowboard-document-sha256': sha(office),
    } });
  } }, key);
  await assert.rejects(wrongType.process(office, signal, DOCUMENT_MEDIA_TYPES.docx), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });

  const changed = Buffer.from(office);
  changed[4] = changed[4]! ^ 1;
  const rewritten = new BindingDocumentProcessor({ async fetch() {
    return new Response(changed, { headers: {
      'content-type': DOCUMENT_MEDIA_TYPES.docx, 'x-flowboard-document-sha256': sha(changed),
    } });
  } }, key);
  await assert.rejects(rewritten.process(office, signal, DOCUMENT_MEDIA_TYPES.docx), { code: 'DOCUMENT_PROCESSOR_UNAVAILABLE' });
});
