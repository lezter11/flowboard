import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('./jpeg-corpus.json', import.meta.url), 'utf8'));
export const jpegCorpus: Array<{
  name: string;
  width: number;
  height: number;
  bytes: Buffer;
}> = data.records.map((row: any) => ({
  ...row,
  bytes: Buffer.from(row.data, 'base64')
}));
export interface JpegSegment {
  marker: number;
  markerStart: number;
  data: number;
  end: number;
  entropyEnd?: number;
}
// Test fixture location helper only; no decoding decisions or entropy interpretation.
export function jpegSegments(bytes: Buffer): JpegSegment[] {
  const segments: JpegSegment[] = [];
  let p = 2;
  while (p < bytes.length) {
    const markerStart = p;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++]!;
    if (marker === 217) {
      segments.push({
        marker,
        markerStart,
        data: p,
        end: p
      });
      break;
    }
    const end = p + bytes.readUInt16BE(p),
      data = p + 2;
    const segment: JpegSegment = {
      marker,
      markerStart,
      data,
      end
    };
    p = end;
    if (marker === 218) {
      while (p < bytes.length) {
        if (bytes[p] !== 255) {
          p++;
          continue;
        }
        const next = bytes[p + 1]!;
        if (next === 0 || next >= 208 && next <= 215) {
          p += 2;
          continue;
        }
        break;
      }
      segment.entropyEnd = p;
    }
    segments.push(segment);
  }
  return segments;
}
export function replaceScanTable(source: Buffer, predicate: (segment: JpegSegment, bytes: Buffer) => boolean, value: number): Buffer {
  const bytes = Buffer.from(source);
  const tables = new Map<number, {
    start: number;
    count: number;
  }>();
  for (const segment of jpegSegments(source)) {
    if (segment.marker === 196) {
      let p = segment.data;
      while (p < segment.end) {
        const id = source[p++]!;
        let n = 0;
        for (let i = 0; i < 16; i++) n += source[p + i]!;
        p += 16;
        tables.set(id, {
          start: p,
          count: n
        });
        p += n;
      }
    }
    if (segment.marker === 218 && predicate(segment, source)) {
      const first = source[segment.end - 3]!,
        selector = source[segment.data + 2]!;
      const id = first ? 16 + (selector & 15) : selector >>> 4;
      const table = tables.get(id)!;
      bytes.fill(value, table.start, table.start + table.count);
      return bytes;
    }
  }
  throw new Error('Fixture has no matching JPEG scan/table');
}
