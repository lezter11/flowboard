import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const src = files(root).filter((f) => /\.(tsx?)$/.test(f));

test('no screen renders an ApiError message: only the catalogue speaks', () => {
  const offenders: string[] = [];
  for (const f of src) {
    if (/lib\/(api|image-prepare|error-catalogue)\.ts$/.test(f) || /signin\/page\.tsx$/.test(f)) continue; // dev sign-in is compiled out of production
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => { if (/\b(err|error|e)\.message\b/.test(line) && !/PrepareError|row\.|first\.message|result\.message|\.issues/.test(line)) offenders.push(`${f.replace(root, '')}:${i + 1}`); });
  }
  assert.deepEqual(offenders, []);
});

test('ErrorNote is an alert, takes catalogue text, and shows a reference only when the note carries one', () => {
  const note = readFileSync(join(root, 'components/ui/error-note.tsx'), 'utf8');
  assert.match(note, /role="alert"/);
  assert.match(note, /describeFailure\(error, ctx\)/);
  assert.match(note, /\{d\.reference && \(/);
  assert.match(note, /aria-label="Copy the reference"/);
  assert.doesNotMatch(note, /\.message/);
});

test('dialogs and forms show failures through ErrorNote', () => {
  for (const f of ['components/ui/new-board-dialog.tsx', 'components/project/new-project-dialog.tsx', 'components/ui/invite-dialog.tsx', 'app/settings/page.tsx']) {
    assert.match(readFileSync(join(root, f), 'utf8'), /<ErrorNote/, f);
  }
});
