import { timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { ClamAvQpdfDocumentProcessor } from '../services/document-processor-node.ts';
import { DocumentProcessingError, type DocumentProcessor } from '../services/document-processor.ts';
import { createDocumentScannerHandler } from '../services/document-scanner-http.ts';
import { scannerReadiness } from './document-scanner/readiness.ts';

// Linux only. The application Worker has a separate entry point and no native tools.
const httpSocket = process.env.FB_DOCUMENT_HTTP_SOCKET;
const keyFile = process.env.FB_DOCUMENT_SCANNER_KEY_FILE;
const socket = process.env.FB_DOCUMENT_CLAMD_SOCKET;
const configured = socket && (!httpSocket || (isAbsolute(httpSocket) && keyFile && isAbsolute(keyFile)));
if (!configured) throw new Error('Private document scanner settings are incomplete.');
const key = httpSocket && keyFile ? readFileSync(keyFile, 'utf8').trim() : process.env.FB_DOCUMENT_SCANNER_KEY;
if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Private document scanner key is invalid.');

const native = new ClamAvQpdfDocumentProcessor({
  clamSocket: socket,
  qpdfPath: '/usr/bin/qpdf',
  prlimitPath: '/usr/bin/prlimit',
});
const ready = httpSocket ? scannerReadiness(socket) : undefined;
const processor: DocumentProcessor = ready ? {
  async process(bytes, signal, type) {
    if (!await ready() || signal.aborted) throw new DocumentProcessingError('DOCUMENT_PROCESSOR_UNAVAILABLE');
    const result = await native.process(bytes, signal, type);
    if (!await ready() || signal.aborted) throw new DocumentProcessingError('DOCUMENT_PROCESSOR_UNAVAILABLE');
    return result;
  },
} : native;
const handle = createDocumentScannerHandler(processor, key);
const expected = Buffer.from(key, 'hex');
const listen = getRequestListener(async request => {
  const url = new URL(request.url);
  if (!ready || url.pathname !== '/ready' || url.search || request.method !== 'GET') return handle(request);
  const supplied = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const headers = { 'cache-control': 'no-store' };
  if (!supplied || !timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) return new Response(null, { status: 404, headers });
  return new Response(null, { status: await ready() ? 204 : 503, headers });
});
const server = createServer({
  headersTimeout: 4_000,
  requestTimeout: 16_000,
  connectionsCheckingInterval: 1_000,
  keepAliveTimeout: 2_000,
  maxHeaderSize: 4_096,
}, listen);
server.maxConnections = 16;
server.maxRequestsPerSocket = 8;
if (httpSocket) server.listen(httpSocket, () => chmodSync(httpSocket, 0o660));
else server.listen(8788, '127.0.0.1');
