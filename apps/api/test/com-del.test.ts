import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { processPendingStorageDeletions } from '../src/services/trash-purge.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { restoreCard } from '../src/adapters/trash.ts';
import { getStorageDriver, MemoryStorageDriver, setStorageDriver } from '../src/adapters/storage.ts';
import type {
  Comment,
  TrashRow,
  Card,
  CommentListResponse,
  TrashListResponse,
} from '@flowboard/contracts';

test('COM-01 to COM-06 & DEL-01 to DEL-08: Comments, Mentions & Trash Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceId = 'usr_alice_owner';
  const bobId = 'usr_bob_manager';
  const charlieId = 'usr_charlie_member';
  const daveId = 'usr_dave_viewer';
  const eveId = 'usr_eve_outsider';
  const frankId = 'usr_frank_sibling';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let daveCookie = '';
  let eveCookie = '';

  const wsId = 'ws_com_del_test';
  const prjAId = 'prj_a_com_del';
  const prjBId = 'prj_b_sibling';
  const brdId = 'brd_a_com_del';
  const colTodoId = 'col_todo_com_del';
  const colDoneId = 'col_done_com_del';
  const colTempId = 'col_temp_com_del';
  const card1Id = 'card_1_com_del';
  const card2Id = 'card_2_com_del';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE pending_storage_deletions, workspaces, users, sessions, idempotency_receipts, projects, project_memberships, boards, columns, cards, card_assignees, comments, comment_mentions, notifications, activity_log, outbox CASCADE;',
      );

      // 1. Seed users
      const users = [
        [aliceId, 'alice@flowboard.example', 'Alice Owner'],
        [bobId, 'bob@flowboard.example', 'Bob Manager'],
        [charlieId, 'charlie@flowboard.example', 'Charlie Member'],
        [daveId, 'dave@flowboard.example', 'Dave Viewer'],
        [eveId, 'eve@flowboard.example', 'Eve Outsider'],
        [frankId, 'frank@flowboard.example', 'Frank Sibling'],
      ];

      for (const [id, email, name] of users) {
        await client.query(
          `INSERT INTO users (id, email, display_name, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())`,
          [id, email, name],
        );
      }

      // 2. Create sessions
      const sAlice = await createSession(aliceId, 24, client);
      aliceCookie = `flowboard_session=${sAlice.id}`;

      const sBob = await createSession(bobId, 24, client);
      bobCookie = `flowboard_session=${sBob.id}`;

      const sCharlie = await createSession(charlieId, 24, client);
      charlieCookie = `flowboard_session=${sCharlie.id}`;

      const sDave = await createSession(daveId, 24, client);
      daveCookie = `flowboard_session=${sDave.id}`;

      const sEve = await createSession(eveId, 24, client);
      eveCookie = `flowboard_session=${sEve.id}`;

      // 3. Workspace
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, 'Main Workspace', 'UTC', $2, 1, NOW(), NOW())`,
        [wsId, aliceId],
      );

      // 4. Projects
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Project A', FALSE, 1, NOW(), NOW()),
                ($3, $2, 'Project B (Sibling)', FALSE, 1, NOW(), NOW())`,
        [prjAId, wsId, prjBId],
      );

      // 5. Memberships in Project A:
      // Alice is workspace owner (implicit owner)
      // Bob is manager, Charlie is member, Dave is viewer
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES 
           ('pm_bob', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
           ('pm_charlie', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
           ('pm_dave', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW()),
           ('pm_frank', $6, $2, $7, 'member', 'active', 1, NOW(), NOW())`,
        [prjAId, wsId, bobId, charlieId, daveId, prjBId, frankId],
      );

      // 6. Board in Project A
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, 'Development Board', 1, 1, FALSE, NOW(), NOW())`,
        [brdId, wsId, prjAId],
      );

      // Board Grants for Bob (manager), Charlie (member), Dave (viewer)
      await client.query(
        `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
         VALUES
           ($1, $2, $3, $4, $7),
           ($1, $2, $3, $5, $7),
           ($1, $2, $3, $6, $7)`,
        [brdId, prjAId, wsId, bobId, charlieId, daveId, aliceId],
      );

      // 7. Columns
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES 
           ($1, $2, $3, $4, 'To Do', '#6b7280', 'todo', 1000, 1, NOW(), NOW()),
           ($5, $2, $3, $4, 'Done', '#10b981', 'done', 2000, 1, NOW(), NOW()),
           ($6, $2, $3, $4, 'Temp Column', '#ef4444', 'todo', 3000, 1, NOW(), NOW())`,
        [colTodoId, wsId, prjAId, brdId, colDoneId, colTempId],
      );

      // 8. Cards
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, position, version, state, created_at, updated_at)
         VALUES 
           ($1, $2, $3, $4, $5, 'Card 1 Title', 'Description for card 1', 'medium', 1000, 1, 'active', NOW(), NOW()),
           ($6, $2, $3, $4, $5, 'Card 2 Title', 'Description for card 2', 'high', 2000, 1, 'active', NOW(), NOW())`,
        [card1Id, wsId, prjAId, brdId, colTodoId, card2Id],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  // =========================================================================
  // COM-02: Post comment authorization & validation
  // =========================================================================

  await t.test('COM-02: Viewers cannot post comments (403 FORBIDDEN)', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_viewer_01',
        Cookie: daveCookie,
      },
      body: JSON.stringify({ body: 'Viewer trying to comment' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  await t.test('COM-02: Outsiders receive 404 NOT_FOUND on comment post', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_outsider_01',
        Cookie: eveCookie,
      },
      body: JSON.stringify({ body: 'Outsider comment' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  await t.test('COM-02: Comment post requires mandatory Idempotency-Key header', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'Missing idempotency key' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  await t.test('COM-02: Comment body validation (rejects empty or whitespace-only body)', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_empty_body',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: '    ' }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  let postedCommentId = '';

  await t.test('COM-02: Member posts valid comment with outbox and activity_log', async () => {
    const initialBoardRes = await pool.query<{ snapshot_version: number }>(
      'SELECT snapshot_version FROM boards WHERE id = $1',
      [brdId],
    );
    const initialSnapshotVersion = initialBoardRes.rows[0]!.snapshot_version;

    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_charlie_001',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'Hello this is Charlie commenting on Card 1' }),
    });
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: Comment; replayed: boolean };
    assert.equal(json.replayed, false);
    assert.ok(json.data.id);
    assert.equal(json.data.body, 'Hello this is Charlie commenting on Card 1');
    assert.equal(json.data.authorId, charlieId);
    assert.equal(json.data.author?.displayName, 'Charlie Member');
    assert.equal(json.data.version, 1);
    postedCommentId = json.data.id;

    // Verify outbox entry
    const outboxRes = await pool.query<{ id: string; event_type: string }>(
      `SELECT id, event_type FROM outbox WHERE project_id = $1 AND event_type = 'comment.created'`,
      [prjAId],
    );
    assert.ok(outboxRes.rows.length >= 1);

    // Verify activity_log entry
    const actRes = await pool.query<{ id: string; action: string }>(
      `SELECT id, action FROM activity_log WHERE card_id = $1 AND action = 'comment_created'`,
      [card1Id],
    );
    assert.ok(actRes.rows.length >= 1);

    // Verify board snapshot_version incremented
    const afterBoardRes = await pool.query<{ snapshot_version: number }>(
      'SELECT snapshot_version FROM boards WHERE id = $1',
      [brdId],
    );
    assert.equal(afterBoardRes.rows[0]!.snapshot_version, initialSnapshotVersion + 1);
  });

  await t.test('COM-02: Idempotency replay returns identical comment with replayed=true', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_charlie_001',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'Hello this is Charlie commenting on Card 1' }),
    });
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: Comment; replayed: boolean };
    assert.equal(json.replayed, true);
    assert.equal(json.data.id, postedCommentId);

    const receipt = await pool.query<{ response_body: unknown }>(
      'SELECT response_body FROM idempotency_receipts WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3',
      [charlieId, prjAId, 'idem_cmt_charlie_001'],
    );
    assert.equal(receipt.rows.length, 1);
    assert.equal(JSON.stringify(receipt.rows[0]!.response_body).includes('Hello this is Charlie commenting on Card 1'), false);
    assert.deepEqual(receipt.rows[0]!.response_body, {
      data: { id: postedCommentId, projectId: prjAId, version: 1 },
    });

    await pool.query(
      `UPDATE project_memberships SET role = 'viewer' WHERE project_id = $1 AND user_id = $2`,
      [prjAId, charlieId],
    );
    try {
      const revokedReplay = await app.request(`/api/v1/cards/${card1Id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem_cmt_charlie_001',
          Cookie: charlieCookie,
        },
        body: JSON.stringify({ body: 'Hello this is Charlie commenting on Card 1' }),
      });
      assert.equal(revokedReplay.status, 403);
    } finally {
      await pool.query(
        `UPDATE project_memberships SET role = 'member' WHERE project_id = $1 AND user_id = $2`,
        [prjAId, charlieId],
      );
    }
  });

  await t.test('COM-02: Idempotency conflict on same key with different body', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_charlie_001',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'A different body on the same key' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  // =========================================================================
  // COM-03: Mentions validation, privacy & notification creation
  // =========================================================================

  await t.test('COM-03: Rejects overlapping mention spans', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_overlap_01',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        body: 'Hey @Bob and @Alice check this',
        mentions: [
          { userId: bobId, start: 4, end: 12 },
          { userId: aliceId, start: 10, end: 18 }, // overlaps with 12
        ],
      }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('COM-03: Rejects mentions of sibling project users or non-members', async () => {
    // Frank is only in Project B (sibling project)
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_sibling_mention',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        body: 'Hey @Frank from sibling project',
        mentions: [{ userId: frankId, start: 4, end: 10 }],
      }),
    });
    assert.equal(res.status, 400); // 400 or 422
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  await t.test('COM-03: Valid mentions notify teammates but self-mentions do NOT notify', async () => {
    // Charlie mentions Bob and himself
    const bodyText = 'Hey @Bob and @Charlie please check';
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_mention_success',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        body: bodyText,
        mentions: [
          { userId: bobId, start: 4, end: 8 },
          { userId: charlieId, start: 13, end: 21 },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: Comment };
    assert.equal(json.data.mentions.length, 2);

    // Verify notifications table
    const notifsBob = await pool.query<{ user_id: string; title: string; link: string; card_id: string | null }>(
      'SELECT user_id, title, link, card_id FROM notifications WHERE user_id = $1',
      [bobId],
    );
    assert.ok(notifsBob.rows.length >= 1);
    assert.ok(notifsBob.rows[0]!.title.includes('Charlie'));
    assert.ok(notifsBob.rows[0]!.link.includes(card1Id));
    assert.equal(notifsBob.rows[0]!.card_id, card1Id);

    // Self-mention check: Charlie should NOT have received a notification for his own comment
    const notifsCharlie = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND title LIKE '%mentioned you%'`,
      [charlieId],
    );
    assert.equal(notifsCharlie.rows.length, 0);
  });

  // =========================================================================
  // COM-01: List comments & author display identity
  // =========================================================================

  await t.test('COM-01: GET /cards/:cardId/comments returns chronological comments for readers', async () => {
    // Dave (viewer) can read comments
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      headers: { Cookie: daveCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as CommentListResponse;
    assert.ok(json.data.length >= 2);
    // Chronological order verification
    const dates = json.data.map((c) => new Date(c.createdAt).getTime());
    for (let i = 0; i < dates.length - 1; i++) {
      assert.ok(dates[i]! <= dates[i + 1]!);
    }
    // Author identity verification
    const first = json.data[0]!;
    assert.ok(first.author);
    assert.equal(first.author?.displayName, 'Charlie Member');
    assert.equal(first.author?.activeInProject, true);
  });

  await t.test('COM-01: Outsiders receive 404 NOT_FOUND on comment listing', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(res.status, 404);
  });

  await t.test('COM-01: Comment cursor pages are card-scoped and stable across inserts', async () => {
    const firstPageResponse = await app.request(`/api/v1/cards/${card1Id}/comments?limit=1`, {
      headers: { Cookie: daveCookie },
    });
    assert.equal(firstPageResponse.status, 200);
    const firstPage = (await firstPageResponse.json()) as CommentListResponse;
    assert.equal(firstPage.data.length, 1);
    assert.ok(firstPage.nextCursor);

    // A newly inserted later comment must not shift the keyset boundary.
    const inserted = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_cursor_insert_between_pages',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'Comment added after page one was read' }),
    });
    assert.equal(inserted.status, 201);
    const insertedJson = (await inserted.json()) as { data: Comment };

    const secondPageResponse = await app.request(
      `/api/v1/cards/${card1Id}/comments?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(secondPageResponse.status, 200);
    const secondPage = (await secondPageResponse.json()) as CommentListResponse;
    assert.equal(secondPage.data.length, 1);
    assert.notEqual(secondPage.data[0]!.id, firstPage.data[0]!.id);
    assert.ok(new Date(secondPage.data[0]!.createdAt) >= new Date(firstPage.data[0]!.createdAt));
    assert.ok(secondPage.nextCursor);

    const thirdPageResponse = await app.request(
      `/api/v1/cards/${card1Id}/comments?limit=1&cursor=${encodeURIComponent(secondPage.nextCursor!)}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(thirdPageResponse.status, 200);
    const thirdPage = (await thirdPageResponse.json()) as CommentListResponse;
    assert.equal(thirdPage.data.length, 1);
    assert.equal(thirdPage.data[0]!.id, insertedJson.data.id);

    const malformed = await app.request(`/api/v1/cards/${card1Id}/comments?cursor=not-a-cursor`, {
      headers: { Cookie: daveCookie },
    });
    assert.equal(malformed.status, 409);
    assert.equal((await malformed.json()).error.code, 'STALE_CURSOR');

    const wrongCard = await app.request(
      `/api/v1/cards/${card2Id}/comments?cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(wrongCard.status, 409);
    assert.equal((await wrongCard.json()).error.code, 'STALE_CURSOR');
  });

  // =========================================================================
  // COM-04: Edit own comment & OCC checks
  // =========================================================================

  await t.test('COM-04: Non-author cannot edit another user comment (403 FORBIDDEN)', async () => {
    // Bob (manager) tries to edit Charlie's comment
    const res = await app.request(`/api/v1/comments/${postedCommentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_edit_non_author',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        body: 'Bob trying to edit Charlie comment',
        expectedVersion: 1,
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  await t.test('COM-04: Edit comment OCC conflict returns 409 STALE_VERSION', async () => {
    // Charlie sends expectedVersion = 99
    const res = await app.request(`/api/v1/comments/${postedCommentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_edit_stale',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        body: 'Updated body with wrong version',
        expectedVersion: 99,
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'STALE_VERSION');
  });

  await t.test('COM-04: Author successfully edits comment and increments version', async () => {
    const res = await app.request(`/api/v1/comments/${postedCommentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_edit_success',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({
        body: 'Successfully updated comment body by Charlie',
        expectedVersion: 1,
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Comment };
    assert.equal(json.data.body, 'Successfully updated comment body by Charlie');
    assert.equal(json.data.version, 2);
  });

  // =========================================================================
  // COM-05: Delete comment & Tombstones
  // =========================================================================

  await t.test('COM-05: Regular member cannot delete another member comment (403 FORBIDDEN)', async () => {
    // First Bob posts a comment
    const postRes = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_bob_comment_to_del',
        Cookie: bobCookie,
      },
      body: JSON.stringify({ body: 'Bob comment for deletion test' }),
    });
    assert.equal(postRes.status, 201);
    const bobCmt = (await postRes.json()) as { data: Comment };

    // Charlie (member) attempts to delete Bob's comment -> 403
    const delRes = await app.request(`/api/v1/comments/${bobCmt.data.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_charlie_del_bob_fail',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert.equal(delRes.status, 403);
  });

  await t.test('COM-05: Workspace owner moderates and deletes comment', async () => {
    // Alice (owner) deletes Bob's comment
    const bobCmtRes = await pool.query<{ id: string; version: number }>(
      `SELECT id, version FROM comments WHERE author_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [bobId],
    );
    const cmt = bobCmtRes.rows[0]!;

    const delRes = await app.request(`/api/v1/comments/${cmt.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_owner_mod_delete',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({ expectedVersion: cmt.version }),
    });
    assert.equal(delRes.status, 200);

    // Verify row still exists in DB (tombstone)
    const checkDb = await pool.query<{ deleted_at: Date | null; version: number }>(
      'SELECT deleted_at, version FROM comments WHERE id = $1',
      [cmt.id],
    );
    assert.ok(checkDb.rows[0]!.deleted_at !== null);

    // Verify tombstone in listing
    const listRes = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      headers: { Cookie: bobCookie },
    });
    const listJson = (await listRes.json()) as CommentListResponse;
    const tombstone = listJson.data.find((c) => c.id === cmt.id);
    assert.ok(tombstone);
    assert.equal(tombstone.body, '[Comment deleted]');
    assert.equal(tombstone.mentions.length, 0);
  });

  await t.test('COM-05: Author deletes their own comment', async () => {
    const delRes = await app.request(`/api/v1/comments/${postedCommentId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_author_delete_own',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ expectedVersion: 2 }),
    });
    assert.equal(delRes.status, 200);
  });

  // =========================================================================
  // DEL-01: Soft delete card
  // =========================================================================

  await t.test('DEL-01: Regular member/viewer cannot delete card (403 FORBIDDEN)', async () => {
    const resMember = await app.request(`/api/v1/cards/${card1Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card_member_fail',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: 1 }),
    });
    assert.equal(resMember.status, 403);

    const resViewer = await app.request(`/api/v1/cards/${card1Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card_viewer_fail',
        Cookie: daveCookie,
      },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: 1 }),
    });
    assert.equal(resViewer.status, 403);
  });

  await t.test('DEL-01: Delete card OCC check returns 409 STALE_VERSION', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card_stale',
        Cookie: bobCookie,
      },
      body: JSON.stringify({ expectedVersion: 99, expectedBoardVersion: 1 }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'STALE_VERSION');
  });

  await t.test('DEL-01: Manager soft-deletes card with 24-hour restore window and board version increment', async () => {
    const boardBefore = await pool.query<{ structure_version: number; snapshot_version: number }>(
      'SELECT structure_version, snapshot_version FROM boards WHERE id = $1',
      [brdId],
    );

    const res = await app.request(`/api/v1/cards/${card1Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card_success',
        Cookie: bobCookie,
      },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: boardBefore.rows[0]!.structure_version }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Card; replayed: boolean };
    assert.equal(json.data.state, 'trashed');
    assert.equal(json.data.deletedBy, bobId);
    assert.ok(json.data.deletedAt);
    assert.ok(json.data.restoreUntil);

    // Verify 24-hour restore window calculation (within 10 seconds of 24h = 86400000ms)
    const delAt = new Date(json.data.deletedAt!).getTime();
    const restUntil = new Date(json.data.restoreUntil!).getTime();
    const diffHours = (restUntil - delAt) / (1000 * 60 * 60);
    assert.ok(Math.abs(diffHours - 24) < 0.01, `Expected ~24h difference, got ${diffHours}h`);

    // Verify board versions incremented
    const boardAfter = await pool.query<{ structure_version: number; snapshot_version: number }>(
      'SELECT structure_version, snapshot_version FROM boards WHERE id = $1',
      [brdId],
    );
    assert.equal(boardAfter.rows[0]!.structure_version, boardBefore.rows[0]!.structure_version + 1);
    assert.equal(boardAfter.rows[0]!.snapshot_version, boardBefore.rows[0]!.snapshot_version + 1);

    // Verify activity_log
    const actRes = await pool.query<{ id: string; action: string }>(
      `SELECT id, action FROM activity_log WHERE card_id = $1 AND action = 'card_trashed'`,
      [card1Id],
    );
    assert.ok(actRes.rows.length >= 1);
  });

  // =========================================================================
  // DEL-08 & COM-06: Interaction guards on trashed cards
  // =========================================================================

  await t.test('DEL-08: Trashed card returns 404 NOT_FOUND on direct GET /cards/:cardId', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(res.status, 404);
  });

  await t.test('DEL-08: Trashed card comments return 404 NOT_FOUND on GET /cards/:cardId/comments', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(res.status, 404);
  });

  await t.test('COM-06: Posting comment on trashed card is rejected with 400 CARD_IS_TRASHED', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_cmt_on_trashed_fail',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ body: 'Trying to comment on trashed card' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'CARD_IS_TRASHED');
  });

  // =========================================================================
  // DEL-02: Project trash listing
  // =========================================================================

  await t.test('DEL-02: Non-administrators (members/viewers) receive 403 on trash listing', async () => {
    const resMember = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(resMember.status, 403);

    const resViewer = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: daveCookie },
    });
    assert.equal(resViewer.status, 403);

    const resOutsider = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(resOutsider.status, 404);
  });

  await t.test('DEL-02: Owner and Manager can list trash with canRestore and blockedReason details', async () => {
    // Insert an additional trashed card to verify bounded pagination
    const extraTrashId = 'card_extra_trash_01';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Extra Trash', 'none', 9999, 2, 'trashed', NOW() - INTERVAL '10 minutes', $6, NOW() + INTERVAL '23 hours', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [extraTrashId, wsId, prjAId, brdId, colTodoId, bobId],
    );

    // 1. Unbounded / full list
    const res = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as TrashListResponse;
    assert.ok(json.serverNow);
    assert.ok(json.data.length >= 1);

    const item = json.data.find((c) => c.id === card1Id);
    assert.ok(item);
    assert.equal(item.canRestore, true);
    assert.equal(item.blockedReason, null);
    assert.equal(item.deletedBy, bobId);
    assert.ok(item.actor);
    assert.equal(item.actor?.displayName, 'Bob Manager');

    // 2. Bounded pagination: limit=1
    const p1Res = await app.request(`/api/v1/projects/${prjAId}/trash?limit=1`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(p1Res.status, 200);
    const p1Json = (await p1Res.json()) as TrashListResponse;
    assert.equal(p1Json.data.length, 1);
    assert.ok(p1Json.nextCursor, 'Must have nextCursor for page 2');

    // 3. Resume with cursor
    const p2Res = await app.request(`/api/v1/projects/${prjAId}/trash?limit=1&cursor=${p1Json.nextCursor}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(p2Res.status, 200);
    const p2Json = (await p2Res.json()) as TrashListResponse;
    assert.equal(p2Json.data.length, 1);
    assert.notEqual(p2Json.data[0]!.id, p1Json.data[0]!.id);

    // 4. Stale/forged cursor returns 409 STALE_CURSOR
    const staleRes = await app.request(`/api/v1/projects/${prjAId}/trash?cursor=invalid_base64_json`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(staleRes.status, 409);
    assert.equal((await staleRes.json()).error.code, 'STALE_CURSOR');
  });

  // =========================================================================
  // DEL-03: Restore card before deadline
  // =========================================================================

  await t.test('DEL-03: Non-admin cannot restore card (403 FORBIDDEN)', async () => {
    const res = await app.request(`/api/v1/cards/${card1Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_member_fail',
        Cookie: charlieCookie,
      },
      body: JSON.stringify({ expectedVersion: 2, expectedBoardVersion: 2 }),
    });
    assert.equal(res.status, 403);
  });

  await t.test('DEL-03: Manager restores card before deadline with OCC checks', async () => {
    const boardRes = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const boardStructureVersion = boardRes.rows[0]!.structure_version;

    const res = await app.request(`/api/v1/cards/${card1Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_success',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 2, // card version was 1, incremented to 2 on delete
        expectedBoardVersion: boardStructureVersion,
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Card };
    assert.equal(json.data.id, card1Id);
    assert.equal(json.data.state, 'active');
    assert.equal(json.data.deletedAt, null);
    assert.equal(json.data.deletedBy, null);
    assert.equal(json.data.restoreUntil, null);

    // Verify activity_log
    const actRes = await pool.query<{ id: string; action: string }>(
      `SELECT id, action FROM activity_log WHERE card_id = $1 AND action = 'card_restored'`,
      [card1Id],
    );
    assert.ok(actRes.rows.length >= 1);

    // Verify card is now accessible again
    const getRes = await app.request(`/api/v1/cards/${card1Id}`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(getRes.status, 200);
  });

  // =========================================================================
  // DEL-04: Restore destination conflict handling
  // =========================================================================

  await t.test('DEL-04: Destination missing requires explicit toColumnId', async () => {
    // 1. Move card2 to colTemp and soft delete card2
    await pool.query('UPDATE cards SET column_id = $1 WHERE id = $2', [colTempId, card2Id]);

    const boardRes = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const boardVer = boardRes.rows[0]!.structure_version;

    const delRes = await app.request(`/api/v1/cards/${card2Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card2_001',
        Cookie: bobCookie,
      },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: boardVer }),
    });
    assert.equal(delRes.status, 200);

    // 2. Delete colTemp from columns table (disable trigger on columns to simulate orphan trashed card)
    await pool.query('ALTER TABLE columns DISABLE TRIGGER ALL;');
    await pool.query('DELETE FROM columns WHERE id = $1', [colTempId]);
    await pool.query('ALTER TABLE columns ENABLE TRIGGER ALL;');

    // 3. Trash listing should now show destination_missing
    const trashRes = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(trashRes.status, 200);
    const trashJson = (await trashRes.json()) as TrashListResponse;
    const card2Item = trashJson.data.find((c) => c.id === card2Id);
    assert.ok(card2Item);
    assert.equal(card2Item.canRestore, false);
    assert.equal(card2Item.blockedReason, 'destination_missing');

    // 4. Attempt to restore without toColumnId -> 409 RESTORE_DESTINATION_REQUIRED
    const boardRes2 = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const restoreFailRes = await app.request(`/api/v1/cards/${card2Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_card2_no_dest',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: boardRes2.rows[0]!.structure_version,
      }),
    });
    assert.equal(restoreFailRes.status, 409);
    const failBody = await restoreFailRes.json();
    assert.equal(failBody.error.code, 'RESTORE_DESTINATION_REQUIRED');
    assert.equal(failBody.error.details.reason, 'destination_missing');

    // 5. Restore with invalid toColumnId from non-existent column -> 400 INVALID_DESTINATION
    const restoreInvalidColRes = await app.request(`/api/v1/cards/${card2Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_card2_invalid_dest',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: boardRes2.rows[0]!.structure_version,
        toColumnId: 'col_non_existent',
      }),
    });
    assert.equal(restoreInvalidColRes.status, 400);

    // 6. Restore with valid toColumnId -> succeeds
    const restoreSuccessRes = await app.request(`/api/v1/cards/${card2Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_card2_valid_dest',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: boardRes2.rows[0]!.structure_version,
        toColumnId: colDoneId,
      }),
    });
    assert.equal(restoreSuccessRes.status, 200);
    const restoredCard2 = (await restoreSuccessRes.json()) as { data: Card };
    assert.equal(restoredCard2.data.columnId, colDoneId);
    assert.equal(restoredCard2.data.state, 'active');
  });

  // =========================================================================
  // DEL-05: Strict 24-hour restore window expiry
  // =========================================================================

  await t.test('DEL-05: Expired restore returns HTTP 410 RESTORE_WINDOW_EXPIRED with details', async () => {
    // 1. Soft delete card1 again
    const boardRes = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const delRes = await app.request(`/api/v1/cards/${card1Id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_del_card1_again',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 3, // version was 3 after restore
        expectedBoardVersion: boardRes.rows[0]!.structure_version,
      }),
    });
    assert.equal(delRes.status, 200);

    // 2. Simulate expiration by setting restore_until into the past in the database
    await pool.query(
      `UPDATE cards SET restore_until = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [card1Id],
    );

    // 3. Trash listing should report window_expired
    const trashRes = await app.request(`/api/v1/projects/${prjAId}/trash`, {
      headers: { Cookie: bobCookie },
    });
    const trashJson = (await trashRes.json()) as TrashListResponse;
    const card1Trash = trashJson.data.find((c) => c.id === card1Id);
    assert.ok(card1Trash);
    assert.equal(card1Trash.canRestore, false);
    assert.equal(card1Trash.blockedReason, 'window_expired');

    // 4. Attempt to restore expired card -> 410 RESTORE_WINDOW_EXPIRED
    const boardResAfter = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const restoreExpiredRes = await app.request(`/api/v1/cards/${card1Id}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_expired_card1',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 4,
        expectedBoardVersion: boardResAfter.rows[0]!.structure_version,
      }),
    });
    assert.equal(restoreExpiredRes.status, 410);
    const errBody = await restoreExpiredRes.json();
    assert.equal(errBody.error.code, 'RESTORE_WINDOW_EXPIRED');
    assert.ok(errBody.error.details.serverNow);
    assert.ok(errBody.error.details.restoreUntil);
  });

  await t.test('Archived project and board reject card and comment writes atomically', async () => {
    const commentRes = await app.request(`/api/v1/cards/${card2Id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archive_seed_comment', Cookie: charlieCookie },
      body: JSON.stringify({ body: 'Comment for archived-context checks' }),
    });
    assert.equal(commentRes.status, 201);
    const seeded = (await commentRes.json()) as { data: Comment };

    const versionRes = await pool.query<{ card_version: number; board_version: number }>(
      `SELECT c.version AS card_version, b.structure_version AS board_version
       FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.id = $1`,
      [card2Id],
    );
    const cardVersion = versionRes.rows[0]!.card_version;
    const boardVersion = versionRes.rows[0]!.board_version;

    await pool.query('UPDATE boards SET archived = TRUE WHERE id = $1', [brdId]);
    try {
      const requests: Array<[string, () => Response | Promise<Response>]> = [
        ['card create', () => app.request(`/api/v1/boards/${brdId}/cards`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_create', Cookie: charlieCookie },
          body: JSON.stringify({ title: 'Should not exist', columnId: colTodoId, expectedBoardVersion: boardVersion }),
        })],
        ['card update', () => app.request(`/api/v1/cards/${card2Id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_update', Cookie: charlieCookie },
          body: JSON.stringify({ title: 'Should not update', expectedVersion: cardVersion }),
        })],
        ['card move', () => app.request(`/api/v1/cards/${card2Id}/move`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_move', Cookie: charlieCookie },
          body: JSON.stringify({ toColumnId: colDoneId, previousCardId: null, nextCardId: null, expectedVersion: cardVersion, expectedBoardVersion: boardVersion }),
        })],
        ['comment post', () => app.request(`/api/v1/cards/${card2Id}/comments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_post', Cookie: charlieCookie },
          body: JSON.stringify({ body: 'Should not post' }),
        })],
        ['comment edit', () => app.request(`/api/v1/comments/${seeded.data.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_edit', Cookie: charlieCookie },
          body: JSON.stringify({ body: 'Should not edit', expectedVersion: 1 }),
        })],
        ['comment delete', () => app.request(`/api/v1/comments/${seeded.data.id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_comment_delete', Cookie: charlieCookie },
          body: JSON.stringify({ expectedVersion: 1 }),
        })],
        ['card delete', () => app.request(`/api/v1/cards/${card2Id}/delete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_card_delete', Cookie: bobCookie },
          body: JSON.stringify({ expectedVersion: cardVersion, expectedBoardVersion: boardVersion }),
        })],
      ];

      for (const [label, request] of requests) {
        const response = await request();
        assert.equal(response.status, 409, `${label} should fail with 409`);
        assert.equal((await response.json()).error.code, 'READ_ONLY_CONTEXT', `${label} should identify archived context`);
      }
    } finally {
      await pool.query('UPDATE boards SET archived = FALSE WHERE id = $1', [brdId]);
    }

    await pool.query('UPDATE projects SET archived = TRUE WHERE id = $1', [prjAId]);
    try {
      const response = await app.request(`/api/v1/cards/${card2Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_archived_project_update', Cookie: charlieCookie },
        body: JSON.stringify({ title: 'Should not update project archive', expectedVersion: cardVersion }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'READ_ONLY_CONTEXT');
    } finally {
      await pool.query('UPDATE projects SET archived = FALSE WHERE id = $1', [prjAId]);
    }
  });

  await t.test('Comment delete replay rechecks moderator authority after role demotion', async () => {
    const seed = await app.request(`/api/v1/cards/${card2Id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_moderator_replay_seed', Cookie: charlieCookie },
      body: JSON.stringify({ body: 'Comment moderated by Bob' }),
    });
    assert.equal(seed.status, 201);
    const comment = (await seed.json()) as { data: Comment };
    const path = `/api/v1/comments/${comment.data.id}`;
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_moderator_delete_replay', Cookie: bobCookie };
    const body = JSON.stringify({ expectedVersion: comment.data.version });

    const first = await app.request(path, { method: 'DELETE', headers, body });
    assert.equal(first.status, 200);

    await pool.query("UPDATE project_memberships SET role = 'member' WHERE project_id = $1 AND user_id = $2", [prjAId, bobId]);
    try {
      const replay = await app.request(path, { method: 'DELETE', headers, body });
      assert.equal(replay.status, 403);
      assert.equal((await replay.json()).error.code, 'FORBIDDEN');
    } finally {
      await pool.query("UPDATE project_memberships SET role = 'manager' WHERE project_id = $1 AND user_id = $2", [prjAId, bobId]);
    }
  });

  await t.test('Comment post retry respects current parent-card trash state', async () => {
    const key = 'idem_comment_retry_after_trash';
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': key, Cookie: charlieCookie };
    const body = JSON.stringify({ body: 'This retry must not replay after trash' });
    const first = await app.request(`/api/v1/cards/${card2Id}/comments`, { method: 'POST', headers, body });
    assert.equal(first.status, 201);
    const comment = (await first.json()) as { data: Comment };

    const editPath = `/api/v1/comments/${comment.data.id}`;
    const editBody = JSON.stringify({ body: 'Edited before the card is trashed', expectedVersion: 1 });
    const editHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_comment_edit_retry_after_trash', Cookie: charlieCookie };
    assert.equal((await app.request(editPath, { method: 'PATCH', headers: editHeaders, body: editBody })).status, 200);
    const deleteBody = JSON.stringify({ expectedVersion: 2 });
    const deleteHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_comment_delete_retry_after_trash', Cookie: charlieCookie };
    assert.equal((await app.request(editPath, { method: 'DELETE', headers: deleteHeaders, body: deleteBody })).status, 200);

    const state = await pool.query<{ version: number; structure_version: number }>(
      `SELECT c.version, b.structure_version FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.id = $1`,
      [card2Id],
    );
    const trash = await app.request(`/api/v1/cards/${card2Id}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_trash_after_comment_replay', Cookie: bobCookie },
      body: JSON.stringify({ expectedVersion: state.rows[0]!.version, expectedBoardVersion: state.rows[0]!.structure_version }),
    });
    assert.equal(trash.status, 200);

    const retry = await app.request(`/api/v1/cards/${card2Id}/comments`, { method: 'POST', headers, body });
    assert.equal(retry.status, 400);
    assert.equal((await retry.json()).error.code, 'CARD_IS_TRASHED');

    const editRetry = await app.request(editPath, { method: 'PATCH', headers: editHeaders, body: editBody });
    assert.equal(editRetry.status, 400);
    assert.equal((await editRetry.json()).error.code, 'CARD_IS_TRASHED');
    const deleteRetry = await app.request(editPath, { method: 'DELETE', headers: deleteHeaders, body: deleteBody });
    assert.equal(deleteRetry.status, 400);
    assert.equal((await deleteRetry.json()).error.code, 'CARD_IS_TRASHED');
  });

  // =========================================================================
  // DEL-06: Purge worker, content scrubbing, restore concurrency & fenced winner
  // =========================================================================

  await t.test('DEL-06: Background purge worker, private content redaction, and fenced winner race', async () => {
    // 1. Create a trashed card with expired restore_until and private content
    const expiredCardId = 'crd_purge_expired_1';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, position, version, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Secret Card Title', 'Top secret card description', 'high', 5000, 2, 'trashed', NOW() - INTERVAL '25 hours', $6, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '25 hours', NOW() - INTERVAL '25 hours')`,
      [expiredCardId, wsId, prjAId, brdId, colTodoId, bobId],
    );

    // Add private comment on this card
    const comPurgeId = 'com_purge_1';
    await pool.query(
      `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Top secret comment content that must be purged', 1, NOW() - INTERVAL '24 hours', NOW() - INTERVAL '24 hours')`,
      [comPurgeId, wsId, prjAId, expiredCardId, charlieId],
    );

    // Add mention notification
    const notifPurgeId = 'notif_purge_1';
    await pool.query(
      `INSERT INTO notifications (id, workspace_id, project_id, user_id, type, title, body, link, read, created_at, card_id)
       VALUES ($1, $2, $3, $4, 'mention', 'Mention notification', 'Excerpt of top secret comment', $5, FALSE, NOW() - INTERVAL '24 hours', $6)`,
      [notifPurgeId, wsId, prjAId, bobId, `/projects/${prjAId}/boards/${brdId}?cardId=${expiredCardId}`, expiredCardId],
    );

    // Same card ID as a substring in an unrelated notification link must not redact it.
    const neighborCardId = `prefix_${expiredCardId}_suffix`;
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Unrelated card', 'none', 6000, 1, 'active', NOW(), NOW())`,
      [neighborCardId, wsId, prjAId, brdId, colTodoId],
    );
    await pool.query(
      `INSERT INTO notifications (id, workspace_id, project_id, user_id, type, title, body, link, read, created_at, card_id)
       VALUES ('notif_purge_collision', $1, $2, $3, 'mention', 'Unrelated', 'Keep this body', $4, FALSE, NOW(), $5)`,
      [wsId, prjAId, bobId, `/projects/${prjAId}/boards/${brdId}?cardId=${neighborCardId}`, neighborCardId],
    );

    // A failed object-store delete must keep a durable retry key while removing the DB image.
    const storageKey = `images/${prjAId}/${expiredCardId}/purge-retry.png`;
    await pool.query(
      `INSERT INTO card_images (id, workspace_id, project_id, card_id, uploader_id, filename, byte_length, content_type, storage_key, sha256, created_at, updated_at)
       VALUES ('img_purge_retry', $1, $2, $3, $4, 'purge-retry.png', 1, 'image/png', $5, 'abc', NOW(), NOW())`,
      [wsId, prjAId, expiredCardId, bobId, storageKey],
    );
    const originalStorage = getStorageDriver();
    const retryStorage = new MemoryStorageDriver();
    await retryStorage.put(storageKey, new Uint8Array([1]), 'image/png');
    let failFirstDelete = true;
    const deleteOnceFails = {
      put: retryStorage.put.bind(retryStorage),
      get: retryStorage.get.bind(retryStorage),
      delete: async (key: string) => {
        if (key === storageKey && failFirstDelete) {
          failFirstDelete = false;
          throw new Error('temporary storage outage');
        }
        await retryStorage.delete(key);
      },
    };
    setStorageDriver(deleteOnceFails);

    // Add activity log
    const actPurgeId = 'act_purge_1';
    await pool.query(
      `INSERT INTO activity_log (id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at)
       VALUES ($1, $2, $3, $4, $5, 'card_trashed', $6, NOW() - INTERVAL '24 hours')`,
      [actPurgeId, wsId, prjAId, expiredCardId, bobId, JSON.stringify({ cardId: expiredCardId, title: 'Secret Card Title' })],
    );

    // 2. Purge wins first: the expired card is purged before a restore can lock it.
    const purgeRes = await purgeExpiredTrash(pool, { asOfDate: new Date() });

    // Purge worker claimed and purged the expired card
    assert.ok(purgeRes.claimedCount >= 1);
    assert.ok(purgeRes.purgedCardIds.includes(expiredCardId));
    setStorageDriver(originalStorage);

    const boardBeforeRestoreAttempt = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1', [brdId],
    );
    const restoreAttemptRes = await app.request(`/api/v1/cards/${expiredCardId}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_purge_wins_restore',
        Cookie: bobCookie,
      },
      body: JSON.stringify({ expectedVersion: 3, expectedBoardVersion: boardBeforeRestoreAttempt.rows[0]!.structure_version }),
    });
    // Restore is rejected after the purge transition wins.
    assert.ok([404, 410].includes(restoreAttemptRes.status));

    // 3. Verify private content scrubbing on the purged card:
    const cardCheck = await pool.query<{ state: string; title: string; description: string | null }>(
      'SELECT state, title, description FROM cards WHERE id = $1',
      [expiredCardId],
    );
    assert.equal(cardCheck.rows[0]!.state, 'purged');
    assert.equal(cardCheck.rows[0]!.title, '[Purged card]');
    assert.equal(cardCheck.rows[0]!.description, null);

    // Comments body scrubbed to empty string
    const comCheck = await pool.query<{ body: string }>(
      'SELECT body FROM comments WHERE id = $1',
      [comPurgeId],
    );
    assert.equal(comCheck.rows[0]!.body, '');

    // Notifications scrubbed
    const notifCheck = await pool.query<{ body: string; link: string }>(
      'SELECT body, link FROM notifications WHERE id = $1',
      [notifPurgeId],
    );
    assert.equal(notifCheck.rows[0]!.body, '[Card content purged]');
    assert.equal(notifCheck.rows[0]!.link, '#');
    const collisionCheck = await pool.query<{ body: string; link: string }>(
      "SELECT body, link FROM notifications WHERE id = 'notif_purge_collision'",
    );
    assert.equal(collisionCheck.rows[0]!.body, 'Keep this body');
    assert.ok(collisionCheck.rows[0]!.link.includes(neighborCardId));

    const imageRow = await pool.query("SELECT id FROM card_images WHERE id = 'img_purge_retry'");
    assert.equal(imageRow.rows.length, 0);
    const pendingKey = await pool.query<{ storage_key: string }>(
      'SELECT storage_key FROM pending_storage_deletions WHERE storage_key = $1',
      [storageKey],
    );
    assert.equal(pendingKey.rows[0]?.storage_key, storageKey);
    const stillStored = await retryStorage.get(storageKey);
    assert.ok(stillStored, 'failed object deletion must remain retryable');
    await pool.query('UPDATE pending_storage_deletions SET next_retry_at = NOW() WHERE storage_key = $1', [storageKey]);
    setStorageDriver(retryStorage);
    const cleanupRetry = await processPendingStorageDeletions(pool);
    assert.equal(cleanupRetry.deletedCount, 1);
    assert.equal(await retryStorage.get(storageKey), null);
    assert.equal((await pool.query('SELECT storage_key FROM pending_storage_deletions WHERE storage_key = $1', [storageKey])).rows.length, 0);
    setStorageDriver(originalStorage);

    // 4. Any subsequent restore attempt on the purged card returns 404 NOT_FOUND (fenced winner)
    const boardRes = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [brdId],
    );
    const restorePurgedRes = await app.request(`/api/v1/cards/${expiredCardId}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_restore_purged_winner_002',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        expectedVersion: 3,
        expectedBoardVersion: boardRes.rows[0]!.structure_version,
      }),
    });
    assert.equal(restorePurgedRes.status, 404);

    // A delayed mention outbox event cannot re-create private notification text after purge.
    const delayedOutboxId = 'out_purged_comment_retry';
    await pool.query(
      `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at)
       VALUES ($1, $2, $3, 'comment.created', $4, 'pending', 0, NOW(), NOW())`,
      [delayedOutboxId, wsId, prjAId, JSON.stringify({ commentId: comPurgeId, cardId: expiredCardId, authorId: charlieId, mentions: [bobId] })],
    );
    await processOutboxLease(pool);
    const delayedNotifications = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE card_id = $1',
      [expiredCardId],
    );
    assert.equal(Number(delayedNotifications.rows[0]!.count), 1);

    // 5. Restore wins while holding the row lock; the purge worker must SKIP LOCKED.
    const restoreFirstId = 'crd_restore_wins_purge';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, deleted_at, deleted_by, restore_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Restore wins', 'none', 700000, 2, 'trashed', NOW() - INTERVAL '1 hour', $6, NOW() + INTERVAL '1 hour', NOW() - INTERVAL '1 hour', NOW())`,
      [restoreFirstId, wsId, prjAId, brdId, colTodoId, bobId],
    );
    const restoreClient = await pool.connect();
    try {
      await restoreClient.query('BEGIN');
      const boardVersion = await restoreClient.query<{ structure_version: number }>(
        'SELECT structure_version FROM boards WHERE id = $1', [brdId],
      );
      await restoreCard(
        restoreClient,
        restoreFirstId,
        { expectedVersion: 2, expectedBoardVersion: boardVersion.rows[0]!.structure_version },
        bobId,
      );
      const skippedPurge = await purgeExpiredTrash(pool, { asOfDate: new Date(Date.now() + 2 * 60 * 60 * 1000) });
      assert.equal(skippedPurge.purgedCardIds.includes(restoreFirstId), false);
      await restoreClient.query('COMMIT');
    } catch (error) {
      await restoreClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      restoreClient.release();
    }
    const restoreFirstState = await pool.query<{ state: string }>(
      'SELECT state FROM cards WHERE id = $1', [restoreFirstId],
    );
    assert.equal(restoreFirstState.rows[0]!.state, 'active');

    // 6. Re-anchor to the surviving next neighbor when the original previous neighbor disappears.
    const beforeAnchorId = 'crd_reanchor_before';
    const anchorTargetId = 'crd_reanchor_target';
    const afterAnchorId = 'crd_reanchor_after';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Before anchor', 'none', 910000, 1, 'active', NOW(), NOW()),
              ($6, $2, $3, $4, $5, 'Restore between anchors', 'none', 920000, 1, 'active', NOW(), NOW()),
              ($7, $2, $3, $4, $5, 'After anchor', 'none', 930000, 1, 'active', NOW(), NOW())`,
      [beforeAnchorId, wsId, prjAId, brdId, colTodoId, anchorTargetId, afterAnchorId],
    );
    const boardBeforeAnchorDelete = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1', [brdId],
    );
    const anchorDelete = await app.request(`/api/v1/cards/${anchorTargetId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_reanchor_delete', Cookie: bobCookie },
      body: JSON.stringify({ expectedVersion: 1, expectedBoardVersion: boardBeforeAnchorDelete.rows[0]!.structure_version }),
    });
    assert.equal(anchorDelete.status, 200);
    await pool.query("UPDATE cards SET state = 'trashed' WHERE id = $1", [beforeAnchorId]);
    const boardBeforeAnchorRestore = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1', [brdId],
    );
    const anchorRestore = await app.request(`/api/v1/cards/${anchorTargetId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem_reanchor_restore', Cookie: bobCookie },
      body: JSON.stringify({ expectedVersion: 2, expectedBoardVersion: boardBeforeAnchorRestore.rows[0]!.structure_version }),
    });
    assert.equal(anchorRestore.status, 200);
    const reanchored = await pool.query<{ id: string; position: string }>(
      `SELECT id, position::text AS position FROM cards
       WHERE column_id = $1 AND state = 'active' AND id IN ($2, $3)
       ORDER BY position ASC, id ASC`,
      [colTodoId, anchorTargetId, afterAnchorId],
    );
    assert.deepEqual(reanchored.rows.map((row) => row.id), [anchorTargetId, afterAnchorId]);
    assert.ok(Number(reanchored.rows[0]!.position) < Number(reanchored.rows[1]!.position));
  });
});
