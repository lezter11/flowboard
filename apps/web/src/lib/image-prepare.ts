/**
 * Client-side image preparation before upload (S-15).
 *
 * Why in the browser: the API runs on Workers, which have no image library, and the server limits (10 MiB, 20 megapixels,
 * 8192 px, PNG/JPEG/WebP) stay as the safety net. We shrink big photos so the upload is faster and the stored bytes smaller,
 * and the re-encode also drops EXIF (GPS, camera, timestamps) as a side effect.
 *
 * `decide` and the header readers are pure so they can be tested with fake sizes; `prepareImage` wires them to injectable
 * browser pieces (`ImageEnv`) so tests can run the whole flow with fake bitmaps. It has no imports, so node:test can run it directly.
 */

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export const SERVER_MAX_BYTES = 10 * 1024 * 1024;
export const SERVER_MAX_PIXELS = 20_000_000;
export const SERVER_MAX_SIDE = 8192;
/** Largest file we are willing to read in the browser, even though the upload itself is capped at 10 MiB. */
export const INPUT_MAX_BYTES = 40 * 1024 * 1024;
export const LONGEST_SIDE = 2560;
export const SKIP_UNDER_BYTES = 300 * 1024;
export const MIN_SAVING = 0.1;
export const WEBP_QUALITY = 0.82;
export const JPEG_QUALITY = 0.85;
const RETRY_QUALITIES = [0.7, 0.55];

export type PrepareFailure = 'unsupported-type' | 'too-large-input' | 'too-many-pixels' | 'still-too-large' | 'unreadable';
export class PrepareError extends Error {
  readonly reason: PrepareFailure;
  constructor(reason: PrepareFailure, message: string) { super(message); this.name = 'PrepareError'; this.reason = reason; }
}

export interface Source { bytes: number; type: string; width: number; height: number }
export type Decision =
  | { action: 'original'; reason: 'small' }
  | { action: 'encode'; width: number; height: number; resized: boolean };

/** Whether the file can be uploaded as it is, judged only by the server's own limits. */
export function originalFitsServer(s: Source): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(s.type) && s.bytes <= SERVER_MAX_BYTES && s.width * s.height <= SERVER_MAX_PIXELS && Math.max(s.width, s.height) <= SERVER_MAX_SIDE;
}

/** Step 1, before any encoding: keep the file untouched, or scale and re-encode it. */
export function decide(s: Source): Decision {
  const longest = Math.max(s.width, s.height);
  if (s.bytes <= SKIP_UNDER_BYTES && longest <= LONGEST_SIDE && originalFitsServer(s)) return { action: 'original', reason: 'small' };
  if (longest <= LONGEST_SIDE) return { action: 'encode', width: s.width, height: s.height, resized: false };
  const scale = LONGEST_SIDE / longest;
  return { action: 'encode', width: Math.max(1, Math.round(s.width * scale)), height: Math.max(1, Math.round(s.height * scale)), resized: true };
}

/** Step 2, after encoding: is the result worth uploading instead of the original? */
export function chooseResult(s: Source, resultBytes: number, resized: boolean): 'result' | 'original' {
  if (resultBytes > SERVER_MAX_BYTES) return 'original'; // caller treats an unusable original as a failure
  if (resized) return resultBytes < s.bytes || !originalFitsServer(s) ? 'result' : 'original';
  if (!originalFitsServer(s)) return 'result';
  return resultBytes <= s.bytes * (1 - MIN_SAVING) ? 'result' : 'original';
}

export function extensionFor(type: string): string { return type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'png'; }
/** Keeps the base name and swaps the extension so it matches the bytes (the server checks the real content). */
export function renameFor(filename: string, type: string): string {
  const base = filename.replace(/[\\/]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'image';
  return `${base.slice(0, 240)}.${extensionFor(type)}`;
}

/** Reads width and height from the first bytes of a PNG, JPEG or WebP without decoding it. Returns null when not found. */
export function readDimensions(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (o: number) => (b[o]! << 8) | b[o + 1]!;
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32(16), height: u32(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o += 1; continue; }
      const marker = b[o + 1]!;
      if (marker === 0xff) { o += 1; continue; }
      if (marker >= 0xd0 && marker <= 0xd9 || marker === 0x01) { o += 2; continue; }
      const length = u16(o + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16(o + 5), width: u16(o + 7) };
      o += 2 + length;
    }
    return null;
  }
  const tag = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (b.length >= 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12);
    if (kind === 'VP8X') return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (kind === 'VP8L') { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  return null;
}

/** True for a WebP whose VP8X header sets the animation flag (bit 1 of the flags byte). createImageBitmap would keep only the first frame. */
export function isAnimatedWebp(b: Uint8Array): boolean {
  const tag = (o: number) => String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
  return b.length >= 21 && tag(0) === 'RIFF' && tag(8) === 'WEBP' && tag(12) === 'VP8X' && (b[20]! & 0x02) !== 0;
}

/** The alpha check only needs a sample, so it never reads more than this many pixels per side. */
export const ALPHA_SAMPLE_SIDE = 256;
export function alphaSampleSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, ALPHA_SAMPLE_SIDE / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export interface Bitmap { width: number; height: number; close?: () => void }
export interface ImageEnv {
  /** Decodes with EXIF orientation applied (createImageBitmap with imageOrientation 'from-image'). */
  decode(file: Blob): Promise<Bitmap>;
  /** Draws the bitmap at the given size and returns whether any pixel is not fully opaque. */
  hasAlpha(bitmap: Bitmap, width: number, height: number): Promise<boolean>;
  /** Draws at the given size (high-quality smoothing) and encodes. May return a different type than asked (Safari ignores WebP). */
  encode(bitmap: Bitmap, width: number, height: number, type: string, quality: number): Promise<Blob | null>;
  sha256(bytes: ArrayBuffer): Promise<string>;
}

export interface Prepared {
  blob: Blob;
  filename: string;
  contentType: AcceptedType;
  byteLength: number;
  sha256: string;
  width: number | null;
  height: number | null;
  /** What happened, for the per-file note in the UI. */
  outcome: 'optimised' | 'unchanged' | 'fallback';
  originalBytes: number;
  note: string;
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Compresses when it helps; never blocks the upload on a compression problem. Throws PrepareError only for files that cannot be uploaded at all. */
export async function prepareImage(file: File, env: ImageEnv): Promise<Prepared> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) throw new PrepareError('unsupported-type', 'Only PNG, JPEG and WebP images can be added.');
  if (file.size > INPUT_MAX_BYTES) throw new PrepareError('too-large-input', 'This file is too large to prepare in the browser (over 40 MB).');

  const keep = async (note: string, outcome: Prepared['outcome'], dims: { width: number; height: number } | null): Promise<Prepared> => {
    if (file.size > SERVER_MAX_BYTES) throw new PrepareError('still-too-large', 'This image is over 10 MB and could not be made smaller. Try a smaller image.');
    const sha = await env.sha256(await file.arrayBuffer());
    return { blob: file, filename: file.name, contentType: file.type as AcceptedType, byteLength: file.size, sha256: sha, width: dims?.width ?? null, height: dims?.height ?? null, outcome, originalBytes: file.size, note };
  };

  // Cheap header read first, so a 40-megapixel file is refused before we decode it.
  const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const known = readDimensions(head);
  if (known && known.width * known.height > SERVER_MAX_PIXELS) throw new PrepareError('too-many-pixels', `This image is ${(known.width * known.height / 1e6).toFixed(0)} megapixels. The limit is 20.`);

  // Re-encoding would flatten an animation to one frame: keep the original, or refuse when it cannot be uploaded as is.
  if (file.type === 'image/webp' && isAnimatedWebp(head)) {
    if (file.size > SERVER_MAX_BYTES) throw new PrepareError('still-too-large', 'This animated image is over 10 MB. Animated images are uploaded as they are, so try a smaller one.');
    return await keep(`${mb(file.size)}, animated; uploading the original`, 'unchanged', known);
  }

  let bitmap: Bitmap | null = null;
  try {
    bitmap = await env.decode(file);
    const source: Source = { bytes: file.size, type: file.type, width: bitmap.width, height: bitmap.height };
    if (source.width * source.height > SERVER_MAX_PIXELS) throw new PrepareError('too-many-pixels', `This image is ${(source.width * source.height / 1e6).toFixed(0)} megapixels. The limit is 20.`);
    const plan = decide(source);
    if (plan.action === 'original') return await keep(`${mb(file.size)}, already small`, 'unchanged', source);

    const alpha = file.type !== 'image/jpeg' && (await env.hasAlpha(bitmap, plan.width, plan.height));
    const attempts: Array<[string, number]> = [['image/webp', WEBP_QUALITY], ...RETRY_QUALITIES.map((q): [string, number] => ['image/webp', q])];
    let result: Blob | null = null;
    for (const [type, quality] of attempts) {
      let out = await env.encode(bitmap, plan.width, plan.height, type, quality);
      // Browsers without a WebP encoder hand back PNG: use JPEG for opaque images, and PNG only when alpha must survive.
      if (out && out.type !== 'image/webp') {
        if (!alpha) out = await env.encode(bitmap, plan.width, plan.height, 'image/jpeg', JPEG_QUALITY);
        else if (out.type !== 'image/png') out = null;
      }
      if (out && (ACCEPTED_TYPES as readonly string[]).includes(out.type)) { result = out; if (out.size <= SERVER_MAX_BYTES || out.type === 'image/png') break; }
    }
    if (!result) return await keep(`${mb(file.size)}, could not optimise; uploading the original`, 'fallback', source);

    if (chooseResult(source, result.size, plan.resized) === 'original') {
      return await keep(`${mb(file.size)}, already efficient`, 'unchanged', source);
    }
    if (result.size > SERVER_MAX_BYTES) throw new PrepareError('still-too-large', 'This image is still over 10 MB after optimising. Try a smaller image.');
    const sha = await env.sha256(await result.arrayBuffer());
    const type = result.type as AcceptedType;
    return { blob: result, filename: renameFor(file.name, type), contentType: type, byteLength: result.size, sha256: sha, width: plan.width, height: plan.height, outcome: 'optimised', originalBytes: file.size, note: `Optimised ${mb(file.size)} → ${mb(result.size)}` };
  } catch (error) {
    if (error instanceof PrepareError) throw error;
    // Decode or encode trouble must not block the upload: send the original if the server could take it.
    try { return await keep(`${mb(file.size)}, could not optimise; uploading the original`, 'fallback', known); }
    catch (inner) { if (inner instanceof PrepareError) throw inner; throw new PrepareError('unreadable', 'This file could not be read as an image.'); }
  } finally {
    bitmap?.close?.();
  }
}

/** The real browser pieces. createImageBitmap decodes off the main thread; OffscreenCanvas encodes asynchronously. Images are prepared one at a time by the caller. */
export const browserEnv: ImageEnv = {
  decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
  async hasAlpha(bitmap, width, height) {
    // Sample a downscaled copy (at most 256 px a side): a transparent edge or hole still shows up, and the buffer stays at ~256 KB.
    const size = alphaSampleSize(width, height);
    const canvas = makeCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap as ImageBitmap, 0, 0, size.width, size.height);
    const data = ctx.getImageData(0, 0, size.width, size.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
    return false;
  },
  async encode(bitmap, width, height, type, quality) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
    if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
    return new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, type, quality));
  },
  async sha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  },
};

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
}
