/*!
 * JPEG scan algorithm reference: jpeg-js v0.4.4, commit
 * 9ccd35fb5f55a6c4f1902ac5b0f270f675750c27, lib/decoder.js decodeScan.
 * Copyright 2011 notmasteryet. Licensed under Apache-2.0.
 * Package BSD-3-Clause attribution and changes: licenses/jpeg-entropy.NOTICE.
 * This validation-only adaptation has no coefficient magnitudes, IDCT or pixels.
 */
import { HttpError } from '../http/errors.ts';
import { ImageValidationError, MAX_IMAGE_BYTE_LENGTH, MAX_IMAGE_DIMENSION, MAX_IMAGE_MEGAPIXELS } from './image-validator.ts';
import { IMAGE_VERIFICATION_DEADLINE_MS } from './image-verifier.ts';
const MAX_PRESENCE_BYTES = 10 * 1024 * 1024;
const MAX_OPERATIONS = 200_000_000;
const POPCOUNT = Uint8Array.from({
  length: 256
}, (_, value) => {
  let count = 0;
  while (value) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
});
interface Huffman {
  min: Int32Array;
  max: Int32Array;
  start: Int32Array;
  values: Uint8Array;
}
interface Component {
  id: number;
  h: number;
  v: number;
  columns: number;
  rows: number;
  stride: number;
  paddedRows: number;
  presence?: Uint8Array;
  approximation: Int8Array;
  sequentialDone: boolean;
  nonzeroLow: number;
  nonzeroHigh: number;
}
export interface JpegEntropyMetrics {
  scans: number;
  operations: number;
  presenceBytes: number;
  elapsedMs: number;
}
function invalid(message: string): never {
  throw new ImageValidationError('MALFORMED_IMAGE', message);
}
function unsupported(): never {
  throw new ImageValidationError('REJECTED_FORMAT', 'This JPEG coding mode is not supported.');
}
function limited(): never {
  throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Image verification exceeded its processing budget. Try again later.');
}
export async function validateJpegEntropy(input: Uint8Array, signal?: AbortSignal, deadlineAt?: number): Promise<JpegEntropyMetrics> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length > MAX_IMAGE_BYTE_LENGTH) limited();
  if (signal?.aborted) limited();
  const started = Date.now();
  // Preflight owns one absolute budget across DB/storage, parsing and full decode.
  // Standalone callers get the same bounded ceiling, never a longer override.
  if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) limited();
  const deadline = Math.min(deadlineAt ?? started + IMAGE_VERIFICATION_DEADLINE_MS, started + IMAGE_VERIFICATION_DEADLINE_MS);
  if (started >= deadline) limited();
  let operations = 0,
    presenceBytes = 0,
    scans = 0,
    lastYield = 0;
  async function cooperate() {
    if (operations - lastYield >= 1_000_000) {
      await new Promise(resolve => setTimeout(resolve, 1));
      lastYield = operations;
    }
    if (signal?.aborted || Date.now() >= deadline) limited();
  }
  function tick() {
    operations++;
    if (operations > MAX_OPERATIONS) limited();
    if ((operations & 4095) === 0 && Date.now() >= deadline) limited();
  }
  function need(offset: number, length: number) {
    if (offset < 0 || length < 0 || offset + length > bytes.length) invalid('Truncated JPEG entropy structure.');
  }
  function u16(offset: number) {
    need(offset, 2);
    return bytes.readUInt16BE(offset);
  }
  if (u16(0) !== 0xffd8) invalid('JPEG SOI missing.');
  const tables = new Map<number, Huffman>();
  const components = new Map<number, Component>();
  let offset = 2,
    width = 0,
    height = 0,
    maxH = 0,
    maxV = 0,
    mcuColumns = 0,
    mcuRows = 0,
    restartInterval = 0,
    progressive = false;
  while (offset < bytes.length) {
    await cooperate();
    tick();
    if (bytes[offset++] !== 255) invalid('JPEG marker expected after complete scan.');
    while (bytes[offset] === 255) {
      tick();
      offset++;
    }
    need(offset, 1);
    const marker = bytes[offset++]!;
    if (marker === 217) {
      if (offset !== bytes.length || !scans || [...components.values()].some(c => progressive ? c.approximation[0] === -1 : !c.sequentialDone)) invalid('JPEG has incomplete component scans.');
      return {
        scans,
        operations,
        presenceBytes,
        elapsedMs: Date.now() - started
      };
    }
    if (marker === 1) continue;
    if (marker === 0 || marker === 216 || marker >= 208 && marker <= 215) invalid('Unexpected JPEG scan marker.');
    const length = u16(offset);
    if (length < 2) invalid('Invalid JPEG segment length.');
    need(offset, length);
    const start = offset + 2,
      end = offset + length;
    if (marker === 196) {
      let p = start;
      while (p < end) {
        need(p, 17);
        const selector = bytes[p++]!;
        if (selector >>> 4 > 1 || (selector & 15) > 3 || p + 16 > end) invalid('Invalid JPEG Huffman selector.');
        const counts = bytes.subarray(p, p + 16);
        p += 16;
        const total = counts.reduce((a, b) => a + b, 0);
        if (!total || total > 256 || p + total > end) invalid('Invalid JPEG Huffman symbol count.');
        const min = new Int32Array(17).fill(-1),
          max = new Int32Array(17).fill(-1),
          indices = new Int32Array(17);
        let code = 0,
          index = 0;
        for (let bits = 1; bits <= 16; bits++) {
          const n = counts[bits - 1]!;
          // JPEG reserves the all-one code for entropy byte-alignment padding.
          if (code + n > 2 ** bits || n && code + n === 2 ** bits) invalid('Oversubscribed or all-one JPEG Huffman code.');
          if (n) {
            min[bits] = code;
            max[bits] = code + n - 1;
            indices[bits] = index;
          }
          index += n;
          code = (code + n) * 2;
        }
        tables.set(selector, {
          min,
          max,
          start: indices,
          values: bytes.subarray(p, p + total)
        });
        p += total;
      }
    } else if (marker === 192 || marker === 193 || marker === 194) {
      if (components.size || length < 8) invalid('Repeated or short JPEG frame.');
      if (bytes[start] !== 8) unsupported();
      height = u16(start + 1);
      width = u16(start + 3);
      const count = bytes[start + 5]!;
      if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_MEGAPIXELS) invalid('JPEG dimensions exceed image bounds.');
      if (!count || count > 4 || length !== 8 + count * 3) invalid('Invalid JPEG component count.');
      for (let i = 0; i < count; i++) {
        const p = start + 6 + i * 3,
          id = bytes[p]!,
          sampling = bytes[p + 1]!,
          h = sampling >>> 4,
          v = sampling & 15;
        if (components.has(id) || !h || h > 4 || !v || v > 4) invalid('Invalid JPEG sampling.');
        maxH = Math.max(maxH, h);
        maxV = Math.max(maxV, v);
        components.set(id, {
          id,
          h,
          v,
          columns: 0,
          rows: 0,
          stride: 0,
          paddedRows: 0,
          approximation: new Int8Array(64).fill(-1),
          sequentialDone: false,
          nonzeroLow: 0,
          nonzeroHigh: 0
        });
      }
      mcuColumns = Math.ceil(width / 8 / maxH);
      mcuRows = Math.ceil(height / 8 / maxV);
      progressive = marker === 194;
      for (const component of components.values()) {
        component.columns = Math.ceil(Math.ceil(width / 8) * component.h / maxH);
        component.rows = Math.ceil(Math.ceil(height / 8) * component.v / maxV);
        component.stride = mcuColumns * component.h;
        component.paddedRows = mcuRows * component.v;
      }
    } else if (marker === 221) {
      if (length !== 4) invalid('Invalid JPEG restart interval.');
      restartInterval = u16(start);
    } else if (marker === 218) {
      if (!components.size || length < 6 || ++scans > 4096) invalid('Invalid JPEG scan count/header.');
      const count = bytes[start]!;
      if (!count || count > components.size || length !== 6 + 2 * count) invalid('Invalid JPEG scan components.');
      const first = bytes[end - 3]!,
        last = bytes[end - 2]!,
        high = bytes[end - 1]! >>> 4,
        low = bytes[end - 1]! & 15;
      if (first > last || last > 63 || high > 13 || low > 13) invalid('Invalid JPEG spectral bounds.');
      if (progressive) {
        if (first === 0 && last !== 0 || first > 0 && count !== 1 || high && low !== high - 1) invalid('Invalid progressive JPEG scan.');
      } else if (first !== 0 || last !== 63 || high || low) invalid('Invalid sequential JPEG scan.');
      const selected: Array<{
        component: Component;
        dc?: Huffman;
        ac?: Huffman;
      }> = [];
      const selectedIds = new Set<number>();
      for (let i = 0; i < count; i++) {
        const id = bytes[start + 1 + i * 2]!,
          selector = bytes[start + 2 + i * 2]!,
          component = components.get(id);
        if (!component || selectedIds.has(id) || selector >>> 4 > 3 || (selector & 15) > 3) invalid('Invalid JPEG scan selector.');
        selectedIds.add(id);
        const dc = tables.get(selector >>> 4),
          ac = tables.get(16 + (selector & 15));
        if ((!progressive || first === 0 && !high) && !dc || (!progressive || first > 0) && !ac) invalid('Missing JPEG Huffman table.');
        if (progressive) {
          if (first > 0 && component.approximation[0] === -1) invalid('JPEG AC scan precedes DC.');
          for (let k = first; k <= last; k++) if (component.approximation[k] !== (high ? high : -1)) invalid('Invalid JPEG successive approximation sequence.');
          if (first > 0 && !component.presence) {
            const n = component.stride * component.paddedRows * 8;
            if (presenceBytes + n > MAX_PRESENCE_BYTES) limited();
            component.presence = new Uint8Array(n);
            presenceBytes += n;
          }
        } else if (component.sequentialDone) invalid('Repeated sequential JPEG component.');
        selected.push({
          component,
          ...(dc ? {
            dc
          } : {}),
          ...(ac ? {
            ac
          } : {})
        });
      }
      if (count > 1 && selected.reduce((n, s) => n + s.component.h * s.component.v, 0) > 10) unsupported();
      let p = end,
        bits = 0,
        remainingBits = 0,
        eob = 0,
        restart = 0;
      function bit(): number {
        tick();
        if (!remainingBits) {
          need(p, 1);
          bits = bytes[p++]!;
          if (bits === 255) {
            need(p, 1);
            if (bytes[p++] !== 0) invalid('JPEG entropy ends inside a required block.');
          }
          remainingBits = 8;
        }
        return bits >>> --remainingBits & 1;
      }
      function receive(n: number): number {
        let value = 0;
        while (n-- > 0) value = value * 2 + bit();
        return value;
      }
      function skipBits(n: number): void {
        while (n > 0) {
          tick();
          if (!remainingBits) {
            need(p, 1);
            bits = bytes[p++]!;
            if (bits === 255) {
              need(p, 1);
              if (bytes[p++] !== 0) invalid('JPEG entropy ends inside a required value.');
            }
            remainingBits = 8;
          }
          const take = Math.min(n, remainingBits);
          remainingBits -= take;
          n -= take;
        }
      }
      function symbol(table: Huffman | undefined): number {
        if (!table) invalid('JPEG Huffman table missing.');
        let code = 0;
        for (let n = 1; n <= 16; n++) {
          code = code * 2 + bit();
          if (table.max[n] !== -1 && code >= table.min[n]! && code <= table.max[n]!) {
            const value = table.values[table.start[n]! + code - table.min[n]!];
            if (value === undefined) invalid('JPEG Huffman index out of range.');
            return value;
          }
        }
        return invalid('Invalid JPEG Huffman entropy code.');
      }
      function present(c: Component, block: number, k: number) {
        return (c.presence![block * 8 + (k >>> 3)]! & 1 << (k & 7)) !== 0;
      }
      function mark(c: Component, block: number, k: number) {
        const i = block * 8 + (k >>> 3);
        if (i >= c.presence!.length) invalid('JPEG coefficient block out of range.');
        c.presence![i] = c.presence![i]! | 1 << (k & 7);
        if (k < 32) c.nonzeroLow |= 1 << k;else c.nonzeroHigh |= 1 << k - 32;
      }
      function bandHasNonzero(c: Component): boolean {
        const mask = (from: number, to: number) => 0xffffffff >>> 31 - (to - from) << from;
        return first <= 31 && !!(c.nonzeroLow & mask(first, Math.min(last, 31))) || last >= 32 && !!(c.nonzeroHigh & mask(Math.max(first, 32) - 32, last - 32));
      }
      function nonzeroCount(c: Component, block: number, from: number): number {
        let count = 0;
        for (let byte = from >>> 3; byte <= last >>> 3; byte++) {
          let mask = c.presence![block * 8 + byte]!;
          if (byte === from >>> 3) mask &= 255 << (from & 7) & 255;
          if (byte === last >>> 3) mask &= (1 << (last & 7) + 1) - 1;
          count += POPCOUNT[mask]!;
        }
        return count;
      }
      function refineRest(c: Component, block: number, from: number): void {
        tick();
        skipBits(nonzeroCount(c, block, from));
      }
      function decode(entry: typeof selected[number], block: number): void {
        tick();
        const c = entry.component;
        if (block < 0 || block >= c.stride * c.paddedRows) invalid('JPEG block index out of range.');
        if (!progressive) {
          const dc = symbol(entry.dc);
          if (dc > 11) invalid('Invalid JPEG DC category.');
          skipBits(dc);
          let k = 1;
          while (k < 64) {
            tick();
            const value = symbol(entry.ac),
              size = value & 15,
              run = value >>> 4;
            if (!size) {
              if (run === 0) break;
              if (run !== 15 || k + 16 > 64) invalid('Invalid JPEG zero run.');
              k += 16;
              continue;
            }
            if (size > 10 || k + run > 63) invalid('Invalid JPEG AC run/category.');
            k += run;
            skipBits(size);
            k++;
          }
          return;
        }
        if (first === 0) {
          if (high) bit();else {
            const category = symbol(entry.dc);
            if (category > 11) invalid('Invalid progressive JPEG DC category.');
            skipBits(category);
          }
          return;
        }
        let k = first;
        if (!high) {
          if (eob) {
            eob--;
            return;
          }
          while (k <= last) {
            tick();
            const value = symbol(entry.ac),
              size = value & 15,
              run = value >>> 4;
            if (!size) {
              if (run < 15) {
                eob = (1 << run) + receive(run) - 1;
                break;
              }
              if (k + 16 > last + 1) invalid('Progressive JPEG zero run exceeds band.');
              k += 16;
              continue;
            }
            if (size > 10 || k + run > last) invalid('Progressive JPEG AC run exceeds band.');
            k += run;
            skipBits(size);
            mark(c, block, k++);
          }
          return;
        }
        if (eob) {
          refineRest(c, block, k);
          eob--;
          return;
        }
        while (k <= last) {
          tick();
          const value = symbol(entry.ac),
            size = value & 15,
            r = value >>> 4;
          if (size > 1) invalid('Invalid JPEG AC refinement category.');
          if (!size && r < 15) {
            eob = (1 << r) + receive(r);
            refineRest(c, block, k);
            eob--;
            return;
          }
          let run = size ? r : 16;
          if (size) bit(); // sign of a new +/-1 coefficient; magnitude is unnecessary.
          while (k <= last) {
            tick();
            if (present(c, block, k)) {
              bit();
              k++;
            } else if (run) {
              run--;
              k++;
              if (!size && !run) break;
            } else break;
          }
          if (run) invalid('JPEG refinement zero run exceeds band.');
          if (size) {
            if (k > last) invalid('JPEG new refinement coefficient exceeds band.');
            mark(c, block, k++);
          }
        }
      }
      function align() {
        if (remainingBits && (bits & (1 << remainingBits) - 1) !== (1 << remainingBits) - 1) invalid('Invalid JPEG entropy alignment padding.');
        remainingBits = 0;
      }
      const expected = count === 1 ? selected[0]!.component.columns * selected[0]!.component.rows : mcuColumns * mcuRows;
      let refinementPrefix: Uint32Array | undefined;
      const refinementComponent = selected[0]!.component;
      const physicalBlock = (index: number) => Math.floor(index / refinementComponent.columns) * refinementComponent.stride + index % refinementComponent.columns;
      if (progressive && first > 0 && high && bandHasNonzero(refinementComponent)) {
        refinementPrefix = new Uint32Array(Math.ceil(expected / 32) + 1);
        if (refinementPrefix.byteLength > 65536) limited();
        let total = 0;
        for (let index = 0; index < expected; index++) {
          tick();
          if (operations - lastYield >= 1_000_000) await cooperate();
          total += nonzeroCount(refinementComponent, physicalBlock(index), first);
          if ((index + 1) % 32 === 0) refinementPrefix[(index + 1) / 32] = total;
        }
      }
      function refinementBits(start: number, count: number): number {
        const end = start + count;
        let total = 0;
        while (start < end && start % 32) {
          tick();
          total += nonzeroCount(refinementComponent, physicalBlock(start++), first);
        }
        const groupEnd = Math.floor(end / 32) * 32;
        if (start < groupEnd) {
          total += refinementPrefix![groupEnd / 32]! - refinementPrefix![start / 32]!;
          start = groupEnd;
        }
        while (start < end) {
          tick();
          total += nonzeroCount(refinementComponent, physicalBlock(start++), first);
        }
        return total;
      }
      const interval = restartInterval || expected;
      let mcu = 0;
      while (mcu < expected) {
        const stop = Math.min(mcu + interval, expected);
        eob = 0;
        for (; mcu < stop; mcu++) {
          if (operations - lastYield >= 1_000_000) await cooperate();
          tick();
          if (count === 1 && progressive && first > 0 && eob) {
            const skip = Math.min(eob, stop - mcu);
            if (high && refinementPrefix) skipBits(refinementBits(mcu, skip));
            eob -= skip;
            mcu += skip - 1;
            continue;
          }
          if (count === 1) {
            const c = selected[0]!.component;
            decode(selected[0]!, Math.floor(mcu / c.columns) * c.stride + mcu % c.columns);
          } else {
            const row = Math.floor(mcu / mcuColumns),
              column = mcu % mcuColumns;
            for (const entry of selected) for (let y = 0; y < entry.component.v; y++) for (let x = 0; x < entry.component.h; x++) decode(entry, (row * entry.component.v + y) * entry.component.stride + column * entry.component.h + x);
          }
        }
        if (eob) invalid('JPEG EOB run exceeds restart/scan block count.');
        align();
        if (mcu < expected) {
          need(p, 2);
          if (bytes[p++] !== 255) invalid('JPEG restart marker missing.');
          while (bytes[p] === 255) {
            tick();
            p++;
          }
          need(p, 1);
          if (bytes[p++] !== 208 + (restart++ & 7)) invalid('JPEG restart marker sequence is invalid.');
        }
      }
      // The next byte must be a marker prefix; do not copy upstream's tolerant
      // skip-until-marker behavior, which would hide surplus/truncated scan data.
      need(p, 2);
      if (bytes[p] !== 255 || bytes[p + 1] === 0) invalid('Unexpected trailing JPEG entropy data.');
      for (const entry of selected) {
        if (progressive) for (let k = first; k <= last; k++) entry.component.approximation[k] = low;else entry.component.sequentialDone = true;
      }
      offset = p;
      continue;
    } else if (marker >= 195 && marker <= 207 && marker !== 196) unsupported();else if (!(marker >= 224 && marker <= 239) && marker !== 254 && marker !== 219) unsupported();
    offset = end;
  }
  return invalid('JPEG entropy stream has no final EOI.');
}
