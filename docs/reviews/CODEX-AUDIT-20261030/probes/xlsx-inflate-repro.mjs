import zlib from 'node:zlib';
import { parseExcelWorkbook, MAX_EXPANDED_BYTES } from '../../../../apps/api/src/services/excel-parser.ts';

const name = Buffer.from('xl/workbook.xml');
const expanded = Buffer.alloc(MAX_EXPANDED_BYTES + 1, 0x41);
const compressed = zlib.deflateRawSync(expanded, { level: 9 });
const local = Buffer.alloc(30 + name.length + compressed.length);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);
local.writeUInt16LE(8, 8);
local.writeUInt32LE(compressed.length, 18);
local.writeUInt32LE(expanded.length, 22);
local.writeUInt16LE(name.length, 26);
name.copy(local, 30);
compressed.copy(local, 30 + name.length);
const central = Buffer.alloc(46 + name.length);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(20, 4);
central.writeUInt16LE(20, 6);
central.writeUInt16LE(8, 10);
central.writeUInt32LE(compressed.length, 20);
central.writeUInt32LE(expanded.length, 24);
central.writeUInt16LE(name.length, 28);
central.writeUInt32LE(0, 42);
name.copy(central, 46);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(1, 8);
eocd.writeUInt16LE(1, 10);
eocd.writeUInt32LE(central.length, 12);
eocd.writeUInt32LE(local.length, 16);
const zip = Buffer.concat([local, central, eocd]);
const before = process.memoryUsage().external;
let outcome;
try {
  parseExcelWorkbook(zip);
  outcome = 'unexpected accept';
} catch (error) {
  outcome = `${error.code ?? error.name}: ${error.message}`;
}
console.log(JSON.stringify({ compressedBytes: zip.length, claimedExpandedBytes: expanded.length, maxExpandedBytes: MAX_EXPANDED_BYTES, outcome, externalMemoryDeltaBytes: process.memoryUsage().external - before }));
