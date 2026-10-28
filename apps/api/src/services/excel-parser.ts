import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { isValidGregorianDate, type Priority } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';

export const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_EXPANDED_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_IMPORT_ROWS = 200;

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
      `Workbook upload of ${buffer.length} bytes exceeds maximum allowed size of ${MAX_COMPRESSED_BYTES} bytes (5 MiB).`,
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

  if (totalEntries > 100) {
    throw HttpError.unprocessable(
      'INVALID_WORKBOOK',
      'Invalid workbook package: exceeds maximum allowed entry count.',
    );
  }

  const files = new Map<string, Buffer>();
  let totalExpandedBytes = 0;
  let offset = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        'Invalid workbook package: corrupted central directory entry.',
      );
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLen);
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

    if (dataEnd > buffer.length) {
      throw HttpError.unprocessable(
        'INVALID_WORKBOOK',
        'Invalid workbook package: compressed data segment overflow.',
      );
    }

    const compressedData = buffer.subarray(dataStart, dataEnd);
    let uncompressedData: Buffer;

    if (method === 0) {
      uncompressedData = Buffer.from(compressedData);
    } else if (method === 8) {
      try {
        uncompressedData = zlib.inflateRawSync(compressedData);
      } catch {
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

    totalExpandedBytes += uncompressedData.length;
    if (totalExpandedBytes > MAX_EXPANDED_BYTES) {
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Expanded workbook XML content exceeds maximum allowed size of ${MAX_EXPANDED_BYTES} bytes (20 MiB).`,
      );
    }

    files.set(fileName, uncompressedData);
  }

  return files;
}

/**
 * Checks for XML External Entity (XXE) declarations.
 */
function assertNoXXE(xml: string, fileName: string): void {
  const upper = xml.toUpperCase();
  if (upper.includes('<!DOCTYPE') || upper.includes('<!ENTITY')) {
    throw HttpError.unprocessable(
      'XXE_DETECTED',
      `XML External Entity (XXE) declaration detected in ${fileName}. Entity declarations are strictly disallowed.`,
    );
  }
}

/**
 * Unescapes standard XML entities and numeric entities.
 */
export function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

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

/**
 * Parses shared strings XML into an array of string values.
 */
function parseSharedStrings(xml: string): string[] {
  assertNoXXE(xml, 'xl/sharedStrings.xml');

  const strings: string[] = [];
  const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let siMatch: RegExpExecArray | null;

  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1]!;
    const tRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tMatch: RegExpExecArray | null;
    let strVal = '';
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      strVal += tMatch[1]!;
    }
    strings.push(unescapeXml(strVal));
  }

  return strings;
}

interface RawCellData {
  colIndex: number;
  colLetter: string;
  type: string;
  isNumericRaw: boolean;
  value: string;
}

/**
 * Pure TypeScript Excel Parser for Flowboard Card Import Engine.
 */
export function parseExcelWorkbook(fileBuffer: Buffer): ParseExcelResult {
  const files = unzipXlsx(fileBuffer);

  // 1. Read xl/workbook.xml
  const workbookXmlBuf = files.get('xl/workbook.xml');
  if (!workbookXmlBuf) {
    throw HttpError.unprocessable(
      'INVALID_WORKBOOK',
      'Invalid workbook package: missing xl/workbook.xml.',
    );
  }
  const workbookXml = workbookXmlBuf.toString('utf8');
  assertNoXXE(workbookXml, 'xl/workbook.xml');

  // Check 1904 date system
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbookXml);

  // Check sheets
  const sheetTagRegex = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
  let sheetMatch: RegExpExecArray | null;
  const sheetList: Array<{ name: string; rId: string }> = [];

  while ((sheetMatch = sheetTagRegex.exec(workbookXml)) !== null) {
    const attrs = sheetMatch[1]!;
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const rIdMatch = attrs.match(/\b(?:r:id|id)="([^"]+)"/i);
    if (nameMatch && rIdMatch) {
      sheetList.push({ name: nameMatch[1]!, rId: rIdMatch[1]! });
    }
  }

  if (sheetList.length === 0) {
    throw HttpError.unprocessable(
      'EMPTY_WORKBOOK',
      'Workbook contains no worksheets.',
    );
  }

  // Only Cards and optional Instructions worksheets are allowed in v1
  for (const sheet of sheetList) {
    const lowerName = sheet.name.trim().toLowerCase();
    if (lowerName !== 'cards' && lowerName !== 'instructions') {
      throw HttpError.unprocessable(
        'UNSUPPORTED_WORKSHEET',
        `Workbook contains unsupported worksheet '${sheet.name}'. Only 'Cards' and optional 'Instructions' are allowed.`,
      );
    }
  }

  // Select Cards worksheet (or fallback to first worksheet that isn't Instructions)
  let targetSheet = sheetList.find((s) => s.name.trim().toLowerCase() === 'cards');
  if (!targetSheet) {
    targetSheet = sheetList.find((s) => s.name.trim().toLowerCase() !== 'instructions');
  }
  if (!targetSheet) {
    throw HttpError.unprocessable(
      'CARDS_SHEET_NOT_FOUND',
      "Workbook is missing required 'Cards' worksheet.",
    );
  }

  // 2. Resolve target sheet file path from xl/_rels/workbook.xml.rels
  const relsXmlBuf = files.get('xl/_rels/workbook.xml.rels');
  let worksheetRelPath = 'xl/worksheets/sheet1.xml';

  if (relsXmlBuf) {
    const relsXml = relsXmlBuf.toString('utf8');
    assertNoXXE(relsXml, 'xl/_rels/workbook.xml.rels');

    const relRegex = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      const attrs = relMatch[1]!;
      const idMatch = attrs.match(/\bId="([^"]+)"/i);
      const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
      if (idMatch && targetMatch && idMatch[1] === targetSheet.rId) {
        let t = targetMatch[1]!;
        if (t.startsWith('/')) t = t.slice(1);
        if (!t.startsWith('xl/')) t = 'xl/' + t;
        worksheetRelPath = t;
        break;
      }
    }
  }

  const worksheetXmlBuf = files.get(worksheetRelPath);
  if (!worksheetXmlBuf) {
    throw HttpError.unprocessable(
      'WORKSHEET_NOT_FOUND',
      `Worksheet XML not found at ${worksheetRelPath}.`,
    );
  }
  const worksheetXml = worksheetXmlBuf.toString('utf8');
  assertNoXXE(worksheetXml, worksheetRelPath);

  // 3. Security: Check for formula evaluations in Cards worksheet
  if (/<(?:\w+:)?f\b[^>]*>/i.test(worksheetXml)) {
    throw HttpError.unprocessable(
      'FORMULA_REJECTED',
      'Formulas and calculated cells are strictly disallowed in the import template.',
    );
  }

  // 4. Parse shared strings if present
  let sharedStrings: string[] = [];
  const sharedStringsXmlBuf = files.get('xl/sharedStrings.xml');
  if (sharedStringsXmlBuf) {
    sharedStrings = parseSharedStrings(sharedStringsXmlBuf.toString('utf8'));
  }

  // 5. Parse sheet rows
  const rowRegex = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;

  let headerMap: Map<number, StandardHeader> | null = null;
  const rows: ParsedImportRow[] = [];

  while ((rowMatch = rowRegex.exec(worksheetXml)) !== null) {
    const rowAttrs = rowMatch[1]!;
    const rowContent = rowMatch[2]!;
    const rAttr = rowAttrs.match(/\br="(\d+)"/i);
    const rowNum = rAttr ? parseInt(rAttr[1]!, 10) : rows.length + (headerMap ? 2 : 1);

    // Parse cells inside this row
    const cellRegex = /<(?:\w+:)?c\b([^>]*)>(?:([\s\S]*?)<\/(?:\w+:)?c>)?/g;
    let cMatch: RegExpExecArray | null;
    const cells: RawCellData[] = [];

    while ((cMatch = cellRegex.exec(rowContent)) !== null) {
      const cAttrs = cMatch[1]!;
      const cInner = cMatch[2] ?? '';

      const cellRefMatch = cAttrs.match(/\br="([A-Z]+)(\d+)"/i);
      if (!cellRefMatch) continue;

      const colLetter = cellRefMatch[1]!.toUpperCase();
      const colIndex = colLettersToIndex(colLetter);

      const typeMatch = cAttrs.match(/\bt="([^"]+)"/i);
      const cellType = typeMatch ? typeMatch[1]!.toLowerCase() : '';

      // Extract value
      let cellVal = '';
      let isNumericRaw = false;

      if (cellType === 'inlineStr') {
        const isMatch = cInner.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
        if (isMatch) cellVal = unescapeXml(isMatch[1]!);
      } else {
        const vMatch = cInner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
        if (vMatch) {
          const rawV = vMatch[1]!.trim();
          if (cellType === 's') {
            const strIdx = parseInt(rawV, 10);
            cellVal = sharedStrings[strIdx] ?? '';
          } else if (cellType === 'str') {
            cellVal = unescapeXml(rawV);
          } else if (cellType === 'b') {
            cellVal = rawV === '1' ? 'true' : 'false';
          } else {
            // Numeric or raw literal
            cellVal = rawV;
            isNumericRaw = !isNaN(Number(rawV)) && rawV !== '';
          }
        }
      }

      cells.push({
        colIndex,
        colLetter,
        type: cellType,
        isNumericRaw,
        value: cellVal,
      });
    }

    // Row 1: Header Row
    if (!headerMap) {
      if (rowNum === 1 || rows.length === 0) {
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
      if (!header) continue;

      const val = cell.value;
      switch (header) {
        case 'External ID':
          rawExternalId = val;
          // Check if stored as numeric without text formatting
          externalIdIsNumeric = cell.isNumericRaw && cell.type !== 's' && cell.type !== 'str' && cell.type !== 'inlineStr';
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
          dueDateIsSerial = cell.isNumericRaw;
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
    const description = rawDescription.trim();
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

  return {
    sheetName: targetSheet.name,
    date1904,
    totalRows: rows.length,
    rows,
  };
}
