import zlib from 'node:zlib';

/** Synthetic fixture ZIP tools. CRC and offsets are real; never used by production parsing. */
export function zipXmlParts(files: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const raw = typeof value === 'string' ? Buffer.from(value) : value;
    const bytes = zlib.deflateRawSync(raw), fn = Buffer.from(name), crc = zlib.crc32(raw);
    const l = Buffer.alloc(30 + fn.length), c = Buffer.alloc(46 + fn.length);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(bytes.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(fn.length, 26); fn.copy(l, 30);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(bytes.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(fn.length, 28); c.writeUInt32LE(offset, 42); fn.copy(c, 46);
    local.push(l, bytes); central.push(c); offset += l.length + bytes.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

export function unzipFixture(bytes: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  const eocd = bytes.length - 22;
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < bytes.readUInt16LE(eocd + 10); i++) {
    const size = bytes.readUInt32LE(offset + 20), nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength), at = bytes.readUInt32LE(offset + 42);
    const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
    const data = bytes.subarray(start, start + size);
    files[name] = bytes.readUInt16LE(offset + 10) === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return files;
}

export function rewriteWorkbook(bytes: Buffer, edit: (parts: Record<string, Buffer>) => void): Buffer {
  const parts = unzipFixture(bytes); edit(parts); return zipXmlParts(parts);
}
