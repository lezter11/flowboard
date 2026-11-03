import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {validatePngPixelStream} from '../src/services/png-stream.ts';
import {validateImageBinary} from '../src/services/image-validator.ts';
import {imageFixtures, imageFixture} from './support/image-fixtures.ts';
import {malformedPngStreams, packedPng, pngIdat, replacePngIdat} from './support/png-stream-fixtures.ts';
for (const row of malformedPngStreams()) test('PNG native stream rejects recoverable corruption: ' + row.name, async () => {
  validateImageBinary(row.bytes, 'image/png');
  await assert.rejects(validatePngPixelStream(row.bytes), (error: any) => error.code === 'MALFORMED_IMAGE');
});
test('PNG native stream validates genuine PNG corpus without collecting pixel output', async () => {
  for (const row of imageFixtures.filter(row => row.contentType === 'image/png')) {
    const metrics = await validatePngPixelStream(row.bytes);
    assert.ok(metrics.expandedBytes > 0); assert.ok(metrics.scanlines > 0);
    const split = replacePngIdat(row.bytes, pngIdat(row.bytes), 1);
    assert.equal((await validatePngPixelStream(split)).expandedBytes, metrics.expandedBytes);
  }
});
test('PNG native stream counts every packed depth/color and Adam7 tiny empty pass against real native decoder', async () => {
  for (const [color, depths] of [[0,[1,2,4,8,16]],[2,[8,16]],[3,[1,2,4,8]],[4,[8,16]],[6,[8,16]]] as const)
    for (const depth of depths) for (const interlace of [false,true]) for (const [width,height] of [[1,1],[3,2],[9,9]]) {
      const bytes = packedPng(width!,height!,depth,color,interlace);
      validateImageBinary(bytes,'image/png');
      const decoded = await sharp(bytes,{failOn:'warning'}).raw().toBuffer({resolveWithObject:true});
      assert.equal(decoded.info.width,width); assert.equal(decoded.info.height,height);
      assert.ok((await validatePngPixelStream(bytes)).expandedBytes > 0);
    }
});
test('PNG native stream uses the supplied absolute deadline and honors caller abort', async () => {
  const bytes=imageFixture('png').bytes;
  await assert.rejects(validatePngPixelStream(bytes,undefined,Date.now()-1),(error:any)=>error.status===503);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(validatePngPixelStream(bytes,controller.signal),(error:any)=>error.status===503);
});

import {withImageAdmission} from '../src/services/image-admission.ts';
test('PNG native stream keeps admission until actual cancellation settles after caller timeout', async t => {
  let finishCancel!: () => void;
  const cancellation = new Promise<void>(resolve => {finishCancel = resolve;});
  const originalCancel = ReadableStreamDefaultReader.prototype.cancel;
  t.mock.method(ReadableStreamDefaultReader.prototype, 'cancel', async function(this: ReadableStreamDefaultReader) {
    await cancellation;
    return originalCancel.call(this);
  });
  let lifetime!: Promise<void>;
  await withImageAdmission(new AbortController().signal, async () => {
    await assert.rejects(validatePngPixelStream(imageFixture('png').bytes, undefined, Date.now() + 20), (error:any) => error.status === 503);
  }, work => {lifetime = work;});
  await assert.rejects(withImageAdmission(new AbortController().signal, async () => {}), (error:any) => error.status === 503);
  finishCancel();
  await lifetime;
  await withImageAdmission(new AbortController().signal, async () => {});
});

test('PNG native stream caps optional deadlines and rejects nonfinite values', async t => {
  const bytes = imageFixture('png').bytes;
  for (const deadline of [NaN, Infinity, -Infinity]) await assert.rejects(validatePngPixelStream(bytes, undefined, deadline), (error:any) => error.status === 503);
  t.mock.timers.enable({apis:['Date']});
  const work = validatePngPixelStream(bytes, undefined, Date.now() + 60000);
  t.mock.timers.tick(8001);
  await assert.rejects(work, (error:any) => error.status === 503);
});
