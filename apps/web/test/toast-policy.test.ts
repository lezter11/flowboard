import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESUME_MS, SUCCESS_MS, UNDO_MS, toastLifetime, toastRegion } from '../src/lib/toast-policy.ts';

test('failures and toasts with a remedy never time out; success keeps 4.5 s; undo 8 s', () => {
  assert.equal(toastLifetime({ tone: 'danger' }), null);
  assert.equal(toastLifetime({ action: { label: 'Try again' } }), null);
  assert.equal(toastLifetime({ tone: 'danger', undo: () => {} }), null);
  assert.equal(toastLifetime({}), SUCCESS_MS);
  assert.equal(toastLifetime({ undo: () => {} }), UNDO_MS);
  assert.equal(SUCCESS_MS, 4500);
  assert.ok(RESUME_MS > 0);
});

test('failures are announced assertively, the rest politely', () => {
  assert.equal(toastRegion({ tone: 'danger' }), 'assertive');
  assert.equal(toastRegion({}), 'polite');
});

test('the toast pauses on focus as well as hover, and has a separate alert region', () => {
  const t = readFileSync(new URL('../src/components/ui/toasts.tsx', import.meta.url), 'utf8');
  assert.match(t, /onFocus=\{pause\}/);
  assert.match(t, /onBlur=\{resume\}/);
  assert.match(t, /role="alert" aria-live="assertive"/);
  assert.match(t, /role="status" aria-live="polite"/);
});

test('every danger toast goes through the catalogue helper, so none shows server text', () => {
  for (const f of ['../src/app/inbox/page.tsx', '../src/app/trash/page.tsx', '../src/components/board/board-view.tsx', '../src/components/board/card-detail-drawer.tsx']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /tone: 'danger'/, f);
  }
});
