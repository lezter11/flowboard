import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowboardApiError, FlowboardClient } from '../src/client.ts';

const token = `flw_pat_${'a'.repeat(64)}`;
const config = { apiUrl: 'http://127.0.0.1:43210', apiToken: token };
const input = { operationId: '00000000-1111-2222-3333-444444444444', boardId: 'board_123', column: 'to do', title: ' A synthetic task ' };
const metadata = (version = 5) => ({ data: {
  id: 'board_123', name: 'Engineering Sprint', structureVersion: version,
  columns: [{ id: 'col_todo', name: 'To Do', category: 'todo', position: 0 }],
} });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function withFetch(mock: typeof fetch, work: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await work(); } finally { globalThis.fetch = original; }
}

test('create uses metadata, resolves a unique name and sends caller operationId', async () => {
  let posts = 0;
  await withFetch(async (url, options) => {
    if (String(url).endsWith('/metadata')) return json(metadata());
    assert.equal(String(url), `${config.apiUrl}/api/v1/boards/board_123/cards`);
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('Idempotency-Key'), input.operationId);
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(options?.body as string), {
      title: 'A synthetic task', columnId: 'col_todo', description: '', priority: 'none', dueDate: null, expectedBoardVersion: 5,
    });
    posts++;
    return json({ data: { id: 'crd_abc', title: 'server text need not be exposed' } }, 201);
  }, async () => {
    const card = await new FlowboardClient(config).createCard(input);
    assert.equal(card.id, 'crd_abc');
    assert.equal(card.submittedTitle, 'A synthetic task');
    assert.equal(card.columnId, 'col_todo');
    assert.equal(card.operationId, input.operationId);
    assert.equal(card.replayed, false);
  });
  assert.equal(posts, 1);
});

test('metadata projection strips accidental cards, counts and other fields at runtime', async () => {
  const body = metadata();
  const raw = body.data as unknown as Record<string, unknown>;
  raw.description = 'must not reach model';
  raw.cardCount = 10;
  Object.assign(body.data.columns[0]!, { cards: [{ title: 'private card' }], count: 1, assignees: ['person'] });
  await withFetch(async (url) => {
    assert.ok(String(url).endsWith('/boards/board_123/metadata'));
    return json(body);
  }, async () => {
    const output = await new FlowboardClient(config).getBoard('board_123');
    assert.deepEqual(output, { id: 'board_123', name: 'Engineering Sprint', version: 5,
      columns: [{ id: 'col_todo', name: 'To Do', category: 'todo', position: 0 }] });
    assert.doesNotMatch(JSON.stringify(output), /private|cardCount|cards|assignees/);
  });
});

test('metadata must identify the requested board and an exact column ID wins over a colliding label', async () => {
  await withFetch(async () => json({ data: { ...metadata().data, id: 'board_other' } }), async () => {
    await assert.rejects(new FlowboardClient(config).getBoard('board_123'), /unexpected board/);
  });
  await withFetch(async (url, options) => {
    if (String(url).endsWith('/metadata')) return json({ data: { ...metadata().data,
      columns: [...metadata().data.columns, { id: 'col_other', name: 'col_todo', category: 'todo', position: 1 }] } });
    assert.equal(JSON.parse(options?.body as string).columnId, 'col_todo');
    return json({ data: { id: 'crd_exact' } }, 201);
  }, async () => {
    assert.equal((await new FlowboardClient(config).createCard({ ...input, column: 'col_todo' })).id, 'crd_exact');
  });
});

test('lost response: new client retry preserves key and accepts minimal replay with a newer metadata revision', async () => {
  const keys: string[] = [];
  let metadataCalls = 0;
  await withFetch(async (url, options) => {
    if (String(url).endsWith('/metadata')) return json(metadata(++metadataCalls));
    keys.push(new Headers(options?.headers).get('Idempotency-Key')!);
    if (keys.length === 1) throw new Error('synthetic response dropped after server commit');
    return json({ data: { id: 'crd_original', version: 1 }, replayed: true }, 201);
  }, async () => {
    await assert.rejects(new FlowboardClient(config).createCard(input), /same operationId and input/);
    assert.equal(keys.length, 1, 'no automatic network retry');
    const replay = await new FlowboardClient(config).createCard(input);
    assert.equal(replay.id, 'crd_original');
    assert.equal(replay.replayed, true);
    assert.equal(replay.submittedPriority, 'none');
  });
  assert.deepEqual(keys, [input.operationId, input.operationId]);
});

test('only STALE_BOARD_VERSION retries, once, with unchanged key and semantic input', async () => {
  const requests: { key: string; payload: Record<string, unknown> }[] = [];
  let metadataCalls = 0;
  await withFetch(async (url, options) => {
    if (String(url).endsWith('/metadata')) return json(metadata(++metadataCalls));
    requests.push({ key: new Headers(options?.headers).get('Idempotency-Key')!, payload: JSON.parse(options?.body as string) });
    if (requests.length === 1) return json({ error: { code: 'STALE_BOARD_VERSION', message: 'ignored' } }, 409);
    return json({ data: { id: 'crd_retried' } }, 201);
  }, async () => {
    assert.equal((await new FlowboardClient(config).createCard(input)).id, 'crd_retried');
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.key, requests[1]!.key);
  assert.equal(requests[0]!.payload.expectedBoardVersion, 1);
  assert.equal(requests[1]!.payload.expectedBoardVersion, 2);
  const { expectedBoardVersion: _first, ...semantic1 } = requests[0]!.payload;
  const { expectedBoardVersion: _second, ...semantic2 } = requests[1]!.payload;
  assert.deepEqual(semantic1, semantic2);
});

test('a second stale-version conflict is returned without a third POST', async () => {
  let posts = 0;
  await withFetch(async (url) => {
    if (String(url).endsWith('/metadata')) return json(metadata());
    posts++;
    return json({ error: { code: 'STALE_BOARD_VERSION' } }, 409);
  }, async () => {
    await assert.rejects(new FlowboardClient(config).createCard(input), (error) => error instanceof FlowboardApiError && error.code === 'STALE_BOARD_VERSION');
  });
  assert.equal(posts, 2);
});

test('generic 409 and idempotency conflict never retry', async () => {
  for (const code of ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'COLUMN_NOT_FOUND']) {
    let posts = 0;
    await withFetch(async (url) => {
      if (String(url).endsWith('/metadata')) return json(metadata());
      posts++;
      return json({ error: { code } }, 409);
    }, async () => {
      await assert.rejects(new FlowboardClient(config).createCard(input), (error) => error instanceof FlowboardApiError && error.code === code);
    });
    assert.equal(posts, 1, code);
  }
});

test('missing or ambiguous target column causes no POST', async () => {
  for (const columns of [[], [metadata().data.columns[0]!, { id: 'col_other', name: 'to do', category: 'todo', position: 1 }]]) {
    await withFetch(async (_url, options) => {
      assert.notEqual(options?.method, 'POST');
      return json({ data: { ...metadata().data, columns } });
    }, async () => {
      await assert.rejects(new FlowboardClient(config).createCard(input), /missing or ambiguous/);
    });
  }
});

test('stale recovery refuses a deleted column and never changes requested column', async () => {
  let reads = 0;
  let posts = 0;
  await withFetch(async (url) => {
    if (String(url).endsWith('/metadata')) {
      reads++;
      return json(reads === 1 ? metadata() : { data: { ...metadata(2).data, columns: [] } });
    }
    posts++;
    return json({ error: { code: 'STALE_BOARD_VERSION' } }, 409);
  }, async () => {
    await assert.rejects(new FlowboardClient(config).createCard(input), /no longer exists/);
  });
  assert.equal(posts, 1);
});

test('search uses query and explicit pagination, returning only the bounded safe projection', async () => {
  await withFetch(async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/api/v1/projects/proj_123/cards/search');
    assert.equal(parsed.searchParams.get('query'), 'needle & vehicle');
    assert.equal(parsed.searchParams.has('q'), false);
    assert.equal(parsed.searchParams.get('limit'), '1');
    assert.equal(parsed.searchParams.get('cursor'), 'opaque-next');
    return json({ data: [{ id: 'card_needle', title: 'needle vehicle', boardId: 'board_123', columnId: 'col_todo', description: 'not returned' }], nextCursor: 'opaque-more' });
  }, async () => {
    const result = await new FlowboardClient(config).searchCards('proj_123', 'needle & vehicle', { cursor: 'opaque-next', limit: 1 });
    assert.deepEqual(result, { data: [{ id: 'card_needle', title: 'needle vehicle', boardId: 'board_123', columnId: 'col_todo' }], nextCursor: 'opaque-more' });
  });
});

test('list projects exposes the cursor and never silently follows extra pages', async () => {
  let requests = 0;
  await withFetch(async (url) => {
    requests++;
    assert.equal(new URL(String(url)).searchParams.get('limit'), '1');
    return json({ data: [{ id: 'proj_1', name: 'A', description: null, ownerEmail: 'not returned' }], nextCursor: 'next' });
  }, async () => {
    const result = await new FlowboardClient(config).listProjects({ limit: 1 });
    assert.deepEqual(result, { data: [{ id: 'proj_1', name: 'A', description: null }], nextCursor: 'next' });
  });
  assert.equal(requests, 1);
});

test('configuration rejects missing tokens, credential URLs, insecure remote HTTP and non-origin URLs', () => {
  for (const apiUrl of ['http://flowboard.test', 'file:///tmp/a', 'https://person:secret@example.test', 'https://example.test/path', 'https://example.test/?q=secret', 'https://example.test/#secret', 'not a URL']) {
    assert.throws(() => new FlowboardClient({ ...config, apiUrl }), /FLOWBOARD_API_URL/);
  }
  for (const apiToken of ['', 'flw_pat_wrong', `${token}\n`]) assert.throws(() => new FlowboardClient({ ...config, apiToken }), /FLOWBOARD_API_TOKEN/);
  for (const requestTimeoutMs of [0, 30001, NaN, 1.5]) assert.throws(() => new FlowboardClient({ ...config, requestTimeoutMs }), /requestTimeoutMs/);
  assert.ok(new FlowboardClient({ ...config, apiUrl: 'https://flowboard.example' }));
});

test('input validation rejects impossible dates, oversized text, path-like IDs and absent operation IDs before fetch', async () => {
  await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
    const client = new FlowboardClient(config);
    for (const dueDate of ['0000-01-01', '2026-02-29', '2026-04-31', '31/10/2026', '2026-01-01T00:00Z']) {
      await assert.rejects(client.createCard({ ...input, dueDate }));
    }
    await assert.rejects(client.createCard({ ...input, description: 'x'.repeat(20001) }));
    await assert.rejects(client.createCard({ ...input, title: ' ' }));
    await assert.rejects(client.createCard({ ...input, boardId: '../session' }));
    await assert.rejects(client.createCard({ ...input, operationId: '' }));
    await assert.rejects(client.searchCards('proj_123', ''));
    await assert.rejects(client.getBoard('board_123?expand=cards'));
    await assert.rejects(client.listProjects({ limit: 101 }));
  });
});

test('real leap-day date is accepted', async () => {
  await withFetch(async (url, options) => {
    if (String(url).endsWith('/metadata')) return json(metadata());
    assert.equal(JSON.parse(options?.body as string).dueDate, '2028-02-29');
    return json({ data: { id: 'crd_leap' } }, 201);
  }, async () => { assert.equal((await new FlowboardClient(config).createCard({ ...input, dueDate: '2028-02-29' })).id, 'crd_leap'); });
});

test('non-JSON and JSON server errors are consumed once and do not echo bodies, tokens or messages', async () => {
  for (const response of [new Response(`proxy says ${token}`, { status: 502 }), json({ error: { code: 'DENIED', message: token }, recipient: 'sensitive' }, 403)]) {
    await withFetch(async () => response, async () => {
      await assert.rejects(new FlowboardClient(config).listProjects(), (error) => {
        assert.ok(error instanceof FlowboardApiError);
        assert.doesNotMatch(String(error), /flw_pat_|sensitive|Body is unusable/);
        assert.equal('body' in error, false);
        return true;
      });
    });
    assert.equal(response.bodyUsed, true);
  }
});

test('oversized responses fail safely and are not retried', async () => {
  let requests = 0;
  await withFetch(async () => {
    requests++;
    return new Response(token, { headers: { 'content-length': String(1024 * 1024 + 1) } });
  }, async () => {
    await assert.rejects(new FlowboardClient(config).listProjects(), (error) => {
      assert.doesNotMatch(String(error), /flw_pat_/);
      return true;
    });
  });
  assert.equal(requests, 1);
});

test('HTTP timeout aborts the request and reports unknown create outcome without secrets', async () => {
  let aborted = false;
  await withFetch(async (_url, options) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(json({ data: [], nextCursor: null })), 1000);
    options!.signal!.addEventListener('abort', () => {
      clearTimeout(timer);
      aborted = true;
      reject(new Error(`synthetic transport exception ${token}`));
    }, { once: true });
  }), async () => {
    await assert.rejects(new FlowboardClient({ ...config, requestTimeoutMs: 10 }).listProjects(), (error) => {
      assert.match(String(error), /timed out/);
      assert.doesNotMatch(String(error), /flw_pat_/);
      return true;
    });
  });
  assert.equal(aborted, true);
});
