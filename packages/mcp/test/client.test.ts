import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowboardClient } from '../src/client.ts';

test('Flowboard MCP Client Suite', async (t) => {
  await t.test('createCard: resolves column by case-insensitive name and creates card', async () => {
    let requestedUrl = '';
    let requestHeaders: Headers | null = null;
    let requestBody: any = null;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = input.toString();

      // Mock GET /api/v1/boards/:boardId
      if (urlStr.includes('/api/v1/boards/board_123') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(
          JSON.stringify({
            data: {
              id: 'board_123',
              name: 'Engineering Sprint',
              version: 5,
              columns: [
                { id: 'col_backlog', name: 'Backlog', category: 'todo', position: 0 },
                { id: 'col_todo', name: 'To Do', category: 'todo', position: 1 },
                { id: 'col_done', name: 'Done', category: 'done', position: 2 },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Mock POST /api/v1/boards/:boardId/cards
      if (urlStr.includes('/api/v1/boards/board_123/cards') && init?.method === 'POST') {
        requestedUrl = urlStr;
        requestHeaders = new Headers(init.headers);
        requestBody = JSON.parse(init.body as string);

        return new Response(
          JSON.stringify({
            data: {
              id: 'crd_abc789',
              title: requestBody.title,
              priority: requestBody.priority,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const client = new FlowboardClient({
        apiUrl: 'http://flowboard.test',
        apiToken: 'flw_pat_test123',
      });

      const card = await client.createCard({
        boardId: 'board_123',
        column: 'to do', // Case-insensitive column name
        title: 'Fix edge case in token verification',
        description: 'Ensure token revoked_at is checked',
        priority: 'high',
      });

      assert.equal(card.id, 'crd_abc789');
      assert.equal(card.title, 'Fix edge case in token verification');
      assert.equal(card.columnId, 'col_todo');
      assert.equal(card.columnName, 'To Do');
      assert.equal(card.boardName, 'Engineering Sprint');

      assert.equal(requestBody.columnId, 'col_todo');
      assert.equal(requestBody.expectedBoardVersion, 5);
      assert.ok(requestHeaders?.get('Idempotency-Key')?.startsWith('pat_'));
      assert.equal(requestHeaders?.get('Authorization'), 'Bearer flw_pat_test123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('createCard: fails cleanly with helpful column list if column not found', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      return new Response(
        JSON.stringify({
          data: {
            id: 'board_123',
            name: 'Engineering Sprint',
            version: 1,
            columns: [
              { id: 'col_1', name: 'Backlog', category: 'todo', position: 0 },
              { id: 'col_2', name: 'In Progress', category: 'active', position: 1 },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const client = new FlowboardClient({
        apiUrl: 'http://flowboard.test',
        apiToken: 'flw_pat_test123',
      });

      await assert.rejects(
        async () => {
          await client.createCard({
            boardId: 'board_123',
            column: 'Done',
            title: 'Test',
          });
        },
        /Column "Done" not found on board "Engineering Sprint"\. Available columns are: "Backlog" \(id: col_1\), "In Progress" \(id: col_2\)/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('createCard: automatically retries once if version conflict 409 occurs', async () => {
    let boardVersion = 1;
    let postAttempts = 0;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = input.toString();

      if (urlStr.includes('/api/v1/boards/board_123') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(
          JSON.stringify({
            data: {
              id: 'board_123',
              name: 'Engineering Sprint',
              version: boardVersion,
              columns: [{ id: 'col_1', name: 'To Do', category: 'todo', position: 0 }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('/api/v1/boards/board_123/cards') && init?.method === 'POST') {
        postAttempts++;
        const body = JSON.parse(init.body as string);
        if (body.expectedBoardVersion < 2) {
          // Simulate race condition where someone else bumped the board version to 2
          boardVersion = 2;
          return new Response(
            JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Board version mismatch' } }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ data: { id: 'crd_retried', title: body.title, priority: body.priority } }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const client = new FlowboardClient({
        apiUrl: 'http://flowboard.test',
        apiToken: 'flw_pat_test123',
      });

      const card = await client.createCard({
        boardId: 'board_123',
        column: 'To Do',
        title: 'Conflict resilient card',
      });

      assert.equal(card.id, 'crd_retried');
      assert.equal(postAttempts, 2, 'Expected exactly 2 POST attempts (1 fail, 1 retry)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
