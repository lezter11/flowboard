import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERROR_CATALOG, ERROR_DETAILS_SCHEMAS } from '@flowboard/contracts';

// ERR-R1 (S13) and ERR-R1b. Static scan of apps/api/src. Every error code that reaches HttpError or an error
// envelope must be in the shared catalog. A code is either a string literal ('NOT_FOUND') or an identifier that
// resolves to a constant (NAME_REQUIRED_CODE, from packages/contracts or apps/api). An identifier that does not
// resolve fails the test, so a constant cannot hide a code from the scan.

const API_SRC = fileURLToPath(new URL('../src/', import.meta.url));
const CONTRACTS_SRC = fileURLToPath(new URL('../../../packages/contracts/src/', import.meta.url));
const UPPER = /^[A-Z][A-Z0-9_]{2,}$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every `const NAME = 'VALUE'` in the API and the contracts, so an imported constant resolves. */
function constantValues(): Map<string, string> {
  const map = new Map<string, string>();
  for (const dir of [API_SRC, CONTRACTS_SRC]) {
    for (const file of sourceFiles(dir)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([A-Z][A-Z0-9_]+)'/g)) map.set(m[1]!, m[2]!);
    }
  }
  return map;
}

/** The text inside the parentheses that open at openIdx, skipping string literals in the balance count. */
function argumentsOf(src: string, openIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return '';
}

/** Splits an argument list on top-level commas (not inside brackets or strings). */
function topLevelArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\') current += text[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

interface ScanResult {
  codes: Set<string>;
  unresolved: string[];
}

function scanCodes(constants: Map<string, string>): ScanResult {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  /** Records the code an argument stands for, if it is a code at all. */
  const take = (arg: string | undefined, file: string) => {
    if (!arg) return;
    const literal = /^'([A-Z][A-Z0-9_]+)'$/.exec(arg);
    if (literal) return void codes.add(literal[1]!);
    if (/^[A-Z][A-Z0-9_]+$/.test(arg)) {
      const value = constants.get(arg);
      if (value) codes.add(value);
      else unresolved.push(`${path.relative(API_SRC, file)}: ${arg}`);
    }
  };
  for (const file of sourceFiles(API_SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    // new HttpError(status, CODE, message, details?)
    for (const m of src.matchAll(/new HttpError\(/g)) {
      const args = topLevelArgs(argumentsOf(src, m.index! + 'new HttpError'.length));
      take(args[1], file);
    }
    // HttpError.helper(CODE, message) or HttpError.helper(message, CODE): the code is one of the first two
    for (const m of src.matchAll(/HttpError\.(\w+)\(/g)) {
      const args = topLevelArgs(argumentsOf(src, m.index! + 'HttpError.'.length + m[1]!.length));
      take(args[0], file);
      take(args[1], file);
    }
    // validationError(message, details?) is VALIDATION_ERROR; a literal code may also be passed
    for (const m of src.matchAll(/(?<![\w.])validationError\(/g)) {
      codes.add('VALIDATION_ERROR');
      const args = topLevelArgs(argumentsOf(src, m.index! + 'validationError'.length));
      take(args[0], file);
      take(args[1], file);
    }
    // error envelopes: { error: { code: 'X' } } or { code: CONSTANT }
    for (const m of src.matchAll(/code:\s*('[A-Z][A-Z0-9_]+'|[A-Z][A-Z0-9_]+)\s*[,}]/g)) take(m[1], file);
  }
  return { codes, unresolved: [...new Set(unresolved)] };
}

test('ERR-R1 S13 and ERR-R1b: every error code the API throws is in the shared catalog', (t) => {
  const { codes, unresolved } = scanCodes(constantValues());
  t.diagnostic(`scan found ${codes.size} codes, ${unresolved.length} unresolved identifiers`);
  assert.deepEqual(unresolved, [], 'every constant used as an error code must resolve to a value');
  assert.ok(codes.size >= 100, `the scan found ${codes.size} codes; a smaller number means the scan is broken`);
  const missing = [...codes].filter((code) => !(code in ERROR_CATALOG)).sort();
  assert.deepEqual(missing, [], 'codes thrown by apps/api/src but missing from packages/contracts ERROR_CATALOG');
});

test('ERR-R1 S13: every catalog entry that carries details has a details schema', () => {
  for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
    if (meta.hasDetails) assert.ok(ERROR_DETAILS_SCHEMAS[code as keyof typeof ERROR_CATALOG], `${code} has details but no schema`);
  }
});

export { scanCodes, constantValues };
