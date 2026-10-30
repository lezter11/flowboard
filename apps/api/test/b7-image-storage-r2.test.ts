import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool } from '../src/adapters/postgres.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { getStorageDriver, R2StorageDriver, type R2BucketBinding } from '../src/adapters/storage.ts';
import worker from '../src/runtime/worker.ts';

// FB-AUD-01 regression. The fake R2 bucket is a shared Map standing in for the durable bucket:
// every fetch() call below builds its own driver over it, as separate Worker isolates would.
// This is not a substitute for a hosted R2 verification.

interface FakeBucket {
  binding: R2BucketBinding;
  objects: Map<string, { bytes: Uint8Array; contentType: string | undefined }>;
}

function fakeR2(objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>()): FakeBucket {
  const binding: R2BucketBinding = {
    async put(key, value, options) {
      objects.set(key, { bytes: new Uint8Array(value), contentType: options?.httpMetadata?.contentType });
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      const copy = new Uint8Array(item.bytes);
      return {
        arrayBuffer: async () => copy.buffer,
        httpMetadata: { contentType: item.contentType },
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { binding, objects };
}

const sfx = () => crypto.randomBytes(4).toString('hex');

// A file-owned pool. The Worker's fetch() installs and then ends its own pool, so getPool() is unusable after it.
const pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);

// A 1x1 PNG the image validator accepts (signature, IHDR with dimensions, IEND).
const PNG = (() => {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(1, 8);
  ihdr.writeUInt32BE(1, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([header, ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
})();

async function setup(pool: pg.Pool) {
  await runMigrations(pool);
  const s = sfx();
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
  const manager = await createDevUserAndSession(`manager.${s}@flowboard.example`, 'Manager', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  const board = `b_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B',now(),now())`, [board, ws, project]);
  await pool.query(
    `INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'To do','blue','todo',0,1,now(),now())`,
    [`col_${s}`, ws, project, board],
  );
  await pool.query(
    `INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'Task','medium',100,'active',now(),now())`,
    [`card_${s}`, ws, project, board, `col_${s}`],
  );
  await pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'manager','active',now(),now())`,
    [`pm_${s}`, project, ws, manager.user.id],
  );
  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
    [board, project, ws, manager.user.id, owner.user.id],
  );
  return { cookie: `flowboard_session=${manager.session.id}`, card: `card_${s}`, project, ws };
}

function headers(cookie: string, json = false) {
  return {
    cookie,
    'Idempotency-Key': `b7-${crypto.randomUUID()}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

test('B-7 images: R2 driver round-trips bytes and content type, and tolerates repeat deletes', async () => {
  const fake = fakeR2();
  const driver = new R2StorageDriver(fake.binding);
  await driver.put('k/one', new Uint8Array([1, 2, 3]), 'image/png');
  const got = await driver.get('k/one');
  assert.deepEqual([...got!.data], [1, 2, 3]);
  assert.equal(got!.contentType, 'image/png');
  assert.equal(await driver.get('missing'), null);
  await driver.delete('k/one');
  await driver.delete('k/one');
  assert.equal(await driver.get('k/one'), null);
});

test('B-7 images: with no bucket bound, image routes fail closed before any database write', async () => {
  const fx = await setup(pool);
  const app = createApp(async () => {}, { pool, storage: null });
  const before = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM card_image_uploads WHERE card_id = $1', [fx.card]);

  const stage = await app.request(`http://localhost/api/v1/cards/${fx.card}/image-uploads`, {
    method: 'POST',
    headers: headers(fx.cookie, true),
    body: JSON.stringify({
      filename: 'a.png', byteLength: PNG.byteLength, contentType: 'image/png',
      sha256: crypto.createHash('sha256').update(PNG).digest('hex'),
    }),
  });
  assert.equal(stage.status, 503);
  assert.equal(((await stage.json()) as any).error.code, 'CONFIG_ERROR');

  const after = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM card_image_uploads WHERE card_id = $1', [fx.card]);
  assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'no staging row was written');

  const list = await app.request(`http://localhost/api/v1/cards/${fx.card}/images`, { headers: { cookie: fx.cookie } });
  assert.equal(list.status, 503);

  // Non-image routes keep working without the bucket.
  const card = await app.request(`http://localhost/api/v1/cards/${fx.card}`, { headers: { cookie: fx.cookie } });
  assert.equal(card.status, 200);
});

test('B-7 images: the Worker without an IMAGES binding answers 503 CONFIG_ERROR on image routes', async () => {
  const fx = await setup(pool);
  const env = { DATABASE_URL: process.env['DATABASE_URL']! };
  const response = await worker.fetch(
    new Request(`http://localhost/api/v1/cards/${fx.card}/images`, { headers: { cookie: fx.cookie } }),
    env as never,
  );
  assert.equal(response.status, 503);
  assert.equal(((await response.json()) as any).error.code, 'CONFIG_ERROR');
});

test('B-7 images: upload, finalize, read and delete through the Worker, across separate isolates', async () => {
  const fx = await setup(pool);
  const bucket = fakeR2();
  // Each call gets a fresh env object over the same bucket store: the durable state two isolates share.
  const call = (request: Request) => worker.fetch(request, { DATABASE_URL: process.env['DATABASE_URL']!, IMAGES: fakeR2(bucket.objects).binding } as never);
  const base = 'http://localhost/api/v1';

  // Isolate 1: stage and upload the bytes.
  const stage = await call(new Request(`${base}/cards/${fx.card}/image-uploads`, {
    method: 'POST',
    headers: headers(fx.cookie, true),
    body: JSON.stringify({
      filename: 'synthetic.png', byteLength: PNG.byteLength, contentType: 'image/png',
      sha256: crypto.createHash('sha256').update(PNG).digest('hex'),
    }),
  }));
  assert.equal(stage.status, 201, await stage.clone().text());
  const uploadId = ((await stage.json()) as any).data.id as string;
  const stagingKey = `staging/${uploadId}`;

  const content = await call(new Request(`${base}/image-uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: { ...headers(fx.cookie), 'content-type': 'image/png' },
    body: PNG,
  }));
  assert.equal(content.status, 200, await content.clone().text());
  assert.ok(bucket.objects.has(stagingKey), 'staged bytes are in the bucket');

  // Isolate 2: finalize. It must read the staged bytes written by isolate 1.
  const finalize = await call(new Request(`${base}/image-uploads/${uploadId}/finalize`, {
    method: 'POST',
    headers: headers(fx.cookie),
  }));
  assert.equal(finalize.status, 200, await finalize.clone().text());
  const imageId = ((await finalize.json()) as any).data.id as string;
  const finalKey = `images/${fx.project}/${fx.card}/${imageId}`;
  assert.ok(bucket.objects.has(finalKey), 'permanent bytes are in the bucket');
  assert.equal(bucket.objects.has(stagingKey), false, 'cleanup removed the staged object after finalize');

  // Isolate 3: read the bytes back.
  const read = await call(new Request(`${base}/images/${imageId}/content`, { headers: { cookie: fx.cookie } }));
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
  assert.equal(read.headers.get('content-type'), 'image/png');

  // Isolate 4: delete the image; its object goes too.
  const remove = await call(new Request(`${base}/images/${imageId}`, {
    method: 'DELETE',
    headers: { ...headers(fx.cookie, true) },
    body: JSON.stringify({ expectedVersion: 1 }),
  }));
  assert.equal(remove.status, 200, await remove.clone().text());
  assert.equal(bucket.objects.has(finalKey), false, 'the deleted image object is gone');
  const gone = await call(new Request(`${base}/images/${imageId}/content`, { headers: { cookie: fx.cookie } }));
  assert.equal(gone.status, 404);
});

test('B-7 images: cancelling a staged upload removes its staged object', async () => {
  const fx = await setup(pool);
  const bucket = fakeR2();
  const scoped = createApp(async () => {}, { pool, storage: new R2StorageDriver(bucket.binding) });

  const stage = await scoped.request(`http://localhost/api/v1/cards/${fx.card}/image-uploads`, {
    method: 'POST',
    headers: headers(fx.cookie, true),
    body: JSON.stringify({
      filename: 'pending.png', byteLength: PNG.byteLength, contentType: 'image/png',
      sha256: crypto.createHash('sha256').update(PNG).digest('hex'),
    }),
  });
  assert.equal(stage.status, 201);
  const uploadId = ((await stage.json()) as any).data.id as string;
  const put = await scoped.request(`http://localhost/api/v1/image-uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: { ...headers(fx.cookie), 'content-type': 'image/png' },
    body: PNG,
  });
  assert.equal(put.status, 200);
  assert.equal(bucket.objects.size, 1);

  const cancel = await scoped.request(`http://localhost/api/v1/image-uploads/${uploadId}`, {
    method: 'DELETE',
    headers: headers(fx.cookie),
  });
  assert.equal(cancel.status, 200, await cancel.clone().text());
  assert.equal(bucket.objects.size, 0, 'the staged object was removed');
});

test('B-7 images: the default driver is not used when a scope binds none', () => {
  // The scope is per run: a null binding must not fall back to a process default.
  assert.throws(() => getStorageDriver(), (err: any) => err.code === 'CONFIG_ERROR');
});

// B-14 (FB-AUD-09). The user's filename never reaches a storage key: keys are random and the
// original name stays on the database row only.
test('B-14 images: storage keys carry no user filename, and filenames with separators or control characters are refused', async () => {
  const fx = await setup(pool);
  const bucket = fakeR2();
  const call = (request: Request) => worker.fetch(request, { DATABASE_URL: process.env['DATABASE_URL']!, IMAGES: fakeR2(bucket.objects).binding } as never);
  const base = 'http://localhost/api/v1';
  const name = 'holiday photo 2026.png';

  for (const bad of ['sub/dir.png', 'sub\\dir.png', 'bad\u0001name.png', '../escape.png']) {
    const refused = await call(new Request(`${base}/cards/${fx.card}/image-uploads`, {
      method: 'POST',
      headers: headers(fx.cookie, true),
      body: JSON.stringify({ filename: bad, byteLength: PNG.byteLength, contentType: 'image/png', sha256: crypto.createHash('sha256').update(PNG).digest('hex') }),
    }));
    assert.equal(refused.status, 422, `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(bucket.objects.size, 0, 'a refused filename writes nothing to storage');

  const stage = await call(new Request(`${base}/cards/${fx.card}/image-uploads`, {
    method: 'POST',
    headers: headers(fx.cookie, true),
    body: JSON.stringify({ filename: name, byteLength: PNG.byteLength, contentType: 'image/png', sha256: crypto.createHash('sha256').update(PNG).digest('hex') }),
  }));
  assert.equal(stage.status, 201, await stage.clone().text());
  const uploadId = ((await stage.json()) as any).data.id as string;
  const stagingKey = `staging/${uploadId}`;

  const content = await call(new Request(`${base}/image-uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: { ...headers(fx.cookie), 'content-type': 'image/png' },
    body: PNG,
  }));
  assert.equal(content.status, 200, await content.clone().text());
  assert.ok(bucket.objects.has(stagingKey), 'the staged object uses the random upload key');

  const finalize = await call(new Request(`${base}/image-uploads/${uploadId}/finalize`, { method: 'POST', headers: headers(fx.cookie) }));
  assert.equal(finalize.status, 200, await finalize.clone().text());
  const imageId = ((await finalize.json()) as any).data.id as string;
  const finalKey = `images/${fx.project}/${fx.card}/${imageId}`;
  assert.ok(bucket.objects.has(finalKey), 'the permanent object uses the random image key');

  for (const key of bucket.objects.keys()) {
    assert.equal(key.includes('holiday'), false, `no filename in ${key}`);
  }

  const row = await pool.query<{ filename: string; storage_key: string }>('SELECT filename, storage_key FROM card_images WHERE id = $1', [imageId]);
  assert.equal(row.rows[0]!.filename, name, 'the original name stays on the row');
  assert.equal(row.rows[0]!.storage_key, finalKey);

  const read = await call(new Request(`${base}/images/${imageId}/content`, { headers: { cookie: fx.cookie } }));
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
});
