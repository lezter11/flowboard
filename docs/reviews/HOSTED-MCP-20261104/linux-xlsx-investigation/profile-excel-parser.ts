import { events, event, stage, stamp } from './profile-state.ts';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { isValidGregorianDate, type Priority } from '@flowboard/contracts';
import { HttpError } from '../../../../apps/api/src/http/errors.ts';
import path from 'node:path';
import { attr, child, children, descendants, decodeXmlText, invalidXml, parseXmlPart, requireRoot,
  SPREADSHEET_NS, STRICT_SPREADSHEET_NS, DOCUMENT_REL_NS, STRICT_DOCUMENT_REL_NS,
  PACKAGE_REL_NS, CONTENT_TYPES_NS, MAX_XML_TEXT, type XmlElement } from './profile-import-xml.ts';

export const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_EXPANDED_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_CELLS = 10000;
export const MAX_PARSE_MS = 1000;

export const STANDARD_HEADERS = [
  'External ID',
  'Title',
  'Description',
  'Priority',
  'Due Date',
  'Assignees',
  'Status',
] as const;

export type StandardHeader = (typeof STANDARD_HEADERS)[number];

export interface ImportRowError {
  field: string;
  code: string;
  message: string;
}

export interface ParsedImportRow {
  rowNumber: number;
  externalId: string;
  externalIdIsNumeric: boolean;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  assigneeEmails: string[];
  status: string | null;
  rawErrors: ImportRowError[];
}

export interface ParseExcelResult {
  sheetName: string;
  date1904: boolean;
  totalRows: number;
  rows: ParsedImportRow[];
}

/**
 * Minimal unzipper for XLSX archives enforcing strict bounds against ZIP bombs.
 */
function unzipXlsx(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length > MAX_COMPRESSED_BYTES) {
    throw new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      'The workbook is too large to import.',
    );
  }

  // Look for End of Central Directory Record (EOCD signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw HttpError.unprocessable(
      'INVALID_WORKBOOK',
      'Invalid workbook file: missing ZIP central directory signature.',
    );
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  if (buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0
      || buffer.readUInt16LE(eocdOffset + 8) !== totalEntries
      || eocdOffset + 22 + buffer.readUInt16LE(eocdOffset + 20) !== buffer.length
      || cdOffset + cdSize !== eocdOffset) throw invalidXml('Invalid or unsupported ZIP directory.');

  if (totalEntries > 100) {
    throw HttpError.unprocessable(
      'INVALID_WORKBOOK',
      'Invalid workbook package: exceeds maximum allowed entry count.',
    );
  }

  const files = new Map<string, Buffer>();
  let totalExpandedBytes = 0;
  let offset = cdOffset;
  const names = new Set<string>();
  const segments: Array<[number, number]> = [];
  const expandedTooLarge = () =>
    new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      'The workbook contains too much content to import.',
    );

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        'Invalid workbook package: corrupted central directory entry.',
      );
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 16);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    if (offset + 46 + fileNameLen + extraLen + commentLen > eocdOffset
        || buffer.readUInt16LE(offset + 34) !== 0 || (flags & ~0x0808) !== 0) throw invalidXml('Invalid or encrypted ZIP entry.');
    let fileName: string;
    try { fileName = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset + 46, offset + 46 + fileNameLen)); }
    catch { throw invalidXml('Invalid ZIP filename encoding.'); }
    if (!fileName || fileName.startsWith('/') || fileName.includes('\\') || fileName.includes('%')
        || fileName.split('/').some(segment => !segment || segment === '.' || segment === '..')
        || /[\x00-\x20\x7f:]/.test(fileName) || names.has(fileName.toLowerCase())) throw invalidXml('Unsafe or duplicate ZIP part name.');
    names.add(fileName.toLowerCase());
    offset += 46 + fileNameLen + extraLen + commentLen;
    const lowerName = fileName.toLowerCase();

    // Security check: reject external references & OLE embeddings
    if (lowerName.startsWith('xl/embeddings/') || lowerName.endsWith('.ole')) {
      throw HttpError.unprocessable(
        'OLE_EMBEDDINGS_REJECTED',
        'Embedded OLE objects are strictly disallowed.',
      );
    }
    if (lowerName.startsWith('xl/externallinks/') || lowerName.includes('externalreferences')) {
      throw HttpError.unprocessable(
        'EXTERNAL_LINKS_REJECTED',
        'External package links and external references are strictly disallowed.',
      );
    }

    // Security check: reject macro / executable extensions
    if (
      lowerName.endsWith('.bin') ||
      lowerName.endsWith('.exe') ||
      lowerName.endsWith('.dll') ||
      lowerName.endsWith('.vbs') ||
      lowerName.endsWith('.bat') ||
      lowerName.endsWith('.cmd') ||
      lowerName.includes('vba')
    ) {
      throw HttpError.unprocessable(
        'MACRO_OR_EXECUTABLE_REJECTED',
        'Macros, executable code, and binary package parts are strictly disallowed.',
      );
    }

    // Read local header
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        'Invalid workbook package: corrupted local file header.',
      );
    }

    const localFileLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    const localName = buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localFileLen);
    if (buffer.readUInt16LE(localHeaderOffset + 6) !== flags
        || buffer.readUInt16LE(localHeaderOffset + 8) !== method
        || !localName.equals(Buffer.from(fileName))
        || (!(flags & 8) && (buffer.readUInt32LE(localHeaderOffset + 14) !== crc
          || buffer.readUInt32LE(localHeaderOffset + 18) !== compressedSize
          || buffer.readUInt32LE(localHeaderOffset + 22) !== uncompressedSize))) throw invalidXml('ZIP local/central metadata mismatch.');
    if (dataEnd > cdOffset || localHeaderOffset >= cdOffset || segments.some(([start, end]) => localHeaderOffset < end && dataEnd > start)) {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        'Invalid workbook package: compressed data segment overflow.',
      );
    }

    // The bytes this entry may still expand to. The declared size comes from the
    // central directory and can lie, so it is only a fast reject. The real limit is
    // the decompressor's maxOutputLength below, which stops inflation at the cap.
    const remainingBudget = MAX_EXPANDED_BYTES - totalExpandedBytes;
    if (uncompressedSize > remainingBudget) {
      throw expandedTooLarge();
    }

    const compressedData = buffer.subarray(dataStart, dataEnd);
    let uncompressedData: Buffer;

    if (method === 0) {
      if (compressedData.length > remainingBudget) {
        throw expandedTooLarge();
      }
      uncompressedData = Buffer.from(compressedData);
    } else if (method === 8) {
      try {
        uncompressedData = zlib.inflateRawSync(compressedData, { maxOutputLength: remainingBudget });
      } catch (err) {
        if (err instanceof RangeError && (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          throw expandedTooLarge();
        }
        throw HttpError.unprocessable(
          'DECOMPRESSION_FAILED',
          'Failed to decompress workbook XML content.',
        );
      }
    } else {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        `Unsupported ZIP compression method: ${method}`,
      );
    }

    if (uncompressedData.length !== uncompressedSize || zlib.crc32(uncompressedData) !== crc) throw invalidXml('ZIP size or CRC integrity check failed.');
    segments.push([localHeaderOffset, dataEnd]);
    totalExpandedBytes += uncompressedData.length;
    files.set(fileName, uncompressedData);
  }

  if (offset !== eocdOffset) throw invalidXml('Invalid ZIP directory size.');
  return files;
}

/** Single XML text decode, retained for callers and regression tests. */
export const unescapeXml = decodeXmlText;

/**
 * Converts column letters (e.g. 'A', 'B', 'AA') to 0-indexed column number.
 */
function colLettersToIndex(col: string): number {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Converts Excel serial date number to YYYY-MM-DD respecting 1900 or 1904 date system.
 * Strictly rejects fictitious 1900-02-29 (serial 60 in 1900 date system).
 */
export function excelSerialToIsoDate(serial: number, is1904: boolean): string {
  if (isNaN(serial) || !isFinite(serial)) {
    throw new Error('Invalid numeric date serial');
  }

  const intSerial = Math.floor(serial);

  if (is1904) {
    if (intSerial < 0 || intSerial > 2958465) {
      throw new Error('Date serial out of valid Gregorian range');
    }
    // 1904 system epoch: 1904-01-01 is serial 0
    const epochMs = Date.UTC(1904, 0, 1);
    const date = new Date(epochMs + intSerial * 86_400_000);
    const iso = date.toISOString().split('T')[0]!;
    if (!isValidGregorianDate(iso)) {
      throw new Error('Invalid calendar date');
    }
    return iso;
  } else {
    // 1900 date system:
    // Serial 1 is 1900-01-01
    // Day 60 is the fictitious 1900-02-29 leap year bug from Lotus 1-2-3!
    if (intSerial === 60) {
      throw new Error('Fictitious 1900-02-29 date is not supported');
    }
    if (intSerial < 1 || intSerial > 2958465) {
      throw new Error('Date serial out of valid Gregorian range');
    }

    const epochMs = intSerial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const date = new Date(epochMs + intSerial * 86_400_000);
    const iso = date.toISOString().split('T')[0]!;
    if (!isValidGregorianDate(iso)) {
      throw new Error('Invalid calendar date');
    }
    return iso;
  }
}

/** Literal text runs only: phonetic annotations are not cell text. */
function richText(node: XmlElement): string {
  let value = '';
  const direct = children(node, 't'), runs = children(node, 'r');
  if (direct.length > 1 || (direct.length && runs.length) || node.text.trim()) throw invalidXml('Unsupported string representation.');
  for (const c of node.children) {
    if (c.ns !== node.ns || !['t', 'r', 'rPh', 'phoneticPr'].includes(c.name)) throw invalidXml('Unsupported string child element.');
    if (c.name === 't') {
      if (c.children.length) throw invalidXml('Unsupported nested string text.');
      value += c.text;
    } else if (c.name === 'r') {
      const texts = children(c, 't');
      if (texts.length !== 1 || c.text.trim() || c.children.some(n => n.ns !== c.ns || !['t', 'rPr'].includes(n.name))) throw invalidXml('Invalid rich-text run.');
      if (texts[0]!.children.length) throw invalidXml('Unsupported nested string text.');
      value += texts[0]!.text;
    }
    if (value.length > MAX_XML_TEXT) throw HttpError.unprocessable('XML_LIMIT_EXCEEDED', 'Cell text exceeds the supported limit.');
  }
  return value;
}

interface RawCellData {
  colIndex: number;
  colLetter: string;
  type: string;
  isNumericRaw: boolean;
  dateStyled: boolean;
  value: string;
}

/**
 * Pure TypeScript Excel Parser for Flowboard Card Import Engine.
 */
/** Recognize genuine Excel date formats, never general numeric cells. */
function dateStyleIndexes(root: XmlElement | undefined): Set<number> {
  if (!root) return new Set();
  requireRoot(root, 'styleSheet', [SPREADSHEET_NS, STRICT_SPREADSHEET_NS]);
  const formats = new Map<number, string>();
  const numFmts = child(root, 'numFmts');
  if (numFmts) for (const f of children(numFmts, 'numFmt')) formats.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') ?? '');
  const result = new Set<number>();
  const xfs = child(root, 'cellXfs');
  if (xfs) children(xfs, 'xf').forEach((xf, index) => {
    const id = Number(attr(xf, 'numFmtId') ?? 0);
    const code = (formats.get(id) ?? '').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '').toLowerCase();
    if ([14,15,16,17,22].includes(id) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58) || /[yd]/.test(code)) result.add(index);
  });
  return result;
}

const CONTENT = 'application/vnd.openxmlformats-officedocument.';
function expectedContentType(name: string): string | undefined {
  if (name === 'xl/workbook.xml') return CONTENT + 'spreadsheetml.sheet.main+xml';
  if (name === 'xl/styles.xml') return CONTENT + 'spreadsheetml.styles+xml';
  if (name === 'xl/sharedStrings.xml') return CONTENT + 'spreadsheetml.sharedStrings+xml';
  if (/^xl\/worksheets\/sheet[^/]+\.xml$/.test(name)) return CONTENT + 'spreadsheetml.worksheet+xml';
  if (/^xl\/theme\/theme[^/]+\.xml$/.test(name)) return CONTENT + 'theme+xml';
  if (/^xl\/tables\/table[^/]+\.xml$/.test(name)) return CONTENT + 'spreadsheetml.table+xml';
  if (name === 'docProps/core.xml') return 'application/vnd.openxmlformats-package.core-properties+xml';
  if (name === 'docProps/app.xml') return CONTENT + 'extended-properties+xml';
  if (name === 'docProps/custom.xml') return CONTENT + 'custom-properties+xml';
  if (name === '_rels/.rels' || /^(?:xl|xl\/worksheets)\/_rels\/[^/]+\.xml\.rels$/.test(name)) return 'application/vnd.openxmlformats-package.relationships+xml';
  return undefined;
}

/** All parts are parsed and checked, including unreferenced relationships/XML. */
function validatePackage(files: Map<string, Buffer>, checkBudget: () => void): {
  documents: Map<string, XmlElement>; relationships: Map<string, Map<string, { target: string; type: string }>>
} {
  const documents = new Map<string, XmlElement>();
  const xmlBudget = { markup: 0 };
  // Scan all XML before profile validation so hidden UTF16 declarations cannot be ignored.
  for (const [name, bytes] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) {
    documents.set(name, parseXmlPart(bytes, checkBudget, xmlBudget));
  }
  const types = documents.get('[Content_Types].xml');
  if (!types) throw invalidXml('Missing workbook content types.');
  requireRoot(types, 'Types', [CONTENT_TYPES_NS]);
  const defaults = new Map<string, string>(), overrides = new Map<string, string>();
  const allowedTypes = new Set([
    CONTENT + 'spreadsheetml.sheet.main+xml', CONTENT + 'spreadsheetml.styles+xml', CONTENT + 'spreadsheetml.sharedStrings+xml',
    CONTENT + 'spreadsheetml.worksheet+xml', CONTENT + 'theme+xml', CONTENT + 'spreadsheetml.table+xml',
    CONTENT + 'extended-properties+xml', CONTENT + 'custom-properties+xml',
    'application/vnd.openxmlformats-package.core-properties+xml', 'application/vnd.openxmlformats-package.relationships+xml', 'application/xml',
  ]);
  for (const entry of types.children) {
    const type = attr(entry, 'ContentType');
    if (entry.ns !== CONTENT_TYPES_NS || !type || !allowedTypes.has(type)) throw invalidXml('Unsupported workbook content type. Only macro-free XLSX is supported.');
    if (entry.name === 'Default') {
      const ext = attr(entry, 'Extension');
      if (!ext || defaults.has(ext) || !['xml', 'rels'].includes(ext)) throw invalidXml('Invalid default workbook content type.');
      defaults.set(ext, type);
    } else if (entry.name === 'Override') {
      const part = attr(entry, 'PartName');
      if (!part?.startsWith('/') || overrides.has(part.slice(1)) || !files.has(part.slice(1))) throw invalidXml('Invalid workbook content type override.');
      overrides.set(part.slice(1), type);
    } else throw invalidXml('Invalid content type element.');
  }
  for (const name of files.keys()) {
    if (name === '[Content_Types].xml') continue;
    const expected = expectedContentType(name), actual = overrides.get(name) ?? defaults.get(name.split('.').at(-1)!);
    if (!expected || actual !== expected) throw invalidXml('Unsupported workbook part or mismatched content type.');
  }
  const relationships = new Map<string, Map<string, { target: string; type: string }>>();
  const allowedRelationships = new Set(['officeDocument', 'worksheet', 'styles', 'sharedStrings', 'theme', 'table', 'extended-properties', 'custom-properties']);
  for (const [name, root] of documents) if (name.endsWith('.rels')) {
    requireRoot(root, 'Relationships', [PACKAGE_REL_NS]);
    const source = name === '_rels/.rels' ? '' : name.replace('/_rels/', '/').slice(0, -5);
    if (source && !files.has(source)) throw invalidXml('Relationship source does not exist.');
    const rels = new Map<string, { target: string; type: string }>();
    for (const rel of root.children) {
      const id = attr(rel, 'Id'), target = attr(rel, 'Target'), type = attr(rel, 'Type'), mode = attr(rel, 'TargetMode');
      if (rel.name !== 'Relationship' || rel.ns !== PACKAGE_REL_NS || !id || rels.has(id) || !target || !type
          || (mode && mode !== 'Internal') || /[\\%?#\x00-\x20]/.test(target) || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        throw HttpError.unprocessable('EXTERNAL_LINKS_REJECTED', 'External or invalid package relationships are disallowed.');
      }
      const kind = type.startsWith(DOCUMENT_REL_NS + '/') ? type.slice(DOCUMENT_REL_NS.length + 1)
        : type.startsWith(STRICT_DOCUMENT_REL_NS + '/') ? type.slice(STRICT_DOCUMENT_REL_NS.length + 1)
        : type === PACKAGE_REL_NS + '/metadata/core-properties' ? 'core-properties' : '';
      if (!allowedRelationships.has(kind) && kind !== 'core-properties') throw invalidXml('Unsupported workbook relationship type.');
      const base = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(source), target);
      const resolved = path.posix.normalize(base);
      if (resolved.startsWith('../') || !files.has(resolved)) throw invalidXml('Relationship target does not exist in the package.');
      const targetType = expectedContentType(resolved);
      const expectedKind = kind === 'officeDocument' ? CONTENT + 'spreadsheetml.sheet.main+xml'
        : kind === 'core-properties' ? 'application/vnd.openxmlformats-package.core-properties+xml'
        : kind === 'worksheet' ? CONTENT + 'spreadsheetml.worksheet+xml'
        : kind === 'table' ? CONTENT + 'spreadsheetml.table+xml'
        : kind === 'styles' ? CONTENT + 'spreadsheetml.styles+xml'
        : kind === 'sharedStrings' ? CONTENT + 'spreadsheetml.sharedStrings+xml'
        : CONTENT + kind + '+xml';
      if (targetType !== expectedKind) throw invalidXml('Relationship type does not match its target.');
      rels.set(id, { target: resolved, type: kind });
    }
    relationships.set(source, rels);
  }
  if (![...(relationships.get('')?.values() ?? [])].some(r => r.type === 'officeDocument' && r.target === 'xl/workbook.xml')) throw invalidXml('Missing root workbook relationship.');
  return { documents, relationships };
}

export function parseExcelWorkbook(fileBuffer: Buffer): ParseExcelResult {
  const started = performance.now();
  const checkBudget = () => { const elapsedMs=performance.now()-started; event({kind:'checkpoint',elapsedMs}); if (elapsedMs > MAX_PARSE_MS) throw HttpError.unprocessable('PARSE_BUDGET_EXCEEDED', 'Workbook validation took too long. Reduce the workbook.'); };
  stage("unzip"); const files = unzipXlsx(fileBuffer); stamp("unzip");
  const { documents, relationships } = validatePackage(files, checkBudget);
  event({kind:"packageComplete",elapsedMs:performance.now()-started}); stage("rowConversion");
  const dateStyles = dateStyleIndexes(documents.get('xl/styles.xml'));
  let cellCount = 0;
  for (const [name, document] of documents) if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
    requireRoot(document, 'worksheet', [SPREADSHEET_NS, STRICT_SPREADSHEET_NS]);
    cellCount += descendants(document, 'c').length;
  }
  if (cellCount > MAX_IMPORT_CELLS) throw HttpError.unprocessable('CELL_LIMIT_EXCEEDED', 'Workbook contains too many cells.');
  const workbook = documents.get('xl/workbook.xml');
  if (!workbook) throw invalidXml('Missing xl/workbook.xml.');
  requireRoot(workbook, 'workbook', [SPREADSHEET_NS, STRICT_SPREADSHEET_NS]);
  const date1904 = ['1', 'true'].includes(attr(child(workbook, 'workbookPr') ?? workbook, 'date1904') ?? '');
  const sheets = child(workbook, 'sheets');
  const sheetList = sheets ? children(sheets, 'sheet').map(s => ({ name: attr(s, 'name') ?? '',
    rId: attr(s, 'id', DOCUMENT_REL_NS) ?? attr(s, 'id', STRICT_DOCUMENT_REL_NS) ?? '' })) : [];
  if (sheetList.length === 0) throw HttpError.unprocessable('EMPTY_WORKBOOK', 'Workbook contains no worksheets.');
  if (sheetList.length > 2 || sheetList.some(s => !['Cards', 'Instructions'].includes(s.name))
      || new Set(sheetList.map(s => s.name)).size !== sheetList.length) throw HttpError.unprocessable('UNSUPPORTED_WORKSHEET', 'Only Cards and optional Instructions worksheets are allowed.');
  const targetSheet = sheetList.find(s => s.name === 'Cards');
  if (!targetSheet) throw HttpError.unprocessable('CARDS_SHEET_NOT_FOUND', "Workbook is missing required 'Cards' worksheet.");
  const sheetPaths = new Set<string>();
  for (const sheet of sheetList) {
    const rel = relationships.get('xl/workbook.xml')?.get(sheet.rId);
    if (!rel || rel.type !== 'worksheet' || sheetPaths.has(rel.target)) throw invalidXml('Invalid worksheet relationship.');
    sheetPaths.add(rel.target);
  }
  const worksheetRelPath = relationships.get('xl/workbook.xml')!.get(targetSheet.rId)!.target;
  const worksheet = documents.get(worksheetRelPath)!;
  if (descendants(worksheet, 'f').length) throw HttpError.unprocessable('FORMULA_REJECTED', 'Formulas and calculated cells are disallowed in Cards.');
  if (descendants(worksheet, 'mergeCell').length || child(worksheet, 'mergeCells')) throw HttpError.unprocessable('MERGED_CELLS_REJECTED', 'Merged Cards cells are disallowed.');
  const shared = documents.get('xl/sharedStrings.xml');
  if (shared) requireRoot(shared, 'sst', [SPREADSHEET_NS, STRICT_SPREADSHEET_NS]);
  const sharedStrings = shared ? children(shared, 'si').map(richText) : [];
  if (sharedStrings.length > MAX_IMPORT_CELLS) throw HttpError.unprocessable('CELL_LIMIT_EXCEEDED', 'Workbook contains too many shared strings.');
  const data = children(worksheet, 'sheetData');
  if (data.length !== 1) throw invalidXml('Cards requires one sheetData element.');
  let headerMap: Map<number, StandardHeader> | null = null;
  const rows: ParsedImportRow[] = [];
  let previousRow = 0;
  if (data[0]!.children.some(n => n.ns !== worksheet.ns || n.name !== 'row')) throw invalidXml('Invalid sheetData child element.');
  for (const row of children(data[0]!, 'row')) {
    if (row.children.some(n => n.ns !== row.ns || !['c', 'extLst'].includes(n.name))) throw invalidXml('Invalid row child element.');
    checkBudget();
    const rowNumber = attr(row, 'r');
    const rowNum = rowNumber === undefined ? previousRow + 1 : Number(rowNumber);
    if (!Number.isInteger(rowNum) || rowNum <= previousRow || rowNum > 1_048_576 || (rowNumber !== undefined && !/^[1-9]\d*$/.test(rowNumber))) throw invalidXml('Invalid or duplicate worksheet row number.');
    previousRow = rowNum;
    const cells: RawCellData[] = [];
    const columns = new Set<number>();
    for (const cell of children(row, 'c')) {
      const ref = attr(cell, 'r')?.match(/^([A-Z]{1,3})([1-9]\d*)$/);
      if (!ref || Number(ref[2]) !== rowNum) throw invalidXml('Invalid worksheet cell reference.');
      const colLetter = ref[1]!, colIndex = colLettersToIndex(colLetter);
      if (columns.has(colIndex) || colIndex >= 16_384) throw invalidXml('Duplicate or invalid cell column.');
      columns.add(colIndex);
      const cellType = attr(cell, 't') ?? '';
      // Validate the whole cell before selecting its value. Filtering by name or
      // namespace alone would silently discard unsupported/mixed representations.
      const valueElement = cellType === 'inlineStr' ? 'is' : 'v';
      if (cell.text.trim() || cell.children.some(n => n.ns !== cell.ns || n.name !== valueElement)
          || cell.children.length > 1) throw invalidXml('Unsupported or mixed worksheet cell content.');
      const values = children(cell, 'v');
      if (values.some(v => v.children.length) || values.length > 1 || !['', 'n', 's', 'str', 'inlineStr', 'b', 'e', 'd'].includes(cellType)) throw invalidXml('Invalid worksheet cell representation.');
      let cellVal = values[0]?.text ?? '', isNumericRaw = false;
      if (cellType === 'inlineStr') {
        const inline = children(cell, 'is');
        if (inline.length > 1 || values.length) throw invalidXml('Invalid inline string cell.');
        cellVal = inline[0] ? richText(inline[0]) : '';
      } else if (cellType === 's' && values.length) {
        if (!/^\d+$/.test(cellVal) || Number(cellVal) >= sharedStrings.length) throw invalidXml('Invalid shared string index.');
        cellVal = sharedStrings[Number(cellVal)]!;
      } else if (cellType === 'b' && values.length) {
        if (!['0', '1'].includes(cellVal)) throw invalidXml('Invalid boolean cell.');
        cellVal = cellVal === '1' ? 'true' : 'false';
      } else if (cellType === '' || cellType === 'n') {
        cellVal = cellVal.trim();
        isNumericRaw = cellVal !== '' && Number.isFinite(Number(cellVal));
        if (cellVal && !isNumericRaw) throw invalidXml('Invalid numeric worksheet cell.');
      }
      const style = attr(cell, 's') ?? '0';
      if (!/^\d+$/.test(style)) throw invalidXml('Invalid cell style index.');
      cells.push({ colIndex, colLetter, type: cellType, isNumericRaw, dateStyled: dateStyles.has(Number(style)), value: cellVal });
    }

    // Row 1: Header Row
    if (!headerMap) {
      if (rowNum !== 1) throw HttpError.unprocessable('MISSING_REQUIRED_HEADER', 'Cards header must be row 1.');
      if (rowNum === 1) {
        headerMap = new Map();
        const seenHeaders = new Set<string>();

        for (const cell of cells) {
          const headerText = cell.value.trim();
          if (!headerText) continue;

          // Check if header is in allowed standard headers
          const matchedHeader = STANDARD_HEADERS.find(
            (sh) => sh.toLowerCase() === headerText.toLowerCase(),
          );

          if (!matchedHeader) {
            throw HttpError.unprocessable(
              'UNKNOWN_HEADER',
              `Unknown header in column ${cell.colLetter}: '${headerText}'. Allowed headers are: ${STANDARD_HEADERS.join(', ')}.`,
            );
          }

          if (seenHeaders.has(matchedHeader)) {
            throw HttpError.unprocessable(
              'DUPLICATE_HEADER',
              `Duplicate header in import: '${matchedHeader}'.`,
            );
          }

          seenHeaders.add(matchedHeader);
          headerMap.set(cell.colIndex, matchedHeader);
        }

        // Validate required headers: External ID and Title
        if (!seenHeaders.has('External ID')) {
          throw HttpError.unprocessable(
            'MISSING_REQUIRED_HEADER',
            "Missing required header: 'External ID'.",
          );
        }
        if (!seenHeaders.has('Title')) {
          throw HttpError.unprocessable(
            'MISSING_REQUIRED_HEADER',
            "Missing required header: 'Title'.",
          );
        }
        continue;
      }
    }

    if (!headerMap) continue;

    // Data Row: Extract fields by header
    let rawExternalId = '';
    let externalIdIsNumeric = false;
    let rawTitle = '';
    let rawDescription = '';
    let rawPriority = '';
    let rawDueDate = '';
    let dueDateIsSerial = false;
    let rawAssignees = '';
    let rawStatus = '';

    for (const cell of cells) {
      const header = headerMap.get(cell.colIndex);
      if (!header) {
        if (cell.value.trim()) throw HttpError.unprocessable('UNKNOWN_HEADER', 'Nonempty data requires a supported column header.');
        continue;
      }

      const val = cell.value;
      switch (header) {
        case 'External ID':
          rawExternalId = val;
          // Check if stored as numeric without text formatting
          externalIdIsNumeric = cell.isNumericRaw;
          break;
        case 'Title':
          rawTitle = val;
          break;
        case 'Description':
          rawDescription = val;
          break;
        case 'Priority':
          rawPriority = val;
          break;
        case 'Due Date':
          rawDueDate = val;
          dueDateIsSerial = cell.isNumericRaw && cell.dateStyled;
          if (cell.isNumericRaw && !cell.dateStyled) rawDueDate = '[general numeric cell]';
          break;
        case 'Assignees':
          rawAssignees = val;
          break;
        case 'Status':
          rawStatus = val;
          break;
      }
    }

    // Skip fully blank rows anywhere in the sheet
    const isBlank =
      !rawExternalId.trim() &&
      !rawTitle.trim() &&
      !rawDescription.trim() &&
      !rawPriority.trim() &&
      !rawDueDate.trim() &&
      !rawAssignees.trim() &&
      !rawStatus.trim();

    if (isBlank) {
      continue;
    }

    // Check row limit
    if (rows.length >= MAX_IMPORT_ROWS) {
      throw HttpError.unprocessable(
        'ROW_LIMIT_EXCEEDED',
        `Import exceeds maximum allowed limit of ${MAX_IMPORT_ROWS} nonempty rows.`,
      );
    }

    // Validate and collect errors
    const rawErrors: ImportRowError[] = [];

    // 1. External ID
    let externalId = rawExternalId.normalize('NFC').trim();
    if (externalIdIsNumeric) {
      rawErrors.push({
        field: 'externalId',
        code: 'NUMERIC_ID_REJECTED',
        message: 'Numeric External ID rejected. Format the External ID cell as Text in Excel to preserve leading zeros.',
      });
    } else if (!externalId) {
      rawErrors.push({
        field: 'externalId',
        code: 'REQUIRED',
        message: 'External ID is required.',
      });
    } else if (externalId.length > 64) {
      rawErrors.push({
        field: 'externalId',
        code: 'MAX_LENGTH_EXCEEDED',
        message: 'External ID cannot exceed 64 characters.',
      });
    }

    // 2. Title
    const title = rawTitle.trim();
    if (!title) {
      rawErrors.push({
        field: 'title',
        code: 'REQUIRED',
        message: 'Title is required.',
      });
    } else if (title.length > 200) {
      rawErrors.push({
        field: 'title',
        code: 'MAX_LENGTH_EXCEEDED',
        message: 'Title cannot exceed 200 characters.',
      });
    }

    // 3. Description
    const description = rawDescription;
    if (description.length > 20_000) {
      rawErrors.push({
        field: 'description',
        code: 'MAX_LENGTH_EXCEEDED',
        message: 'Description cannot exceed 20,000 characters.',
      });
    }

    // 4. Priority
    let priority: Priority = 'none';
    const normPriority = rawPriority.trim().toLowerCase();
    if (normPriority) {
      if (['none', 'low', 'medium', 'high', 'urgent'].includes(normPriority)) {
        priority = normPriority as Priority;
      } else {
        rawErrors.push({
          field: 'priority',
          code: 'INVALID_PRIORITY',
          message: `Priority '${rawPriority.trim()}' is invalid. Allowed: none, low, medium, high, urgent.`,
        });
      }
    }

    // 5. Due Date
    let dueDate: string | null = null;
    const trimmedDueDate = rawDueDate.trim();
    if (trimmedDueDate) {
      if (dueDateIsSerial) {
        try {
          const serialNum = parseFloat(trimmedDueDate);
          dueDate = excelSerialToIsoDate(serialNum, date1904);
        } catch (err) {
          rawErrors.push({
            field: 'dueDate',
            code: 'INVALID_DATE',
            message: err instanceof Error ? err.message : 'Invalid Excel date serial.',
          });
        }
      } else {
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDueDate) && isValidGregorianDate(trimmedDueDate)) {
          dueDate = trimmedDueDate;
        } else {
          rawErrors.push({
            field: 'dueDate',
            code: 'INVALID_DATE',
            message: 'Due date must be a valid Gregorian date in YYYY-MM-DD format or genuine Excel date.',
          });
        }
      }
    }

    // 6. Assignees
    const assigneeEmails: string[] = [];
    if (rawAssignees.trim()) {
      const parts = rawAssignees
        .split(';')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);

      const seenEmails = new Set<string>();
      for (const email of parts) {
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          assigneeEmails.push(email);
        }
      }

      if (assigneeEmails.length > 20) {
        rawErrors.push({
          field: 'assigneeEmails',
          code: 'ASSIGNEE_LIMIT_EXCEEDED',
          message: 'At most 20 distinct assignees are allowed per card.',
        });
      }

      for (const email of assigneeEmails) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          rawErrors.push({
            field: 'assigneeEmails',
            code: 'INVALID_EMAIL_FORMAT',
            message: `Invalid email address format: '${email}'.`,
          });
        }
      }
    }

    // 7. Status
    const status = rawStatus.trim() || null;

    rows.push({
      rowNumber: rowNum,
      externalId,
      externalIdIsNumeric,
      title,
      description,
      priority,
      dueDate,
      assigneeEmails,
      status,
      rawErrors,
    });
  }

  if (!headerMap) throw HttpError.unprocessable('MISSING_REQUIRED_HEADER', 'Cards requires its row 1 header.');
  checkBudget();
  return {
    sheetName: targetSheet.name,
    date1904,
    totalRows: rows.length,
    rows,
  };
}
