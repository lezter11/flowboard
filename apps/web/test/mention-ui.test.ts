import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mentionCandidates, mentionEmptyText } from '../src/lib/mention-ui.ts';
import { rankPeople } from '../src/lib/mentions.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const me = { id: 'me', displayName: 'Me Myself', activeInProject: true, mentionable: true, scopedRole: 'owner' };
const sam = { id: 'sam', displayName: 'Sam Lee', activeInProject: true, mentionable: true, scopedRole: 'member' };
const viewer = { id: 'vee', displayName: 'Vee Viewer', activeInProject: true, mentionable: true, scopedRole: 'viewer' };
const noGrant = { id: 'ng', displayName: 'Nina NoGrant', activeInProject: true, mentionable: false, scopedRole: 'member' };
const left = { id: 'lf', displayName: 'Lou Left', activeInProject: false, mentionable: true, scopedRole: 'member' };

test('the mention query sends the card id, keyed by card, and the client method puts it in the URL', () => {
  const drawer = src('../src/components/board/card-detail-drawer.tsx');
  assert.match(drawer, /queryKey: \['project-people', projectId, 'mention', cardId\]/);
  assert.match(drawer, /listProjectPeople\(projectId, 'mention', \{ cardId \}\)/);
  assert.match(src('../src/lib/api.ts'), /q\.set\('cardId', opts\.cardId\)/);
});

test('with a second member, candidates appear and are searchable', () => {
  const c = mentionCandidates([me, sam]);
  assert.deepEqual(rankPeople(c, 'sa').map((p) => p.id), ['sam']);
});

test('a Viewer with board access can be mentioned; someone without a grant or who left cannot', () => {
  assert.deepEqual(mentionCandidates([me, viewer, noGrant, left]).map((p) => p.id), ['me', 'vee']);
});

test('empty wording: loading, failed, only you, no match', () => {
  const base = { loading: false, failed: false, candidates: [me], actorId: 'me', typed: '' };
  assert.equal(mentionEmptyText({ ...base, loading: true }), 'Loading people…');
  assert.match(mentionEmptyText({ ...base, failed: true }), /Could not load people/);
  assert.equal(mentionEmptyText(base), 'You are the only person in this project. Invite someone from People to mention them.');
  assert.equal(mentionEmptyText({ ...base, candidates: [] }), 'You are the only person in this project. Invite someone from People to mention them.');
  assert.equal(mentionEmptyText({ ...base, candidates: [me, sam], typed: 'zz' }), 'No one matches.');
});

test('listbox pattern: combobox textarea, listbox, options named "Name, Role", polite result count', () => {
  const d = src('../src/components/board/card-detail-drawer.tsx');
  assert.match(d, /role="combobox" aria-autocomplete="list"/);
  assert.match(d, /role="listbox"/);
  assert.match(d, /role="option" aria-label=\{`\$\{person\.displayName\}, \$\{roleLabel\}/);
  assert.match(d, /aria-live="polite">\{picker && matches\.length > 0 \? `\$\{matches\.length\}/);
});

test('saved mentions show the current full name on hover, not the stored text', () => {
  const d = src('../src/components/board/card-detail-drawer.tsx');
  assert.match(d, /title=\{names\.get\(part\.userId\)\?\.displayName \?\? 'Former member'\}/);
});
