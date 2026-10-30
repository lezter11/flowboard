import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createPoller, describeAge, nextDelay, type TickResult } from '../src/lib/poller.ts';
import { reconcileDraft } from '../src/lib/draft-sync.ts';

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
function setup(results: TickResult[], extra: { visible?: () => boolean; held?: () => boolean } = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let runs = 0;
  const poller = createPoller({
    run: async () => results[Math.min(runs++, results.length - 1)]!,
    isVisible: extra.visible ?? (() => true),
    isHeld: extra.held,
    random: () => 0.5, // no jitter offset
    intervalMs: 15_000,
  });
  return { poller, runs: () => runs };
}
const tickBy = async (ms: number) => { mock.timers.tick(ms); await flush(); };

test('delay is 15 s +-20% jitter, doubling per failure up to 2 min', () => {
  const o = { intervalMs: 15_000, jitter: 0.2, maxBackoffMs: 120_000 };
  assert.equal(nextDelay(0, { ...o, random: () => 0 }), 12_000);
  assert.equal(nextDelay(0, { ...o, random: () => 1 }), 18_000);
  assert.equal(nextDelay(0, { ...o, random: () => 0.5 }), 15_000);
  assert.equal(nextDelay(1, { ...o, random: () => 0.5 }), 30_000);
  assert.equal(nextDelay(2, { ...o, random: () => 0.5 }), 60_000);
  assert.equal(nextDelay(3, { ...o, random: () => 0.5 }), 120_000);
  assert.equal(nextDelay(9, { ...o, random: () => 0.5 }), 120_000);
});

test('polls on the interval and records the last success', async () => {
  const { poller, runs } = setup(['ok']);
  poller.start();
  await tickBy(14_999); assert.equal(runs(), 0);
  await tickBy(1); assert.equal(runs(), 1);
  assert.notEqual(poller.state.lastSuccessAt, null);
  await tickBy(15_000); assert.equal(runs(), 2);
  poller.stop(); mock.timers.reset();
});

test('a hidden tab does not poll; becoming visible polls straight away', async () => {
  let visible = false;
  const { poller, runs } = setup(['ok'], { visible: () => visible });
  poller.start();
  await tickBy(60_000); assert.equal(runs(), 0);
  visible = true; poller.poke();
  await tickBy(0); assert.equal(runs(), 1);
  poller.stop(); mock.timers.reset();
});

test('failures back off x2 and success resets', async () => {
  const { poller, runs } = setup(['failed', 'failed', 'ok', 'ok']);
  poller.start();
  await tickBy(15_000); assert.equal(runs(), 1); assert.equal(poller.state.failures, 1);
  await tickBy(29_999); assert.equal(runs(), 1);
  await tickBy(1); assert.equal(runs(), 2); assert.equal(poller.state.failures, 2);
  await tickBy(59_999); assert.equal(runs(), 2);
  await tickBy(1); assert.equal(runs(), 3); assert.equal(poller.state.failures, 0);
  await tickBy(15_000); assert.equal(runs(), 4);
  poller.stop(); mock.timers.reset();
});

test('a signed-out result stops polling for good', async () => {
  const { poller, runs } = setup(['signedOut']);
  poller.start();
  await tickBy(15_000); assert.equal(runs(), 1); assert.equal(poller.state.stopped, true);
  poller.poke(); await tickBy(600_000); assert.equal(runs(), 1);
  mock.timers.reset();
});

test('poke after the user\'s own save waits ~1 s, and bursts share one run', async () => {
  const { poller, runs } = setup(['ok']);
  poller.start();
  poller.poke(1000); poller.poke(1000);
  await tickBy(999); assert.equal(runs(), 0);
  await tickBy(1); assert.equal(runs(), 1);
  poller.poke(); // inside the minimum gap
  await tickBy(500); assert.equal(runs(), 1);
  await tickBy(500); assert.equal(runs(), 2);
  poller.stop(); mock.timers.reset();
});

test('a held tick (drag in progress) is retried instead of run', async () => {
  let held = true;
  const { poller, runs } = setup(['ok'], { held: () => held });
  poller.start();
  await tickBy(15_000); assert.equal(runs(), 0);
  held = false;
  await tickBy(1000); assert.equal(runs(), 1);
  poller.stop(); mock.timers.reset();
});

test('age text', () => {
  assert.equal(describeAge(null, 1000), '');
  assert.equal(describeAge(0, 2000), 'Updated just now');
  assert.equal(describeAge(0, 12_000), 'Updated 10s ago');
  assert.equal(describeAge(0, 125_000), 'Updated 2 min ago');
});

// ---- drafts are never clobbered ----
const card = (o: Partial<Parameters<typeof reconcileDraft>[0]> = {}) => ({ title: 'A', description: 'd', priority: 'medium', dueDate: '', assigneeIds: [] as string[], columnId: 'c1', ...o });
test('untouched fields follow the server', () => {
  const r = reconcileDraft(card(), card({ title: 'B', columnId: 'c2' }), card());
  assert.deepEqual([r.draft.title, r.draft.columnId, r.conflict], ['B', 'c2', false]);
});
test('an edited field keeps the user\'s text and flags a conflict when the server changed it too', () => {
  const r = reconcileDraft(card(), card({ title: 'Server', description: 'new d' }), card({ title: 'Mine' }));
  assert.equal(r.draft.title, 'Mine'); assert.equal(r.draft.description, 'new d'); assert.equal(r.conflict, true);
});
test('no conflict when the server changed a different field than the one being edited', () => {
  const r = reconcileDraft(card(), card({ priority: 'high' }), card({ title: 'Mine' }));
  assert.deepEqual([r.draft.title, r.draft.priority, r.conflict], ['Mine', 'high', false]);
});
test('no conflict when the server arrived at the same text the user typed', () => {
  const r = reconcileDraft(card(), card({ title: 'Same' }), card({ title: 'Same' }));
  assert.equal(r.conflict, false);
});
test('assignee lists compare by content', () => {
  const r = reconcileDraft(card({ assigneeIds: ['a'] }), card({ assigneeIds: ['a', 'b'] }), card({ assigneeIds: ['a'] }));
  assert.deepEqual(r.draft.assigneeIds, ['a', 'b']);
});
