import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../image-compression.js', import.meta.url), 'utf8');
function setup({ result = { type: 'image/webp', size: 1000 }, fail = false, noContext = false } = {}) {
  const calls = { revoked: [], canvas: null, quality: null };
  const canvas = { width: 0, height: 0, getContext: () => noContext ? null : { drawImage() {} }, toBlob: (callback, type, quality) => { calls.quality = [type, quality]; callback(result); } };
  class Image { constructor() { this.width = 4000; this.height = 2000; } set src(value) { if (fail) this.onerror(); else this.onload(); } }
  const window = {};
  vm.runInNewContext(source, { window, Image, Promise, Math, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: u => calls.revoked.push(u) }, document: { createElement: () => { calls.canvas = canvas; return canvas; } } });
  return { compress: window.compressCardImage, calls };
}
const large = { type: 'image/jpeg', size: 300000 };
test('small images are left untouched', async () => { const {compress,calls}=setup(); const f={type:'image/png',size:1024}; assert.equal(await compress(f),f); assert.equal(calls.canvas,null); });
test('large images are downscaled proportionally and encoded as WebP', async () => { const {compress,calls}=setup(); const output=await compress(large); assert.equal(output.type,'image/webp'); assert.equal(calls.canvas.width,1920); assert.equal(calls.canvas.height,960); assert.deepEqual(calls.quality,['image/webp',0.85]); assert.deepEqual(calls.revoked,['blob:test']); });
test('decode failures, missing canvas and unsupported or larger encodings keep the original', async () => {
  for (const options of [{fail:true},{noContext:true},{result:null},{result:{type:'image/png',size:1}},{result:{type:'image/webp',size:400000}}]) {
    const {compress,calls}=setup(options); assert.equal(await compress(large),large); assert.deepEqual(calls.revoked,['blob:test']);
  }
});
