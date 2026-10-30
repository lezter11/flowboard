import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvitationInputSchema } from '@flowboard/contracts';
import { checkInvitationEmail, emailFieldAria } from '../src/lib/invite-email.ts';

const long = (n: number) => 'a'.repeat(n);
const valid: Array<[string, string, string]> = [
  ['plain', 'name@company.com', 'name@company.com'],
  ['trims and lowercases', '  Name@Company.COM  ', 'name@company.com'],
  ['plus tag', 'a+tag@sub.company.co', 'a+tag@sub.company.co'],
  ['dot inside local', 'first.last@company.com', 'first.last@company.com'],
  ['rfc atext symbols', "o'brien!#$%&*/=?^_`{|}~-@x.io", "o'brien!#$%&*/=?^_`{|}~-@x.io"],
  ['64 char local', `${long(64)}@x.io`, `${long(64)}@x.io`],
  ['254 chars total', `${long(64)}@${long(63)}.${long(63)}.${long(55)}.com`, `${long(64)}@${long(63)}.${long(63)}.${long(55)}.com`],
];
const invalid: Array<[string, string, RegExp]> = [
  ['empty', '', /Enter an email/],
  ['only spaces', '   ', /Enter an email/],
  ['CR', 'a@b.co\r', /line breaks/],
  ['LF in the middle', 'a@b.co\nbcc:x@y.zz', /line breaks/],
  ['tab', 'a\t@b.co', /control characters/],
  ['NUL', 'a@b.co\u0000', /control characters/],
  ['space inside', 'a b@c.co', /spaces/],
  ['display name', 'Ann <ann@b.co>', /without a name or quotes/],
  ['quoted local', '"ann"@b.co', /without a name or quotes/],
  ['non-ASCII local', 'zoë@b.co', /plain English/],
  ['non-ASCII domain', 'a@bücher.de', /plain English/],
  ['no @', 'abc.co', /Include an @/],
  ['two @', 'a@b@c.co', /exactly one @/],
  ['empty local', '@b.co', /before the @/],
  ['empty domain', 'a@', /domain after the @/],
  ['local over 64', `${long(65)}@b.co`, /at most 64/],
  ['domain over 255', `a@${long(256)}.co`, /at most (255|254)/],
  ['over 254 total', `${long(64)}@${long(63)}.${long(63)}.${long(60)}.com`, /at most 254/],
  ['leading dot local', '.a@b.co', /dot/],
  ['trailing dot local', 'a.@b.co', /dot/],
  ['double dot local', 'a..b@c.co', /dot/],
  ['leading dot domain', 'a@.b.co', /dot/],
  ['trailing dot domain', 'a@b.co.', /dot/],
  ['double dot domain', 'a@b..co', /dot/],
  ['domain without dot', 'a@localhost', /needs a dot/],
  ['numeric tld', 'a@b.123', /valid address/],
  ['one-letter tld', 'a@b.c', /valid address/],
  ['hyphen-led label', 'a@-b.co', /valid address/],
  ['comma', 'a,b@c.co', /valid address/],
];

for (const [name, input, expected] of valid) {
  test(`accepts: ${name}`, () => {
    const result = checkInvitationEmail(input);
    assert.deepEqual(result, { ok: true, value: expected });
  });
}
for (const [name, input, message] of invalid) {
  test(`rejects with a specific message: ${name}`, () => {
    const result = checkInvitationEmail(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, message);
  });
}

test('the client verdict always equals the contract schema the server runs', () => {
  for (const input of [...valid.map((v) => v[1]), ...invalid.map((v) => v[1])]) {
    const client = checkInvitationEmail(input).ok;
    const server = createInvitationInputSchema.safeParse({ email: input, role: 'member' }).success;
    assert.equal(client, server, JSON.stringify(input));
  }
});

test('aria attributes link the input to its message only while there is an error', () => {
  assert.deepEqual(emailFieldAria('', 'inviteEmailError'), { 'aria-invalid': false });
  assert.deepEqual(emailFieldAria('Include an @', 'inviteEmailError'), { 'aria-invalid': true, 'aria-describedby': 'inviteEmailError' });
});
