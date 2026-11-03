import {ImageValidationError, MAX_IMAGE_BYTE_LENGTH, MAX_IMAGE_DIMENSION, MAX_IMAGE_MEGAPIXELS} from './image-validator.ts';
import {IMAGE_VERIFICATION_DEADLINE_MS, imageVerificationUnavailable} from './image-verifier.ts';
import {assertImageWorkActive, retainImageWork} from './image-admission.ts';

const INPUT_SLICE_BYTES = 1024;
export interface PngStreamMetrics {
  expandedBytes: number;
  scanlines: number;
  maxDecodedChunkBytes: number;
}
function malformed(): never {
  throw new ImageValidationError('MALFORMED_IMAGE', 'The PNG pixel stream is incomplete or invalid.');
}
interface Pass {rowBytes: number; rows: number;}
/**
 * Additional semantic check after validateImageBinary has checked PNG CRC/order.
 * Native zlib validates one complete stream, including its checksum and no trailing
 * input. JS visits only decoded chunk spans and row-filter bytes, never pixels.
 * The full independent pixel decoder is still required after this check.
 */
export async function validatePngPixelStream(input: Uint8Array, signal?: AbortSignal, deadlineAt?: number): Promise<PngStreamMetrics> {
  const started = Date.now();
  if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) throw imageVerificationUnavailable();
  const deadline = Math.min(deadlineAt ?? started + IMAGE_VERIFICATION_DEADLINE_MS, started + IMAGE_VERIFICATION_DEADLINE_MS);
  let stopped = false;
  function active(): void {
    if (stopped || signal?.aborted || Date.now() >= deadline) throw imageVerificationUnavailable();
    assertImageWorkActive();
  }
  active();
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 45 || bytes.length > MAX_IMAGE_BYTE_LENGTH || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') malformed();
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24]!, color = bytes[25]!, interlace = bytes[28]!;
  if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_MEGAPIXELS) malformed();
  const depths: Record<number, readonly number[]> = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  const channels: Record<number,number> = {0:1,2:3,3:1,4:2,6:4};
  if (!depths[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) malformed();
  const bitsPerPixel = channels[color]! * depth;
  // PNG Adam7 pass origins/steps, in specification order. Empty passes have no filter byte.
  const layout = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const passes: Pass[] = [];
  let expected = 0;
  for (const [x, y, dx, dy] of layout) {
    const columns = Math.max(0, Math.ceil((width - x!) / dx!));
    const rows = Math.max(0, Math.ceil((height - y!) / dy!));
    if (!columns || !rows) continue;
    const rowBytes = Math.ceil(columns * bitsPerPixel / 8);
    expected += (rowBytes + 1) * rows;
    passes.push({rowBytes, rows});
  }
  // Maximum RGBA16 data plus one filter byte for every possible pass row.
  if (!expected || expected > MAX_IMAGE_MEGAPIXELS * 8 + MAX_IMAGE_DIMENSION * 7) malformed();
  let offset = 8, sliceAt = 0, sliceEnd = 0;
  const compressed = new ReadableStream<BufferSource>({
    pull(controller) {
      active();
      while (sliceAt === sliceEnd) {
        if (offset === bytes.length) {controller.close(); return;}
        if (bytes.length - offset < 12) malformed();
        const length = bytes.readUInt32BE(offset);
        if (length > bytes.length - offset - 12) malformed();
        const type = bytes.toString('ascii', offset + 4, offset + 8), start = offset + 8;
        offset += 12 + length;
        if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new ImageValidationError('REJECTED_FORMAT', 'Animated PNG is not supported. Use a still PNG or WebP.');
        if (type === 'IDAT') {sliceAt = start; sliceEnd = start + length;}
        active();
      }
      const end = Math.min(sliceAt + INPUT_SLICE_BYTES, sliceEnd);
      // A bounded copy also excludes SharedArrayBuffer-backed input from the
      // native BufferSource contract; never combine the complete IDAT payload.
      controller.enqueue(Uint8Array.from(bytes.subarray(sliceAt, end)));
      sliceAt = end;
    }
  });
  let decoder: DecompressionStream;
  try {decoder = new DecompressionStream('deflate');}
  catch {throw imageVerificationUnavailable();}
  const reader = compressed.pipeThrough(decoder).getReader();
  const release = retainImageWork();
  let cancellation: Promise<void> | undefined;
  function cancel(): Promise<void> {
    return cancellation ??= Promise.resolve().then(() => reader.cancel()).then(() => {}, () => {});
  }
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => {
      stopped = true;
      reject(imageVerificationUnavailable());
      void cancel();
    };
  });
  const timer = setTimeout(interrupt, Math.max(0, deadline - Date.now()));
  signal?.addEventListener('abort', interrupt, {once:true});
  if (signal?.aborted) interrupt();
  const work = (async (): Promise<PngStreamMetrics> => {
    let expandedBytes = 0, scanlines = 0, maxDecodedChunkBytes = 0;
    let pass = 0, rowsLeft = passes[0]!.rows, rowRemaining = 0;
    try {
      for (;;) {
        active();
        const {done, value} = await reader.read();
        active();
        if (done) break;
        if (expandedBytes + value.byteLength > expected) malformed();
        maxDecodedChunkBytes = Math.max(maxDecodedChunkBytes, value.byteLength);
        let at = 0;
        while (at < value.byteLength) {
          if (!rowRemaining) {
            if (!rowsLeft) {pass++; rowsLeft = passes[pass]?.rows ?? 0;}
            if (!rowsLeft || value[at]! > 4) malformed();
            at++; expandedBytes++; scanlines++; rowsLeft--;
            rowRemaining = passes[pass]!.rowBytes;
          }
          const span = Math.min(rowRemaining, value.byteLength - at);
          at += span; expandedBytes += span; rowRemaining -= span;
        }
      }
      if (expandedBytes !== expected || rowRemaining || rowsLeft || pass !== passes.length - 1) malformed();
      return {expandedBytes, scanlines, maxDecodedChunkBytes};
    } catch (error) {
      active();
      if (error instanceof ImageValidationError) throw error;
      malformed();
    } finally {
      // A timeout can reply first, but admission remains retained until the real
      // native read AND stream cancellation settle. Never collect decoded chunks.
      await cancel();
      reader.releaseLock();
    }
  })();
  void work.then(release, release);
  try {return await Promise.race([work, interrupted]);}
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', interrupt);
  }
}
