import { crc32, inflateRawSync, type InflateRaw } from 'node:zlib';
import { MAX_DOCUMENT_BYTES } from '@flowboard/contracts';

const MAX_PARTS = 32;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const LOCAL_HEADER = 0x04034b50;
const DIRECTORY_HEADER = 0x02014b50;
const DIRECTORY_END = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;

export function invalidOffice(): never {
  throw new Error('Unsupported Office document.');
}

const canonicalPartName = /^[a-zA-Z0-9_.\-[\]]+(?:\/[a-zA-Z0-9_.\-[\]]+)*$/;

/** Canonical ASCII paths are shared by the local and central ZIP headers. */
export function isOfficePartName(value: string): boolean {
  return value.length <= 240 && canonicalPartName.test(value) &&
    value.split('/').every(segment => segment !== '.' && segment !== '..' && !segment.endsWith('.'));
}

function checkExtraFields(buffer: Buffer, start: number, end: number) {
  if (start === end) return;
  // Microsoft OPC growth hint. Only the canonical zero-filled padding is inert.
  if (end - start < 8 || buffer.readUInt16LE(start) !== 0xa220 || buffer.readUInt16LE(start + 2) !== end - start - 4 ||
      buffer.readUInt16LE(start + 4) !== 0xa028 || buffer.subarray(start + 8, end).some(byte => byte !== 0)) invalidOffice();
}

interface ZipEntry {
  local: number;
  name: string;
  directory: boolean;
  nameBytes: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  expanded: number;
}

function readCentralDirectory(buffer: Buffer, end: number, start: number, entryCount: number) {
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = start;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== DIRECTORY_HEADER) invalidOffice();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20);
    const expanded = buffer.readUInt32LE(offset + 24);
    const nameStart = offset + 46;
    const nameEnd = nameStart + buffer.readUInt16LE(offset + 28);
    const extraEnd = nameEnd + buffer.readUInt16LE(offset + 30);
    const attributes = buffer.readUInt32LE(offset + 38);
    const local = buffer.readUInt32LE(offset + 42);
    if (extraEnd > end || buffer.readUInt16LE(offset + 32) !== 0 || buffer.readUInt16LE(offset + 34) !== 0 ||
        (flags & ~(method === 8 ? 0x080e : 0x0808)) !== 0 || (method !== 0 && method !== 8)) invalidOffice();
    const nameBytes = buffer.subarray(nameStart, nameEnd);
    const name = nameBytes.toString('latin1');
    const directory = name.endsWith('/');
    const path = directory ? name.slice(0, -1) : name;
    const unixType = attributes >>> 28;
    if (!isOfficePartName(path) || names.has(path.toLowerCase()) ||
        (unixType !== 0 && unixType !== (directory ? 4 : 8)) || (!directory && (attributes & 0x10) !== 0)) invalidOffice();
    if (directory && (method !== 0 || flags & 8 || crc !== 0 || compressed !== 0 || expanded !== 0)) invalidOffice();
    checkExtraFields(buffer, nameEnd, extraEnd);
    names.add(path.toLowerCase());
    entries.push({ local, name, directory, nameBytes, flags, method, crc, compressed, expanded });
    offset = extraEnd;
  }
  if (offset !== end || entries.filter(entry => !entry.directory).length > MAX_PARTS) invalidOffice();
  const files = entries.filter(entry => !entry.directory);
  if (entries.some(entry => entry.directory && !files.some(file => file.name.startsWith(entry.name)))) invalidOffice();
  return entries.sort((first, second) => first.local - second.local);
}

function readLocalEntry(buffer: Buffer, entry: ZipEntry, next: number) {
  const { local, nameBytes, flags, method, crc, compressed, expanded } = entry;
  if (local + 30 > next || buffer.readUInt32LE(local) !== LOCAL_HEADER || buffer.readUInt16LE(local + 6) !== flags ||
      buffer.readUInt16LE(local + 8) !== method) invalidOffice();
  const nameEnd = local + 30 + buffer.readUInt16LE(local + 26);
  const dataStart = nameEnd + buffer.readUInt16LE(local + 28);
  const dataEnd = dataStart + compressed;
  if (dataEnd > next || !nameBytes.equals(buffer.subarray(local + 30, nameEnd))) invalidOffice();
  checkExtraFields(buffer, nameEnd, dataStart);
  const localCrc = buffer.readUInt32LE(local + 14);
  const localCompressed = buffer.readUInt32LE(local + 18);
  const localExpanded = buffer.readUInt32LE(local + 22);
  if (flags & 8) {
    // Accept either standard non-ZIP64 descriptor spelling with no gaps.
    const descriptor = next - dataEnd === 16 && buffer.readUInt32LE(dataEnd) === DATA_DESCRIPTOR ? dataEnd + 4 : dataEnd;
    if (descriptor + 12 !== next || (localCrc !== 0 && localCrc !== crc) ||
        (localCompressed !== 0 && localCompressed !== compressed) || (localExpanded !== 0 && localExpanded !== expanded) ||
        buffer.readUInt32LE(descriptor) !== crc || buffer.readUInt32LE(descriptor + 4) !== compressed ||
        buffer.readUInt32LE(descriptor + 8) !== expanded) invalidOffice();
  } else if (dataEnd !== next || localCrc !== crc || localCompressed !== compressed || localExpanded !== expanded) invalidOffice();
  return buffer.subarray(dataStart, dataEnd);
}

function inflateEntry(bytes: Buffer, entry: ZipEntry, remaining: number): Buffer {
  if (!entry.expanded || entry.expanded > remaining) invalidOffice();
  let expanded = bytes;
  if (entry.method === 8) {
    // A claimed length is untrusted. Limit native output and check every compressed byte was consumed.
    const result = inflateRawSync(bytes, { info: true, maxOutputLength: entry.expanded }) as unknown as { buffer: Buffer; engine: InflateRaw };
    if (result.engine.bytesWritten !== bytes.length) invalidOffice();
    expanded = result.buffer;
  }
  if (expanded.length !== entry.expanded || crc32(expanded) !== entry.crc) invalidOffice();
  return expanded;
}

/** A bounded non-ZIP64 ZIP profile with no executable, hidden, or unframed bytes. */
export function readOfficeZip(bytes: Uint8Array, checkBudget: () => void): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.length > MAX_DOCUMENT_BYTES) invalidOffice();
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = buffer.length - 22;
  const entryCount = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(end) !== DIRECTORY_END || buffer.readUInt32LE(end + 4) !== 0 ||
      buffer.readUInt16LE(end + 8) !== entryCount || entryCount === 0 || entryCount > 2 * MAX_PARTS ||
      start + buffer.readUInt32LE(end + 12) !== end || buffer.readUInt16LE(end + 20) !== 0) invalidOffice();
  const entries = readCentralDirectory(buffer, end, start, entryCount);
  if (entries[0]?.local !== 0) invalidOffice();
  const result = new Map<string, Buffer>();
  let remaining = MAX_EXPANDED_BYTES;
  for (const [index, entry] of entries.entries()) {
    checkBudget();
    const compressed = readLocalEntry(buffer, entry, entries[index + 1]?.local ?? start);
    if (!entry.directory) {
      const expanded = inflateEntry(compressed, entry, remaining);
      remaining -= expanded.length;
      result.set(entry.name, expanded);
    }
  }
  return result;
}
