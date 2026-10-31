import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSessionResponseSchema,
  NAME_PART_MAX,
  normalizeNamePart,
  NAME_REQUIRED_CODE,
  saveNameInputSchema,
  saveNameResponseSchema,
} from '../src/index.ts';

// B-16 contract: the name rules, the save input and response, and the session fields.

test('normalizeNamePart trims, collapses whitespace, and bounds the length in code points', () => {
  assert.equal(normalizeNamePart('  Ada   Marie  '), 'Ada Marie');
  assert.equal(normalizeNamePart('\tAda\t'), 'Ada', 'a tab is whitespace');
  assert.equal(normalizeNamePart('x'.repeat(NAME_PART_MAX)), 'x'.repeat(NAME_PART_MAX));
  assert.equal(normalizeNamePart('x'.repeat(NAME_PART_MAX + 1)), null);
  assert.equal(normalizeNamePart('😀'.repeat(NAME_PART_MAX)), '😀'.repeat(NAME_PART_MAX), 'a code point is one character');
  assert.equal(normalizeNamePart('😀'.repeat(NAME_PART_MAX + 1)), null);
  assert.equal(normalizeNamePart('   '), null);
  assert.equal(normalizeNamePart(''), null);
});

test('normalizeNamePart refuses control, zero-width, bidirectional and separator characters', () => {
  for (const bad of [
    'A\u0000B', 'A\rB', 'A\nB', 'A\u007FB', 'A\u0085B',
    'A​B', 'A‍B', 'A﻿B', 'A­B',
    'A‮B', 'A‪B', 'A⁦B', 'A⁩B',
    'A B', 'A B',
  ]) {
    assert.equal(normalizeNamePart(bad), null, JSON.stringify(bad));
  }
});

test('saveNameInputSchema: both parts are required, stored normalised, and unknown fields are refused', () => {
  const ok = saveNameInputSchema.parse({ firstName: '  Ada ', lastName: 'Lovelace   ' });
  assert.deepEqual(ok, { firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal(saveNameInputSchema.safeParse({ firstName: 'Ada' }).success, false, 'last name is required');
  assert.equal(saveNameInputSchema.safeParse({ firstName: 'Ada', lastName: '' }).success, false);
  assert.equal(saveNameInputSchema.safeParse({ firstName: 'Ada', lastName: 'L', role: 'owner' }).success, false, 'strict');
  assert.equal(saveNameInputSchema.safeParse({ firstName: 'A‮B', lastName: 'L' }).success, false, 'bidi override refused');
  assert.equal(saveNameInputSchema.safeParse({ firstName: 'x'.repeat(61), lastName: 'L' }).success, false);
});

test('saveNameResponseSchema and the session fields carry the name state', () => {
  const actor = { id: 'usr_1', email: 'a@flowboard.example', displayName: 'Ada Lovelace', avatarUrl: null };
  assert.ok(saveNameResponseSchema.safeParse({ data: { actor, firstName: 'Ada', lastName: 'Lovelace', needsName: false } }).success);
  assert.equal(saveNameResponseSchema.safeParse({ data: { actor, firstName: 'Ada', lastName: 'Lovelace', needsName: true } }).success, false);

  const session = {
    actor,
    ownedWorkspaces: [],
    accessibleProjects: [],
    needsName: true,
    suggestedFirstName: 'Asha',
    suggestedLastName: null,
  };
  assert.ok(getSessionResponseSchema.safeParse({ data: session }).success);
  assert.equal(getSessionResponseSchema.safeParse({ data: { ...session, needsName: undefined } }).success, false, 'needsName is required');
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...session, needsName: false, suggestedFirstName: null } }).success);
  const longDisplay = { ...actor, displayName: 'x'.repeat(121) };
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...session, actor: longDisplay } }).success, 'First Last can reach 121');
  assert.equal(NAME_REQUIRED_CODE, 'NAME_REQUIRED');
});
