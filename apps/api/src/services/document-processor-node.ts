// Node/Linux only. Cloudflare Workers cannot run native PDF tools or connect to a Unix socket.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { DOCUMENT_MEDIA_TYPES, documentMediaTypeSchema, type DocumentMediaType } from '@flowboard/contracts';
import { validateOfficeDocument } from './document-office.ts';
import { DocumentProcessingError, MAX_DOCUMENT_BYTES, type DocumentProcessor, type ProcessedDocument } from './document-processor.ts';

const run = promisify(execFile);
const SCAN_REPLY_LIMIT = 512;
const PROCESSING_TIMEOUT_MS = 12_000;
const TOOL_TIMEOUT_MS = 3500;
const MAX_ACTIVE_PROCESSES = 2;
const QPDF_JSON_LIMIT = 2 * MAX_DOCUMENT_BYTES;
const MAX_PAGES = 40;
const clamdUnavailable = () => new DocumentProcessingError('DOCUMENT_PROCESSOR_UNAVAILABLE');
const unsupported = () => new DocumentProcessingError('UNSUPPORTED_DOCUMENT');

/** ClamAV zINSTREAM over a private Unix socket, closed to TCP clients. */
export function scanClamdStream(socketPath: string, bytes: Uint8Array, signal: AbortSignal): Promise<'clean' | 'rejected'> {
  if (signal.aborted || bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES || !isAbsolute(socketPath)) {
    return Promise.reject(clamdUnavailable());
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    const chunks: Buffer[] = [];
    let length = 0;
    const finish = (result?: 'clean' | 'rejected') => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.destroy();
      if (result) resolve(result);
      else reject(clamdUnavailable());
    };
    const abort = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(TOOL_TIMEOUT_MS);
    socket.on('timeout', abort);
    socket.on('error', abort);
    socket.on('close', abort);
    socket.on('connect', () => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.length);
      socket.write('zINSTREAM\0');
      socket.write(size);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > SCAN_REPLY_LIMIT) return finish();
      chunks.push(chunk);
    });
    socket.on('end', () => {
      const response = Buffer.concat(chunks).toString('latin1');
      if (response === 'stream: OK\0') finish('clean');
      else if (/^stream: [^\x00\r\n]{1,450} FOUND\0$/.test(response)) finish('rejected');
      else finish();
    });
  });
}

const forbiddenNames = new Set([
  '/AA', '/A', '/OpenAction', '/JavaScript', '/JS', '/Launch', '/URI', '/SubmitForm', '/ImportData',
  '/GoToR', '/GoToE', '/RichMedia', '/RichMediaContent', '/Movie', '/Sound', '/3D', '/Screen',
  '/EmbeddedFile', '/EmbeddedFiles', '/EF', '/FileAttachment', '/Filespec', '/AF',
  '/FileSpec', '/F', '/FFilter', '/FDecodeParms', '/FS', '/RF', '/UF',
  '/Collection', '/AcroForm', '/XFA', '/Annots', '/Encrypt', '/Sig', '/DocMDP',
]);

// qpdf JSON v2 decodes PDF name escapes. Look for name tokens in structure, not text
// substrings in a page. Strings are tagged with a u: or b: prefix in this format.
function checkPdfStructure(metadata: unknown): void {
  if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || metadata.version !== 2 ||
      !('pages' in metadata) || !Array.isArray(metadata.pages) || metadata.pages.length < 1 || metadata.pages.length > MAX_PAGES ||
      !('encrypt' in metadata) || !metadata.encrypt || typeof metadata.encrypt !== 'object' ||
      !('encrypted' in metadata.encrypt) || metadata.encrypt.encrypted !== false ||
      !('qpdf' in metadata) || !Array.isArray(metadata.qpdf) || metadata.qpdf.length !== 2) throw unsupported();
  const entries = [metadata.qpdf[1]];
  let visited = 0;
  while (entries.length > 0) {
    const item: unknown = entries.pop();
    if (++visited > 60_000) throw unsupported();
    if (typeof item === 'string' && forbiddenNames.has(item)) throw unsupported();
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        if (forbiddenNames.has(key)) throw unsupported();
        entries.push(value);
      }
    }
  }
}

export interface ClamAvQpdfOptions {
  clamSocket: string;
  qpdfPath: string;
  prlimitPath: string;
}

/** Applies the format validator and ClamAV before any file can be published. */
export class ClamAvQpdfDocumentProcessor implements DocumentProcessor {
  private readonly options: ClamAvQpdfOptions;
  private active = 0;

  constructor(options: ClamAvQpdfOptions) {
    if (Object.values(options).some(value => !isAbsolute(value))) throw clamdUnavailable();
    this.options = { ...options };
  }

  async process(bytes: Uint8Array, callerSignal: AbortSignal, mediaType: DocumentMediaType = DOCUMENT_MEDIA_TYPES.pdf): Promise<ProcessedDocument> {
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE');
    if (!bytes.length || !documentMediaTypeSchema.safeParse(mediaType).success) throw unsupported();
    if (mediaType === DOCUMENT_MEDIA_TYPES.pdf && (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\n|\r)$/.test(
      Buffer.from(bytes.subarray(0, 10)).toString('latin1').match(/^[^\r\n]*(?:\r\n|\r|\n)/)?.[0] ?? '',
    ) || !/%%EOF[\x00\t\r\n\f ]{0,32}$/.test(Buffer.from(bytes.subarray(-40)).toString('latin1')))) throw unsupported();
    if (callerSignal.aborted || this.active >= MAX_ACTIVE_PROCESSES) throw clamdUnavailable();

    this.active++;
    let directory: string | undefined;
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(PROCESSING_TIMEOUT_MS)]);
    const original = Buffer.from(bytes);
    try {
      if (mediaType !== DOCUMENT_MEDIA_TYPES.pdf) {
        try { validateOfficeDocument(original, mediaType, signal); }
        catch { if (signal.aborted) throw clamdUnavailable(); throw unsupported(); }
        await this.scan(original, signal);
        return this.result(original, original.length, mediaType, signal);
      }
      await this.scan(original, signal);
      directory = await mkdtemp(join(tmpdir(), 'flowboard-private-pdf-'));
      const input = join(directory, 'input.pdf');
      const output = join(directory, 'processed.pdf');
      await writeFile(input, original, { flag: 'wx', mode: 0o600, signal });
      await this.inspect(input, directory, signal);
      await this.qpdf(['--object-streams=generate', '--recompress-flate', '--compression-level=9', input, output],
        directory, signal);
      const generated = await stat(output);
      if (!generated.isFile() || generated.size <= 0 || generated.size > MAX_DOCUMENT_BYTES) throw unsupported();
      await this.inspect(output, directory, signal);
      const optimized = await readFile(output, { signal });
      if (optimized.length !== generated.size || optimized.length > MAX_DOCUMENT_BYTES) throw clamdUnavailable();
      const selected = optimized.length < original.length ? optimized : original;
      // Release no bytes other than the exact, independently scanned candidate.
      await this.scan(selected, signal);
      return this.result(selected, original.length, mediaType, signal);
    } catch (error) {
      if (error instanceof DocumentProcessingError && !signal.aborted) throw error;
      throw clamdUnavailable();
    } finally {
      try {
        if (directory !== undefined) await rm(directory, { recursive: true, force: true });
      } finally {
        this.active--;
      }
    }
  }

  private result(bytes: Uint8Array, originalByteLength: number, mediaType: DocumentMediaType, signal: AbortSignal): ProcessedDocument {
    if (signal.aborted) throw clamdUnavailable();
    return { bytes, originalByteLength, mediaType, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  private async scan(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (await scanClamdStream(this.options.clamSocket, bytes, signal) !== 'clean') {
      throw new DocumentProcessingError('DOCUMENT_REJECTED');
    }
  }

  private async inspect(pdf: string, cwd: string, signal: AbortSignal): Promise<void> {
    const result = await this.qpdf(['--json=2', '--json-key=pages', '--json-key=encrypt', '--json-key=qpdf',
      '--json-stream-data=none', pdf], cwd, signal);
    checkPdfStructure(JSON.parse(result));
    await this.qpdf(['--check', pdf], cwd, signal);
  }

  private async qpdf(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
    try {
      const { stdout } = await run(this.options.prlimitPath, [
        '--as=268435456:268435456', '--cpu=3:4', '--fsize=1048576:1048576', '--nofile=48:48',
        '--', this.options.qpdfPath, ...args,
      ], { cwd, env: { LANG: 'C' }, encoding: 'utf8', maxBuffer: QPDF_JSON_LIMIT, timeout: TOOL_TIMEOUT_MS, signal, killSignal: 'SIGKILL' });
      return stdout;
    } catch (error) {
      // QPDF uses exits 2 and 3 for PDF errors and warnings. Other exits include
      // failure to start the tool, timeout, and resource exhaustion.
      if (!signal.aborted && error && typeof error === 'object' && 'code' in error && (error.code === 2 || error.code === 3)) throw unsupported();
      throw clamdUnavailable();
    }
  }
}
