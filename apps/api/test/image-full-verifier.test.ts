import { SharpImageVerifier } from '../src/services/image-verifier-node.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { MemoryStorageDriver } from '../src/adapters/storage.ts';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { corruptEntropyImages } from './support/image-fixtures.ts';
test('Full image verifier: mounted content rejects corrupt entropy even with a valid container envelope', async t => {
  const f = await lifecycleFixture(t);
  const app = createApp(async () => {}, {
    pool: f.pool,
    storage: new MemoryStorageDriver(),
    imageVerifier: new SharpImageVerifier(),
    rateLimiter: () => ({
      limit: async () => ({
        success: true
      })
    }),
    windowCounter: () => ({
      consume: async () => ({
        count: 1,
        retryAfterSeconds: 60
      })
    })
  });
  const headers = {
    cookie: `flowboard_session=${f.actors.owner!.session.id}`,
    origin: 'http://localhost',
    'content-type': 'application/json'
  };
  const results = [];
  for (const row of corruptEntropyImages()) {
    const stage = await app.request('http://localhost/api/v1/cards/card/image-uploads', {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': crypto.randomUUID()
      },
      body: JSON.stringify({
        filename: row.name + '.' + row.contentType.split('/')[1],
        byteLength: row.bytes.length,
        contentType: row.contentType,
        sha256: crypto.createHash('sha256').update(row.bytes).digest('hex')
      })
    });
    assert.equal(stage.status, 201);
    const id = ((await stage.json()) as any).data.id;
    const upload = await app.request('http://localhost/api/v1/image-uploads/' + id + '/content', {
      method: 'PUT',
      headers,
      body: new Uint8Array(row.bytes).buffer
    });
    results.push({
      name: row.name,
      status: upload.status
    });
  }
  assert.deepEqual(results.map(r => r.status), results.map(() => 422), JSON.stringify(results));
  assert.equal((await f.pool.query('SELECT id FROM card_images')).rowCount, 0);
});
import type { TestContext } from 'node:test';
import { imageFixture, imageFixtures, apngFixture, corruptLaterWebpFrame, animatedWebp } from './support/image-fixtures.ts';
import { maximumImageFixtures, texturedMaximumJpegFixtures } from './support/image-maximum-fixtures.ts';
import { imageVerificationFrames, imageVerifierStorage, verifyImagePixels, imageVerificationUnavailable, type ImageVerifier } from '../src/services/image-verifier.ts';
import { ImagesBindingVerifier, type ImageVerifierBinding } from '../src/services/image-verifier-worker.ts';
import { validateImageBinary } from '../src/services/image-validator.ts';
async function imageTestFixture(t: TestContext, verifier: ImageVerifier | null = new SharpImageVerifier(), storageOverride?: MemoryStorageDriver) {
  const f = await lifecycleFixture(t);
  const storage = storageOverride ?? new MemoryStorageDriver();
  const makeApp = (imageVerifier: ImageVerifier | null) => createApp(async () => {}, {
    pool: f.pool,
    storage,
    imageVerifier,
    rateLimiter: () => ({
      limit: async () => ({
        success: true
      })
    }),
    windowCounter: () => ({
      consume: async () => ({
        count: 1,
        retryAfterSeconds: 60
      })
    })
  });
  const app = makeApp(verifier);
  const headers = (actor = 'owner') => ({
    cookie: `flowboard_session=${f.actors[actor]!.session.id}`,
    origin: 'http://localhost',
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID()
  });
  const stage = async (row: {
    name: string;
    bytes: Buffer;
    contentType: string;
  } = imageFixture('png'), actor = 'owner') => {
    const response = await app.request('http://localhost/api/v1/cards/card/image-uploads', {
      method: 'POST',
      headers: headers(actor),
      body: JSON.stringify({
        filename: row.name + '.' + row.contentType.split('/')[1],
        byteLength: row.bytes.length,
        contentType: row.contentType,
        sha256: crypto.createHash('sha256').update(row.bytes).digest('hex')
      })
    });
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as any).data.id as string;
  };
  const put = (id: string, bytes: Buffer = imageFixture('png').bytes, actor = 'owner', target = app) => target.request('http://localhost/api/v1/image-uploads/' + id + '/content', {
    method: 'PUT',
    headers: headers(actor),
    body: new Uint8Array(bytes).buffer
  });
  const finalize = (id: string, actor = 'owner', target = app) => target.request('http://localhost/api/v1/image-uploads/' + id + '/finalize', {
    method: 'POST',
    headers: headers(actor)
  });
  const state = async () => ({
    images: (await f.pool.query('SELECT id FROM card_images')).rowCount,
    board: (await f.pool.query("SELECT snapshot_version FROM boards WHERE id='brd'")).rows[0].snapshot_version,
    events: (await f.pool.query("SELECT id FROM activity_log WHERE action='image_attached'")).rowCount
  });
  return {
    ...f,
    storage,
    app,
    makeApp,
    headers,
    stage,
    put,
    finalize,
    state
  };
}
test('Full image verifier: a deadline cannot turn an abort-resolving provider into accepted content', {
  timeout: 20000
}, async t => {
  const verifier: ImageVerifier = {
    verify: async (_frame, signal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {
      once: true
    }))
  };
  const f = await imageTestFixture(t, verifier);
  const id = await f.stage();
  const before = await f.state();
  const result = await f.put(id);
  assert.equal(result.status, 503, await result.clone().text());
  assert.deepEqual(await f.state(), before);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1', [id])).rows[0].state, 'awaiting_content');
});
test('Full image verifier: native decoder accepts genuine20MP PNG16,progressive444 JPEG and lossless WebP', async t => {
  const f = await imageTestFixture(t);
  for await (const row of maximumImageFixtures()) {
    const id = await f.stage(row);
    const put = await f.put(id, row.bytes);
    if (row.name.includes('cmyk')) {
      assert.equal(put.status, 422, row.name + ': ' + (await put.clone().text()));
      assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
      continue;
    }
    assert.equal(put.status, 200, row.name + ': ' + (await put.clone().text()));
    const finalized = await f.finalize(id);
    assert.equal(finalized.status, 200, row.name + ': ' + (await finalized.clone().text()));
    const image = ((await finalized.json()) as any).data;
    assert.equal(image.width, 5000);
    assert.equal(image.height, 4000);
  }
});
test('Full image verifier: later WebP entropy is decoded and unsupported APNG is refused explicitly', async t => {
  const f = await imageTestFixture(t);
  for (const row of [{
    name: 'later-frame',
    contentType: 'image/webp',
    bytes: corruptLaterWebpFrame()
  }, {
    name: 'animated-png',
    contentType: 'image/png',
    bytes: apngFixture()
  }]) {
    validateImageBinary(row.bytes, row.contentType as any);
    const id = await f.stage(row);
    const result = await f.put(id, row.bytes);
    assert.equal(result.status, 422, row.name + ': ' + (await result.clone().text()));
    if (row.name === 'animated-png') assert.equal(((await result.json()) as any).error.code, 'REJECTED_FORMAT');
  }
  assert.equal((await f.state()).images, 0);
});
test('Full image verifier: frame count and total pixel budget fail before any provider operation', async () => {
  let calls = 0;
  const verifier: ImageVerifier = {
    verify: async () => {
      calls++;
    }
  };
  const small = imageFixture('webp-lossless').bytes;
  const tooMany = animatedWebp(small, 3, 2, 101);
  const dims = validateImageBinary(tooMany, 'image/webp');
  await assert.rejects(imageVerifierStorage.run(verifier, () => verifyImagePixels(tooMany, 'image/webp', dims)), (error: any) => error.status === 422);
  assert.equal(calls, 0);
  const hundred = animatedWebp(small, 3, 2, 100);
  const hundredDims = validateImageBinary(hundred, 'image/webp');
  assert.equal([...imageVerificationFrames(hundred, 'image/webp', hundredDims)].length, 100);
  for await (const row of maximumImageFixtures()) if (row.contentType === 'image/webp') {
    const tooMuch = animatedWebp(row.bytes, row.width, row.height, 2);
    const dimensions = validateImageBinary(tooMuch, 'image/webp');
    await assert.rejects(imageVerifierStorage.run(verifier, () => verifyImagePixels(tooMuch, 'image/webp', dimensions)), (error: any) => error.status === 422);
    assert.equal(calls, 0);
  }
});
test('Full image verifier: missing provider blocks new effects while existing private images remain readable', async t => {
  const f = await imageTestFixture(t);
  const first = await f.stage();
  assert.equal((await f.put(first)).status, 200);
  const finished = await f.finalize(first);
  assert.equal(finished.status, 200);
  const image = ((await finished.json()) as any).data;
  const second = await f.stage();
  assert.equal((await f.put(second)).status, 200);
  const third = await f.stage();
  const missing = f.makeApp(null);
  const before = await f.state();
  assert.equal((await f.put(third, imageFixture('png').bytes, 'owner', missing)).status, 503);
  assert.equal((await f.finalize(second, 'owner', missing)).status, 503);
  const read = await missing.request('http://localhost/api/v1/images/' + image.id + '/content', {
    headers: f.headers()
  });
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), imageFixture('png').bytes);
  assert.deepEqual(await f.state(), before);
});
test('Full image verifier: quota,unavailable,timeout and unknown failures are503 while identified decode failures are422', async () => {
  const row = imageFixture('png');
  const frame = {
    ...row,
    bytes: new Uint8Array(row.bytes)
  };
  for (const [code, message, status] of [[9422, 'usage limit reached', 503], [9432, 'configuration unavailable', 503], [9529, 'timeout', 503], [9523, 'transport failed', 503], [9412, 'not an image', 422], [9523, 'webp2vips: unable to read pixels', 422]] as const) {
    const binding: ImageVerifierBinding = {
      input: () => ({
        output: async () => {
          throw Object.assign(new Error(message), {
            code
          });
        }
      })
    };
    await assert.rejects(new ImagesBindingVerifier(binding).verify(frame, new AbortController().signal), (error: any) => error.status === status, String(code));
  }
});
test('Full image verifier: bounded output cancels provider stream and a late aborted result is discarded', async () => {
  const frame = {
    ...imageFixture('png'),
    width: 1,
    height: 1
  };
  let cancelled = false;
  const binding: ImageVerifierBinding = {
    input: () => ({
      output: async () => ({
        response: () => new Response(new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(600_000));
            c.enqueue(new Uint8Array(600_000));
          },
          cancel() {
            cancelled = true;
          }
        }), {
          headers: {
            'content-type': 'image/jpeg'
          }
        })
      })
    })
  };
  await assert.rejects(new ImagesBindingVerifier(binding).verify(frame, new AbortController().signal), (error: any) => error.status === 503);
  assert.equal(cancelled, true);
  let release!: () => void;
  let lateCancelled = false;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  const late: ImageVerifierBinding = {
    input: () => ({
      output: async () => {
        await wait;
        return {
          response: () => new Response(new ReadableStream<Uint8Array>({
            cancel() {
              lateCancelled = true;
            }
          }), {
            headers: {
              'content-type': 'image/jpeg'
            }
          })
        };
      }
    })
  };
  const controller = new AbortController();
  const operation = new ImagesBindingVerifier(late).verify(frame, controller.signal);
  controller.abort();
  release();
  await assert.rejects(operation, (error: any) => error.status === 503);
  assert.equal(lateCancelled, true);
});
function barrierVerifier(pauseAt = 1) {
  let release!: () => void,
    enter!: () => void,
    calls = 0;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const native = new SharpImageVerifier();
  const verifier: ImageVerifier = {
    verify: async (frame, signal) => {
      await native.verify(frame, signal);
      if (++calls === pauseAt) {
        enter();
        await blocked;
      }
    }
  };
  return {
    verifier,
    entered,
    release
  };
}
test('Full image verifier: mounted cancellation wins while decoding without waiting for a DB transaction', async t => {
  const barrier = barrierVerifier();
  const f = await imageTestFixture(t, barrier.verifier);
  const id = await f.stage();
  const pending = f.put(id);
  await barrier.entered;
  try {
    const cancelled = await f.app.request('http://localhost/api/v1/image-uploads/' + id, {
      method: 'DELETE',
      headers: f.headers()
    });
    assert.equal(cancelled.status, 200);
  } finally {
    barrier.release();
  }
  assert.equal((await pending).status, 409);
  assert.equal((await f.state()).images, 0);
  const key = (await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1', [id])).rows[0].staging_storage_key;
  assert.equal(await f.storage.get(key), null);
});
test('Full image verifier: current grant revocation wins during decoder work and no staged bytes are stored', async t => {
  const barrier = barrierVerifier();
  const f = await imageTestFixture(t, barrier.verifier);
  const id = await f.stage(imageFixture('png'), 'member');
  const pending = f.put(id, imageFixture('png').bytes, 'member');
  await barrier.entered;
  try {
    const rev = (await f.pool.query("SELECT access_revision FROM boards WHERE id='brd'")).rows[0].access_revision;
    const result = await f.request('DELETE', '/boards/brd/grants/' + f.actors.member!.user.id, 'owner', {
      expectedAccessRevision: rev
    });
    assert.equal(result.status, 200, await result.clone().text());
  } finally {
    barrier.release();
  }
  assert.equal((await pending).status, 404);
  const key = (await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1', [id])).rows[0].staging_storage_key;
  assert.equal(await f.storage.get(key), null);
  assert.equal((await f.state()).images, 0);
});
test('Full image verifier: cancelling content-received upload during finalize decoding creates no permanent image', async t => {
  const barrier = barrierVerifier(2);
  const f = await imageTestFixture(t, barrier.verifier);
  const id = await f.stage();
  assert.equal((await f.put(id)).status, 200);
  const pending = f.finalize(id);
  await barrier.entered;
  try {
    assert.equal((await f.app.request('http://localhost/api/v1/image-uploads/' + id, {
      method: 'DELETE',
      headers: f.headers()
    })).status, 200);
  } finally {
    barrier.release();
  }
  assert.equal((await pending).status, 409);
  assert.equal((await f.state()).images, 0);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1', [id])).rows[0].state, 'cancelled');
});
test('Full image verifier: storage bytes replaced after decode fail the locked digest recheck', async t => {
  const barrier = barrierVerifier(2);
  const f = await imageTestFixture(t, barrier.verifier);
  const id = await f.stage();
  assert.equal((await f.put(id)).status, 200);
  const pending = f.finalize(id);
  await barrier.entered;
  try {
    const key = (await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1', [id])).rows[0].staging_storage_key;
    await f.storage.put(key, corruptEntropyImages()[0]!.bytes, 'image/png');
  } finally {
    barrier.release();
  }
  assert.equal((await pending).status, 422);
  assert.equal((await f.state()).images, 0);
});
test('Full image verifier: trash winning while content decodes leaves no new staged object', async t => {
  const barrier = barrierVerifier();
  const f = await imageTestFixture(t, barrier.verifier);
  const id = await f.stage();
  const pending = f.put(id);
  await barrier.entered;
  try {
    const v = (await f.pool.query("SELECT version FROM cards WHERE id='card'")).rows[0].version;
    const result = await f.request('POST', '/cards/card/delete', 'owner', {
      expectedVersion: v,
      expectedBoardVersion: await f.version()
    });
    assert.equal(result.status, 200, await result.clone().text());
  } finally {
    barrier.release();
  }
  assert.equal((await pending).status, 409);
  assert.equal((await f.state()).images, 0);
  const key = (await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1', [id])).rows[0].staging_storage_key;
  assert.equal(await f.storage.get(key), null);
});
async function waitForImageLock(pool: any, applicationName: string, table: string) {
  for (let i = 0; i < 100; i++) {
    const found = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query ILIKE $2", [applicationName, '%' + table + '%']);
    if (found.rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected an actual separate PostgreSQL connection to wait on ' + table);
}
test('Full image verifier: authorized content holding effect locks wins before a waiting mounted grant revocation', async t => {
  let entered!: () => void, release!: () => void;
  const inPut = new Promise<void>(resolve => {
    entered = resolve;
  });
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  class HeldStorage extends MemoryStorageDriver {
    override async put(key: string, bytes: Uint8Array, type: string) {
      entered();
      await hold;
      return super.put(key, bytes, type);
    }
  }
  const f = await imageTestFixture(t, new SharpImageVerifier(), new HeldStorage());
  const id = await f.stage(imageFixture('png'), 'member');
  const pending = f.put(id, imageFixture('png').bytes, 'member');
  await inPut;
  const revision = (await f.pool.query("SELECT access_revision FROM boards WHERE id='brd'")).rows[0].access_revision;
  const revocation = f.request('DELETE', '/boards/brd/grants/' + f.actors.member!.user.id, 'owner', {
    expectedAccessRevision: revision
  });
  try {
    await waitForImageLock(f.pool, f.schema, 'board_grants');
  } finally {
    release();
  }
  assert.equal((await pending).status, 200);
  assert.equal((await revocation).status, 200);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1', [id])).rows[0].state, 'content_received');
  assert.equal((await f.finalize(id, 'member')).status, 404);
  assert.equal((await f.state()).images, 0);
});
test('Full image verifier: a caller abort during full verification cannot produce a verified mutation ticket', async t => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const verifier: ImageVerifier = {
    verify: async (_frame, signal) => {
      entered();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {
        once: true
      }));
    }
  };
  const f = await imageTestFixture(t, verifier);
  const id = await f.stage();
  const controller = new AbortController();
  const operation = f.app.request('http://localhost/api/v1/image-uploads/' + id + '/content', {
    method: 'PUT',
    headers: f.headers(),
    body: new Uint8Array(imageFixture('png').bytes).buffer,
    signal: controller.signal
  });
  await started;
  controller.abort();
  assert.equal((await operation).status, 503);
  assert.equal((await f.state()).images, 0);
  assert.equal((await f.pool.query('SELECT state FROM card_image_uploads WHERE id=$1', [id])).rows[0].state, 'awaiting_content');
});
test('Full image gallery: empty and genuinely finalized native wire conform to shared object contract', async t => {
  const {
    imageGalleryResponseSchema
  } = await import('@flowboard/contracts');
  const f = await imageTestFixture(t);
  const gallery = () => f.app.request('http://localhost/api/v1/cards/card/images', {
    headers: f.headers()
  });
  const empty = await gallery();
  assert.equal(empty.status, 200);
  const emptyWire = imageGalleryResponseSchema.parse(await empty.json());
  assert.deepEqual(emptyWire.data, {
    items: [],
    nextCursor: null,
    totalCount: 0
  });
  const id = await f.stage();
  assert.equal((await f.put(id)).status, 200);
  const finalized = await f.finalize(id);
  assert.equal(finalized.status, 200);
  const image = ((await finalized.json()) as any).data;
  const response = await gallery();
  assert.equal(response.status, 200);
  const wire = imageGalleryResponseSchema.parse(await response.json());
  assert.equal(wire.data.items.length, 1);
  assert.equal(wire.data.items[0]!.id, image.id);
  assert.equal(wire.data.totalCount, 1);
  assert.equal(wire.data.nextCursor, null);
  assert.equal(imageGalleryResponseSchema.safeParse({
    data: wire.data.items
  }).success, false);
});
test('Full image verifier: genuine restart,grayscale,subsampling and custom progressive corpus traverses mounted routes', async t => {
  const {
    jpegCorpus
  } = await import('./support/jpeg-corpus.ts');
  const f = await imageTestFixture(t);
  for (const row of jpegCorpus) {
    const id = await f.stage({
      ...row,
      contentType: 'image/jpeg'
    });
    const put = await f.put(id, row.bytes);
    if (row.name.includes('cmyk')) {
      assert.equal(put.status, 422, row.name + ': ' + (await put.clone().text()));
      assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
      continue;
    }
    assert.equal(put.status, 200, row.name + ': ' + (await put.clone().text()));
    const finished = await f.finalize(id);
    assert.equal(finished.status, 200, row.name + ': ' + (await finished.clone().text()));
    const image = ((await finished.json()) as any).data;
    assert.equal(image.width, row.width);
    assert.equal(image.height, row.height);
    const removed = await f.app.request('http://localhost/api/v1/images/' + image.id, {
      method: 'DELETE',
      headers: f.headers(),
      body: JSON.stringify({
        expectedVersion: image.version
      })
    });
    assert.equal(removed.status, 200, row.name + ': ' + (await removed.clone().text()));
  }
});
test('Full image verifier: valid20MP texturedRGB fits bounded admission and directCMYK returns typed422', {
  timeout: 60000
}, async t => {
  const f = await imageTestFixture(t);
  for await (const row of texturedMaximumJpegFixtures()) {
    const id = await f.stage(row);
    const started = performance.now();
    const put = await f.put(id, row.bytes);
    if (row.name.includes('cmyk')) {
      assert.equal(put.status, 422, row.name + ': ' + (await put.clone().text()));
      assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
      continue;
    }
    assert.equal(put.status, 200, row.name + ': ' + (await put.clone().text()));
    const finalized = await f.finalize(id);
    assert.equal(finalized.status, 200, row.name + ': ' + (await finalized.clone().text()));
    const image = ((await finalized.json()) as any).data;
    assert.equal(image.width, row.width);
    assert.equal(image.height, row.height);
    const read = await f.app.request('http://localhost/api/v1/images/' + image.id + '/content', {
      headers: f.headers()
    });
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), row.bytes);
    t.diagnostic(row.name + ' bytes=' + row.bytes.length + ' mountedNode PUT+finalize+privateRead wall_ms=' + Math.round(performance.now() - started) + '; not hostedCPU proof');
  }
});
test('Full image verifier: directCMYK content and old staging finalize reject before provider with no effects', async t => {
  let calls = 0;
  const f = await imageTestFixture(t, {
    verify: async () => {
      calls++;
    }
  });
  const row = imageFixture('jpeg-cmyk');
  const id = await f.stage(row);
  const before = await f.state();
  const put = await f.put(id, row.bytes);
  assert.equal(put.status, 422);
  assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
  assert.equal(calls, 0);
  assert.equal(f.storage.size(), 0);
  assert.deepEqual(await f.state(), before);
  const key = (await f.pool.query('SELECT staging_storage_key FROM card_image_uploads WHERE id=$1', [id])).rows[0].staging_storage_key;
  await f.storage.put(key, row.bytes, row.contentType);
  await f.pool.query("UPDATE card_image_uploads SET state='content_received',received_bytes=byte_length WHERE id=$1", [id]);
  const finalized = await f.finalize(id);
  assert.equal(finalized.status, 422);
  assert.equal(((await finalized.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
  assert.equal(calls, 0);
  assert.equal(f.storage.size(), 1);
  assert.deepEqual(await f.state(), before);
  assert.deepEqual(Buffer.from((await f.storage.get(key))!.data), row.bytes);
});
test('Full image verifier: disposableWorker JPEG quality1 output is drained and never changes sourceframe', async () => {
  const frame = imageFixture('png-16bit');
  let options: unknown;
  let pulled = 0;
  const binding: ImageVerifierBinding = {
    input: source => ({
      output: async input => {
        options = input;
        assert.deepEqual(Buffer.from(await new Response(source).arrayBuffer()), frame.bytes);
        return {
          response: () => new Response(new ReadableStream({
            pull(controller) {
              pulled++;
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            }
          }), {
            headers: {
              'content-type': 'image/jpeg'
            }
          })
        };
      }
    })
  };
  await new ImagesBindingVerifier(binding).verify(frame, new AbortController().signal);
  assert.deepEqual(options, {
    format: 'image/jpeg',
    quality: 1
  });
  assert.equal(pulled, 1);
});
