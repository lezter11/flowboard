import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GREETINGS, createTapCounter, invitationSignInHref, motionAllowed, pickGreeting, signedInAsLine } from '../src/lib/invitation-fx.ts';

test('signed-in-as line shows the viewer own address, and nothing when unknown', () => {
  assert.equal(signedInAsLine(' me@example.com '), 'Signed in as me@example.com');
  assert.equal(signedInAsLine(''), null);
  assert.equal(signedInAsLine(undefined), null);
});

test('easter eggs and motion are off under reduced motion', () => {
  assert.equal(motionAllowed(true), false);
  assert.equal(motionAllowed(false), true);
});

test('tap counter fires on the 5th quick tap, not on slow taps', () => {
  let t = 0;
  const c = createTapCounter({ now: () => t });
  const fired = [0, 100, 200, 300, 400].map((x) => { t = x; return c.tap(); });
  assert.deepEqual(fired, [false, false, false, false, true]);
  const slow = createTapCounter({ now: () => t });
  const results = [0, 3000, 6000, 9000, 12000].map((x) => { t = x; return slow.tap(); });
  assert.ok(results.every((r) => !r));
});

test('greeting is always one of the list, even for bad input', () => {
  for (const r of [0, 0.5, 0.999, 1, -1, NaN]) assert.ok(GREETINGS.includes(pickGreeting(r)));
});

test('sign-in returns to the same invitation link', () => {
  const href = invitationSignInHref('tok/en');
  assert.equal(new URL(href, 'http://x').searchParams.get('next'), '/invitation?token=tok/en');
  assert.equal(invitationSignInHref(null), '/signin');
});

test('all invitation animation sits inside no-preference, with a reduce fallback', () => {
  const css = readFileSync(new URL('../src/styles/invitation.css', import.meta.url), 'utf8');
  const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, '');
  assert.ok(!/animation\s*:/.test(outside.replace(/@keyframes[\s\S]*?\n\}\n/g, '')), 'animation declared outside the no-preference block');
  assert.match(css, /prefers-reduced-motion: reduce/);
});

import { acceptedCopy, roleWithArticle } from '../src/lib/invitation-fx.ts';

test('the role reads with the right article', () => {
  assert.equal(roleWithArticle('member'), 'a member');
  assert.equal(roleWithArticle('manager'), 'a manager');
  assert.equal(roleWithArticle('viewer'), 'a viewer');
  assert.equal(roleWithArticle('owner'), 'an owner');
});

test('post-accept copy by role names no project and drops the pre-accept footer', () => {
  for (const role of ['member', 'manager', 'viewer']) {
    const c = acceptedCopy(role);
    assert.match(c.lead, new RegExp(`as a ${role}\\.`));
    assert.doesNotMatch(c.footer, /Before you accept/);
    assert.match(c.note, /Owner/);
  }
});
