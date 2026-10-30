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

/** The "@que" being typed just before the caret, if the @ starts the text or follows whitespace. */
export function activeTrigger(text: string, caret: number): Trigger | null {
  let j = caret - 1;
  while (j >= 0 && !/\s/.test(text[j]!) && text[j] !== '@') j -= 1;
  if (j < 0 || text[j] !== '@') return null;
  if (j > 0 && !/\s/.test(text[j - 1]!)) return null;
  const query = text.slice(j + 1, caret);
  return query.length > 40 ? null : { start: j, query };
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
