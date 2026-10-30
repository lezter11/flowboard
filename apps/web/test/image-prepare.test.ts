import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alphaSampleSize, chooseResult, decide, isAnimatedWebp, extensionFor, prepareImage, PrepareError, readDimensions, renameFor, SERVER_MAX_BYTES,
  type Bitmap, type ImageEnv,
} from '../src/lib/image-prepare.ts';

const KB = 1024; const MB = 1024 * 1024;

// ---- decide(): when to skip, resize or re-encode ----
test('small file within limits is kept as it is', () => {
  assert.deepEqual(decide({ bytes: 200 * KB, type: 'image/jpeg', width: 1600, height: 900 }), { action: 'original', reason: 'small' });
});
test('exactly 300 KB and 2560 px is still skipped', () => {
  assert.equal(decide({ bytes: 300 * KB, type: 'image/png', width: 2560, height: 1000 }).action, 'original');
});
test('mid-size file at normal dimensions is re-encoded without resizing', () => {
  assert.deepEqual(decide({ bytes: 2 * MB, type: 'image/jpeg', width: 2000, height: 1500 }), { action: 'encode', width: 2000, height: 1500, resized: false });
});
test('landscape over 2560 is scaled by its longest side, keeping the aspect ratio', () => {
  assert.deepEqual(decide({ bytes: 5 * MB, type: 'image/jpeg', width: 4032, height: 3024 }), { action: 'encode', width: 2560, height: 1920, resized: true });
});
test('tall phone photo is scaled by height', () => {
  assert.deepEqual(decide({ bytes: 4 * MB, type: 'image/jpeg', width: 3024, height: 4032 }), { action: 'encode', width: 1920, height: 2560, resized: true });
});
test('a small file that is over 2560 px is still resized', () => {
  assert.equal(decide({ bytes: 100 * KB, type: 'image/png', width: 6000, height: 200 }).action, 'encode');
});
test('a small file outside server limits is not skipped', () => {
  assert.equal(decide({ bytes: 100 * KB, type: 'image/gif', width: 100, height: 100 }).action, 'encode');
});

// ---- chooseResult(): is the re-encode worth it? ----
const src = (bytes: number) => ({ bytes, type: 'image/jpeg', width: 3000, height: 2000 });
test('keeps the original unless the result is at least 10% smaller (no resize)', () => {
  assert.equal(chooseResult(src(1000), 899, false), 'result');
  assert.equal(chooseResult(src(1000), 900, false), 'result');
  assert.equal(chooseResult(src(1000), 901, false), 'original');
});
test('a resized result wins when it is smaller at all', () => {
  assert.equal(chooseResult(src(1000), 990, true), 'result');
  assert.equal(chooseResult(src(1000), 1100, true), 'original');
});
test('a resized result wins when the original breaks a server limit', () => {
  assert.equal(chooseResult({ bytes: 12 * MB, type: 'image/jpeg', width: 4000, height: 3000 }, 8 * MB, true), 'result');
});
test('a result over 10 MiB is never chosen', () => {
  assert.equal(chooseResult(src(20 * MB), SERVER_MAX_BYTES + 1, true), 'original');
});

// ---- names ----
test('file name extension follows the new type', () => {
  assert.equal(renameFor('Holiday.JPG', 'image/webp'), 'Holiday.webp');
  assert.equal(renameFor('screen.shot.png', 'image/jpeg'), 'screen.shot.jpg');
  assert.equal(renameFor('noext', 'image/png'), 'noext.png');
  assert.equal(renameFor('../x/evil.png', 'image/webp'), '.._x_evil.webp');
  assert.equal(extensionFor('image/webp'), 'webp');
});

// ---- header dimensions ----
const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
test('reads PNG dimensions', () => assert.deepEqual(readDimensions(png(4000, 3000)), { width: 4000, height: 3000 }));
test('reads JPEG dimensions after other segments', () => {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 1, 2, 3, 4, 5, 6, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xc0, 0x0f, 0xc0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(readDimensions(b), { width: 4032, height: 3008 });
});
test('reads WebP VP8X dimensions', () => {
  const b = new Uint8Array(30); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  b.set([0xff, 0x0f, 0x00], 24); b.set([0xff, 0x07, 0x00], 27);
  assert.deepEqual(readDimensions(b), { width: 4096, height: 2048 });
});
test('unknown bytes give null', () => assert.equal(readDimensions(new Uint8Array(40)), null));

// ---- prepareImage() with fake bitmaps ----
function fakeFile(name: string, type: string, bytes: number, header?: Uint8Array): File {
  const data = new Uint8Array(Math.max(bytes, header?.length ?? 0)); if (header) data.set(header); return new File([data], name, { type });
}
function envFor(opts: { width: number; height: number; alpha?: boolean; webp?: boolean; sizes?: Record<string, number>; decodeFails?: boolean }) {
  const calls: string[] = [];
  const env: ImageEnv = {
    async decode() { calls.push('decode'); if (opts.decodeFails) throw new Error('bad'); return { width: opts.width, height: opts.height, close() { calls.push('close'); } } as Bitmap; },
    async hasAlpha() { calls.push('alpha'); return !!opts.alpha; },
    async encode(_b, w, h, type) {
      const effective = type === 'image/webp' && opts.webp === false ? 'image/png' : type;
      calls.push(`encode ${effective} ${w}x${h}`);
      return new Blob([new Uint8Array(opts.sizes?.[effective] ?? 100 * KB)], { type: effective });
    },
    async sha256(buf) { return buf.byteLength.toString(16).padStart(64, '0'); },
  };
  return { env, calls };
}

test('photo: resized, converted to WebP, renamed, hashed from the exact bytes', async () => {
  const { env, calls } = envFor({ width: 4032, height: 3024, sizes: { 'image/webp': 600 * KB } });
  const out = await prepareImage(fakeFile('IMG_1.jpg', 'image/jpeg', 4 * MB), env);
  assert.equal(out.outcome, 'optimised'); assert.equal(out.contentType, 'image/webp'); assert.equal(out.filename, 'IMG_1.webp');
  assert.equal(out.byteLength, 600 * KB); assert.equal(out.blob.size, 600 * KB); assert.equal(out.sha256, (600 * KB).toString(16).padStart(64, '0'));
  assert.deepEqual([out.width, out.height], [2560, 1920]); assert.match(out.note, /Optimised 4\.0 MB → 600 KB/);
  assert.ok(calls.includes('close'));
});
test('small file is uploaded untouched and never encoded', async () => {
  const { env, calls } = envFor({ width: 800, height: 600 });
  const out = await prepareImage(fakeFile('a.png', 'image/png', 100 * KB), env);
  assert.equal(out.outcome, 'unchanged'); assert.equal(out.filename, 'a.png'); assert.ok(!calls.some((c) => c.startsWith('encode')));
});
test('a result that is not 10% smaller keeps the original', async () => {
  const { env } = envFor({ width: 2000, height: 1500, sizes: { 'image/webp': 950 * KB } });
  const out = await prepareImage(fakeFile('a.jpg', 'image/jpeg', 1000 * KB), env);
  assert.equal(out.outcome, 'unchanged'); assert.equal(out.contentType, 'image/jpeg'); assert.equal(out.byteLength, 1000 * KB);
});
test('PNG with alpha and no WebP encoder keeps PNG; opaque PNG falls back to JPEG', async () => {
  const a = envFor({ width: 3000, height: 2000, alpha: true, webp: false, sizes: { 'image/png': 700 * KB } });
  const withAlpha = await prepareImage(fakeFile('logo.png', 'image/png', 3 * MB), a.env);
  assert.equal(withAlpha.contentType, 'image/png'); assert.equal(withAlpha.filename, 'logo.png');
  const o = envFor({ width: 3000, height: 2000, alpha: false, webp: false, sizes: { 'image/jpeg': 500 * KB } });
  const opaque = await prepareImage(fakeFile('shot.png', 'image/png', 3 * MB), o.env);
  assert.equal(opaque.contentType, 'image/jpeg'); assert.equal(opaque.filename, 'shot.jpg');
});
test('alpha is only checked for formats that can have it', async () => {
  const { env, calls } = envFor({ width: 3000, height: 2000, sizes: { 'image/webp': 400 * KB } });
  await prepareImage(fakeFile('a.jpg', 'image/jpeg', 3 * MB), env);
  assert.ok(!calls.includes('alpha'));
});
test('decode failure falls back to the original with a note, when the server can take it', async () => {
  const { env } = envFor({ width: 1, height: 1, decodeFails: true });
  const out = await prepareImage(fakeFile('a.jpg', 'image/jpeg', 2 * MB), env);
  assert.equal(out.outcome, 'fallback'); assert.match(out.note, /uploading the original/); assert.equal(out.byteLength, 2 * MB);
});
test('decode failure on an over-10 MB file is reported, not uploaded', async () => {
  const { env } = envFor({ width: 1, height: 1, decodeFails: true });
  await assert.rejects(prepareImage(fakeFile('a.jpg', 'image/jpeg', 12 * MB), env), (e: unknown) => e instanceof PrepareError && e.reason === 'still-too-large');
});
test('over 20 megapixels is refused from the header, before decoding', async () => {
  const { env, calls } = envFor({ width: 1, height: 1 });
  await assert.rejects(prepareImage(fakeFile('big.png', 'image/png', 1 * MB, png(6000, 4000)), env), (e: unknown) => e instanceof PrepareError && e.reason === 'too-many-pixels');
  assert.ok(!calls.includes('decode'));
});
test('over 20 megapixels is also refused when only decoding reveals it', async () => {
  const { env } = envFor({ width: 5000, height: 5000 });
  await assert.rejects(prepareImage(fakeFile('big.jpg', 'image/jpeg', 6 * MB), env), (e: unknown) => e instanceof PrepareError && e.reason === 'too-many-pixels');
});
test('12 megapixel image is accepted and resized', async () => {
  const { env } = envFor({ width: 4000, height: 3000, sizes: { 'image/webp': 500 * KB } });
  const out = await prepareImage(fakeFile('12mp.png', 'image/png', 5 * MB, png(4000, 3000)), env);
  assert.deepEqual([out.width, out.height], [2560, 1920]);
});
test('wrong type and huge input are refused', async () => {
  const { env } = envFor({ width: 10, height: 10 });
  await assert.rejects(prepareImage(fakeFile('a.gif', 'image/gif', 1000), env), (e: unknown) => e instanceof PrepareError && e.reason === 'unsupported-type');
  await assert.rejects(prepareImage(fakeFile('a.png', 'image/png', 41 * MB), env), (e: unknown) => e instanceof PrepareError && e.reason === 'too-large-input');
});
test('retries with lower quality when the first result is over 10 MiB', async () => {
  let n = 0;
  const { env } = envFor({ width: 2500, height: 2500 });
  env.encode = async (_b, _w, _h, type) => new Blob([new Uint8Array(++n === 1 ? 11 * MB : 5 * MB)], { type });
  const out = await prepareImage(fakeFile('a.png', 'image/png', 30 * MB), env);
  assert.equal(out.byteLength, 5 * MB);
});

// ---- alpha sampling and animated WebP ----
test('alpha sample never exceeds 256 px a side and keeps the aspect ratio', () => {
  assert.deepEqual(alphaSampleSize(2560, 2560), { width: 256, height: 256 });
  assert.deepEqual(alphaSampleSize(2560, 1280), { width: 256, height: 128 });
  assert.deepEqual(alphaSampleSize(100, 50), { width: 100, height: 50 });
  assert.deepEqual(alphaSampleSize(5000, 1), { width: 256, height: 1 });
});
const webpHeader = (flags: number) => { const b = new Uint8Array(30); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, flags]); return b; };
test('detects the VP8X animation flag', () => {
  assert.equal(isAnimatedWebp(webpHeader(0x02)), true);
  assert.equal(isAnimatedWebp(webpHeader(0x10 | 0x02)), true);
  assert.equal(isAnimatedWebp(webpHeader(0x10)), false);
  assert.equal(isAnimatedWebp(new Uint8Array(40)), false);
});
test('an animated WebP is uploaded as it is and never decoded or encoded', async () => {
  const { env, calls } = envFor({ width: 3000, height: 2000, sizes: { 'image/webp': 100 * KB } });
  const out = await prepareImage(fakeFile('anim.webp', 'image/webp', 2 * MB, webpHeader(0x02)), env);
  assert.equal(out.outcome, 'unchanged'); assert.equal(out.byteLength, 2 * MB); assert.match(out.note, /animated/);
  assert.deepEqual(calls, []);
});
test('an animated WebP over 10 MiB is refused with a clear message', async () => {
  const { env } = envFor({ width: 10, height: 10 });
  await assert.rejects(prepareImage(fakeFile('anim.webp', 'image/webp', 12 * MB, webpHeader(0x02)), env), (e: unknown) => e instanceof PrepareError && e.reason === 'still-too-large' && /animated/.test(e.message));
});
