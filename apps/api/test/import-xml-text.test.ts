import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeXmlText } from '../src/services/import-xml.ts';

test('XML text: repeated escaped ampersands retain every original character', () => {
  assert.equal(decodeXmlText('&amp;'.repeat(20_000)), '&'.repeat(20_000));
});

test('XML text: native ampersand decoding never rescans decoded entity-like text', () => {
  for (const [source, expected] of [
    ['Literal &amp;#65; &amp;#x41; &amp;amp;', 'Literal &#65; &#x41; &amp;'],
    ['&#38;amp; &amp;#38; &#x26;lt;', '&amp; &#38; &lt;'],
    ['&lt;&gt;&quot;&apos;&amp;', '<>"\'&'],
    ['Plain 🙂 text', 'Plain 🙂 text'],
  ]) assert.equal(decodeXmlText(source!), expected);
});

test('XML text: malformed references among escaped ampersands remain rejected', () => {
  for (const invalid of ['&unknown;', '&amp', '&;', '&#0;', '&#xD800;', '&#x110000;', '&']) {
    assert.throws(() => decodeXmlText('&amp;'.repeat(20_000) + invalid), (error: any) => error.status === 422 && error.code === 'INVALID_WORKBOOK');
  }
});
