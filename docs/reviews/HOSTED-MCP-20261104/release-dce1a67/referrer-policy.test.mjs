import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveReferrerPolicy, effectiveReferrerPolicyFromFields } from './referrer-policy.mjs';
for (const [header, expected] of [
  ['no-referrer', 'no-referrer'],
  ['strict-origin-when-cross-origin, no-referrer', 'no-referrer'],
  ['no-referrer, strict-origin-when-cross-origin', 'strict-origin-when-cross-origin'],
  ['no-referrer, unsafe-url', 'unsafe-url'],
  ['unsafe-url, no-referrer', 'no-referrer'],
  ['unknown, no-referrer, unknown', 'no-referrer'],
  ['NO-REFERRER', ''],
  ['', ''],
  [null, ''],
]) test(`standards policy result for ${JSON.stringify(header)}`, () => assert.equal(effectiveReferrerPolicy(header), expected));

for (const header of ['no-referrer\n', 'strict-origin-when-cross-origin\nno-referrer', 'no-referrer\r\nunsafe-url']) test('raw newline field is rejected: '+JSON.stringify(header), () => assert.equal(effectiveReferrerPolicy(header), ''));
test('ordered repeated fields preserve browser policy ordering', () => {
  assert.equal(effectiveReferrerPolicyFromFields(['strict-origin-when-cross-origin', 'no-referrer']), 'no-referrer');
  assert.equal(effectiveReferrerPolicyFromFields(['no-referrer', 'unsafe-url']), 'unsafe-url');
  assert.equal(effectiveReferrerPolicyFromFields(['no-referrer', 'unsafe-url\n']), '');
});
