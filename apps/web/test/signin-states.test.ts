import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNIN_STATES, signinNote } from '../src/lib/signin-states.ts';
import { hasUnsaved, resetUnsavedForTests, setUnsaved, subscribeUnsaved } from '../src/lib/unsaved.ts';

test('every new sign-in state has plain copy that follows the style guide', () => {
  for (const s of ['denied', 'expired', 'failed', 'email_unverified', 'email_missing']) {
    const n = signinNote(s)!;
    assert.ok(n && n.title && n.body, s);
    assert.doesNotMatch(n.title + n.body, /please|successfully|!|JSON|error code/i, s);
    for (const sentence of n.body.split(/(?<=[.?])\s+/)) assert.ok(sentence.split(/\s+/).length <= 25, s);
  }
  assert.ok(SIGNIN_STATES.includes('session_ended'));
});

test('unknown or crafted states show nothing, so a link cannot put words on the page', () => {
  assert.equal(signinNote('<script>alert(1)</script>'), null);
  assert.equal(signinNote('__proto__'), null);
  assert.equal(signinNote('constructor'), null);
  assert.equal(signinNote(null), null);
});

test('unsaved text is tracked and announced to subscribers', () => {
  resetUnsavedForTests();
  let calls = 0;
  const off = subscribeUnsaved(() => { calls += 1; });
  assert.equal(hasUnsaved(), false);
  setUnsaved('card:1', true); setUnsaved('card:1', true);
  assert.equal(hasUnsaved(), true);
  assert.equal(calls, 1);
  setUnsaved('add-card', true); setUnsaved('card:1', false);
  assert.equal(hasUnsaved(), true);
  setUnsaved('add-card', false);
  assert.equal(hasUnsaved(), false);
  off();
});

test('a session that ends keeps the page while text is unsaved, and offers Sign in', () => {
  const gate = readFileSync(new URL('../src/components/shell/session-gate.tsx', import.meta.url), 'utf8');
  assert.match(gate, /!hasUnsaved\(\)/);
  const shell = readFileSync(new URL('../src/components/shell/app-shell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /state\.status === 'signedOut' && unsaved/);
  assert.match(shell, /I’ve signed in/);
  const drawer = readFileSync(new URL('../src/components/board/card-detail-drawer.tsx', import.meta.url), 'utf8');
  assert.match(drawer, /setUnsaved\(`card:\$\{card\.id\}`, dirty\)/);
  const signin = readFileSync(new URL('../src/app/signin/page.tsx', import.meta.url), 'utf8');
  assert.match(signin, /signinNote\(params\.get\('state'\)\)/);
  assert.doesNotMatch(signin, /ask the project owner or manager/i);
});

test('a failed save with an ended session offers Sign in and keeps the draft in place', async () => {
  const { describeFailureOf } = await import('../src/lib/error-catalogue.ts');
  const d = describeFailureOf({ status: 401, code: 'UNAUTHORIZED' });
  assert.equal(d.action?.kind, 'signin');
  assert.match(d.body, /unsaved text stays on this page/);
});
