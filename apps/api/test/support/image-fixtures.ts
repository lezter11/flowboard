import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { ImageContentType } from '@flowboard/contracts';
type ImageFixture = {
  name: string;
  contentType: ImageContentType;
  width: number;
  height: number;
  bytes: Buffer;
};
const fixtureData = JSON.parse(readFileSync(new URL('./image-fixtures.json', import.meta.url), 'utf8'));
export const imageFixtures: ImageFixture[] = fixtureData.records.map((row: any) => ({
  ...row,
  bytes: Buffer.from(row.data, 'base64')
}));
export const imageFixture = (name: string) => imageFixtures.find(row => row.name === name)!;

// Test-data construction only; runtime validator has no dependency on these helpers.
export function pngChunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return result;
}
export function validPng(width = 1, height = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  // Over-limit dimensions intentionally need no enormous test allocation: rejected by caps.
  const rows = width * height <= 20_000_000 && width <= 8192 && height <= 8192 ? Buffer.alloc((width * 3 + 1) * height) : Buffer.alloc(4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}
export function malformedImages(): Array<{
  name: string;
  contentType: ImageContentType;
  bytes: Buffer;
}> {
  const png = imageFixture('png').bytes;
  const jpeg = imageFixture('jpeg').bytes;
  const webp = imageFixture('webp-lossless').bytes;
  const pngHeader = png.subarray(0, 24);
  const pngNoData = Buffer.concat([png.subarray(0, 33), png.subarray(png.length - 12)]);
  const corruptCrc = Buffer.from(png);
  corruptCrc[29] = corruptCrc[29]! ^ 1;
  const invalidIhdr = Buffer.from(png.subarray(16, 29));
  invalidIhdr[8] = 3;
  const pngBadDepth = Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', invalidIhdr), png.subarray(33)]);
  const hugePng = Buffer.from(png);
  hugePng.writeUInt32BE(0xffffffff, 33);
  const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const jpegHeader = Buffer.concat([jpeg.subarray(0, sof + 19), Buffer.from([0xff, 0xd9])]);
  const badJpegLength = Buffer.from(jpeg);
  badJpegLength.writeUInt16BE(65535, 4);
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF');
  vp8x.writeUInt32LE(22, 4);
  vp8x.write('WEBPVP8X', 8);
  vp8x.writeUInt32LE(10, 16);
  const badRiff = Buffer.from(webp);
  badRiff.writeUInt32LE(0xffffffff, 4);
  const headerVp8l = Buffer.from(webp.subarray(0, 25));
  headerVp8l.writeUInt32LE(headerVp8l.length - 8, 4);
  headerVp8l.writeUInt32LE(5, 16);
  return [['png-header-only', 'image/png', pngHeader], ['png-missing-data', 'image/png', pngNoData], ['png-truncated', 'image/png', png.subarray(0, png.length - 1)], ['png-crc', 'image/png', corruptCrc], ['png-invalid-depth', 'image/png', pngBadDepth], ['png-huge-chunk', 'image/png', hugePng], ['png-tail', 'image/png', Buffer.concat([png, Buffer.from('junk')])], ['jpeg-frame-only', 'image/jpeg', jpegHeader], ['jpeg-no-end', 'image/jpeg', jpeg.subarray(0, jpeg.length - 2)], ['jpeg-length', 'image/jpeg', badJpegLength], ['jpeg-tail', 'image/jpeg', Buffer.concat([jpeg, Buffer.from('junk')])], ['webp-extended-header-only', 'image/webp', vp8x], ['webp-length', 'image/webp', badRiff], ['webp-truncated', 'image/webp', webp.subarray(0, webp.length - 1)], ['webp-lossless-header-only', 'image/webp', headerVp8l]].map(([name, contentType, bytes]) => ({
    name,
    contentType,
    bytes
  })) as any;
}
export function corruptEntropyImages(): Array<{
  name: string;
  contentType: ImageContentType;
  bytes: Buffer;
}> {
  const goodPng = imageFixture('png').bytes;
  const png = Buffer.concat([goodPng.subarray(0, 33), pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1])), pngChunk('IEND', Buffer.alloc(0))]);
  const sourceJpeg = imageFixture('jpeg-legacy').bytes;
  const sos = sourceJpeg.indexOf(Buffer.from([255, 218]));
  const entropyStart = sos + 2 + sourceJpeg.readUInt16BE(sos + 2);
  const jpeg = Buffer.concat([sourceJpeg.subarray(0, entropyStart), Buffer.from([127, 255, 217])]);
  const webp = Buffer.from(imageFixture('webp-lossless').bytes);
  webp.fill(0, 25, webp.length - 1);
  const small = imageFixture('jpeg').bytes;
  const marker = small.indexOf(Buffer.from([255, 218]));
  const scanStart = marker + 2 + small.readUInt16BE(marker + 2);
  const warningJpeg = Buffer.concat([small.subarray(0, scanStart), Buffer.from([127, 255, 217])]);
  const png16Source = imageFixture('png-16bit').bytes;
  const png16 = Buffer.concat([png16Source.subarray(0, 33), pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1])), pngChunk('IEND', Buffer.alloc(0))]);
  const alphaSource = imageFixture('webp-lossy').bytes;
  const alphaChunk = Buffer.alloc(10);
  alphaChunk.write('ALPH');
  alphaChunk.writeUInt32LE(2, 4);
  alphaChunk[9] = 100;
  const truncatedAlpha = Buffer.concat([alphaSource.subarray(0, 30), alphaChunk, alphaSource.subarray(46)]);
  truncatedAlpha.writeUInt32LE(truncatedAlpha.length - 8, 4);
  return [{
    name: 'png-corrupt-deflate',
    contentType: 'image/png',
    bytes: png
  }, {
    name: 'jpeg-corrupt-entropy',
    contentType: 'image/jpeg',
    bytes: jpeg
  }, {
    name: 'webp-corrupt-entropy',
    contentType: 'image/webp',
    bytes: webp
  }, {
    name: 'jpeg-warning-recovered',
    contentType: 'image/jpeg',
    bytes: warningJpeg
  }, {
    name: 'png16-corrupt-deflate',
    contentType: 'image/png',
    bytes: png16
  }, {
    name: 'webp-truncated-alpha-pixels',
    contentType: 'image/webp',
    bytes: truncatedAlpha
  }];
}
export function apngFixture(): Buffer {
  const png = imageFixture('png').bytes;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1);
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(3, 4);
  frame.writeUInt32BE(2, 8);
  frame.writeUInt16BE(1, 20);
  frame.writeUInt16BE(10, 22);
  return Buffer.concat([png.subarray(0, 33), pngChunk('acTL', animation), pngChunk('fcTL', frame), png.subarray(33)]);
}
export function corruptLaterWebpFrame(): Buffer {
  const bytes = Buffer.from(imageFixture('webp-animated').bytes);
  let frames = 0;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('latin1', offset, offset + 4) === 'ANMF' && ++frames === 2) {
      const payload = offset + 24;
      const n = bytes.readUInt32LE(payload + 4);
      bytes.fill(0, payload + 8 + 5, payload + 8 + n);
      break;
    }
    offset += 8 + length + (length & 1);
  }
  return bytes;
}
export function animatedWebp(still: Buffer, width: number, height: number, count: number): Buffer {
  const chunks: Buffer[] = [];
  for (let offset = 12; offset < still.length;) {
    const length = still.readUInt32LE(offset + 4);
    const type = still.toString('latin1', offset, offset + 4);
    if (type === 'VP8L' || type === 'VP8 ' || type === 'ALPH') chunks.push(still.subarray(offset, offset + 8 + length + (length & 1)));
    offset += 8 + length + (length & 1);
  }
  const payload = Buffer.concat(chunks);
  const extended = Buffer.alloc(18);
  extended.write('VP8X');
  extended.writeUInt32LE(10, 4);
  extended[8] = 2;
  extended.writeUIntLE(width - 1, 12, 3);
  extended.writeUIntLE(height - 1, 15, 3);
  const animation = Buffer.alloc(14);
  animation.write('ANIM');
  animation.writeUInt32LE(6, 4);
  const frameHeader = Buffer.alloc(24);
  frameHeader.write('ANMF');
  frameHeader.writeUInt32LE(16 + payload.length, 4);
  frameHeader.writeUIntLE(width - 1, 14, 3);
  frameHeader.writeUIntLE(height - 1, 17, 3);
  frameHeader.writeUIntLE(100, 20, 3);
  const frame = Buffer.concat([frameHeader, payload]);
  const header = Buffer.alloc(12);
  header.write('RIFF');
  header.writeUInt32LE(4 + extended.length + animation.length + frame.length * count, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, extended, animation, ...Array.from({
    length: count
  }, () => frame)]);
}
