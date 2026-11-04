import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_XML_MARKUP, MAX_XML_SEGMENT, parseXmlPart } from '../src/services/import-xml.ts';

const rejectsCode = (run: () => unknown, code: string) => assert.throws(run, (error: unknown) => error instanceof Error && 'code' in error && error.code === code);

test('XML native scans: permitted scalar boundaries survive UTF8 and both UTF16 byte orders', () => {
  const text = '\t\n\r !\ud7ff\ue000\ufffd\u{10000}😀\u{10ffff}';
  const xml = `<r>${text}</r>`;
  for (const bytes of [Buffer.from(xml), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(xml, 'utf16le').swap16()])]) {
    assert.equal(parseXmlPart(bytes, () => {}).text, text.replaceAll('\r', '\n'));
  }
});
test('XML native scans: forbidden scalars and malformed surrogate encodings fail before structural mutation', () => {
  for (const value of ['\0', '\x01', '\x08', '\x0b', '\x0c', '\x0e', '\x1f', '\ufffe', '\uffff']) {
    const budget = { markup: MAX_XML_MARKUP };
    rejectsCode(() => parseXmlPart(Buffer.from(`<r>${value}</r>`), () => {}, budget), 'INVALID_WORKBOOK');
    assert.equal(budget.markup, MAX_XML_MARKUP);
  }
  for (const value of ['\ud800', '\udc00', '\ud800x\udc00']) for (const bigEndian of [false, true]) {
    const data = Buffer.from(`<r>${value}</r>`, 'utf16le');
    const bytes = Buffer.concat([Buffer.from(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]), bigEndian ? data.swap16() : data]);
    rejectsCode(() => parseXmlPart(bytes, () => {}), 'INVALID_WORKBOOK');
  }
});
test('XML native scans: segment cap is exact in UTF16 units and rejects before the following delimiter increments the budget', () => {
  for (const delta of [-1, 0, 1]) {
    const budget = { markup: 0 }, bytes = Buffer.from('<!--' + 'x'.repeat(MAX_XML_SEGMENT - 6 + delta) + '--><r/>');
    if (delta <= 0) { assert.equal(parseXmlPart(bytes, () => {}, budget).name, 'r'); assert.equal(budget.markup, 2); }
    else { rejectsCode(() => parseXmlPart(bytes, () => {}, budget), 'XML_LIMIT_EXCEEDED'); assert.equal(budget.markup, 1); }
  }
  const astral = '😀'.repeat((MAX_XML_SEGMENT - 6) / 2);
  assert.equal(parseXmlPart(Buffer.from('<!--' + astral + '--><r/>'), () => {}).name, 'r');
  const budget = { markup: 0 };
  rejectsCode(() => parseXmlPart(Buffer.from('<!--' + astral + 'a--><r/>'), () => {}, budget), 'XML_LIMIT_EXCEEDED');
  assert.equal(budget.markup, 1);
  const leading = { markup: MAX_XML_MARKUP };
  rejectsCode(() => parseXmlPart(Buffer.from('x'.repeat(MAX_XML_SEGMENT + 1) + '<r/>'), () => {}, leading), 'XML_LIMIT_EXCEEDED');
  assert.equal(leading.markup, MAX_XML_MARKUP);
});
test('XML native scans: shared markup and scalar/XXE/deadline precedence stay exact', () => {
  const budget = { markup: MAX_XML_MARKUP - 1 };
  parseXmlPart(Buffer.from('<r/>'), () => {}, budget);
  assert.equal(budget.markup, MAX_XML_MARKUP);
  rejectsCode(() => parseXmlPart(Buffer.from('<r/>'), () => {}, budget), 'XML_LIMIT_EXCEEDED');
  assert.equal(budget.markup, MAX_XML_MARKUP + 1);
  const xxeBudget = { markup: MAX_XML_MARKUP };
  rejectsCode(() => parseXmlPart(Buffer.from('<!DOCTYPE r><r/>'), () => {}, xxeBudget), 'XXE_DETECTED');
  assert.equal(xxeBudget.markup, MAX_XML_MARKUP);
  const deadline = new Error('Synthetic deadline'), deadlineBudget = { markup: 0 };
  assert.throws(() => parseXmlPart(Buffer.from('<!DOCTYPE r><r/>'), () => { throw deadline; }, deadlineBudget), error => error === deadline);
  assert.equal(deadlineBudget.markup, 0);
});
