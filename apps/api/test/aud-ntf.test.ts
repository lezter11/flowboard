import assert from 'node:assert/strict';
import { insertWorkspaceForCookie } from './support/workspace-fixture.ts';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { redactCardActivity } from '../src/adapters/activity.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';

let keyCounter = Date.now();
function nextKey(prefix = 'aud-idem'): string {
  keyCounter++;
  return `${prefix}-${keyCounter}-abcdef123456`;
}

test('AUD-01 to AUD-06 & NTF-01 to NTF-03: Activity & Notifications Test Suite', async (t) => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env['DATABASE_URL']),
    max: 5,
    connectionTimeoutMillis: 5_000,
  });

  const app = createApp(async () => { await pool.query('SELECT 1'); }, { pool });

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        `TRUNCATE 
           workspaces, users, sessions, idempotency_receipts, 
           projects, project_memberships, project_invitations, 
           boards, columns, cards, card_assignees, comments, comment_mentions, 
           activity_log, notifications, outbox 
         CASCADE;`,
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
  });

  // Session helper
  async function createSession(email: string, name: string): Promise<{ cookie: string; user: any }> {
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Secret': process.env['DEV_LOGIN_SECRET'] || 'flowboard-dev-secret',
      },
      body: JSON.stringify({ email, displayName: name }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
    const json = (await res.json()) as any;
    return { cookie, user: json.data.actor };
  }

  // Hierarchy IDs
  let owner: { cookie: string; user: any };
  let manager: { cookie: string; user: any };
  let member: { cookie: string; user: any };
  let viewer: { cookie: string; user: any };
  let siblingMember: { cookie: string; user: any };
  let outsider: { cookie: string; user: any };

  let workspaceId: string;
  let projectId: string;
  let siblingProjectId: string;
  let boardId: string;
  let col1Id: string;
  let col2Id: string;
  let cardId: string;

  await t.test('0. Setup Workspace, Projects, Members and Initial Board Structure', async () => {
    owner = await createSession('owner@flowboard.test', 'Workspace Owner');
    manager = await createSession('manager@flowboard.test', 'Project Manager');
    member = await createSession('member@flowboard.test', 'Project Member');
    viewer = await createSession('viewer@flowboard.test', 'Project Viewer');
    siblingMember = await createSession('sibling@flowboard.test', 'Sibling Member');
    outsider = await createSession('outsider@flowboard.test', 'Complete Outsider');

    // 1. Owner creates workspace
    // B-20: POST /api/v1/workspaces is retired; the fixture inserts the owner's workspace.
    workspaceId = (await insertWorkspaceForCookie(owner.cookie, { name: 'Activity Audit Workspace' })).id;

    // 2. Owner creates Project 1
    const p1Res = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('p1-create'),
      },
      body: JSON.stringify({ name: 'Project Alpha' }),
    });
    assert.equal(p1Res.status, 201);
    const p1Json = (await p1Res.json()) as any;
    projectId = p1Json.data.id;

    // 3. Owner creates Sibling Project 2
    const p2Res = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('p2-create'),
      },
      body: JSON.stringify({ name: 'Project Beta' }),
    });
    assert.equal(p2Res.status, 201);
    const p2Json = (await p2Res.json()) as any;
    siblingProjectId = p2Json.data.id;

    // 4. Add memberships in Project 1
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
         VALUES 
           ('pm_mgr', $1, $2, $3, 'manager', 'active', NOW(), NOW()),
           ('pm_mem', $1, $2, $4, 'member', 'active', NOW(), NOW()),
           ('pm_viw', $1, $2, $5, 'viewer', 'active', NOW(), NOW()),
           ('pm_sib', $6, $2, $7, 'member', 'active', NOW(), NOW());`,
        [projectId, workspaceId, manager.user.id, member.user.id, viewer.user.id, siblingProjectId, siblingMember.user.id],
      );
    } finally {
      client.release();
    }

    // 5. Owner creates board in Project 1
    const bRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('board-create'),
      },
      body: JSON.stringify({ name: 'Main Board' }),
    });
    assert.equal(bRes.status, 201);
    const bJson = (await bRes.json()) as any;
    boardId = bJson.data.id;
    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES
         ($1, $2, $3, $4, $7),
         ($1, $2, $3, $5, $7),
         ($1, $2, $3, $6, $7)`,
      [workspaceId, projectId, boardId, manager.user.id, member.user.id, viewer.user.id, owner.user.id],
    );
    const colRes = await pool.query<{ id: string }>(
      'SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId],
    );
    col1Id = colRes.rows[0]!.id;
    col2Id = colRes.rows[1]!.id;
    assert.ok(col1Id && col2Id);
  });

  await t.test('AUD-01 & AUD-02: Card Activity Timeline and Movement History', async () => {
    // 1. Member creates Card 1 in col1
    const cRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Initial Task Title',
        description: 'First version of description',
        priority: 'low',
        dueDate: '2026-11-15',
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(cRes.status, 201);
    const cJson = (await cRes.json()) as any;
    cardId = cJson.data.id;
    assert.ok(cardId);

    // 2. Member updates card fields (title, priority, assignees)
    const updateRes = await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-update'),
      },
      body: JSON.stringify({
        title: 'Updated Task Title',
        priority: 'high',
        expectedVersion: 1,
        assigneeIds: [manager.user.id],
      }),
    });
    assert.equal(updateRes.status, 200);

    // 3. Member moves card from col1 to col2
    const moveRes = await app.request(`/api/v1/cards/${cardId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-move'),
      },
      body: JSON.stringify({
        toColumnId: col2Id,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 2,
        expectedBoardVersion: 2,
      }),
    });
    assert.equal(moveRes.status, 200);

    // 4. Member posts a comment
    const commentRes = await app.request(`/api/v1/cards/${cardId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('comment-create'),
      },
      body: JSON.stringify({
        body: 'Working on this task now.',
        mentions: [],
      }),
    });
    assert.equal(commentRes.status, 201);

    // 5. Query Card Activity timeline as Workspace Owner
    const actRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(actRes.status, 200);
    const actJson = (await actRes.json()) as any;
    assert.ok(Array.isArray(actJson.data));
    assert.equal(actJson.data.length, 4); // card_created, card_updated, card_moved, comment_created

    // Verify chronological order (created_at ASC)
    const actions = actJson.data.map((item: any) => item.action);
    assert.deepEqual(actions, ['card_created', 'card_updated', 'card_moved', 'comment_created']);

    // AUD-02: Verify safe_changes projection
    const createItem = actJson.data[0];
    assert.equal(createItem.action, 'card_created');
    assert.equal(createItem.safeChanges.title, 'Initial Task Title');
    assert.equal(createItem.safeChanges.columnId, col1Id);
    assert.equal(createItem.actorId, member.user.id);
    assert.ok(createItem.actor);
    assert.equal(createItem.actor.displayName, 'Project Member');

    const updateItem = actJson.data[1];
    assert.equal(updateItem.action, 'card_updated');
    assert.deepEqual(updateItem.safeChanges.title, { old: 'Initial Task Title', new: 'Updated Task Title' });
    assert.deepEqual(updateItem.safeChanges.priority, { old: 'low', new: 'high' });
    assert.deepEqual(updateItem.safeChanges.assignees, { added: [manager.user.id], removed: [] });

    const moveItem = actJson.data[2];
    assert.equal(moveItem.action, 'card_moved');
    assert.equal(moveItem.safeChanges.fromColumnId, col1Id);
    assert.equal(moveItem.safeChanges.toColumnId, col2Id);
    assert.ok(moveItem.safeChanges.fromColumnTitle);
    assert.ok(moveItem.safeChanges.toColumnTitle);
    assert.ok(typeof moveItem.safeChanges.fromPosition === 'number');
    assert.ok(typeof moveItem.safeChanges.toPosition === 'number');

    // 6. Test cursor pagination on Card Activity (limit=2)
    const page1Res = await app.request(`/api/v1/cards/${cardId}/activity?limit=2`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(page1Res.status, 200);
    const page1Json = (await page1Res.json()) as any;
    assert.equal(page1Json.data.length, 2);
    assert.ok(page1Json.nextCursor);

    const page2Res = await app.request(`/api/v1/cards/${cardId}/activity?limit=2&cursor=${encodeURIComponent(page1Json.nextCursor)}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(page2Res.status, 200);
    const page2Json = (await page2Res.json()) as any;
    assert.equal(page2Json.data.length, 2);
    assert.equal(page2Json.nextCursor, null);
    assert.equal(page2Json.data[0].action, 'card_moved');
    assert.equal(page2Json.data[1].action, 'comment_created');

    // 7. Authorization checks
    // Project Reader (viewer) can view card activity
    const viewerActRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      headers: { 'Cookie': viewer.cookie },
    });
    assert.equal(viewerActRes.status, 200);

    // Sibling project member receives 404 NOT_FOUND
    const sibActRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      headers: { 'Cookie': siblingMember.cookie },
    });
    assert.equal(sibActRes.status, 404);

    // Complete outsider receives 404 NOT_FOUND
    const outActRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      headers: { 'Cookie': outsider.cookie },
    });
    assert.equal(outActRes.status, 404);
  });

  await t.test('AUD-03: Workspace Owner Cross-Project Activity & Sibling Privacy', async () => {
    // 1. Create a card in Sibling Project 2 so workspace has events across both projects
    const b2Res = await app.request(`/api/v1/projects/${siblingProjectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('b2-create'),
      },
      body: JSON.stringify({ name: 'Beta Board' }),
    });
    assert.equal(b2Res.status, 201);
    const b2Json = (await b2Res.json()) as any;
    const b2BoardId = b2Json.data.id;
    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, siblingProjectId, b2BoardId, siblingMember.user.id, owner.user.id],
    );
    const b2Cols = await pool.query<{ id: string }>(
      'SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [b2BoardId],
    );
    const b2Col1Id = b2Cols.rows[0]!.id;

    const sibCardRes = await app.request(`/api/v1/boards/${b2BoardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': siblingMember.cookie,
        'Idempotency-Key': nextKey('sib-card-create'),
      },
      body: JSON.stringify({
        columnId: b2Col1Id,
        title: 'Sibling Task Beta',
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(sibCardRes.status, 201);

    // 2. Owner queries workspace activity: should see events from both Project 1 and Project 2
    const wsActRes = await app.request(`/api/v1/workspaces/${workspaceId}/activity`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(wsActRes.status, 200);
    const wsActJson = (await wsActRes.json()) as any;
    assert.ok(Array.isArray(wsActJson.data));
    assert.ok(wsActJson.data.length >= 5);

    const projectIds = new Set(wsActJson.data.map((i: any) => i.projectId));
    assert.ok(projectIds.has(projectId), 'Contains Project 1 events');
    assert.ok(projectIds.has(siblingProjectId), 'Contains Project 2 events');

    // 3. Owner filters by project
    const filteredRes = await app.request(`/api/v1/workspaces/${workspaceId}/activity?projectId=${projectId}`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(filteredRes.status, 200);
    const filteredJson = (await filteredRes.json()) as any;
    assert.ok(filteredJson.data.every((i: any) => i.projectId === projectId));

    // 4. Sibling privacy: Project Manager / Member cannot query workspace activity (403 FORBIDDEN)
    const mgrWsRes = await app.request(`/api/v1/workspaces/${workspaceId}/activity`, {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(mgrWsRes.status, 403);

    const memWsRes = await app.request(`/api/v1/workspaces/${workspaceId}/activity`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(memWsRes.status, 403);

    // Outsider gets 404 NOT_FOUND
    const outWsRes = await app.request(`/api/v1/workspaces/${workspaceId}/activity`, {
      headers: { 'Cookie': outsider.cookie },
    });
    assert.equal(outWsRes.status, 404);
  });

  await t.test('AUD-04: Manager vs Member vs Viewer Audit Scopes', async () => {
    // 1. Project Manager queries project-wide activity: succeeds (200 OK)
    const mgrPrjRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(mgrPrjRes.status, 200);
    const mgrPrjJson = (await mgrPrjRes.json()) as any;
    assert.ok(Array.isArray(mgrPrjJson.data));
    assert.ok(mgrPrjJson.data.length >= 4);

    // 2. Workspace Owner can also query project-wide activity
    const ownerPrjRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(ownerPrjRes.status, 200);

    // 3. Project Member receives 403 FORBIDDEN on project-wide activity (AUD-04)
    const memPrjRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(memPrjRes.status, 403);

    // 4. Project Viewer receives 403 FORBIDDEN on project-wide activity (AUD-04)
    const viewPrjRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': viewer.cookie },
    });
    assert.equal(viewPrjRes.status, 403);

    // 5. Outsider receives 404 NOT_FOUND
    const outPrjRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': outsider.cookie },
    });
    assert.equal(outPrjRes.status, 404);
  });

  await t.test('AUD-06: Append-only Immutability and Retention Redaction', async () => {
    // 1. Verify that no user-facing mutation routes exist for activity logs
    const postRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      method: 'POST',
      headers: { 'Cookie': owner.cookie },
      body: JSON.stringify({ action: 'tampered' }),
    });
    assert.equal(postRes.status, 404);

    const deleteRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      method: 'DELETE',
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(deleteRes.status, 404);

    // 2. Execute retention redaction helper on card activity
    const client = await pool.connect();
    try {
      await redactCardActivity(client, cardId);
    } finally {
      client.release();
    }

    // 3. Verify activity rows persist with actor and timestamp, but safe_changes is sanitized
    const actRes = await app.request(`/api/v1/cards/${cardId}/activity`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(actRes.status, 200);
    const actJson = (await actRes.json()) as any;
    assert.ok(actJson.data.length >= 4);

    for (const item of actJson.data) {
      assert.deepEqual(item.safeChanges, { cardId, purged: true });
      assert.ok(item.actorId);
      assert.ok(item.action);
      assert.ok(item.createdAt);
    }
  });

  await t.test('NTF-01: Durable In-App Mention Inbox & Self-Mention Omission', async () => {
    // 1. Member creates a new card for discussion testing
    const c2Res = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('c2-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Notification Mention Test Card',
        expectedBoardVersion: 3,
      }),
    });
    assert.equal(c2Res.status, 201);
    const c2Json = (await c2Res.json()) as any;
    const testCardId = c2Json.data.id;

    // 2. Member posts comment mentioning Manager AND Member (self-mention)
    const commentBody = 'Hey @Manager please review, and @Member check this';
    const commentRes = await app.request(`/api/v1/cards/${testCardId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('mention-comment'),
      },
      body: JSON.stringify({
        body: commentBody,
        mentions: [
          { userId: manager.user.id, start: 4, end: 12 },
          { userId: member.user.id, start: 31, end: 38 }, // Self-mention
        ],
      }),
    });
    assert.equal(commentRes.status, 201);

    // 3. Verify Manager receives notification in inbox
    const mgrInboxRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(mgrInboxRes.status, 200);
    const mgrInbox = (await mgrInboxRes.json()) as any;
    assert.ok(Array.isArray(mgrInbox.data));
    assert.ok(mgrInbox.data.length >= 1);

    const mentionNotif = mgrInbox.data.find((n: any) => n.link.includes(testCardId));
    assert.ok(mentionNotif, 'Manager received notification with card link');
    assert.equal(mentionNotif.type, 'mention');
    assert.equal(mentionNotif.read, false);
    assert.ok(mentionNotif.title.includes('mentioned you'));

    // 4. Verify Member (the author) did NOT receive a self-mention notification
    const memInboxRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(memInboxRes.status, 200);
    const memInbox = (await memInboxRes.json()) as any;
    const selfNotif = memInbox.data.find((n: any) => n.link.includes(testCardId));
    assert.equal(selfNotif, undefined, 'Self-mention notification was omitted');

    // 5. Test pagination on notifications
    const pagedRes = await app.request('/api/v1/notifications?limit=1', {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(pagedRes.status, 200);
    const pagedJson = (await pagedRes.json()) as any;
    assert.equal(pagedJson.data.length, 1);
  });

  await t.test('NTF-02: Inbox Read State & Access Revocation Redaction', async () => {
    // 1. Fetch unread notification for Manager
    const inboxRes = await app.request('/api/v1/notifications?unreadOnly=true', {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(inboxRes.status, 200);
    const inboxJson = (await inboxRes.json()) as any;
    assert.ok(inboxJson.data.length >= 1);
    const targetNotifId = inboxJson.data[0].id;

    // 2. Mark individual notification read
    const patchRes = await app.request(`/api/v1/notifications/${targetNotifId}/read`, {
      method: 'PATCH',
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as any;
    assert.equal(patchJson.data.id, targetNotifId);
    assert.equal(patchJson.data.read, true);

    // 3. Unauthorized actor cannot mark another user's notification as read
    const hackRes = await app.request(`/api/v1/notifications/${targetNotifId}/read`, {
      method: 'PATCH',
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(hackRes.status, 404);

    // 4. Batch mark all read
    const batchRes = await app.request('/api/v1/notifications/mark-all-read', {
      method: 'POST',
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(batchRes.status, 200);
    const batchJson = (await batchRes.json()) as any;
    assert.equal(batchJson.data.success, true);

    // Verify unread list is now empty
    const emptyRes = await app.request('/api/v1/notifications?unreadOnly=true', {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(emptyRes.status, 200);
    const emptyJson = (await emptyRes.json()) as any;
    assert.equal(emptyJson.data.length, 0);

    // 5. Access Revocation: remove Viewer membership, verify their notifications are hidden/redacted
    // Post a comment mentioning Viewer first
    const vCommentRes = await app.request(`/api/v1/cards/${cardId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('mention-viewer'),
      },
      body: JSON.stringify({
        body: 'Hello @Viewer checking in',
        mentions: [{ userId: viewer.user.id, start: 6, end: 13 }],
      }),
    });
    assert.equal(vCommentRes.status, 201);

    // Viewer initially sees notification
    const vInitRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': viewer.cookie },
    });
    assert.equal(vInitRes.status, 200);
    const vInitJson = (await vInitRes.json()) as any;
    assert.ok(vInitJson.data.length >= 1);
    const vNotifId = vInitJson.data[0].id;

    // Revoke Viewer membership (status = 'removed')
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2",
        [projectId, viewer.user.id],
      );
    } finally {
      client.release();
    }

    // Viewer inbox now excludes/hides notifications from revoked project (NTF-01, NTF-02)
    const vRevokedRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': viewer.cookie },
    });
    assert.equal(vRevokedRes.status, 200);
    const vRevokedJson = (await vRevokedRes.json()) as any;
    assert.equal(vRevokedJson.data.length, 0, 'Revoked project notifications are filtered out');

    // Attempting to mark revoked notification read returns 404 NOT_FOUND
    const vPatchRes = await app.request(`/api/v1/notifications/${vNotifId}/read`, {
      method: 'PATCH',
      headers: { 'Cookie': viewer.cookie },
    });
    assert.equal(vPatchRes.status, 404);
  });

  await t.test('NTF-03: Outbox Leased Worker Processing, Idempotency & Quarantine', async () => {
    // 1. Insert an outbox event for comment.created targeting Sibling Member
    const outId = 'out_' + crypto.randomUUID();
    const outboxCommentId = 'com_outbox_' + crypto.randomUUID();
    const outboxBoardId = 'brd_outbox_' + crypto.randomUUID();
    const outboxCardId = 'crd_outbox_' + crypto.randomUUID();
    const siblingColumnId = 'col_outbox_' + crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, 'Outbox Board', 1, 1, FALSE, NOW(), NOW())`,
        [outboxBoardId, workspaceId, siblingProjectId],
      );
      await client.query(
        `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, siblingProjectId, outboxBoardId, siblingMember.user.id, owner.user.id],
      );
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Outbox', '#64748b', 'todo', 0, 1, NOW(), NOW())`,
        [siblingColumnId, workspaceId, siblingProjectId, outboxBoardId],
      );
      await client.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Outbox card', 'none', 1000, 1, 'active', NOW(), NOW())`,
        [outboxCardId, workspaceId, siblingProjectId, outboxBoardId, siblingColumnId],
      );
      await client.query(
        `INSERT INTO comments (id, workspace_id, project_id, card_id, author_id, body, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Outbox mention comment', 1, NOW(), NOW())`,
        [outboxCommentId, workspaceId, siblingProjectId, outboxCardId, owner.user.id],
      );
      await client.query(
        `INSERT INTO outbox (
           id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
         ) VALUES ($1, $2, $3, 'comment.created', $4, 'pending', 0, NOW() - INTERVAL '1 second', NOW())`,
        [
          outId,
          workspaceId,
          siblingProjectId,
          JSON.stringify({
            commentId: outboxCommentId,
            cardId: outboxCardId,
            authorId: owner.user.id,
            mentions: [siblingMember.user.id],
          }),
        ],
      );
    } finally {
      client.release();
    }

    // 2. Outbox processing is a scheduled internal job, never a public route.
    const publicProcessor = await app.request('/api/v1/notifications/outbox/process', {
      method: 'POST', headers: { Cookie: owner.cookie },
    });
    assert.equal(publicProcessor.status, 404);
    const procResult = await processOutboxLease(pool, { batchSize: 10, maxRetries: 3 });
    assert.ok(procResult.delivered >= 1);

    // Verify outbox row status updated to 'delivered'
    const outCheckRes = await pool.query<{ status: string }>('SELECT status FROM outbox WHERE id = $1', [outId]);
    assert.equal(outCheckRes.rows[0]?.status, 'delivered');

    // Verify Sibling Member received notification
    const sibNotifRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': siblingMember.cookie },
    });
    assert.equal(sibNotifRes.status, 200);
    const sibNotifJson = (await sibNotifRes.json()) as any;
    assert.ok(sibNotifJson.data.length >= 1);

    // 3. Test Idempotency: Process same outbox again; verify no duplicate notification created
    const preCount = sibNotifJson.data.length;
    await processOutboxLease(pool, { batchSize: 10, maxRetries: 3 });
    const sibRecheckRes = await app.request('/api/v1/notifications', {
      headers: { 'Cookie': siblingMember.cookie },
    });
    const sibRecheckJson = (await sibRecheckRes.json()) as any;
    assert.equal(sibRecheckJson.data.length, preCount, 'No duplicate notifications delivered');

    // 4. Dead-letter Quarantine: insert failing outbox job and test maxRetries bound
    const failOutId = 'out_' + crypto.randomUUID();
    const failClient = await pool.connect();
    try {
      // payload with invalid JSON string to trigger processing error
      await failClient.query(
        `INSERT INTO outbox (
           id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
         ) VALUES ($1, $2, $3, 'comment.created', $4, 'pending', 2, NOW() - INTERVAL '1 second', NOW())`,
        [failOutId, workspaceId, projectId, JSON.stringify({ forceFailure: true })],
      );
    } finally {
      failClient.release();
    }

    // Run lease with maxRetries = 3 (current retry_count = 2, so nextRetry = 3 -> fails to quarantine)
    const qResult = await processOutboxLease(pool, { batchSize: 10, maxRetries: 3 });
    assert.ok(qResult.failed >= 1);

    const failCheck = await pool.query<{ status: string; retry_count: number }>(
      'SELECT status, retry_count FROM outbox WHERE id = $1',
      [failOutId],
    );
    assert.equal(failCheck.rows[0]?.status, 'failed', 'Dead-letter quarantine status applied');
    assert.equal(failCheck.rows[0]?.retry_count, 3);
  });

  await t.test('AUD-05: Lifecycle import and image events', async () => {
    // 1. Create a fresh card in board
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const lifeCardRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('aud05-card-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Lifecycle Card Test',
        expectedBoardVersion: bVer.rows[0]!.structure_version,
      }),
    });
    assert.equal(lifeCardRes.status, 201);
    const lifeCardJson = (await lifeCardRes.json()) as any;
    const lifeCardId = lifeCardJson.data.id;

    // 2. Soft-delete card creates card_trashed event
    const bVer2 = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const delRes = await app.request(`/api/v1/cards/${lifeCardId}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('aud05-card-del'),
      },
      body: JSON.stringify({
        expectedVersion: 1,
        expectedBoardVersion: bVer2.rows[0]!.structure_version,
      }),
    });
    assert.equal(delRes.status, 200);

    // 3. Restore card creates card_restored event
    const bVer3 = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const restRes = await app.request(`/api/v1/cards/${lifeCardId}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('aud05-card-rest'),
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: bVer3.rows[0]!.structure_version,
        toColumnId: col1Id,
      }),
    });
    assert.equal(restRes.status, 200);

    // 4. Query project activity as manager to verify lifecycle events are traceable
    const prjActRes = await app.request(`/api/v1/projects/${projectId}/activity`, {
      headers: { 'Cookie': manager.cookie },
    });
    assert.equal(prjActRes.status, 200);
    const prjActJson = (await prjActRes.json()) as any;
    const actions = prjActJson.data.map((item: any) => item.action);
    assert.ok(actions.includes('card_trashed'), 'Activity includes card_trashed');
    assert.ok(actions.includes('card_restored'), 'Activity includes card_restored');

    // 5. Traceable import and image event recording in activity_log
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO activity_log (id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          crypto.randomUUID(),
          workspaceId,
          projectId,
          lifeCardId,
          manager.user.id,
          'image.attached',
          JSON.stringify({ imageId: 'img-123', fileName: 'sample.png', sizeBytes: 1024 }),
        ]
      );
      await client.query(
        `INSERT INTO activity_log (id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          crypto.randomUUID(),
          workspaceId,
          projectId,
          null,
          manager.user.id,
          'import.committed',
          JSON.stringify({ totalRows: 5, createdCount: 5 }),
        ]
      );

      // Verify no secret token, raw file buffer, or secret links in any activity payload
      const allAct = await client.query(
        `SELECT action, safe_changes FROM activity_log WHERE project_id = $1`,
        [projectId]
      );
      for (const row of allAct.rows) {
        const str = JSON.stringify(row.safe_changes || {});
        assert.ok(!str.includes('secret'), 'Must not contain secret');
        assert.ok(!str.includes('token'), 'Must not contain token');
        assert.ok(!str.includes('Buffer'), 'Must not contain Buffer');
        assert.ok(!str.includes('data:image'), 'Must not contain raw image data');
      }
    } finally {
      client.release();
    }
  });
});
