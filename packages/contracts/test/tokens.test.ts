import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTokenInputSchema,
  tokenSummarySchema,
  createdTokenResponseSchema,
  tokenListResponseSchema,
  TOKEN_SCOPES,
} from '../src/tokens.ts';

test('Personal Access Token Schemas', async (t) => {
  await t.test('createTokenInputSchema: validates valid inputs', () => {
    const valid = {
      name: 'Claude Desktop Integration',
      scopes: ['cards:create', 'boards:read'],
      projectId: 'proj_123',
      expiresInDays: 30,
    };
    const parsed = createTokenInputSchema.parse(valid);
    assert.equal(parsed.name, 'Claude Desktop Integration');
    assert.deepEqual(parsed.scopes, ['cards:create', 'boards:read']);
    assert.equal(parsed.projectId, 'proj_123');
    assert.equal(parsed.expiresInDays, 30);
  });

  await t.test('createTokenInputSchema: rejects empty name', () => {
    assert.throws(
      () =>
        createTokenInputSchema.parse({
          name: '   ',
          scopes: ['cards:create'],
        }),
      /cannot be empty/i,
    );
  });

  await t.test('createTokenInputSchema: rejects empty scopes array', () => {
    assert.throws(
      () =>
        createTokenInputSchema.parse({
          name: 'Valid Name',
          scopes: [],
        }),
      /At least one scope is required/i,
    );
  });

  await t.test('createTokenInputSchema: rejects duplicate scopes', () => {
    assert.throws(
      () =>
        createTokenInputSchema.parse({
          name: 'Valid Name',
          scopes: ['cards:create', 'cards:create'],
        }),
      /Scopes must be unique/i,
    );
  });

  await t.test('createTokenInputSchema: rejects invalid scope', () => {
    assert.throws(
      () =>
        createTokenInputSchema.parse({
          name: 'Valid Name',
          scopes: ['super:admin'],
        }),
    );
  });

  await t.test('tokenSummarySchema: parses valid summary object', () => {
    const summary = {
      id: 'pat_01hxyz',
      name: 'Claude Bot',
      tokenPrefix: 'flw_pat_8f3a',
      scopes: ['cards:create'],
      projectId: null,
      expiresAt: '2026-12-01T00:00:00.000Z',
      lastUsedAt: null,
      createdAt: '2026-11-02T16:00:00.000Z',
    };
    const parsed = tokenSummarySchema.parse(summary);
    assert.equal(parsed.id, 'pat_01hxyz');
    assert.equal(parsed.name, 'Claude Bot');
  });

  await t.test('createdTokenResponseSchema: validates data envelope with raw token', () => {
    const res = {
      data: {
        token: 'flw_pat_live_8f3a4b9c1d2e3f4a5b6c7d8e9f0a1b2c',
        tokenDetails: {
          id: 'pat_01hxyz',
          name: 'Claude Bot',
          tokenPrefix: 'flw_pat_8f3a',
          scopes: ['cards:create'],
          projectId: null,
          expiresAt: null,
          lastUsedAt: null,
          createdAt: '2026-11-02T16:00:00.000Z',
        },
      },
    };
    const parsed = createdTokenResponseSchema.parse(res);
    assert.equal(parsed.data.token, 'flw_pat_live_8f3a4b9c1d2e3f4a5b6c7d8e9f0a1b2c');
    assert.equal(parsed.data.tokenDetails.name, 'Claude Bot');
  });
});
