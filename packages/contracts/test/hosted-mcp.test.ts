import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hostedMcpAuthorizationViewSchema,
  hostedMcpConnectionsResponseSchema,
  hostedMcpDecisionInputSchema,
} from '../src/hosted-mcp.ts';

const client = { name: 'Unverified client', origin: 'https://claude.ai', redirectOrigin: 'https://claude.ai', verified: false };
const view = { requestId: 'request_12345678', client, scopes: ['projects:read'],
  offlineAccess: true, accessTokenLifetimeSeconds: 900, connectionLifetimeDays: 30, refreshTokenIdleDays: 7,
  expiresAt: '2026-11-04T09:00:00.000Z', csrfToken: 'a'.repeat(43), projects: [], nextCursor: null };

test('hosted consent requires an explicit project on allow but permits deny', () => {
  assert.equal(hostedMcpDecisionInputSchema.safeParse({ decision: 'allow', csrfToken: view.csrfToken }).success, false);
  assert.equal(hostedMcpDecisionInputSchema.safeParse({ decision: 'allow', csrfToken: view.csrfToken, projectId: 'project_one' }).success, true);
  assert.equal(hostedMcpDecisionInputSchema.safeParse({ decision: 'deny', csrfToken: view.csrfToken }).success, true);
});

test('hosted consent cannot inject a callback, scope or alternate actor', () => {
  for (const extra of [{ redirectUrl: 'https://example.invalid' }, { scopes: ['admin'] }, { userId: 'other' }]) {
    assert.equal(hostedMcpDecisionInputSchema.safeParse({ decision: 'deny', csrfToken: view.csrfToken, ...extra }).success, false);
  }
});

test('hosted authorization view refuses credential leaks and self-asserted verification', () => {
  assert.equal(hostedMcpAuthorizationViewSchema.safeParse({ data: view }).success, true);
  for (const extra of [{ access_token: 'synthetic' }, { token: 'synthetic' }, { refreshToken: 'synthetic' }]) {
    assert.equal(hostedMcpAuthorizationViewSchema.safeParse({ data: { ...view, ...extra } }).success, false);
  }
  assert.equal(hostedMcpAuthorizationViewSchema.safeParse({ data: { ...view, client: { ...client, verified: true } } }).success, false);
  assert.equal(hostedMcpAuthorizationViewSchema.safeParse({ data: { ...view, scopes: ['admin'] } }).success, false);
});

test('hosted connection summary refuses raw credentials and token hashes', () => {
  const connection = { id: 'connection_123456', clientName: client.name, clientOrigin: client.origin,
    redirectOrigin: client.redirectOrigin, projectId: 'project_one', projectName: 'One', scopes: ['cards:read'],
    offlineAccess: true, createdAt: view.expiresAt, expiresAt: view.expiresAt, lastUsedAt: null, revokedAt: null };
  assert.equal(hostedMcpConnectionsResponseSchema.safeParse({ data: [connection] }).success, true);
  for (const extra of [{ tokenHash: 'synthetic' }, { access_token: 'synthetic' }, { refreshToken: 'synthetic' }]) {
    assert.equal(hostedMcpConnectionsResponseSchema.safeParse({ data: [{ ...connection, ...extra }] }).success, false);
  }
});
