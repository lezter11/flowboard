import assert from 'node:assert/strict';
import test from 'node:test';
import { createInertLock, pickFocusTarget, type InertTarget } from '../src/lib/inert-lock.ts';

function fake(initiallyInert = false): InertTarget & { inert: boolean } {
  const el = { inert: initiallyInert, hasAttribute: (n: string) => n === 'inert' && el.inert, setAttribute: (n: string) => { if (n === 'inert') el.inert = true; }, removeAttribute: (n: string) => { if (n === 'inert') el.inert = false; } };
  return el;
}

test('region is inert while a dialog is open and restored on close', () => {
  const lock = createInertLock(); const app = fake();
  const release = lock.acquire(app);
  assert.equal(app.inert, true);
  release();
  assert.equal(app.inert, false);
});
test('nested dialogs keep it inert until the last one closes', () => {
  const lock = createInertLock(); const app = fake();
  const a = lock.acquire(app); const b = lock.acquire(app);
  a(); assert.equal(app.inert, true);
  b(); assert.equal(app.inert, false);
});
test('releasing twice (unmount after close) does not unbalance the count', () => {
  const lock = createInertLock(); const app = fake();
  const a = lock.acquire(app); const b = lock.acquire(app);
  a(); a(); assert.equal(app.inert, true); assert.equal(lock.holders, 1);
  b(); assert.equal(app.inert, false);
});
test('an already-inert region is left as it was', () => {
  const lock = createInertLock(); const app = fake(true);
  lock.acquire(app)(); assert.equal(app.inert, true);
});
test('a missing region is a no-op', () => {
  const lock = createInertLock(); lock.acquire(null)(); assert.equal(lock.holders, 0);
});

const node = (isConnected: boolean) => ({ isConnected });
test('focus goes to the remembered trigger, then the card button, then the board heading', () => {
  const trigger = node(true), button = node(true), heading = node(true);
  assert.equal(pickFocusTarget(trigger, () => button, () => heading), trigger);
  assert.equal(pickFocusTarget(null, () => button, () => heading), button);
  assert.equal(pickFocusTarget(node(false), () => button, () => heading), button);
  assert.equal(pickFocusTarget(null, () => null, () => heading), heading);
  assert.equal(pickFocusTarget(null, () => node(false), () => null), null);
});
