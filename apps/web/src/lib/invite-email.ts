import { isValidInvitationEmail } from '@flowboard/contracts';

export type EmailCheck = { ok: true; value: string } | { ok: false; message: string };

const CONTROL = /[\u0000-\u001f\u007f]/;
const EXAMPLE = 'name@company.com';

/**
 * Explains why an address would be refused. The accept/reject decision always comes from the contract's
 * `isValidInvitationEmail` (the same function the API runs), so the two cannot drift; the branches below only choose the sentence.
 * The server stays the source of truth: its error is still shown if it disagrees.
 */
export function checkInvitationEmail(raw: string): EmailCheck {
  // Checked before trim, as the contract does: trim would quietly drop a trailing CR or LF.
  if (CONTROL.test(raw)) return { ok: false, message: 'An email address cannot contain line breaks or other control characters.' };
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, message: `Enter an email address, such as ${EXAMPLE}.` };
  if (value.length > 254) return { ok: false, message: 'An email address can be at most 254 characters.' };
  if (/[<>"]/.test(value)) return { ok: false, message: `Enter just the address, without a name or quotes: ${EXAMPLE}.` };
  if (/\s/.test(value)) return { ok: false, message: 'An email address cannot contain spaces.' };
  if (/[^\u0000-\u007f]/.test(value)) return { ok: false, message: 'Use plain English letters, digits and standard symbols only. Accented or non-English characters are not supported yet.' };
  const at = value.indexOf('@');
  if (at === -1) return { ok: false, message: `Include an @, such as ${EXAMPLE}.` };
  if (value.indexOf('@', at + 1) !== -1) return { ok: false, message: 'Use exactly one @ in the address.' };
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local) return { ok: false, message: 'Add the part before the @.' };
  if (!domain) return { ok: false, message: 'Add the domain after the @, such as company.com.' };
  if (local.length > 64) return { ok: false, message: 'The part before the @ can be at most 64 characters.' };
  if (domain.length > 255) return { ok: false, message: 'The domain can be at most 255 characters.' };
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return { ok: false, message: 'An address cannot start or end with a dot, or have two dots in a row.' };
  }
  if (!domain.includes('.')) return { ok: false, message: `The domain needs a dot, such as company.com.` };
  if (!isValidInvitationEmail(value)) return { ok: false, message: `That does not look like a valid address. Use the form ${EXAMPLE}.` };
  return { ok: true, value };
}

/** aria attributes for the email input; the message element must carry `id`. */
export function emailFieldAria(error: string, id: string): { 'aria-invalid': boolean; 'aria-describedby'?: string } {
  return error ? { 'aria-invalid': true, 'aria-describedby': id } : { 'aria-invalid': false };
}
