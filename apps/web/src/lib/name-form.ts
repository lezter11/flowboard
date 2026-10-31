import { NAME_PART_MAX, normalizeNamePart } from '@flowboard/contracts';

/** Pure checks for the "What should we call you?" step, so the form and the tests share one rule with the API. */
export interface NameCheck {
  firstName: string | null;
  lastName: string | null;
  errors: { firstName?: string; lastName?: string };
  ok: boolean;
}

function partError(label: string, raw: string): string {
  if (raw.trim() === '') return `Enter your ${label}.`;
  if ([...raw.trim().replace(/\s+/gu, ' ')].length > NAME_PART_MAX) return `Your ${label} can be up to ${NAME_PART_MAX} characters.`;
  return `Your ${label} has a character we cannot use. Remove any invisible or control characters.`;
}

export function checkName(first: string, last: string): NameCheck {
  const firstName = normalizeNamePart(first);
  const lastName = normalizeNamePart(last);
  const errors: NameCheck['errors'] = {};
  if (firstName === null) errors.firstName = partError('first name', first);
  if (lastName === null) errors.lastName = partError('last name', last);
  return { firstName, lastName, errors, ok: firstName !== null && lastName !== null };
}

/** Form start values: Google's suggestions when the account has them, otherwise empty. Never the e-mail address. */
export function initialName(session: { suggestedFirstName?: string | null; suggestedLastName?: string | null }): { first: string; last: string } {
  return { first: session.suggestedFirstName ?? '', last: session.suggestedLastName ?? '' };
}
