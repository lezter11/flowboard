import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadStore, type UploadDeps } from '../src/lib/image-uploads.ts';

const prepared = (name: string) => ({ blob: new Blob(['x']), filename: name, contentType: 'image/webp' as const, byteLength: 1, sha256: 'a'.repeat(64), width: 1, height: 1, outcome: 'optimised' as const, originalBytes: 2, note: 'Optimised 2 KB → 1 KB' });
const file = (name: string) => new File(['xx'], name, { type: 'image/png' });
const tick = () => new Promise((r) => setTimeout(r, 5));

function setup(over: Partial<UploadDeps> = {}) {
  const log: string[] = [];
  const deps: UploadDeps = {
    prepare: async (f) => { log.push(`prepare ${f.name}`); return prepared(f.name.replace('.png', '.webp')); },
    createUpload: async (_c, input) => { log.push(`create ${input.filename}`); return { id: `up_${input.filename}` }; },
    putContent: async (id, _b, o) => { log.push(`put ${id}`); o.onProgress(0.5); },
    finalize: async (id) => { log.push(`finalize ${id}`); },
    cancel: async (id) => { log.push(`cancel ${id}`); },
    describe: (e) => ({ message: String((e as Error).message), retryable: true }),
    onFinalized: (c) => { log.push(`done ${c}`); },
    ...over,
  };
  return { store: createUploadStore(deps), log };
}

test('one file goes prepare, create, put, finalize and then leaves the list', async () => {
  const { store, log } = setup();
  store.add('c1', [file('a.png')]);
  assert.equal(store.get('c1')[0]?.status, 'optimising');
  await tick();
  assert.deepEqual(log, ['prepare a.png', 'create a.webp', 'put up_a.webp', 'finalize up_a.webp', 'done c1']);
  assert.equal(store.get('c1').length, 0);
});
test('several files are handled one at a time, in order', async () => {
  const { store, log } = setup();
  store.add('c1', [file('a.png'), file('b.png')]);
  await tick(); await tick();
  assert.deepEqual(log.filter((l) => l.startsWith('prepare')), ['prepare a.png', 'prepare b.png']);
  assert.ok(log.indexOf('finalize up_a.webp') < log.indexOf('prepare b.png'));
});
test('the item says validating, not saved, while finalize is pending', async () => {
  let release!: () => void;
  const { store } = setup({ finalize: () => new Promise<void>((r) => { release = r; }) });
  store.add('c1', [file('a.png')]);
  await tick();
  assert.equal(store.get('c1')[0]?.status, 'validating');
  release(); await tick();
  assert.equal(store.get('c1').length, 0);
});
test('a failure keeps the item with a message, cancels the staged upload and can be retried', async () => {
  let fail = true;
  const { store, log } = setup({ putContent: async () => { if (fail) throw new Error('boom'); } });
  store.add('c1', [file('a.png')]);
  await tick();
  const failed = store.get('c1')[0]!;
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'boom'); assert.ok(log.includes('cancel up_a.webp'));
  fail = false; store.retry('c1', failed.id); await tick();
  assert.equal(store.get('c1').length, 0); assert.ok(log.includes('finalize up_a.webp'));
});
test('cancel during upload aborts the transfer, cancels the staged upload and never finalizes', async () => {
  const { store, log } = setup({ putContent: (_id, _b, o) => new Promise((_r, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))) });
  store.add('c1', [file('a.png')]);
  await tick();
  store.cancel('c1', store.get('c1')[0]!.id); await tick();
  assert.equal(store.get('c1').length, 0); assert.ok(log.includes('cancel up_a.webp')); assert.ok(!log.some((l) => l.startsWith('finalize')));
});
test('cancel of a waiting file removes it before any work starts', async () => {
  let release!: () => void;
  const { store, log } = setup({ prepare: (f) => new Promise((r) => { release = () => r(prepared(f.name)); }) });
  store.add('c1', [file('a.png'), file('b.png')]);
  await tick();
  store.cancel('c1', store.get('c1')[1]!.id);
  release(); await tick(); await tick();
  assert.ok(!log.some((l) => l.includes('b.png')));
});
test('uploads of different cards do not mix', async () => {
  const { store } = setup({ putContent: () => new Promise(() => undefined) });
  store.add('c1', [file('a.png')]); store.add('c2', [file('b.png')]);
  await tick();
  assert.equal(store.get('c1').length, 1); assert.equal(store.get('c2').length, 1); assert.equal(store.get('c1')[0]?.name, 'a.webp'); assert.equal(store.get('c2')[0]?.name, 'b.png');
});
