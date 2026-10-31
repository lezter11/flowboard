import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERROR_CATALOG, ERROR_DETAILS_SCHEMAS } from '@flowboard/contracts';

// ERR-R1 (S13). Static scan of apps/api/src: every error code literal in an HttpError call (constructor,
// static helpers, and validationError), and every `code: 'X'` in an error envelope, must be in the shared
// catalog. A missing code fails here, so the web catalogue and the API cannot drift silently.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const CODE = /^[A-Z][A-Z0-9_]{2,}$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The text inside the parentheses that open at openIdx, with string literals skipped for the balance count. */
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

function codeLiterals(text: string): string[] {
  return [...text.matchAll(/'([^'\\\n]*)'/g)].map((m) => m[1]!).filter((v) => CODE.test(v));
}

function scanCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    // new HttpError(status, 'CODE', ...)
    for (const m of src.matchAll(/new HttpError\(/g)) {
      const args = argumentsOf(src, m.index! + 'new HttpError'.length);
      for (const c of codeLiterals(args.split(',')[1] ?? '')) found.add(c);
    }
    // HttpError.helper(...): the code may be the first or the second argument
    for (const m of src.matchAll(/HttpError\.(\w+)\(/g)) {
      for (const c of codeLiterals(argumentsOf(src, m.index! + 'HttpError.'.length + m[1]!.length))) found.add(c);
    }
    // validationError(...) is always VALIDATION_ERROR, and may carry a literal code too
    for (const m of src.matchAll(/(?<![\w.])validationError\(/g)) {
      found.add('VALIDATION_ERROR');
      for (const c of codeLiterals(argumentsOf(src, m.index! + 'validationError'.length))) found.add(c);
    }
    // envelope literals: { error: { code: 'CODE' } }
    for (const m of src.matchAll(/code:\s*'([A-Z][A-Z0-9_]{2,})'/g)) found.add(m[1]!);
  }
  return found;
}

test('ERR-R1 S13: every error code the API throws is in the shared catalog', () => {
  const found = scanCodes();
  assert.ok(found.size >= 100, `the scan found ${found.size} codes; a smaller number means the scan is broken`);
  const missing = [...found].filter((code) => !(code in ERROR_CATALOG));
  assert.deepEqual(missing, [], `codes thrown by apps/api/src but missing from packages/contracts ERROR_CATALOG`);
});

test('ERR-R1 S13: every catalog entry that carries details has a details schema', () => {
  for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
    if (meta.hasDetails) assert.ok(ERROR_DETAILS_SCHEMAS[code as keyof typeof ERROR_CATALOG], `${code} has details but no schema`);
  }
});
