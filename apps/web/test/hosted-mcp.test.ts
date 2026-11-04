import assert from 'node:assert/strict';
import test from 'node:test';
import { signinPathFor } from '../src/lib/return-path.ts';
import type { HostedMcpAuthorizationView } from '@flowboard/contracts';

const handle = 'a'.repeat(43);
const origin = 'https://flowboard.example';
const callback = 'https://claude.ai/api/mcp/auth_callback';
// Before the feature exists, missing behavior is an assertion failure, not an import crash.
const state = await import('../src/lib/hosted-mcp-state.ts').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {} as typeof import('../src/lib/hosted-mcp-state.ts');
});

test('sign-in preserves only the exact opaque consent request and personal Connections tab', () => {
  assert.equal(signinPathFor('/connect', `?request=${handle}`), `/signin?next=${encodeURIComponent(`/connect?request=${handle}`)}`);
  assert.equal(signinPathFor('/settings', '?tab=connections'), '/signin?next=%2Fsettings%3Ftab%3Dconnections');
  for (const search of ['', '?request=short', `?request=${handle}&request=${handle}`, `?request=${handle}&redirect_uri=evil`, `?request=${handle}%0a`]) {
    assert.equal(signinPathFor('/connect', search), '/signin');
  }
});

test('consent accepts one canonical 43-character handle, without extra or encoded query input', () => {
  assert.equal(state.authorizationRequestId?.(`?request=${handle}`), handle);
  for (const search of ['', '?request=short', `?request=${handle}&request=${handle}`, `?request=${handle}&x=1`, `?%72equest=${handle}`, `?request=${handle.slice(0,42)}%61`]) {
    assert.equal(state.authorizationRequestId?.(search), null, search);
  }
});

test('callback navigation permits only the exact backend-selected Claude callback and local issuer', () => {
  const valid = `${callback}?code=${handle}&iss=${encodeURIComponent(origin)}&state=opaque`;
  assert.equal(state.safeHostedMcpRedirect?.(valid, origin), valid);
  const denied = `${callback}?error=access_denied&iss=${encodeURIComponent(origin)}`;
  assert.equal(state.safeHostedMcpRedirect?.(denied, origin), denied);
  for (const raw of [
    valid.replace('claude.ai', 'claude.ai.evil.test'), valid.replace('/auth_callback', '/auth_callback/extra'),
    valid.replace('https:', 'http:'), valid.replace('https://', 'https://name@'), valid + '#fragment',
    valid + '&code=other', valid + '&redirect_uri=https://evil.test', valid.replace(encodeURIComponent(origin), encodeURIComponent('https://evil.test')),
    `${callback}?code=${handle}&error=access_denied&iss=${encodeURIComponent(origin)}`,
    `${callback}?code=&error=access_denied&iss=${encodeURIComponent(origin)}`,
    `${callback}?code=&iss=${encodeURIComponent(origin)}`,
    `${callback}?error=&iss=${encodeURIComponent(origin)}`,
  ]) assert.equal(state.safeHostedMcpRedirect?.(raw, origin), null);
});

test('project continuation preserves distinct choices while replacing the CSRF with the newest page', () => {
  const first: HostedMcpAuthorizationView = {
    requestId: handle, client: { name: 'Unverified', origin: 'https://claude.ai', redirectOrigin: 'https://claude.ai', verified: false },
    scopes: ['projects:read'], offlineAccess: false, accessTokenLifetimeSeconds: 900,
    connectionLifetimeDays: 30, refreshTokenIdleDays: null, expiresAt: '2026-11-04T12:00:00.000Z',
    csrfToken: 'first'.repeat(8), projects: [{ id: 'p1', name: 'Website', role: 'owner' }], nextCursor: 'page2',
  };
  const second = { ...first, csrfToken: 'newest'.repeat(8), projects: [{ id: 'p2', name: 'Operations', role: 'member' as const }], nextCursor: null };
  const merged = state.mergeAuthorizationPage?.(first, second);
  assert.deepEqual(merged?.projects.map(project => project.id), ['p1', 'p2']);
  assert.equal(merged?.csrfToken, second.csrfToken);
  assert.equal(merged?.nextCursor, null);
  assert.throws(() => state.mergeAuthorizationPage(first, { ...second, requestId: 'b'.repeat(43) }));
});
