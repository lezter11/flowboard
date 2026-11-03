import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/api.ts';

test('comment and card activity reads forward opaque cursors and preserve the next page envelope', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ data: [], nextCursor: 'next+opaque/==' });
  };
  try {
    assert.deepEqual(await api.listCardComments('card /1', { cursor: 'opaque+/=', limit: 50 }), { data: [], nextCursor: 'next+opaque/==' });
    assert.deepEqual(await api.listCardActivity('card /1', 50, 'history+/='), { data: [], nextCursor: 'next+opaque/==' });
    assert.equal(urls[0], '/api/v1/cards/card%20%2F1/comments?limit=50&cursor=opaque%2B%2F%3D');
    assert.equal(urls[1], '/api/v1/cards/card%20%2F1/activity?limit=50&cursor=history%2B%2F%3D');
  } finally { globalThis.fetch = original; }
});

test('versioned comment edit and delete send exact IDs, mention spans and retained operation keys', async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; method?: string; key: string | null; body: unknown }> = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options?.method, key: new Headers(options?.headers).get('Idempotency-Key'), body: JSON.parse(String(options?.body)) });
    return Response.json({ data: { success: true, id: 'comment', version: 8 } });
  };
  try {
    await api.editComment('comment /1', { body: '😀 @Jo', mentions: [{ userId: 'jo', start: 3, end: 6 }], expectedVersion: 7 }, 'stable-edit');
    await api.deleteComment('comment /1', { expectedVersion: 8 }, 'stable-delete');
    assert.deepEqual(requests, [
      { url: '/api/v1/comments/comment%20%2F1', method: 'PATCH', key: 'stable-edit', body: { body: '😀 @Jo', mentions: [{ userId: 'jo', start: 3, end: 6 }], expectedVersion: 7 } },
      { url: '/api/v1/comments/comment%20%2F1', method: 'DELETE', key: 'stable-delete', body: { expectedVersion: 8 } },
    ]);
  } finally { globalThis.fetch = original; }
});
