import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvitationInputSchema, isValidInvitationEmail } from '../src/invitations.ts';

// B-7 invitation email rules, table-driven. Each row: input, expected accept (true) or refuse (false).
const cases: Array<[string, boolean, string]> = [
  // Accepted.
  ['user@example.com', true, 'plain address'],
  ['first.last@sub.example.co.uk', true, 'dotted local part and subdomains'],
  ['o+tag@example.org', true, 'plus tag'],
  ['a_b-c!#$%&\'*+/=?^_`{|}~@x.io', true, 'every atext symbol is allowed'],
  ['u@xn--80ak6aa92e.com', true, 'punycode label'],
  ['a'.repeat(64) + '@example.com', true, 'local part of exactly 64 characters'],
  // Refused: control characters and whitespace (header injection, folding).
  ['user@example.com\r\nBcc: victim@example.net', false, 'CRLF header injection'],
  ['user@example.com\n', false, 'trailing LF'],
  ['us\ter@example.com', false, 'tab inside local part'],
  ['us\u0000er@example.com', false, 'NUL byte'],
  ['us er@example.com', false, 'space inside local part'],
  ['user@exa mple.com', false, 'space inside domain'],
  // Refused: display-name forms and quoted parts.
  ['Name <user@example.com>', false, 'display name with angle brackets'],
  ['<user@example.com>', false, 'bare angle brackets'],
  ['"user name"@example.com', false, 'quoted local part'],
  ['user,other@example.com', false, 'comma'],
  ['user;other@example.com', false, 'semicolon'],
  ['user:other@example.com', false, 'colon'],
  ['(user)@example.com', false, 'parentheses'],
  ['user\\@example.com', false, 'backslash'],
  // Refused: non-ASCII.
  ['usér@example.com', false, 'accented local part'],
  ['user@exämple.com', false, 'accented domain'],
  // Refused: structure, length and dots.
  ['', false, 'empty'],
  ['user', false, 'no at sign'],
  ['@example.com', false, 'empty local part'],
  ['user@', false, 'empty domain'],
  ['user@@example.com', false, 'two at signs'],
  ['a@b@example.com', false, 'two at signs, mid string'],
  ['user@localhost', false, 'domain without a TLD'],
  ['user@example.c', false, 'one-letter TLD'],
  ['user@example.123', false, 'numeric TLD'],
  ['user@-example.com', false, 'label starts with a hyphen'],
  ['user@example-.com', false, 'label ends with a hyphen'],
  ['.user@example.com', false, 'leading dot in local part'],
  ['user.@example.com', false, 'trailing dot in local part'],
  ['us..er@example.com', false, 'consecutive dots in local part'],
  ['user@.example.com', false, 'leading dot in domain'],
  ['user@example.com.', false, 'trailing dot in domain'],
  ['user@example..com', false, 'consecutive dots in domain'],
  ['a'.repeat(65) + '@example.com', false, 'local part of 65 characters'],
  ['user@' + 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.com', false, 'domain over 255 characters'],
  ['user@' + 'a'.repeat(64) + '.com', false, 'label over 63 characters'],
  ['a'.repeat(64) + '@' + 'b'.repeat(190) + '.com', false, 'total over 254 characters'],
];

test('invitation email: table of accepted and refused addresses', async (t) => {
  for (const [input, accepted, why] of cases) {
    await t.test(`${accepted ? 'accepts' : 'refuses'} ${why}`, () => {
      assert.equal(isValidInvitationEmail(input), accepted);
      const parsed = createInvitationInputSchema.safeParse({ email: input, role: 'member' });
      assert.equal(parsed.success, accepted, parsed.success ? 'schema accepted' : JSON.stringify(parsed.error.issues));
    });
  }
});

test('invitation email: trim and lowercase still apply, and the stored value is normalised', () => {
  const parsed = createInvitationInputSchema.parse({ email: '  User@Example.COM  ', role: 'viewer' });
  assert.equal(parsed.email, 'user@example.com');
});

test('invitation email: a refused address reports the documented message', () => {
  const parsed = createInvitationInputSchema.safeParse({ email: 'Name <user@example.com>', role: 'member' });
  assert.equal(parsed.success, false);
  assert.equal(parsed.error!.issues[0]!.message, 'Invalid email address format');
});
