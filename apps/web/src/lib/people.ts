import type { PersonDisplay } from '@flowboard/contracts';
import { formatPersonName } from './person-name.ts';

const TONES = ['alice', 'charlie', 'david', 'eve'] as const;
export type AvatarTone = (typeof TONES)[number];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

/** The prototype tints avatars alice/charlie/david/eve; real people get a stable tone from their id. */
export function toneFor(id: string): AvatarTone {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length]!;
}

export function personName(people: Map<string, PersonDisplay>, id: string): string {
  return formatPersonName(people.get(id), 'Unknown member');
}
