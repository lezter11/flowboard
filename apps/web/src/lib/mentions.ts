/**
 * @mention text helpers for the comment composer (S-16). Pure functions with no imports so node:test can run them.
 *
 * The API wants mentions as {userId, start, end}: UTF-16 offsets (JavaScript string indices) into the exact body that is sent, with no
 * overlap. Offsets drift as people edit, so the composer keeps spans in sync on every edit (`shiftMentions`) and re-checks them against
 * the final text before sending (`finalizeMentions`): a span that no longer reads "@Name" is dropped instead of sent wrong.
 */
export interface Mention { userId: string; name: string; start: number; end: number }
export interface MentionSpan { userId: string; start: number; end: number }
export interface Trigger { start: number; query: string }

const WORD = /[\p{L}\p{N}_]/u;
export const MAX_MENTIONS = 20;

import { formatPersonName } from './person-name.ts';

export const MAX_QUERY = 40;

/** Lower-case, accent-free form of a name or query, with a map from each character back to the original text. */
function fold(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const piece = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < piece.length; k += 1) map.push(i);
    norm += piece;
    i += ch.length;
  }
  map.push(text.length);
  return { norm, map };
}
const foldQuery = (q: string) => fold(q).norm.replace(/\s+/g, ' ');

/** Where a typed query matches a name: the start of the name or the start of any later word. Accents and case are ignored. */
export function matchRange(name: string, query: string): { start: number; end: number; rank: 0 | 1 } | null {
  const q = foldQuery(query);
  if (q.trim() === '') return { start: 0, end: 0, rank: 0 };
  const { norm, map } = fold(name);
  const flat = norm.replace(/\s+/g, ' ');
  if (flat !== norm) return null; // names are stored with single spaces; anything else cannot be mapped back safely
  const at = norm.startsWith(q) ? 0 : (() => { const w = norm.indexOf(` ${q}`); return w < 0 ? -1 : w + 1; })();
  if (at < 0) return null;
  const end = at + q.length;
  return { start: map[at]!, end: map[end] ?? name.length, rank: at === 0 ? 0 : 1 };
}

/** Candidates for a query, best first (matched on the numbered name the picker shows, so "@shubham" and "@shubham singh (2)" both work): full-name prefix, then other word-start matches, then A to Z by full name. */
export function rankPeople<T extends { id: string; displayName: string; nameSuffix?: number | null }>(people: readonly T[], query: string): T[] {
  return people
    .map((p) => ({ p, m: matchRange(formatPersonName(p), query) }))
    .filter((x): x is { p: T; m: NonNullable<ReturnType<typeof matchRange>> } => x.m !== null)
    .sort((a, b) => a.m.rank - b.m.rank || a.p.displayName.localeCompare(b.p.displayName) || (a.p.nameSuffix ?? 1) - (b.p.nameSuffix ?? 1) || a.p.id.localeCompare(b.p.id))
    .map((x) => x.p);
}

/** The name split into plain and matched pieces, for emphasising what was typed. */
export function highlight(name: string, query: string): Array<{ text: string; hit: boolean }> {
  const m = query.trim() === '' ? null : matchRange(name, query);
  if (!m || m.end <= m.start) return [{ text: name, hit: false }];
  return [{ text: name.slice(0, m.start), hit: false }, { text: name.slice(m.start, m.end), hit: true }, { text: name.slice(m.end), hit: false }].filter((x) => x.text !== '');
}

/**
 * The "@que" being typed just before the caret, if the @ starts the text or follows whitespace. The query may hold spaces
 * ("@shubham si") up to 40 characters. It ends at a newline or another @. When `names` is given, a query with a space that
 * can no longer match anyone ends the trigger, so ordinary text after "@bob" is not swallowed.
 */
export function activeTrigger(text: string, caret: number, names?: readonly string[]): Trigger | null {
  let j = caret - 1;
  while (j >= 0 && caret - j <= MAX_QUERY + 1 && text[j] !== '@' && text[j] !== '\n' && text[j] !== '\r') j -= 1;
  if (j < 0 || text[j] !== '@') return null;
  if (j > 0 && !/\s/.test(text[j - 1]!)) return null;
  const query = text.slice(j + 1, caret);
  if (query.length > MAX_QUERY) return null;
  if (/\s/.test(query) && names && !names.some((n) => matchRange(n, query) !== null)) return null;
  return { start: j, query };
}

/** Backspace over a mention removes all of it at once when the caret sits at its end (or inside it). */
export function backspaceMention(text: string, caret: number, mentions: Mention[]): { text: string; caret: number } | null {
  const m = mentions.find((x) => x.start < caret && caret <= x.end && text.slice(x.start, x.end) === `@${x.name}`);
  if (!m) return null;
  return { text: text.slice(0, m.start) + text.slice(m.end), caret: m.start };
}

/** Replaces the trigger with "@Name " and returns the new text, caret and the span that covers "@Name". */
export function applyMention(text: string, trigger: Trigger, caret: number, person: { id: string; displayName: string }): { text: string; caret: number; mention: Mention } {
  const token = `@${person.displayName}`;
  const next = `${text.slice(0, trigger.start)}${token} ${text.slice(caret)}`;
  const end = trigger.start + token.length;
  return { text: next, caret: end + 1, mention: { userId: person.id, name: person.displayName, start: trigger.start, end } };
}

/** Moves spans after an edit, found by comparing old and new text; a span the edit touches is removed. */
export function shiftMentions(oldText: string, newText: string, mentions: Mention[]): Mention[] {
  if (oldText === newText || mentions.length === 0) return mentions;
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1;
  const removedEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;
  const out: Mention[] = [];
  for (const m of mentions) {
    if (m.end <= prefix) out.push(m);
    else if (m.start >= removedEnd) out.push({ ...m, start: m.start + delta, end: m.end + delta });
  }
  return out;
}

/** What to send: the trimmed body (the API trims too) and only spans that still match the text exactly, shifted for the trim. */
export function finalizeMentions(body: string, mentions: Mention[]): { body: string; mentions: MentionSpan[] } {
  const lead = body.length - body.trimStart().length;
  const trimmed = body.trim();
  const ok = mentions
    .filter((m) => m.start >= lead && m.end <= lead + trimmed.length && body.slice(m.start, m.end) === `@${m.name}` && !(m.end < body.length && WORD.test(body[m.end]!)))
    .sort((a, b) => a.start - b.start);
  const spans: MentionSpan[] = [];
  let last = -1;
  for (const m of ok) {
    if (m.start < last) continue;
    spans.push({ userId: m.userId, start: m.start - lead, end: m.end - lead });
    last = m.end;
    if (spans.length === MAX_MENTIONS) break;
  }
  return { body: trimmed, mentions: spans };
}

/** Splits a stored comment into plain and mention parts for display. Bad spans from the server fall back to plain text. */
export function segments(body: string, mentions: ReadonlyArray<MentionSpan> | undefined): Array<{ text: string; userId?: string }> {
  const spans = [...(mentions ?? [])].sort((a, b) => a.start - b.start);
  const out: Array<{ text: string; userId?: string }> = [];
  let at = 0;
  for (const m of spans) {
    if (m.start < at || m.end > body.length || m.start >= m.end) continue;
    if (m.start > at) out.push({ text: body.slice(at, m.start) });
    out.push({ text: body.slice(m.start, m.end), userId: m.userId });
    at = m.end;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out.length ? out : [{ text: body }];
}
