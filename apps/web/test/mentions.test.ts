import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTrigger, applyMention, backspaceMention, duplicateLabels, finalizeMentions, highlight, matchRange, rankPeople, segments, shiftMentions, type Mention } from '../src/lib/mentions.ts';

const olivia = { id: 'usr_1', displayName: 'Olivia Owner' };
const mention = (start: number, end: number, name = 'Olivia Owner', userId = 'usr_1'): Mention => ({ userId, name, start, end });

test('trigger is found after @ at the start or after whitespace', () => {
  assert.deepEqual(activeTrigger('@oli', 4), { start: 0, query: 'oli' });
  assert.deepEqual(activeTrigger('hi @', 4), { start: 3, query: '' });
  assert.deepEqual(activeTrigger('hi\n@ol', 6), { start: 3, query: 'ol' });
});
test('no trigger inside an email address, after a space, or without @', () => {
  assert.equal(activeTrigger('mail a@b', 8), null);
  assert.equal(activeTrigger('@oli ver', 8, ['Olivia Owner']), null);
  assert.equal(activeTrigger('hello', 5), null);
});
test('applyMention writes @Name plus a space and spans exactly @Name', () => {
  const r = applyMention('hi @ol there', { start: 3, query: 'ol' }, 6, olivia);
  assert.equal(r.text, 'hi @Olivia Owner  there');
  assert.deepEqual(r.mention, { userId: 'usr_1', name: 'Olivia Owner', start: 3, end: 16 });
  assert.equal(r.text.slice(r.mention.start, r.mention.end), '@Olivia Owner');
  assert.equal(r.caret, 17);
});
test('offsets are UTF-16 code units, so emoji and accents before a mention count correctly', () => {
  const text = '👍 é @';
  const r = applyMention(text, activeTrigger(text, text.length)!, text.length, olivia);
  assert.equal(r.mention.start, '👍 é '.length);
  assert.equal(r.text.slice(r.mention.start, r.mention.end), '@Olivia Owner');
});
test('typing before a mention moves it; typing after leaves it', () => {
  const m = [mention(3, 16)];
  assert.deepEqual(shiftMentions('hi @Olivia Owner', 'oh hi @Olivia Owner', m), [mention(6, 19)]);
  assert.deepEqual(shiftMentions('hi @Olivia Owner', 'hi @Olivia Owner!', m), m);
});
test('editing inside a mention removes it; deleting before shifts left', () => {
  assert.deepEqual(shiftMentions('hi @Olivia Owner', 'hi @Olivia Ownr', [mention(3, 16)]), []);
  assert.deepEqual(shiftMentions('hello @Olivia Owner', 'hell @Olivia Owner', [mention(6, 19)]), [mention(5, 18)]);
});
test('pasting over a selection that covers a mention removes it', () => {
  assert.deepEqual(shiftMentions('a @Olivia Owner b', 'a X b', [mention(2, 15)]), []);
});
test('finalize keeps matching spans, sorted, with exact offsets', () => {
  const body = '@Olivia Owner and @Sam Lee please look';
  const out = finalizeMentions(body, [mention(18, 26, 'Sam Lee', 'usr_2'), mention(0, 13)]);
  assert.deepEqual(out.mentions, [{ userId: 'usr_1', start: 0, end: 13 }, { userId: 'usr_2', start: 18, end: 26 }]);
  for (const s of out.mentions) assert.ok(out.body.slice(s.start, s.end).startsWith('@'));
});
test('finalize shifts offsets when the body is trimmed', () => {
  const out = finalizeMentions('  @Olivia Owner hi  ', [mention(2, 15)]);
  assert.equal(out.body, '@Olivia Owner hi');
  assert.deepEqual(out.mentions, [{ userId: 'usr_1', start: 0, end: 13 }]);
});
test('finalize drops spans whose text changed, overlaps and ones glued to a word', () => {
  assert.deepEqual(finalizeMentions('@Olivia Ownerx', [mention(0, 13)]).mentions, []);
  assert.deepEqual(finalizeMentions('hello @Someone', [mention(6, 14, 'Olivia Owner')]).mentions, []);
  assert.equal(finalizeMentions('@Olivia Owner', [mention(0, 13), mention(5, 13, 'Owner')]).mentions.length, 1);
});
test('finalize caps at 20 mentions', () => {
  const names = Array.from({ length: 25 }, (_, i) => `P${i}`);
  const body = names.map((n) => `@${n}`).join(' ');
  let at = 0;
  const ms = names.map((n, i) => { const m = mention(at, at + n.length + 1, n, `u${i}`); at += n.length + 2; return m; });
  assert.equal(finalizeMentions(body, ms).mentions.length, 20);
});
test('segments split a stored comment and ignore bad spans', () => {
  assert.deepEqual(segments('hi @Sam ok', [{ userId: 'u', start: 3, end: 7 }]), [{ text: 'hi ' }, { text: '@Sam', userId: 'u' }, { text: ' ok' }]);
  assert.deepEqual(segments('hi', [{ userId: 'u', start: 1, end: 99 }]), [{ text: 'hi' }]);
  assert.deepEqual(segments('hi', undefined), [{ text: 'hi' }]);
  assert.deepEqual(segments('', []), [{ text: '' }]);
});

const crowd = [
  { id: 'u1', displayName: 'Shubham Singh' }, { id: 'u2', displayName: 'Sam Shubhra' }, { id: 'u3', displayName: 'Ana Singh' },
  { id: 'u4', displayName: 'José Álvarez' }, { id: 'u5', displayName: 'Shubham Singh' }, { id: 'u6', displayName: 'Priya Rao' },
];

test('match any word start, ignoring case and accents', () => {
  assert.ok(matchRange('Shubham Singh', 'sh'));
  assert.ok(matchRange('Shubham Singh', 'SIN'));
  assert.equal(matchRange('Shubham Singh', 'ham'), null);
  assert.ok(matchRange('José Álvarez', 'jose'));
  assert.ok(matchRange('José Álvarez', 'alv'));
});
test('a first name, a space and part of the last name narrows to one person', () => {
  assert.deepEqual(rankPeople(crowd.slice(0, 4), 'shubham si').map((p) => p.id), ['u1']);
  assert.deepEqual(rankPeople(crowd, 'shubham ').map((p) => p.id), ['u1', 'u5']);
});
test('ranking: full-name prefix, then other word starts, then A to Z', () => {
  assert.deepEqual(rankPeople(crowd.slice(0, 3), 'sh').map((p) => p.id), ['u1', 'u2']);
  assert.deepEqual(rankPeople(crowd.slice(0, 3), 'si').map((p) => p.id), ['u3', 'u1']);
  assert.deepEqual(rankPeople(crowd, '').length, crowd.length);
});
test('matched characters are emphasised on the original spelling', () => {
  assert.deepEqual(highlight('José Álvarez', 'alv'), [{ text: 'José ', hit: false }, { text: 'Álv', hit: true }, { text: 'arez', hit: false }]);
  assert.deepEqual(highlight('Priya Rao', ''), [{ text: 'Priya Rao', hit: false }]);
});
test('same full name gets a stable "n of m" label; unique names get none', () => {
  const l = duplicateLabels(crowd);
  assert.equal(l.get('u1'), '1 of 2'); assert.equal(l.get('u5'), '2 of 2'); assert.equal(l.has('u6'), false);
});
test('a multi-word query keeps the trigger open while it can match, and closes when it cannot', () => {
  const names = crowd.map((p) => p.displayName);
  assert.deepEqual(activeTrigger('hi @shubham si', 14, names), { start: 3, query: 'shubham si' });
  assert.equal(activeTrigger('hi @shubham sixteen', 19, names), null);
  assert.equal(activeTrigger('@a\nb', 5), null);
  assert.equal(activeTrigger('@x @sh', 6, names)?.start, 3);
  assert.equal(activeTrigger('@' + 'a'.repeat(41), 42), null);
});
test('inserting a full name writes "@First Last " and keeps the caret after the space', () => {
  const r = applyMention('@shubham si', { start: 0, query: 'shubham si' }, 11, crowd[0]!);
  assert.equal(r.text, '@Shubham Singh ');
  assert.equal(r.caret, r.text.length);
});
test('backspace deletes a whole mention at once, and ignores plain text', () => {
  const m = [mention(3, 16, 'Olivia Owner')];
  assert.deepEqual(backspaceMention('hi @Olivia Owner ok', 16, m), { text: 'hi  ok', caret: 3 });
  assert.equal(backspaceMention('hi @Olivia Owner ok', 17, m), null);
  assert.equal(backspaceMention('hi @Olivia Owner ok', 2, m), null);
});
test('ranges still shift after edits with full-name mentions', () => {
  const m = [mention(0, 14, 'Shubham Singh', 'u1')];
  assert.deepEqual(shiftMentions('@Shubham Singh x', 'Hey @Shubham Singh x', m), [{ ...m[0]!, start: 4, end: 18 }]);
});
