import assert from 'node:assert/strict';
import test from 'node:test';
import { cardDocumentLinkSchema, cardDocumentLinksSchema, updateCardInputSchema } from '../src/index.ts';

const docs = 'https://docs.google.com/document/d/Example-Word_1/edit?usp=sharing&authuser=0#heading=h.example';
const sheets = 'https://docs.google.com/spreadsheets/u/1/d/Example_Excel/edit?gid=3#gid=3&range=A1:D12';
const drive = 'https://drive.google.com/file/d/Example-PDF/view?usp=drive_link&resourcekey=0-abcDEF';

test('card document links preserve supported Google sharing URLs and trim names', () => {
  const urls = [docs, sheets, drive, 'https://drive.google.com/open?id=Example-Doc&resourcekey=0-1'];
  for (const url of urls) assert.deepEqual(cardDocumentLinkSchema.parse({ title: ' Report ', url }), { title: 'Report', url });
  assert.deepEqual(updateCardInputSchema.parse({ expectedVersion: 1, documentLinks: [] }), { expectedVersion: 1, documentLinks: [] });
  assert.deepEqual(updateCardInputSchema.parse({ expectedVersion: 1, title: 'Card' }), { expectedVersion: 1, title: 'Card' });
  assert.equal(updateCardInputSchema.safeParse({ expectedVersion: 1 }).success, false);
});

test('card document links reject external and unsafe Google paths, malformed inputs and duplicate URLs', () => {
  const invalid = [
    'http://docs.google.com/document/d/id/edit',
    'https://evil.test/document/d/doc/edit',
    'https://docs.google.com.evil.test/document/d/doc/edit',
    'https://docs.google.com@evil.test/document/d/doc/edit',
    'https://user@docs.google.com/document/d/doc/edit',
    'https://docs.google.com:443/document/d/doc/edit',
    'https://docs.google.com/route/../document/d/doc/edit',
    'https://docs.google.com/%2e/document/d/doc/edit',
    'https://docs.google.com/document/d/id%2fedit',
    'https://docs.google.com/document/d/id/edit?continue=https%3A%2F%2Fevil.test',
    'https://drive.google.com/open?id=Example&id=Other',
    'https://drive.google.com/open?id=https%3A%2F%2Fevil.test',
    'https://drive.google.com/open',
    'https://drive.google.com/drive/folders/example',
    'https://drive.google.com/uc?id=example',
    'https://docs.google.com/url?q=https%3A%2F%2Fevil.test',
    'https://docs.google.com/document/d/id/edit?usp=%0d%0a',
    'https://docs.google.com/document/d/id/edit#https://evil.test',
    'https://docs.google.com/document/d/id/edit?usp=' + 'a'.repeat(2_000),
    'javascript:alert(1)',
    '',
  ];
  for (const url of invalid) {
    const result = cardDocumentLinksSchema.safeParse([{ title: 'Report', url }]);
    assert.equal(result.success, false, url.slice(0, 100));
  }
  assert.equal(cardDocumentLinksSchema.safeParse([{ title: 'Report', url: docs }, { title: 'Again', url: docs.replace('docs.google.com', 'DOCS.GOOGLE.COM') }]).success, false);
  assert.equal(cardDocumentLinksSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ title: 'Report', url: `https://drive.google.com/file/d/file${i}/view` }))).success, false);
  for (const title of ['', 'a'.repeat(101), 'abc\u0000', 'abc\u202e', 'abc\ud800']) {
    assert.equal(cardDocumentLinkSchema.safeParse({ title, url: docs }).success, false);
  }
  assert.equal(cardDocumentLinkSchema.safeParse({ title: 'Report', url: docs, preview: true }).success, false);
});
