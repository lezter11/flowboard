import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkName, initialName } from '../src/lib/name-form.ts';

test('a valid name is normalised the same way the API does', () => {
  const r = checkName('  Priya ', 'Van   Der Berg');
  assert.equal(r.ok, true);
  assert.equal(r.firstName, 'Priya');
  assert.equal(r.lastName, 'Van Der Berg');
});

test('empty and whitespace-only parts give a plain "enter" message per field', () => {
  const r = checkName('', '   ');
  assert.equal(r.ok, false);
  assert.match(r.errors.firstName ?? '', /Enter your first name/);
  assert.match(r.errors.lastName ?? '', /Enter your last name/);
});

test('over 60 characters is refused with the limit named', () => {
  const r = checkName('a'.repeat(61), 'Ok');
  assert.equal(r.ok, false);
  assert.match(r.errors.firstName ?? '', /up to 60/);
  assert.equal(r.errors.lastName, undefined);
});

test('exactly 60 characters is accepted', () => {
  assert.equal(checkName('a'.repeat(60), 'b'.repeat(60)).ok, true);
});

test('zero-width, bidi and control characters are refused', () => {
  for (const bad of ['Pri​ya', 'Pri‮ya', 'Pri\nya']) {
    const r = checkName(bad, 'Ok');
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.errors.firstName ?? '', /character we cannot use/);
  }
});

test('suggestions prefill, and nothing else does', () => {
  assert.deepEqual(initialName({ suggestedFirstName: 'Priya', suggestedLastName: null }), { first: 'Priya', last: '' });
  assert.deepEqual(initialName({}), { first: '', last: '' });
});

test('name step animation sits inside no-preference', () => {
  const css = readFileSync(new URL('../src/styles/identity.css', import.meta.url), 'utf8');
  const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, '').replace(/@keyframes[\s\S]*?\n\}\n/g, '');
  assert.ok(!/animation\s*:|transition\s*:/.test(outside));
});

test('name errors are announced: both inline error paragraphs are alerts and stay tied to their inputs', () => {
  const src = readFileSync(new URL('../src/components/auth/name-step.tsx', import.meta.url), 'utf8');
  assert.match(src, /id="nameFirstError" role="alert"/);
  assert.match(src, /id="nameLastError" role="alert"/);
  assert.match(src, /aria-describedby=\{showFirst \? 'nameFirstError' : undefined\}/);
  assert.match(src, /aria-describedby=\{showLast \? 'nameLastError' : undefined\}/);
  assert.match(src, /aria-invalid=\{showFirst \? true : undefined\}/);
});
