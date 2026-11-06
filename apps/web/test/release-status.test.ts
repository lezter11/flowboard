import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createReleaseStatusController, readReleaseStatus } from '../src/lib/release-status.ts';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const tick = async (ms: number) => { mock.timers.tick(ms); await flush(); };

test('status accepts exactly one active boolean and never arbitrary payload fields', async () => {
  for (const active of [true, false]) assert.equal(await readReleaseStatus(Response.json({ active }), new AbortController().signal), active);
  for (const value of [{}, [], null, { active: 'true' }, { active: 1 }, { active: true, message: '<script>private</script>' }]) {
    await assert.rejects(readReleaseStatus(Response.json(value), new AbortController().signal));
  }
  await assert.rejects(readReleaseStatus(new Response('{'), new AbortController().signal));
  await assert.rejects(readReleaseStatus(new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }), new AbortController().signal));
  await assert.rejects(readReleaseStatus(Response.json({ active: false }, { status: 503 }), new AbortController().signal));
  await assert.rejects(readReleaseStatus(new Response('{"active":false}', { headers: { 'content-type': 'text/html' } }), new AbortController().signal));
  for (const status of [404, 410]) assert.equal(await readReleaseStatus(new Response('legacy absent', { status }), new AbortController().signal), false);
});

test('rollback absence404/410 clears active, while HTML200 and all other failed statuses retain active', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const states: boolean[] = [];
  const answers = [Response.json({ active: true }), new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }),
    ...[400, 401, 403, 429, 500, 503].map(status => new Response('', { status })),
    new Response('', { status: 404 }), Response.json({ active: true }), new Response('', { status: 410 })];
  const controller = createReleaseStatusController({ fetcher: async () => answers.shift()!, isVisible: () => true, onActive: active => states.push(active) });
  t.after(() => { controller.stop(); mock.timers.reset(); });
  controller.start(); await tick(0);
  for (let index = 0; index < 7; index++) await tick(30_000);
  assert.deepEqual(states, [true]);
  await tick(30_000); assert.deepEqual(states, [true, false]);
  await tick(30_000); await tick(30_000); assert.deepEqual(states, [true, false, true, false]);
});

test('declared and streamed bodies are bounded and an aborted slow reader cancels', async () => {
  const headers = { 'content-type': 'application/json' };
  await assert.rejects(readReleaseStatus(new Response('{"active":true}', { headers: { ...headers, 'content-length': '1025' } }), new AbortController().signal));
  let canceled = 0;
  await assert.rejects(readReleaseStatus(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1025)); }, cancel() { canceled++; } }), { headers }), new AbortController().signal));
  assert.equal(canceled, 1);
  const abort = new AbortController();
  const pending = readReleaseStatus(new Response(new ReadableStream({ cancel() { canceled++; } }), { headers }), abort.signal);
  abort.abort();
  await assert.rejects(pending);
  assert.equal(canceled, 2);
  await assert.rejects(readReleaseStatus(new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); }, cancel() { canceled++; } }), { headers }), new AbortController().signal));
  assert.equal(canceled, 3, 'Empty chunks cannot spin indefinitely before the timeout task runs');
});

test('polls one static unauthenticated asset every30s and retains active through invalid/error responses', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const states: boolean[] = [], calls: Array<[string, RequestInit]> = [];
  const answers = [() => Response.json({ active: true }), () => Response.json({ active: 'false' }), () => { throw new Error('synthetic'); }, () => Response.json({ active: false })];
  const controller = createReleaseStatusController({
    fetcher: async (url, init) => { calls.push([url, init]); return answers[calls.length - 1]!(); },
    isVisible: () => true, onActive: active => states.push(active),
  });
  t.after(() => { controller.stop(); mock.timers.reset(); });
  controller.start(); await tick(0);
  assert.deepEqual(states, [true]);
  await tick(29_999); assert.equal(calls.length, 1);
  await tick(1); assert.deepEqual(states, [true]);
  await tick(30_000); assert.deepEqual(states, [true]);
  await tick(30_000); assert.deepEqual(states, [true, false]);
  for (const [url, init] of calls) {
    assert.equal(url, '/release-status.json');
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.body, undefined); assert.equal(init.headers, undefined);
  }
});

test('hidden tabs pause, abort work, and refresh once on visibility return; stopped controllers never publish', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let visible = false;
  const states: boolean[] = [], signals: AbortSignal[] = [];
  let finish: ((value: Response) => void) | undefined;
  const controller = createReleaseStatusController({ isVisible: () => visible, onActive: value => states.push(value),
    fetcher: async (_url, init) => { signals.push(init.signal as AbortSignal); return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => { controller.stop(); mock.timers.reset(); });
  controller.start(); await tick(90_000); assert.equal(signals.length, 0);
  visible = true; controller.visibilityChanged(); controller.visibilityChanged(); await tick(0);
  assert.equal(signals.length, 1);
  visible = false; controller.visibilityChanged(); assert.equal(signals[0]!.aborted, true);
  visible = true; controller.visibilityChanged(); await tick(30_000);
  assert.equal(signals.length, 1, 'An abort-ignoring fetch must not overlap its replacement');
  finish!(Response.json({ active: true })); await flush(); await tick(0);
  assert.equal(signals.length, 2); assert.deepEqual(states, []);
  controller.stop(); assert.equal(signals[1]!.aborted, true);
  finish!(Response.json({ active: true })); await flush(); await tick(90_000);
  assert.equal(signals.length, 2); assert.deepEqual(states, []);
});

test('request timeout aborts after5s, never overlaps a hung fetch, and starts inactive', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const states: boolean[] = [], signals: AbortSignal[] = [];
  const controller = createReleaseStatusController({ isVisible: () => true, onActive: active => states.push(active),
    fetcher: async (_url, init) => { signals.push(init.signal as AbortSignal); return new Promise(() => {}); } });
  t.after(() => { controller.stop(); mock.timers.reset(); });
  controller.start(); await tick(0); await tick(4999); assert.equal(signals[0]!.aborted, false);
  await tick(1); assert.equal(signals[0]!.aborted, true);
  await tick(90_000); assert.equal(signals.length, 1); assert.deepEqual(states, []);
});
