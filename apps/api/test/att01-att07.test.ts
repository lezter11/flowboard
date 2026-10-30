import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { getStorageDriver, MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';
import { cleanupOrphanUploads } from '../src/adapters/images.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';

// Binary test payloads
function createMinimalPng(width = 1, height = 1): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const ihdr = Buffer.alloc(13 + 12);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write('IHDR', 4, 'ascii'); // type
  ihdr.writeUInt32BE(width, 8); // width
  ihdr.writeUInt32BE(height, 12); // height
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // color type (RGB)
  ihdr[18] = 0; // compression
  ihdr[19] = 0; // filter
  ihdr[20] = 0; // interlace
  ihdr.writeUInt32BE(0x12345678, 21); // dummy CRC
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([header, ihdr, iend]);
}

function createMinimalJpeg(width = 1, height = 1): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0; // SOF0 marker
  sof0.writeUInt16BE(17, 2); // segment length (17)
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5); // height
  sof0.writeUInt16BE(width, 7); // width
  sof0[9] = 3; // components
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, sof0, eoi]);
}

function createMinimalWebp(width = 1, height = 1): Buffer {
  // VP8X extended WebP canvas
  const header = Buffer.alloc(30);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(22, 4); // file size - 8
  header.write('WEBP', 8, 'ascii');
  header.write('VP8X', 12, 'ascii');
  header.writeUInt32LE(10, 16); // chunk size
  header.writeUInt32LE(0, 20); // flags
  // 24-bit width - 1
  const w = width - 1;
  header[24] = w & 0xff;
  header[25] = (w >> 8) & 0xff;
  header[26] = (w >> 16) & 0xff;
  // 24-bit height - 1
  const h = height - 1;
  header[27] = h & 0xff;
  header[28] = (h >> 8) & 0xff;
  header[29] = (h >> 16) & 0xff;
  return header;
}

function sha256Hex(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

let keyIdx = Date.now();
function nextKey(prefix = 'att-idem-key'): string {
  keyIdx++;
  return `${prefix}-${keyIdx}-abcdef123456`;
}

test('ATT-01 to ATT-07: Image Upload Staging, Validation, Delivery, Lifecycle Suite', async (t) => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env['DATABASE_URL']),
    max: 5,
    connectionTimeoutMillis: 5_000,
  });

  const app = createApp(async () => { await pool.query('SELECT 1'); }, { pool });
  let memoryStorage: MemoryStorageDriver;

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships, boards, columns, cards, card_assignees, comments, card_images, card_image_uploads CASCADE;',
      );
    } finally {
      client.release();
    }
    memoryStorage = new MemoryStorageDriver();
    setStorageDriver(memoryStorage);
  });

  after(async () => {
    await pool.end();
  });

  // Helper to create users and sessions
  async function createSession(email: string, name: string): Promise<{ cookie: string; user: any }> {
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Secret': process.env['DEV_LOGIN_SECRET'] || 'flowboard-dev-secret',
      },
      body: JSON.stringify({ email, name }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
    const json = (await res.json()) as any;
    return { cookie, user: json.data.actor };
  }

  // Setup test hierarchy:
  // Owner, Project Manager, Member, Viewer, Sibling Member
  let ownerCookie: string;
  let ownerUser: any;
  let pmCookie: string;
  let pmUser: any;
  let memberCookie: string;
  let memberUser: any;
  let viewerCookie: string;
  let viewerUser: any;
  let siblingCookie: string;
  let siblingUser: any;

  let workspaceId: string;
  let projectId: string;
  let siblingProjectId: string;
  let boardId: string;
  let columnId: string;
  let cardId: string;

  await t.test('0. Setup Workspace, Projects, Members and Initial Card', async () => {
    const owner = await createSession('att-owner@test.com', 'Owner User');
    ownerCookie = owner.cookie;
    ownerUser = owner.user;

    const pm = await createSession('att-pm@test.com', 'Manager User');
    pmCookie = pm.cookie;
    pmUser = pm.user;

    const member = await createSession('att-member@test.com', 'Member User');
    memberCookie = member.cookie;
    memberUser = member.user;

    const viewer = await createSession('att-viewer@test.com', 'Viewer User');
    viewerCookie = viewer.cookie;
    viewerUser = viewer.user;

    const sibling = await createSession('att-sibling@test.com', 'Sibling User');
    siblingCookie = sibling.cookie;
    siblingUser = sibling.user;

    // Create workspace
    const wsRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'ws-att-test-setup-001',
      },
      body: JSON.stringify({ name: 'Attachment Test Workspace', timezone: 'UTC' }),
    });
    assert.equal(wsRes.status, 201);
    const wsJson = (await wsRes.json()) as any;
    workspaceId = wsJson.data.id;

    // Create Project A
    const prjRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'prj-att-test-setup-001',
      },
      body: JSON.stringify({ name: 'Project Alpha' }),
    });
    assert.equal(prjRes.status, 201);
    const prjJson = (await prjRes.json()) as any;
    projectId = prjJson.data.id;

    // Create Project B (Sibling)
    const sibRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'prj-att-test-setup-002',
      },
      body: JSON.stringify({ name: 'Project Beta' }),
    });
    assert.equal(sibRes.status, 201);
    siblingProjectId = ((await sibRes.json()) as any).data.id;

    // Add PM, Member, Viewer to Project Alpha
    await pool.query(
      `INSERT INTO project_memberships (id, workspace_id, project_id, user_id, role, status, version, created_at, updated_at)
       VALUES
         ('pm_1', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
         ('pm_2', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
         ('pm_3', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW())
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
      [workspaceId, projectId, pmUser.id, memberUser.id, viewerUser.id],
    );

    // Add Sibling User to Project Beta only
    await pool.query(
      `INSERT INTO project_memberships (id, workspace_id, project_id, user_id, role, status, version, created_at, updated_at)
       VALUES ('pm_4', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'member', status = 'active'`,
      [workspaceId, siblingProjectId, siblingUser.id],
    );

    // Create Board in Project Alpha
    const brdRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
        'Idempotency-Key': 'brd-att-test-setup-001',
      },
      body: JSON.stringify({ name: 'Sprint Board' }),
    });
    assert.equal(brdRes.status, 201);
    boardId = ((await brdRes.json()) as any).data.id;

    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES
         ($1, $2, $3, $4, $7),
         ($1, $2, $3, $5, $7),
         ($1, $2, $3, $6, $7)`,
      [workspaceId, projectId, boardId, pmUser.id, memberUser.id, viewerUser.id, ownerUser.id],
    );

    // Fetch column
    const colRes = await pool.query<{ id: string }>('SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC LIMIT 1', [boardId]);
    columnId = colRes.rows[0]!.id;

    // Create Card
    const crdRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': 'crd-att-test-setup-001',
      },
      body: JSON.stringify({
        title: 'Card with attachments',
        columnId,
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(crdRes.status, 201);
    cardId = ((await crdRes.json()) as any).data.id;
  });

  // ==========================================================================
  // ATT-01: Image upload staging
  // ==========================================================================
  let validUploadId: string;
  const samplePng = createMinimalPng(200, 100);
  const samplePngSha = sha256Hex(samplePng);

  await t.test('ATT-01: Stage upload authorization and bounds', async () => {
    // 1. Unauthenticated request rejected
    const unauthRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': nextKey('att-01-unauth'),
      },
      body: JSON.stringify({
        filename: 'diagram.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Viewer cannot stage upload -> 403 FORBIDDEN
    const viewerRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: viewerCookie,
        'Idempotency-Key': nextKey('att-01-viewer'),
      },
      body: JSON.stringify({
        filename: 'diagram.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(viewerRes.status, 403);

    // 3. Sibling member querying card gets 404 NOT_FOUND (sibling project isolation)
    const sibRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: siblingCookie,
        'Idempotency-Key': nextKey('att-01-sibling'),
      },
      body: JSON.stringify({
        filename: 'diagram.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(sibRes.status, 404);

    // 4. Missing idempotency key -> 400 IDEMPOTENCY_KEY_REQUIRED
    const nokeyRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
      },
      body: JSON.stringify({
        filename: 'diagram.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(nokeyRes.status, 400);

    // 5. Invalid content type (SVG rejected) -> 400 or 422
    const svgRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-01-svg'),
      },
      body: JSON.stringify({
        filename: 'diagram.svg',
        byteLength: 500,
        contentType: 'image/svg+xml',
        sha256: samplePngSha,
      }),
    });
    assert.equal(svgRes.status, 422);

    // 6. Oversized byteLength (>10 MiB) -> 422
    const largeRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-01-large'),
      },
      body: JSON.stringify({
        filename: 'huge.png',
        byteLength: 10 * 1024 * 1024 + 1,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(largeRes.status, 422);

    // 7. Valid member staging upload succeeds
    const stageRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-01-stage-valid'),
      },
      body: JSON.stringify({
        filename: 'arch_diagram.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(stageRes.status, 201);
    const stageJson = (await stageRes.json()) as any;
    validUploadId = stageJson.data.id;
    assert.equal(stageJson.data.state, 'awaiting_content');
    assert.equal(stageJson.data.expectedBytes, samplePng.length);
    assert.equal(stageJson.data.receivedBytes, null);
    assert.equal(stageJson.data.finalizedImageId, null);
    assert.ok(stageJson.data.expiresAt);
    assert.ok(stageJson.data.serverNow);

    // 8. Progress inspect via GET /api/v1/image-uploads/:uploadId
    const inspectRes = await app.request(`/api/v1/image-uploads/${validUploadId}`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(inspectRes.status, 200);
    const inspectJson = (await inspectRes.json()) as any;
    assert.equal(inspectJson.data.id, validUploadId);
    assert.equal(inspectJson.data.state, 'awaiting_content');

    // 9. Cancel upload staging via DELETE /api/v1/image-uploads/:uploadId
    const cancelTargetRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-01-stage-cancel'),
      },
      body: JSON.stringify({
        filename: 'discard.png',
        byteLength: samplePng.length,
        contentType: 'image/png',
        sha256: samplePngSha,
      }),
    });
    assert.equal(cancelTargetRes.status, 201);
    const cancelTargetId = ((await cancelTargetRes.json()) as any).data.id;

    const cancelRes = await app.request(`/api/v1/image-uploads/${cancelTargetId}`, {
      method: 'DELETE',
      headers: { Cookie: memberCookie },
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as any;
    assert.equal(cancelJson.data.state, 'cancelled');
  });

  // ==========================================================================
  // ATT-02: Validate and finalize image
  // ==========================================================================
  let finalizedImageId: string;
  let finalizedImageVersion: number;

  await t.test('ATT-02: Binary upload, validation, spoofing rejection, and finalization', async () => {
    // 1. Binary payload size mismatch -> 400 SIZE_MISMATCH
    const badSizeRes = await app.request(`/api/v1/image-uploads/${validUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: Buffer.concat([samplePng, Buffer.from([1, 2, 3])]),
    });
    assert.equal(badSizeRes.status, 400);
    assert.equal(((await badSizeRes.json()) as any).error.code, 'SIZE_MISMATCH');

    // 2. Binary payload digest mismatch -> 400 DIGEST_MISMATCH
    const corruptedBytes = Buffer.from(samplePng);
    corruptedBytes[corruptedBytes.length - 1] = ((corruptedBytes[corruptedBytes.length - 1] ?? 0) + 1) % 256;
    const badDigestRes = await app.request(`/api/v1/image-uploads/${validUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: corruptedBytes,
    });
    assert.equal(badDigestRes.status, 400);
    assert.equal(((await badDigestRes.json()) as any).error.code, 'DIGEST_MISMATCH');

    // 3. Staged HTML markup spoofing as PNG -> 422 REJECTED_FORMAT
    const htmlSpoof = Buffer.from('<html><body><script>alert(1)</script></body></html>');
    const stageHtmlRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-02-stage-html'),
      },
      body: JSON.stringify({
        filename: 'spoof.png',
        byteLength: htmlSpoof.length,
        contentType: 'image/png',
        sha256: sha256Hex(htmlSpoof),
      }),
    });
    assert.equal(stageHtmlRes.status, 201);
    const htmlUploadId = ((await stageHtmlRes.json()) as any).data.id;

    const putHtmlRes = await app.request(`/api/v1/image-uploads/${htmlUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: htmlSpoof,
    });
    assert.equal(putHtmlRes.status, 422);
    assert.equal(((await putHtmlRes.json()) as any).error.code, 'REJECTED_FORMAT');

    // 4. Staged oversized dimensions (>8192px) -> 422 DIMENSIONS_EXCEEDED
    const hugePng = createMinimalPng(9000, 100);
    const stageHugeRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-02-stage-huge'),
      },
      body: JSON.stringify({
        filename: 'huge.png',
        byteLength: hugePng.length,
        contentType: 'image/png',
        sha256: sha256Hex(hugePng),
      }),
    });
    assert.equal(stageHugeRes.status, 201);
    const hugeUploadId = ((await stageHugeRes.json()) as any).data.id;

    const putHugeRes = await app.request(`/api/v1/image-uploads/${hugeUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: hugePng as any,
    });
    assert.equal(putHugeRes.status, 422);
    assert.equal(((await putHugeRes.json()) as any).error.code, 'DIMENSIONS_EXCEEDED');

    // 5. Staged oversized megapixels (>20 MP) -> 422 MEGAPIXELS_EXCEEDED
    // 5000 x 5000 = 25,000,000 pixels > 20,000,000
    const mpPng = createMinimalPng(5000, 5000);
    const stageMpRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-02-stage-mp'),
      },
      body: JSON.stringify({
        filename: 'mp.png',
        byteLength: mpPng.length,
        contentType: 'image/png',
        sha256: sha256Hex(mpPng),
      }),
    });
    assert.equal(stageMpRes.status, 201);
    const mpUploadId = ((await stageMpRes.json()) as any).data.id;

    const putMpRes = await app.request(`/api/v1/image-uploads/${mpUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: mpPng as any,
    });
    assert.equal(putMpRes.status, 422);
    assert.equal(((await putMpRes.json()) as any).error.code, 'MEGAPIXELS_EXCEEDED');

    // 6. Valid binary content upload succeeds and transitions to content_received
    const putValidRes = await app.request(`/api/v1/image-uploads/${validUploadId}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: memberCookie,
      },
      body: samplePng as any,
    });
    assert.equal(putValidRes.status, 200);
    const putValidJson = (await putValidRes.json()) as any;
    assert.equal(putValidJson.data.state, 'content_received');
    assert.equal(putValidJson.data.receivedBytes, samplePng.length);

    // 7. Finalize valid image upload
    const validFinKey = nextKey('att-02-fin-valid');
    const finRes = await app.request(`/api/v1/image-uploads/${validUploadId}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': validFinKey,
      },
    });
    assert.equal(finRes.status, 200);
    const finJson = (await finRes.json()) as any;
    finalizedImageId = finJson.data.id;
    finalizedImageVersion = finJson.data.version;
    assert.ok(finalizedImageId.startsWith('img_'));
    assert.equal(finJson.data.filename, 'arch_diagram.png');
    assert.equal(finJson.data.width, 200);
    assert.equal(finJson.data.height, 100);
    assert.equal(finJson.data.sha256, samplePngSha);
    assert.equal(finJson.data.uploaderId, memberUser.id);

    // Verify activity log recorded image_attached
    const actRes = await pool.query<{ action: string; card_id: string }>(
      `SELECT action, card_id FROM activity_log WHERE card_id = $1 AND action = 'image_attached'`,
      [cardId],
    );
    assert.equal(actRes.rows.length, 1);

    // 8. Idempotent retry on finalize returns same finalized record
    const finRetryRes = await app.request(`/api/v1/image-uploads/${validUploadId}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': validFinKey,
      },
    });
    assert.equal(finRetryRes.status, 200);
    assert.equal(((await finRetryRes.json()) as any).data.id, finalizedImageId);

    // 9. Also test JPEG and WebP formats
    const jpegBuf = createMinimalJpeg(300, 150);
    const stageJpeg = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-02-stage-jpeg'),
      },
      body: JSON.stringify({
        filename: 'photo.jpg',
        byteLength: jpegBuf.length,
        contentType: 'image/jpeg',
        sha256: sha256Hex(jpegBuf),
      }),
    });
    assert.equal(stageJpeg.status, 201);
    const jpegUploadId = ((await stageJpeg.json()) as any).data.id;

    const putJpeg = await app.request(`/api/v1/image-uploads/${jpegUploadId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: memberCookie },
      body: jpegBuf as any,
    });
    assert.equal(putJpeg.status, 200);

    const finJpeg = await app.request(`/api/v1/image-uploads/${jpegUploadId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memberCookie, 'Idempotency-Key': nextKey('att-02-fin-jpeg') },
    });
    assert.equal(finJpeg.status, 200);
    const finJpegJson = (await finJpeg.json()) as any;
    assert.equal(finJpegJson.data.contentType, 'image/jpeg');
    assert.equal(finJpegJson.data.width, 300);
    assert.equal(finJpegJson.data.height, 150);

    const webpBuf = createMinimalWebp(400, 250);
    const stageWebp = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-02-stage-webp'),
      },
      body: JSON.stringify({
        filename: 'banner.webp',
        byteLength: webpBuf.length,
        contentType: 'image/webp',
        sha256: sha256Hex(webpBuf),
      }),
    });
    assert.equal(stageWebp.status, 201);
    const webpUploadId = ((await stageWebp.json()) as any).data.id;

    const putWebp = await app.request(`/api/v1/image-uploads/${webpUploadId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: memberCookie },
      body: webpBuf as any,
    });
    assert.equal(putWebp.status, 200);

    const finWebp = await app.request(`/api/v1/image-uploads/${webpUploadId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memberCookie, 'Idempotency-Key': nextKey('att-02-fin-webp') },
    });
    assert.equal(finWebp.status, 200);
    const finWebpJson = (await finWebp.json()) as any;
    assert.equal(finWebpJson.data.contentType, 'image/webp');
    assert.equal(finWebpJson.data.width, 400);
    assert.equal(finWebpJson.data.height, 250);
  });

  // ==========================================================================
  // ATT-03: Card image gallery
  // ==========================================================================
  await t.test('ATT-03: Gallery listing shows finalized images only', async () => {
    // Stage an incomplete upload that has not finalized
    const incompletePng = createMinimalPng(10, 10);
    await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-03-incomplete'),
      },
      body: JSON.stringify({
        filename: 'ghost.png',
        byteLength: incompletePng.length,
        contentType: 'image/png',
        sha256: sha256Hex(incompletePng),
      }),
    });

    // List card images via GET /api/v1/cards/:cardId/images
    const listRes = await app.request(`/api/v1/cards/${cardId}/images`, {
      method: 'GET',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as any;
    // Exactly 3 finalized images (PNG, JPEG, WebP from ATT-02); the incomplete upload must NOT be listed
    assert.equal(listJson.data.items.length, 3);
    assert.equal(listJson.data.totalCount, 3);

    const filenames = listJson.data.items.map((i: any) => i.filename);
    assert.ok(filenames.includes('arch_diagram.png'));
    assert.ok(filenames.includes('photo.jpg'));
    assert.ok(filenames.includes('banner.webp'));
    assert.ok(!filenames.includes('ghost.png'));
  });

  // ==========================================================================
  // ATT-04: Private image delivery
  // ==========================================================================
  await t.test('ATT-04: Authenticated proxy delivery and security headers', async () => {
    // 1. Unauthenticated download rejected -> 401 UNAUTHORIZED
    const unauthFetch = await app.request(`/api/v1/images/${finalizedImageId}/content`, {
      method: 'GET',
    });
    assert.equal(unauthFetch.status, 401);

    // 2. Sibling project member rejected -> 404 NOT_FOUND
    const sibFetch = await app.request(`/api/v1/images/${finalizedImageId}/content`, {
      method: 'GET',
      headers: { Cookie: siblingCookie },
    });
    assert.equal(sibFetch.status, 404);

    // 3. Authorized project viewer receives image content
    const authFetch = await app.request(`/api/v1/images/${finalizedImageId}/content`, {
      method: 'GET',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(authFetch.status, 200);
    assert.equal(authFetch.headers.get('content-type'), 'image/png');
    assert.equal(authFetch.headers.get('cache-control'), 'private, no-cache, no-store, must-revalidate');
    assert.equal(authFetch.headers.get('x-content-type-options'), 'nosniff');
    const receivedBuf = Buffer.from(await authFetch.arrayBuffer());
    assert.equal(receivedBuf.length, samplePng.length);
    assert.equal(sha256Hex(receivedBuf), samplePngSha);

    // 4. Thumbnail proxy endpoint delivers image with same security headers
    const thumbFetch = await app.request(`/api/v1/images/${finalizedImageId}/thumbnail`, {
      method: 'GET',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(thumbFetch.status, 200);
    assert.equal(thumbFetch.headers.get('content-type'), 'image/png');
    assert.equal(thumbFetch.headers.get('cache-control'), 'private, no-cache, no-store, must-revalidate');
    assert.equal(thumbFetch.headers.get('x-content-type-options'), 'nosniff');

    // 5. Access revocation: remove viewer from project, next request immediately fails with 404
    await pool.query(
      `UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2`,
      [projectId, viewerUser.id],
    );
    const revokedFetch = await app.request(`/api/v1/images/${finalizedImageId}/content`, {
      method: 'GET',
      headers: { Cookie: viewerCookie },
    });
    assert.equal(revokedFetch.status, 404);

    // Restore viewer
    await pool.query(
      `UPDATE project_memberships SET status = 'active' WHERE project_id = $1 AND user_id = $2`,
      [projectId, viewerUser.id],
    );
  });

  // ==========================================================================
  // ATT-05: Remove attached image
  // ==========================================================================
  await t.test('ATT-05: Remove attached image with OCC, role check, and activity', async () => {
    // 1. Another member who did not upload cannot delete -> 403 FORBIDDEN
    const otherMember = await createSession('att-other@test.com', 'Other Member');
    await pool.query(
      `INSERT INTO project_memberships (id, workspace_id, project_id, user_id, role, status, version, created_at, updated_at)
       VALUES ('pm_other', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'member', status = 'active'`,
      [workspaceId, projectId, otherMember.user.id],
    );
    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, projectId, boardId, otherMember.user.id, ownerUser.id],
    );

    const forbiddenDel = await app.request(`/api/v1/images/${finalizedImageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: otherMember.cookie,
        'Idempotency-Key': nextKey('att-05-forbid'),
      },
      body: JSON.stringify({ expectedVersion: finalizedImageVersion }),
    });
    assert.equal(forbiddenDel.status, 403);

    // 2. Stale expectedVersion rejected -> 409 STALE_VERSION
    const staleDel = await app.request(`/api/v1/images/${finalizedImageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-05-stale'),
      },
      body: JSON.stringify({ expectedVersion: 9999 }),
    });
    assert.equal(staleDel.status, 409);

    // 3. Original uploader removes image successfully
    const delRes = await app.request(`/api/v1/images/${finalizedImageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-05-del-valid'),
      },
      body: JSON.stringify({ expectedVersion: finalizedImageVersion }),
    });
    assert.equal(delRes.status, 200);
    const delJson = (await delRes.json()) as any;
    assert.equal(delJson.data.success, true);
    assert.equal(delJson.data.imageId, finalizedImageId);

    // 4. Image is no longer in gallery
    const listAfterDel = await app.request(`/api/v1/cards/${cardId}/images`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(listAfterDel.status, 200);
    const listAfterJson = (await listAfterDel.json()) as any;
    assert.equal(listAfterJson.data.items.length, 2);
    assert.ok(!listAfterJson.data.items.some((i: any) => i.id === finalizedImageId));

    // 5. Subsequent content fetch returns 404 NOT_FOUND
    const fetchAfterDel = await app.request(`/api/v1/images/${finalizedImageId}/content`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(fetchAfterDel.status, 404);

    // 6. Verify image_removed was appended to activity_log
    const actDelRes = await pool.query<{ action: string }>(
      `SELECT action FROM activity_log WHERE card_id = $1 AND action = 'image_removed'`,
      [cardId],
    );
    assert.ok(actDelRes.rows.length >= 1);
  });

  // ==========================================================================
  // ATT-06: Orphan cleanup and storage limits
  // ==========================================================================
  await t.test('ATT-06: Quota enforcement (max 10) and orphan upload cleanup', async () => {
    // 1. Add images until reaching 10 attachments
    // Currently 2 images remain on the card (photo.jpg and banner.webp). We need 8 more.
    // Earlier subtests leave staged uploads that are still live on this card. They count toward the
    // cap (B-11), so cancel them first to start the fill from the finalized count.
    await pool.query(
      `UPDATE card_image_uploads SET state = 'cancelled', updated_at = NOW()
       WHERE card_id = $1 AND state IN ('awaiting_content', 'content_received', 'validating')`,
      [cardId],
    );
    for (let i = 1; i <= 8; i++) {
      const buf = createMinimalPng(10, 10);
      const stg = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: memberCookie,
          'Idempotency-Key': nextKey(`att-06-fill-${i}`),
        },
        body: JSON.stringify({
          filename: `fill_${i}.png`,
          byteLength: buf.length,
          contentType: 'image/png',
          sha256: sha256Hex(buf),
        }),
      });
      assert.equal(stg.status, 201);
      const uid = ((await stg.json()) as any).data.id;

      await app.request(`/api/v1/image-uploads/${uid}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: memberCookie },
        body: buf as any,
      });

      const fin = await app.request(`/api/v1/image-uploads/${uid}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: memberCookie, 'Idempotency-Key': nextKey(`att-06-fin-${i}`) },
      });
      assert.equal(fin.status, 200);
    }

    // Now card has exactly 10 finalized attachments
    const fullGallery = await app.request(`/api/v1/cards/${cardId}/images`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(((await fullGallery.json()) as any).data.items.length, 10);

    // 2. 11th staging request is rejected with 422 IMAGE_LIMIT_EXCEEDED
    const overflowBuf = createMinimalPng(10, 10);
    const overflowRes = await app.request(`/api/v1/cards/${cardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-06-overflow'),
      },
      body: JSON.stringify({
        filename: 'overflow.png',
        byteLength: overflowBuf.length,
        contentType: 'image/png',
        sha256: sha256Hex(overflowBuf),
      }),
    });
    assert.equal(overflowRes.status, 422);
    assert.equal(((await overflowRes.json()) as any).error.code, 'IMAGE_LIMIT_EXCEEDED');

    // 3. Test orphan cleanup: insert expired upload staging record directly
    const expiredUploadId = 'upl_expired_test';
    await pool.query(
      `INSERT INTO card_image_uploads (
         id, workspace_id, project_id, card_id, uploader_id,
         filename, byte_length, content_type, sha256,
         state, expires_at, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'expired.png', 100, 'image/png', 'abc',
         'awaiting_content', NOW() - INTERVAL '2 hours', 1, NOW(), NOW())`,
      [expiredUploadId, workspaceId, projectId, cardId, memberUser.id],
    );

    // Store staged dummy object in storage driver
    await memoryStorage.put(`staging/${expiredUploadId}/expired.png`, Buffer.from('dummy'), 'image/png');

    const cleanupResult = await cleanupOrphanUploads(pool);
    assert.ok(cleanupResult.cleanedCount >= 1);

    // Check storage driver cleaned
    const stagedCheck = await memoryStorage.get(`staging/${expiredUploadId}/expired.png`);
    assert.equal(stagedCheck, null);

    // Check DB state marked expired
    const expiredCheck = await pool.query<{ state: string }>(
      'SELECT state FROM card_image_uploads WHERE id = $1',
      [expiredUploadId],
    );
    assert.equal(expiredCheck.rows[0]?.state, 'expired');
  });

  // ==========================================================================
  // ATT-07: Attachment lifecycle in trash
  // ==========================================================================
  await t.test('ATT-07: Attachment preservation in trash, restore, and purge', async () => {
    // Create a new fresh card with an attachment specifically for trash testing
    const trashBoardRow = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const trashCardRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-07-trash-card'),
      },
      body: JSON.stringify({
        title: 'Card destined for trash',
        columnId,
        expectedBoardVersion: trashBoardRow.rows[0]!.structure_version,
      }),
    });
    assert.equal(trashCardRes.status, 201);
    const trashCardId = ((await trashCardRes.json()) as any).data.id;

    // Attach an image to trashCardId
    const trashPng = createMinimalPng(120, 80);
    const trashStg = await app.request(`/api/v1/cards/${trashCardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-07-stg'),
      },
      body: JSON.stringify({
        filename: 'trash_doc.png',
        byteLength: trashPng.length,
        contentType: 'image/png',
        sha256: sha256Hex(trashPng),
      }),
    });
    assert.equal(trashStg.status, 201);
    const trashUploadId = ((await trashStg.json()) as any).data.id;

    await app.request(`/api/v1/image-uploads/${trashUploadId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: memberCookie },
      body: trashPng as any,
    });

    const trashFin = await app.request(`/api/v1/image-uploads/${trashUploadId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memberCookie, 'Idempotency-Key': nextKey('att-07-fin') },
    });
    assert.equal(trashFin.status, 200);
    const trashImageId = ((await trashFin.json()) as any).data.id;

    // 1. Soft-delete the card
    const cardRow = await pool.query<{ version: number }>('SELECT version FROM cards WHERE id = $1', [trashCardId]);
    const boardRow = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);

    const delCardRes = await app.request(`/api/v1/cards/${trashCardId}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmCookie,
        'Idempotency-Key': nextKey('att-07-del-card'),
      },
      body: JSON.stringify({
        expectedVersion: cardRow.rows[0]!.version,
        expectedBoardVersion: boardRow.rows[0]!.structure_version,
      }),
    });
    assert.equal(delCardRes.status, 200);

    // 2. Normal reader cannot view image content of trashed card -> 404 NOT_FOUND
    const normalReaderFetch = await app.request(`/api/v1/images/${trashImageId}/content`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(normalReaderFetch.status, 404);

    // 3. New uploads cannot be staged on trashed card -> 409 CARD_TRASHED
    const blockedUploadRes = await app.request(`/api/v1/cards/${trashCardId}/image-uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-07-blocked-stg'),
      },
      body: JSON.stringify({
        filename: 'blocked.png',
        byteLength: trashPng.length,
        contentType: 'image/png',
        sha256: sha256Hex(trashPng),
      }),
    });
    assert.equal(blockedUploadRes.status, 409);

    // 4. Trashed card images cannot be deleted -> 409 CARD_TRASHED
    const blockedDelImg = await app.request(`/api/v1/images/${trashImageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: memberCookie,
        'Idempotency-Key': nextKey('att-07-blocked-del'),
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert.equal(blockedDelImg.status, 409);

    // 5. Restore the card
    const trashedCardRow = await pool.query<{ version: number }>('SELECT version FROM cards WHERE id = $1', [trashCardId]);
    const trashedBoardRow = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);

    const restoreRes = await app.request(`/api/v1/cards/${trashCardId}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmCookie,
        'Idempotency-Key': nextKey('att-07-restore-card'),
      },
      body: JSON.stringify({
        expectedVersion: trashedCardRow.rows[0]!.version,
        expectedBoardVersion: trashedBoardRow.rows[0]!.structure_version,
      }),
    });
    assert.equal(restoreRes.status, 200);

    // 6. After restore, normal reader can fetch image content again
    const restoredFetch = await app.request(`/api/v1/images/${trashImageId}/content`, {
      method: 'GET',
      headers: { Cookie: memberCookie },
    });
    assert.equal(restoredFetch.status, 200);
    assert.equal(restoredFetch.headers.get('content-type'), 'image/png');

    // 7. Re-delete card and advance restore_until to simulate 24-hour expiration for background purge
    const cardV3 = await pool.query<{ version: number }>('SELECT version FROM cards WHERE id = $1', [trashCardId]);
    const boardV3 = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);

    await app.request(`/api/v1/cards/${trashCardId}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pmCookie,
        'Idempotency-Key': nextKey('att-07-del-card-2'),
      },
      body: JSON.stringify({
        expectedVersion: cardV3.rows[0]!.version,
        expectedBoardVersion: boardV3.rows[0]!.structure_version,
      }),
    });

    // Artificially expire the restore window by setting restore_until in the past
    await pool.query(
      `UPDATE cards SET restore_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [trashCardId],
    );

    // Run purge worker
    const purgeResult = await purgeExpiredTrash(pool);
    assert.ok(purgeResult.purgedCardIds.includes(trashCardId));

    // Verify image record is deleted from DB
    const checkDbImage = await pool.query('SELECT id FROM card_images WHERE id = $1', [trashImageId]);
    assert.equal(checkDbImage.rows.length, 0);

    // Verify storage object was cleaned up
    const finalCheck = await memoryStorage.get(`images/${projectId}/${trashCardId}/${trashImageId}/trash_doc.png`);
    assert.equal(finalCheck, null);
  });
});
