import { jpegCorpus } from './support/jpeg-corpus.ts';
import { imageGalleryResponseSchema } from '@flowboard/contracts';
import { maximumImageFixtures, texturedMaximumJpegFixtures } from './support/image-maximum-fixtures.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';
import { importTestDatabaseUrl } from './support/import-database.ts';
import { imageFixtures, malformedImages, corruptEntropyImages, corruptLaterWebpFrame, apngFixture } from './support/image-fixtures.ts';
test('Image integrity: actual workerd validates complete containers and private R2 deliveries', {
  timeout: 120000
}, async t => {
  const f = await lifecycleFixture(t);
  const dir = await fs.mkdtemp('/private/tmp/flowboard-image-worker-');
  const url = new URL(importTestDatabaseUrl());
  url.searchParams.set('options', `-c search_path=${f.schema}`);
  const configPath = path.join(dir, 'wrangler.json');
  await fs.writeFile(configPath, JSON.stringify({
    name: 'flowboard-image-integrity-test',
    main: fileURLToPath(new URL('../src/runtime/worker.ts', import.meta.url)),
    compatibility_date: '2026-10-19',
    compatibility_flags: ['nodejs_compat'],
    ratelimits: [{
      name: 'FB_RL_WRITES',
      namespace_id: '9912',
      simple: {
        limit: 1000,
        period: 60
      }
    }],
    images: {
      binding: 'IMAGE_VERIFIER'
    },
    r2_buckets: [{
      binding: 'IMAGES',
      bucket_name: 'synthetic-private-images'
    }],
    vars: {
      DATABASE_URL: url.toString()
    }
  }));
  const harness = createTestHarness({
    workers: [{
      configPath
    }]
  });
  try {
    await harness.listen();
    const worker = harness.getWorker('flowboard-image-integrity-test');
    let address = 1;
    const emptyGallery = await worker.fetch('http://localhost/api/v1/cards/card/images', {
      headers: {
        cookie: `flowboard_session=${f.actors.owner!.session.id}`
      }
    });
    assert.equal(emptyGallery.status, 200);
    assert.equal(imageGalleryResponseSchema.parse(await emptyGallery.json()).data.totalCount, 0);
    const cases = [...corruptEntropyImages().map(row => ({
      ...row,
      valid: false
    })), {
      name: 'later-frame-corrupt',
      contentType: 'image/webp',
      bytes: corruptLaterWebpFrame(),
      valid: false
    }, {
      name: 'apng-unsupported',
      contentType: 'image/png',
      bytes: apngFixture(),
      valid: false
    }, ...malformedImages().map(row => ({
      ...row,
      valid: false
    })), ...imageFixtures.filter(row => !row.name.endsWith('-legacy')).map(row => ({
      ...row,
      valid: !row.name.includes('cmyk')
    }))];
    for (const row of cases) {
      const headers = {
        cookie: `flowboard_session=${f.actors.owner!.session.id}`,
        origin: 'http://localhost',
        'content-type': 'application/json',
        'cf-connecting-ip': `192.0.2.${address++}`
      };
      const stage = await worker.fetch('http://localhost/api/v1/cards/card/image-uploads', {
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
      assert.equal(stage.status, 201, row.name + ': ' + (await stage.clone().text()));
      const id = ((await stage.json()) as any).data.id;
      const upload = await worker.fetch('http://localhost/api/v1/image-uploads/' + id + '/content', {
        method: 'PUT',
        headers: {
          ...headers,
          'content-type': 'application/octet-stream'
        },
        body: new Uint8Array(row.bytes).buffer
      });
      assert.equal(upload.status, row.valid ? 200 : 422, row.name + ': ' + (await upload.clone().text()));
      if (!row.valid) {
        const cancel = await worker.fetch('http://localhost/api/v1/image-uploads/' + id, {
          method: 'DELETE',
          headers
        });
        assert.equal(cancel.status, 200);
        continue;
      }
      const finalize = await worker.fetch('http://localhost/api/v1/image-uploads/' + id + '/finalize', {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': crypto.randomUUID()
        }
      });
      assert.equal(finalize.status, 200, row.name + ': ' + (await finalize.clone().text()));
      const image = ((await finalize.json()) as any).data;
      for (const suffix of ['content', 'thumbnail']) {
        const read = await worker.fetch('http://localhost/api/v1/images/' + image.id + '/' + suffix, {
          headers
        });
        assert.equal(read.status, 200);
        assert.equal(read.headers.get('content-type'), row.contentType);
        assert.match(read.headers.get('cache-control') ?? '', /private.*no-store/);
        assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await read.arrayBuffer()), row.bytes);
      }
      const hidden = await worker.fetch('http://localhost/api/v1/images/' + image.id + '/content', {
        headers: {
          ...headers,
          cookie: `flowboard_session=${f.actors.outsider!.session.id}`
        }
      });
      assert.equal(hidden.status, 404);
    }
    const gallery = await worker.fetch('http://localhost/api/v1/cards/card/images', {
      headers: {
        cookie: `flowboard_session=${f.actors.owner!.session.id}`
      }
    });
    assert.equal(gallery.status, 200);
    assert.equal(imageGalleryResponseSchema.parse(await gallery.json()).data.items.length, imageFixtures.filter(row => !row.name.endsWith('-legacy') && !row.name.includes('cmyk')).length);
    await f.pool.query("INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES('card_maximum','ws','prj','brd','col2','Maximum image fixture','none',2000,'active',NOW(),NOW())");
    async function* additionalFixtures() {
      for (const row of jpegCorpus) yield {
        ...row,
        contentType: 'image/jpeg' as const
      };
      yield* maximumImageFixtures();
      yield* texturedMaximumJpegFixtures();
    }
    for await (const row of additionalFixtures()) {
      const headers = {
        cookie: `flowboard_session=${f.actors.owner!.session.id}`,
        origin: 'http://localhost',
        'content-type': 'application/json',
        'cf-connecting-ip': `192.0.2.${address++}`
      };
      const started = performance.now();
      const stage = await worker.fetch('http://localhost/api/v1/cards/card_maximum/image-uploads', {
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
      assert.equal(stage.status, 201, row.name + ': ' + (await stage.clone().text()));
      const id = ((await stage.json()) as any).data.id;
      const put = await worker.fetch('http://localhost/api/v1/image-uploads/' + id + '/content', {
        method: 'PUT',
        headers,
        body: new Uint8Array(row.bytes).buffer
      });
      if (row.name.includes('cmyk')) {
        assert.equal(put.status, 422, row.name + ': ' + (await put.clone().text()));
        assert.equal(((await put.json()) as any).error.code, 'JPEG_COLOR_MODEL_UNSUPPORTED');
        assert.equal((await worker.fetch('http://localhost/api/v1/image-uploads/' + id, {
          method: 'DELETE',
          headers
        })).status, 200);
        continue;
      }
      assert.equal(put.status, 200, row.name + ': ' + (await put.clone().text()));
      const finish = await worker.fetch('http://localhost/api/v1/image-uploads/' + id + '/finalize', {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': crypto.randomUUID()
        }
      });
      assert.equal(finish.status, 200, row.name + ': ' + (await finish.clone().text()));
      const image = ((await finish.json()) as any).data;
      assert.equal(image.width, row.width);
      assert.equal(image.height, row.height);
      const original = await worker.fetch('http://localhost/api/v1/images/' + image.id + '/content', { headers });
      assert.equal(original.status,200);
      assert.equal(crypto.createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'),crypto.createHash('sha256').update(row.bytes).digest('hex'),row.name + ': stored source bytes must be unchanged');
      const removed = await worker.fetch('http://localhost/api/v1/images/' + image.id, {
        method: 'DELETE',
        headers: {
          ...headers,
          'idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({
          expectedVersion: image.version
        })
      });
      assert.equal(removed.status, 200, await removed.clone().text());
      t.diagnostic(row.name + ' actual workerd upload+fullverify+finalize+delete local elapsed_ms=' + Math.round(performance.now() - started) + '; not hosted CPU/memory proof');
    }
    assert.equal((await f.pool.query('SELECT id FROM card_images')).rowCount, imageFixtures.filter(row => !row.name.endsWith('-legacy') && !row.name.includes('cmyk')).length);
    t.diagnostic('Actual local workerd + local R2 emulator + real isolated PostgreSQL; no hosted storage/durability claim.');
  } finally {
    await harness.close();
    await fs.rm(dir, {
      recursive: true,
      force: true
    });
  }
});
