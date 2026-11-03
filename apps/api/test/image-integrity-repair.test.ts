import { SharpImageVerifier } from '../src/services/image-verifier-node.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { createApp } from '../src/http/app.ts';
import { MemoryStorageDriver } from '../src/adapters/storage.ts';
test('Image integrity: header-only PNG must not reach verified saved gallery', async t => {
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
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(1, 16);
  header.writeUInt32BE(1, 20);
  const headers = {
    cookie: `flowboard_session=${f.actors.owner!.session.id}`,
    origin: 'http://localhost',
    'idempotency-key': crypto.randomUUID(),
    'content-type': 'application/json'
  };
  const staged = await app.request('http://localhost/api/v1/cards/card/image-uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: 'header-only.png',
      byteLength: header.length,
      contentType: 'image/png',
      sha256: crypto.createHash('sha256').update(header).digest('hex')
    })
  });
  assert.equal(staged.status, 201);
  const id = ((await staged.json()) as any).data.id;
  const uploaded = await app.request(`http://localhost/api/v1/image-uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream'
    },
    body: header
  });
  let finalizedStatus: number | null = null;
  if (uploaded.status === 200) {
    const finalized = await app.request(`http://localhost/api/v1/image-uploads/${id}/finalize`, {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': crypto.randomUUID()
      }
    });
    finalizedStatus = finalized.status;
  }
  console.log(JSON.stringify({
    syntheticHeaderBytes: header.length,
    uploadStatus: uploaded.status,
    finalizedStatus,
    savedImages: (await f.pool.query('SELECT id FROM card_images')).rowCount
  }));
  assert.equal(uploaded.status, 422, 'A PNG with no complete IHDR/IDAT/IEND is not a valid saved image');
  assert.equal((await f.pool.query('SELECT id FROM card_images')).rowCount, 0);
});
import { imageFixtures, malformedImages } from './support/image-fixtures.ts';
import { validateImageBinary } from '../src/services/image-validator.ts';
for (const contentType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
  test('Image integrity: mounted upload rejects malformed complete-container candidates ' + contentType, async t => {
    const f = await lifecycleFixture(t);
    const storage = new MemoryStorageDriver();
    const app = createApp(async () => {}, {
      pool: f.pool,
      storage,
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
    for (const candidate of malformedImages().filter(row => row.contentType === contentType)) {
      const stage = await app.request('http://localhost/api/v1/cards/card/image-uploads', {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({
          filename: candidate.name + '.' + contentType.split('/')[1],
          byteLength: candidate.bytes.length,
          contentType,
          sha256: crypto.createHash('sha256').update(candidate.bytes).digest('hex')
        })
      });
      assert.equal(stage.status, 201, candidate.name);
      const id = ((await stage.json()) as any).data.id;
      const upload = await app.request('http://localhost/api/v1/image-uploads/' + id + '/content', {
        method: 'PUT',
        headers: {
          ...headers,
          'content-type': 'application/octet-stream'
        },
        body: new Uint8Array(candidate.bytes).buffer
      });
      assert.equal(upload.status, 422, candidate.name + ': ' + (await upload.text()));
      assert.equal((await f.pool.query('SELECT id FROM card_images')).rowCount, 0, candidate.name);
      const cancel = await app.request('http://localhost/api/v1/image-uploads/' + id, {
        method: 'DELETE',
        headers
      });
      assert.equal(cancel.status, 200);
    }
  });
}
test('Image integrity: genuine PNG variants, baseline/progressive JPEG and lossless/lossy WebP save with private delivery', async t => {
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
  for (const row of imageFixtures.filter(row => !row.name.endsWith('-legacy'))) {
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
    assert.equal(stage.status, 201, row.name);
    const id = ((await stage.json()) as any).data.id;
    const put = await app.request('http://localhost/api/v1/image-uploads/' + id + '/content', {
      method: 'PUT',
      headers,
      body: new Uint8Array(row.bytes).buffer
    });
    if (row.name.includes('cmyk')) {
      assert.equal(put.status, 422);
      assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
      continue;
    }
    assert.equal(put.status, 200, row.name + ': ' + (await put.clone().text()));
    const finalized = await app.request('http://localhost/api/v1/image-uploads/' + id + '/finalize', {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': crypto.randomUUID()
      }
    });
    assert.equal(finalized.status, 200, row.name + ': ' + (await finalized.clone().text()));
    const image = ((await finalized.json()) as any).data;
    assert.equal(image.width, row.width);
    assert.equal(image.height, row.height);
    const read = await app.request('http://localhost/api/v1/images/' + image.id + '/content', {
      headers
    });
    assert.equal(read.status, 200);
    assert.match(read.headers.get('cache-control') ?? '', /private.*no-store/);
    assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), row.bytes);
    const outsider = await app.request('http://localhost/api/v1/images/' + image.id + '/content', {
      headers: {
        cookie: `flowboard_session=${f.actors.outsider!.session.id}`
      }
    });
    assert.equal(outsider.status, 404);
  }
});
test('Image integrity: every truncation of genuine containers is rejected without generic runtime errors', () => {
  for (const row of imageFixtures.filter(row => !row.name.endsWith('-legacy'))) {
    for (let n = 1; n < row.bytes.length; n++) assert.throws(() => validateImageBinary(row.bytes.subarray(0, n), row.contentType), error => error instanceof Error && error.name === 'ImageValidationError', row.name + '@' + n);
  }
});
test('Image integrity: finalization rechecks old staged malformed bytes as422 without attachment/version/event effects', async t => {
  const f = await lifecycleFixture(t);
  const storage = new MemoryStorageDriver();
  const app = createApp(async () => {}, {
    pool: f.pool,
    storage,
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
  const row = malformedImages().find(row => row.name === 'png-header-only')!;
  const stage = await app.request('http://localhost/api/v1/cards/card/image-uploads', {
    method: 'POST',
    headers: {
      ...headers,
      'idempotency-key': crypto.randomUUID()
    },
    body: JSON.stringify({
      filename: 'legacy.png',
      byteLength: row.bytes.length,
      contentType: row.contentType,
      sha256: crypto.createHash('sha256').update(row.bytes).digest('hex')
    })
  });
  assert.equal(stage.status, 201);
  const id = ((await stage.json()) as any).data.id;
  const key = (await f.pool.query('UPDATE card_image_uploads SET state=\'content_received\',received_bytes=byte_length WHERE id=$1 RETURNING staging_storage_key', [id])).rows[0].staging_storage_key;
  await storage.put(key, row.bytes, row.contentType);
  const state = async () => ({
    board: (await f.pool.query("SELECT snapshot_version FROM boards WHERE id='brd'")).rows[0].snapshot_version,
    images: (await f.pool.query('SELECT id FROM card_images')).rowCount,
    events: (await f.pool.query("SELECT id FROM activity_log WHERE action='image_attached'")).rowCount
  });
  const before = await state();
  const result = await app.request('http://localhost/api/v1/image-uploads/' + id + '/finalize', {
    method: 'POST',
    headers: {
      ...headers,
      'idempotency-key': crypto.randomUUID()
    }
  });
  assert.equal(result.status, 422, await result.clone().text());
  assert.deepEqual(await state(), before);
  assert.ok(await storage.get(key));
});
