import { createHash } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { DOCUMENT_MEDIA_TYPES, documentMediaTypeForFilename, idempotencyKeySchema, MAX_DOCUMENT_BYTES, type DocumentMediaType } from '@flowboard/contracts';
import {
  confirmDocumentUploadAccess, getCardDocument, listCardDocuments, prepareDocumentUpload, publishCardDocument,
  releaseSettledDocumentReservation, removeCardDocument,
} from '../../adapters/documents.ts';
import { getPool } from '../../adapters/postgres.ts';
import type { StorageDriver, StoredObject } from '../../adapters/storage.ts';
import { DocumentProcessingError, type DocumentProcessingCode, type DocumentProcessor } from '../../services/document-processor.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { deadlineMiddleware } from '../middleware/limits.ts';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const MAX_ACTIVE_DOCUMENT_UPLOADS = 2;
// The Worker constructs a new app per request. These requests still share one isolate's memory.
let activeUploads = 0;
const statusFor: Record<DocumentProcessingCode, 413 | 415 | 422 | 503> = {
  DOCUMENT_TOO_LARGE: 413, UNSUPPORTED_DOCUMENT: 415,
  DOCUMENT_REJECTED: 422, DOCUMENT_PROCESSOR_UNAVAILABLE: 503,
};

export interface CardDocumentDependencies {
  /** Private, shared with the pending-storage-deletions job. A write cannot land past its 24h reclaim horizon. */
  storage: StorageDriver;
  processor: DocumentProcessor;
}

export function isDocumentUploadRequest(method: string, path: string) {
  return method === 'POST' && /^\/api\/v1\/cards\/[^/]+\/documents$/.test(path);
}

export function isDocumentRequest(method: string, path: string) {
  return isDocumentUploadRequest(method,path)
    || ((method === 'GET' || method === 'HEAD') && /^\/api\/v1\/(?:cards\/[^/]+\/documents|documents\/[^/]+\/content)$/.test(path))
    || (method === 'DELETE' && /^\/api\/v1\/documents\/[^/]+$/.test(path));
}

declare module 'hono' {
  interface ContextVariableMap { documentSignal?: AbortSignal; }
}

export function documentRequestDeadline(ordinaryMs: number, onWorkLifetime?: (work: Promise<void>) => void): MiddlewareHandler {
  const ordinaryTimeout = deadlineMiddleware(ordinaryMs);
  const uploadTimeout = deadlineMiddleware(22_000);
  // Start before session auth and give rollback time before the HTTP response deadline.
  const ordinaryWorkMs = Math.max(1, ordinaryMs - Math.min(500,ordinaryMs * 0.2));
  return async (c,next) => {
    const upload = isDocumentUploadRequest(c.req.method,c.req.path);
    const timeout = upload ? uploadTimeout : ordinaryTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), upload ? 20_000 : ordinaryWorkMs);
    c.set('documentSignal',AbortSignal.any([c.req.raw.signal,controller.signal]));
    try {
      await timeout(c, async () => {
        const work = next();
        // The HTTP timeout may finish first while a storage call or database rollback is in flight.
        onWorkLifetime?.(work.then(() => {}, () => {}));
        await work;
      });
    }
    finally { clearTimeout(timer); }
  };
}

function actorFrom(c: Context) {
  const id = c.get('actor')?.id;
  const sessionId = c.get('sessionId');
  if (!id || !sessionId || c.get('authType') !== 'session') throw HttpError.unauthorized();
  return { id, sessionId };
}

function keyFrom(c: Context) {
  const key = idempotencyKeySchema.safeParse(c.req.header('idempotency-key'));
  if (!key.success) throw HttpError.badRequest('Missing or invalid Idempotency-Key header.', 'IDEMPOTENCY_KEY_REQUIRED');
  return key.data;
}

function uploadFilename(value: string | undefined) {
  let filename: string | undefined;
  if (value && value.length <= 2_000 && /^[A-Za-z0-9_.!~*'()%\-]+$/.test(value)) {
    try { filename = decodeURIComponent(value).replace(/^ +| +$/g, '').normalize('NFC'); }
    catch { /* Invalid escapes use the same response as any other invalid filename. */ }
  }
  const mediaType = filename && documentMediaTypeForFilename(filename);
  if (!filename || !mediaType) throw HttpError.badRequest('Supply a valid percent-encoded PDF, Word, or Excel filename in X-Document-Filename.');
  return { filename, mediaType };
}

function hasDocumentSignature(bytes: Uint8Array, mediaType: DocumentMediaType) {
  const signature = mediaType === DOCUMENT_MEDIA_TYPES.pdf ? PDF_MAGIC : ZIP_MAGIC;
  return signature.every((byte, index) => bytes[index] === byte);
}

async function readUpload(request: Request, mediaType: DocumentMediaType, signal: AbortSignal): Promise<Uint8Array> {
  const max = MAX_DOCUMENT_BYTES;
  if (request.headers.get('content-type')?.trim().toLowerCase() !== mediaType || request.headers.has('content-encoding')) {
    throw new DocumentProcessingError('UNSUPPORTED_DOCUMENT');
  }
  const length = request.headers.get('content-length');
  const declared = length === null ? null : Number(length);
  if (length !== null && !/^\d+$/.test(length)) throw HttpError.badRequest('Invalid document content length.');
  if (Number(declared) > max) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE');
  if (!request.body) throw new DocumentProcessingError('UNSUPPORTED_DOCUMENT');
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once:true });
  try {
    const bytes = new Uint8Array(declared ?? max);
    let size = 0;
    for (let chunks = 0; ; chunks++) {
      signal.throwIfAborted();
      if (chunks > 4096) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE');
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      if (next.value.byteLength > max - size) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE');
      if (next.value.byteLength > bytes.length - size) throw HttpError.badRequest('Invalid document content length.');
      bytes.set(next.value, size);
      size += next.value.length;
    }
    if (declared !== null && declared !== size) throw HttpError.badRequest('Invalid document content length.');
    const upload = bytes.subarray(0,size);
    if (!hasDocumentSignature(upload, mediaType)) {
      throw new DocumentProcessingError('UNSUPPORTED_DOCUMENT');
    }
    return upload;
  } finally {
    signal.removeEventListener('abort',cancel);
    cancel();
    reader.releaseLock();
  }
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new DocumentProcessingError('DOCUMENT_PROCESSOR_UNAVAILABLE');

function requireObject(object: StoredObject | null, mediaType: DocumentMediaType, byteLength: number, sha256: string) {
  if (!object || object.contentType !== mediaType || object.data.length !== byteLength ||
      !hasDocumentSignature(object.data, mediaType) || digest(object.data) !== sha256) throw unavailable();
  return object.data;
}

async function readObject(storage: StorageDriver, storageKey: string) {
  try { return await storage.get(storageKey); }
  catch { throw unavailable(); }
}

function visibleError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw new HttpError(504, 'DEADLINE_EXCEEDED', 'The request took too long. Try again with the same key.');
  if (error instanceof DocumentProcessingError) throw new HttpError(statusFor[error.code], error.code, error.message);
  throw error;
}

/** Mount on both runtimes for route inventory. Only explicitly injected local dependencies unlock it. */
export function createDocumentRoutes(dependencies?: CardDocumentDependencies) {
  const app = new Hono();

  function enabled(): CardDocumentDependencies {
    if (!dependencies?.storage || !dependencies.processor) throw new HttpError(503, 'CONFIG_ERROR', 'Card documents are unavailable on this deployment.');
    return dependencies;
  }

  app.get('/api/v1/cards/:cardId/documents',authMiddleware, async c => {
    enabled();
    const signal = c.get('documentSignal') ?? c.req.raw.signal;
    try {
      signal.throwIfAborted();
      const data = await listCardDocuments(getPool(c), actorFrom(c), c.req.param('cardId'));
      signal.throwIfAborted();
      return c.json({data});
    } catch (error) { visibleError(error,signal); }
  });

  app.post('/api/v1/cards/:cardId/documents',authMiddleware, async c => {
    const { storage, processor } = enabled();
    const actor = actorFrom(c);
    const pool = getPool(c);
    const signal = c.get('documentSignal') ?? c.req.raw.signal;
    let admitted = false;
    let settledStorageKey: string | undefined;
    try {
      const cardId = c.req.param('cardId');
      await confirmDocumentUploadAccess(pool,actor,cardId);
      signal.throwIfAborted();
      if (activeUploads >= MAX_ACTIVE_DOCUMENT_UPLOADS) throw new HttpError(429,'RATE_LIMITED','Document processing is busy. Try again shortly.');
      activeUploads++;
      admitted = true;
      const key = keyFrom(c);
      const { filename, mediaType } = uploadFilename(c.req.header('x-document-filename'));
      const inputBytes = await readUpload(c.req.raw,mediaType,signal);
      const input = {filename, inputSha256:digest(inputBytes), originalByteLength:inputBytes.length};
      const beforeScan = await prepareDocumentUpload(pool,actor,cardId,key,input,false,signal);
      if (beforeScan.kind === 'replay') return c.json({data:beforeScan.document},201,{'Idempotency-Replayed':'true'});
      const processed = await processor.process(inputBytes,signal,mediaType).catch(error => {
        if (error instanceof DocumentProcessingError) throw error;
        throw unavailable();
      });
      signal.throwIfAborted();
      // Office packages retain their exact original bytes so its formulas and layout stay intact.
      if (!processed || processed.mediaType !== mediaType || !(processed.bytes instanceof Uint8Array) ||
          !processed.bytes.length || processed.bytes.length > input.originalByteLength ||
          processed.originalByteLength !== input.originalByteLength || !hasDocumentSignature(processed.bytes, mediaType) ||
          digest(processed.bytes) !== processed.sha256 ||
          (mediaType !== DOCUMENT_MEDIA_TYPES.pdf && processed.sha256 !== input.inputSha256)) throw unavailable();
      const reservation = await prepareDocumentUpload(pool,actor,cardId,key,input,true,signal);
      if (reservation.kind === 'replay') return c.json({data:reservation.document},201,{'Idempotency-Replayed':'true'});
      if (reservation.kind !== 'reserved') throw unavailable();

      signal.throwIfAborted();
      const storageKey = reservation.storageKey;
      try { await storage.put(storageKey,processed.bytes,mediaType); }
      catch { throw unavailable(); }
      // Successful PUT cannot arrive after the deletion request. If publication later fails, the
      // reservation still exists unless the DB really committed. Only existing rows are reclaimed.
      settledStorageKey = storageKey;
      signal.throwIfAborted();
      const byteLength = processed.bytes.length;
      const sha256 = processed.sha256;
      requireObject(await readObject(storage,storageKey),mediaType,byteLength,sha256);
      const document = await publishCardDocument(pool,actor,cardId,key,input,{byteLength,sha256},storageKey,signal);
      return c.json({data:document},201);
    } catch (error) {
      if (settledStorageKey) await releaseSettledDocumentReservation(pool,settledStorageKey).catch(() => {});
      visibleError(error,signal);
    } finally {
      if (admitted) activeUploads--;
      if (c.req.raw.body && !c.req.raw.body.locked) void c.req.raw.body.cancel().catch(() => {});
    }
  });

  app.get('/api/v1/documents/:documentId/content',authMiddleware, async c => {
    const { storage } = enabled();
    const pool = getPool(c);
    const actor = actorFrom(c);
    const id = c.req.param('documentId');
    const signal = c.get('documentSignal') ?? c.req.raw.signal;
    try {
      const document = await getCardDocument(pool,actor,id);
      const mediaType = documentMediaTypeForFilename(document.filename);
      if (!mediaType) throw unavailable();
      signal.throwIfAborted();
      const data = requireObject(await readObject(storage,document.storage_key),mediaType,document.byte_length,document.sha256);
      signal.throwIfAborted();
      const current = await getCardDocument(pool,actor,id);
      if (document.storage_key !== current.storage_key || document.sha256 !== current.sha256 ||
          document.filename !== current.filename || document.byte_length !== current.byte_length) throw unavailable();
      signal.throwIfAborted();
      const name = encodeURIComponent(current.filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      const extension = current.filename.slice(current.filename.lastIndexOf('.') + 1).toLowerCase();
      return new Response(new Uint8Array(data), {headers:{
        'Content-Type':mediaType, 'Content-Length':String(document.byte_length), 'X-Content-SHA256':document.sha256,
        'Content-Disposition':`attachment; filename="document.${extension}"; filename*=UTF-8''${name}`,
        'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':'sandbox',
      }});
    } catch (error) { visibleError(error,signal); }
  });

  app.delete('/api/v1/documents/:documentId',authMiddleware, async c => {
    enabled();
    const documentId = c.req.param('documentId');
    const signal = c.get('documentSignal') ?? c.req.raw.signal;
    try {
      const replayed = await removeCardDocument(getPool(c), actorFrom(c), documentId, keyFrom(c), signal);
      if (replayed) c.header('Idempotency-Replayed','true');
      return c.json({data:{id:documentId,success:true as const}});
    } catch (error) { visibleError(error,signal); }
  });

  return app;
}
