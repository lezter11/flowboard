import { createHash, timingSafeEqual } from 'node:crypto';
import { DOCUMENT_MEDIA_TYPES, documentMediaTypeSchema, type DocumentMediaType } from '@flowboard/contracts';
import { DocumentProcessingError, MAX_DOCUMENT_BYTES, type DocumentProcessor, type ProcessedDocument } from './document-processor.ts';

const SCANNER_ORIGIN = 'https://document-processor.internal';
const PDF_PATH = '/v1/pdf';
const DOCUMENT_PATH = '/v1/document';
const SHA_HEADER = 'x-flowboard-document-sha256';
const ERROR_HEADER = 'x-flowboard-document-error';
const SCANNER_TIMEOUT_MS = 14_000;
const unavailable = () => new DocumentProcessingError('DOCUMENT_PROCESSOR_UNAVAILABLE');

function requireScannerKey(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw unavailable();
}

function sha(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function whileActive<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(unavailable());
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function boundedBody(message: Request | Response, max: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const declared = message.headers.get('content-length');
  const validLength = declared === null || /^\d{1,8}$/.test(declared);
  const limit = () => new DocumentProcessingError('DOCUMENT_TOO_LARGE');
  if (!validLength || (declared !== null && Number(declared) > max) || signal.aborted) {
    void message.body?.cancel().catch(() => {});
    throw signal.aborted || !validLength ? unavailable() : limit();
  }
  if (!message.body) throw unavailable();
  const reader = message.body.getReader();
  const output = new Uint8Array(max);
  let total = 0;
  let reads = 0;
  try {
    while (true) {
      // Include empty chunks in the budget so a producer cannot spin.
      if (++reads > 4096 || signal.aborted) throw unavailable();
      const chunk = await whileActive(reader.read(), signal);
      if (chunk.done) break;
      if (chunk.value.length > max - total) throw limit();
      output.set(chunk.value, total);
      total += chunk.value.length;
    }
    if (!total || (declared !== null && total !== Number(declared))) throw unavailable();
    return output.subarray(0, total);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function scannerFailure(status: number, code?: DocumentProcessingError['code']) {
  return new Response(null, { status, headers: {
    'cache-control': 'no-store', ...(code && { [ERROR_HEADER]: code }),
  } });
}

/** Private Node scanner handler. Give the scanner no browser route, cookies, storage or database access. */
export function createDocumentScannerHandler(processor: DocumentProcessor, key: string): (request: Request) => Promise<Response> {
  requireScannerKey(key);
  const expected = Buffer.from(key, 'hex');
  let active = 0;

  return async request => {
    const url = new URL(request.url);
    const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '');
    if ((url.pathname !== PDF_PATH && url.pathname !== DOCUMENT_PATH) || url.search || request.method !== 'POST' || !match?.[1] ||
        !timingSafeEqual(Buffer.from(match[1], 'hex'), expected)) return scannerFailure(404);
    const requested = documentMediaTypeSchema.safeParse(request.headers.get('content-type'));
    if (!requested.success || (url.pathname === PDF_PATH && requested.data !== DOCUMENT_MEDIA_TYPES.pdf) || request.headers.has('content-encoding')) {
      return scannerFailure(415, 'UNSUPPORTED_DOCUMENT');
    }
    if (active >= 2) return scannerFailure(503, 'DOCUMENT_PROCESSOR_UNAVAILABLE');

    active++;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SCANNER_TIMEOUT_MS)]);
    try {
      const source = await boundedBody(request, MAX_DOCUMENT_BYTES, signal);
      const originalDigest = requested.data === DOCUMENT_MEDIA_TYPES.pdf ? null : sha(source);
      const result = await processor.process(source, signal, requested.data);
      if (signal.aborted || result.mediaType !== requested.data || result.originalByteLength !== source.length ||
          result.bytes.length === 0 || result.bytes.length > source.length || sha(result.bytes) !== result.sha256 ||
          (originalDigest !== null && originalDigest !== result.sha256)) throw unavailable();
      return new Response(Uint8Array.from(result.bytes), { status: 200, headers: {
        'content-type': result.mediaType,
        'content-length': String(result.bytes.length),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        [SHA_HEADER]: result.sha256,
      } });
    } catch (error) {
      if (error instanceof DocumentProcessingError && !signal.aborted) {
        if (error.code === 'DOCUMENT_TOO_LARGE') return scannerFailure(413, error.code);
        if (error.code === 'UNSUPPORTED_DOCUMENT' || error.code === 'DOCUMENT_REJECTED') return scannerFailure(422, error.code);
      }
      return scannerFailure(503, 'DOCUMENT_PROCESSOR_UNAVAILABLE');
    } finally {
      active--;
    }
  };
}

export interface DocumentScannerBinding {
  fetch(request: Request): Promise<Response>;
}

/** Uses only the trusted deployment binding. No user URL reaches a fetch call. */
export class BindingDocumentProcessor implements DocumentProcessor {
  private readonly binding: DocumentScannerBinding;
  private readonly key: string;

  constructor(binding: DocumentScannerBinding, key: string) {
    requireScannerKey(key);
    this.binding = binding;
    this.key = key;
  }

  async process(bytes: Uint8Array, callerSignal: AbortSignal, mediaType: DocumentMediaType = DOCUMENT_MEDIA_TYPES.pdf): Promise<ProcessedDocument> {
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE');
    if (!bytes.length || !documentMediaTypeSchema.safeParse(mediaType).success) throw new DocumentProcessingError('UNSUPPORTED_DOCUMENT');
    if (callerSignal.aborted) throw unavailable();

    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(SCANNER_TIMEOUT_MS)]);
    let response: Response | undefined;
    try {
      const path = mediaType === DOCUMENT_MEDIA_TYPES.pdf ? PDF_PATH : DOCUMENT_PATH;
      const body = Uint8Array.from(bytes);
      const originalDigest = mediaType === DOCUMENT_MEDIA_TYPES.pdf ? null : sha(body);
      const pending = this.binding.fetch(new Request(SCANNER_ORIGIN + path, { method: 'POST', redirect: 'manual', signal,
        headers: { authorization: 'Bearer ' + this.key, 'content-type': mediaType }, body }));
      // A binding may settle after the caller gave up. Discard that response too.
      void pending.then(late => {
        if (signal.aborted) void late.body?.cancel().catch(() => {});
      }, () => {});
      response = await whileActive(pending, signal);
      const code = response.headers.get(ERROR_HEADER);
      if ((response.status === 422 && (code === 'DOCUMENT_REJECTED' || code === 'UNSUPPORTED_DOCUMENT')) ||
          (response.status === 415 && code === 'UNSUPPORTED_DOCUMENT')) {
        throw new DocumentProcessingError(code);
      }
      if (response.status !== 200 || response.headers.get('content-type') !== mediaType || response.headers.has('content-encoding')) throw unavailable();
      const digest = response.headers.get(SHA_HEADER);
      if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw unavailable();
      const processed = await boundedBody(response, bytes.length, signal);
      if (signal.aborted || sha(processed) !== digest || (originalDigest !== null && originalDigest !== digest)) throw unavailable();
      return { bytes: processed, originalByteLength: bytes.length, mediaType, sha256: digest };
    } catch (error) {
      if (!signal.aborted && error instanceof DocumentProcessingError &&
          (error.code === 'DOCUMENT_REJECTED' || error.code === 'UNSUPPORTED_DOCUMENT')) throw error;
      throw unavailable();
    } finally {
      void response?.body?.cancel().catch(() => {});
    }
  }
}
