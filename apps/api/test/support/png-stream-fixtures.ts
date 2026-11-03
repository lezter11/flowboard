import {deflateSync, inflateSync} from 'node:zlib';
import {imageFixture, pngChunk} from './image-fixtures.ts';
export function replacePngIdat(source: Buffer, compressed: Buffer, split = compressed.length): Buffer {
  const chunks: Buffer[] = [source.subarray(0, 8)]; let inserted = false;
  for (let at = 8; at < source.length;) {
    const length = source.readUInt32BE(at), type = source.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') {
      if (!inserted) {for (let p = 0; p < compressed.length; p += split) chunks.push(pngChunk('IDAT', compressed.subarray(p, p + split))); inserted = true;}
    } else chunks.push(source.subarray(at, at + 12 + length));
    at += 12 + length;
  }
  return Buffer.concat(chunks);
}
export function pngIdat(source: Buffer): Buffer {
  const chunks: Buffer[] = [];
  for (let at = 8; at < source.length;) {const length = source.readUInt32BE(at); if (source.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(source.subarray(at + 8, at + 8 + length)); at += 12 + length;}
  return Buffer.concat(chunks);
}
export function malformedPngStreams() {
  const source = imageFixture('png').bytes, compressed = pngIdat(source), raw = inflateSync(compressed);
  const wrongAdler = Buffer.from(compressed); wrongAdler[wrongAdler.length - 1] = wrongAdler[wrongAdler.length - 1]! ^ 1;
  const wrongFilter = Buffer.from(raw); wrongFilter[0] = 5;
  return [
    ['extra-deflated-pixels', deflateSync(Buffer.concat([raw, Buffer.from([0, 1, 2, 3])]))],
    ['truncated-deflated-pixels', deflateSync(raw.subarray(0, -1))],
    ['trailing-compressed-junk', Buffer.concat([compressed, Buffer.from([0, 1, 2, 3])])],
    ['concatenated-zlib-stream', Buffer.concat([compressed, deflateSync(raw)])],
    ['bad-adler', wrongAdler], ['invalid-row-filter', deflateSync(wrongFilter)], ['truncated-zlib', compressed.subarray(0, -1)],
  ].map(([name, bytes]) => ({name: name as string, bytes: replacePngIdat(source, bytes as Buffer)}));
}
// Fixture data follows PNG pass extraction; independent Sharp decoding is required by tests.
export function packedPng(width: number, height: number, depth: number, color: number, interlace: boolean): Buffer {
  const channels: Record<number,number> = {0:1, 2:3, 3:1, 4:2, 6:4};
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const lines: Buffer[] = [];
  for (const [x,y,dx,dy] of passes) {const columns = Math.max(0, Math.ceil((width-x!)/dx!)); if (!columns) continue; for (let row=y!; row<height; row+=dy!) lines.push(Buffer.alloc(1+Math.ceil(columns*channels[color]!*depth/8)));}
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=depth; ihdr[9]=color; ihdr[12]=Number(interlace);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),pngChunk('IHDR',ihdr),...(color===3?[pngChunk('PLTE',Buffer.from([0,0,0]))]:[]),pngChunk('IDAT',deflateSync(Buffer.concat(lines))),pngChunk('IEND',Buffer.alloc(0))]);
}
