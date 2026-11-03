import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/api.ts';
import { createRetainedCommand } from '../src/lib/retained-command.ts';

test('invitation history forwards opaque cursor, limit, status and cancellation', async () => {
  const original = globalThis.fetch; const abort = new AbortController(); let sent: RequestInit | undefined; let url = '';
  globalThis.fetch = async (input, init) => { url = String(input); sent = init; return Response.json({ data: [], nextCursor: 'next' }); };
  try {
    assert.deepEqual(await api.listInvitations('pr /1', { cursor: 'opaque+/=', status: 'revoked', limit: 50, signal: abort.signal }), { data: [], nextCursor: 'next' });
    assert.equal(new URL(url, 'http://local').pathname, '/api/v1/projects/pr%20%2F1/invitations');
    assert.deepEqual(Object.fromEntries(new URL(url, 'http://local').searchParams), { limit: '50', cursor: 'opaque+/=', status: 'revoked' });
    assert.equal(sent?.signal, abort.signal);
  } finally { globalThis.fetch = original; }
});

for (const action of ['create', 'resend', 'revoke'] as const) test(`${action} invitation lost reply retries the actual original request identity`, async () => {
  const original = globalThis.fetch; const requests: Array<{url:string;body:unknown;key:string|null}> = [];
  const command = createRetainedCommand<{ email: string; role: 'member'; id: string }>(() => 'original-key');
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') });
    if (requests.length === 1) throw new TypeError('response lost after commit');
    return Response.json({ data: { id: 'original', status: action === 'revoke' ? 'revoked' : 'pending' } });
  };
  const send = (input: {email:string;role:'member';id:string}, key:string): Promise<unknown> => action === 'create' ? api.createInvitation('p', {email:input.email,role:input.role}, key) : action === 'resend' ? api.resendInvitation('p',input.id,key) : api.revokeInvitation('p',input.id,key);
  try {
    await assert.rejects(command.run({email:'original@example.com',role:'member',id:'original'}, send));
    assert.equal(command.unresolved(), true);
    await command.run({email:'edited@example.com',role:'member',id:'edited'}, send);
    assert.deepEqual(requests[1], requests[0]); assert.equal(requests[1]?.key, 'original-key');
    assert.equal(command.unresolved(), false);
  } finally { globalThis.fetch = original; }
});
