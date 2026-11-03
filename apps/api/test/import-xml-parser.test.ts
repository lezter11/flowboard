import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseExcelWorkbook } from '../src/services/excel-parser.ts';
import { workbook } from './support/import-workbook.ts';
import { rewriteWorkbook, zipXmlParts } from './support/import-xml-fixture.ts';

const prior = (name: string) => fs.readFileSync(new URL(`../../../docs/reviews/FULL-REVALIDATION-20261103/formal-import-round1/${name}.xlsx`, import.meta.url));
const reject422 = (bytes: Buffer) => assert.throws(() => parseExcelWorkbook(bytes), (err: any) => err.status === 422);
const literal = () => workbook([{ externalId: '0001', title: 'First Second', description: '  Keep\n whitespace & &#65;  ' }], { inlineStrings: true });
const changeSheet = (text: string) => rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(text); });

test('XML repair: prior entity-like literal is decoded once', () => assert.equal(parseExcelWorkbook(prior('double-entity')).rows[0]!.title, 'Literal &#x41; and &#65;'));
test('XML repair: prior inline rich text keeps every run', () => assert.equal(parseExcelWorkbook(prior('rich-inline-unique')).rows[0]!.title, 'First Second'));
test('XML repair: prior UTF16 worksheet keeps its row', () => assert.equal(parseExcelWorkbook(prior('utf16-worksheet')).totalRows, 1));
test('XML repair: legal single quoted attributes are recognized', () => assert.equal(parseExcelWorkbook(prior('single-quote-attributes')).totalRows, 1));
for (const name of ['utf16-formula', 'macro-content-type', 'external-relationship', 'actual-image-package', 'invalid-numeric-entity', 'merged-data', 'xxe', 'formula']) {
  test(`XML repair: prior ${name} rejects safely`, () => reject422(prior(name)));
}
test('XML repair: text leading zero IDs and description whitespace survive', () => {
  const r = parseExcelWorkbook(literal()).rows[0]!;
  assert.equal(r.externalId, '0001'); assert.equal(r.externalIdIsNumeric, false); assert.equal(r.description, '  Keep\n whitespace & &#65;  ');
});
for (const xml of ['<worksheet/>', '<worksheet><sheetData/></worksheet>', '<worksheet><sheetData></worksheet>', '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>External ID</t></is></c><c r="B2" t="inlineStr"><is><t>Title</t></is></c></row></sheetData></worksheet>']) {
  test(`XML repair: missing/malformed/row2 header ${xml.slice(0,45)} rejects`, () => reject422(changeSheet(xml)));
}
for (const value of ['&#x110000;', '&#0;', '&#xD800;', '&unknown;', '&oops', '\u0001']) {
  test(`XML repair: invalid XML text ${JSON.stringify(value)} rejects safely`, () => reject422(rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(p['xl/worksheets/sheet1.xml']!.toString().replace('First Second', value)); })));
}
test('XML repair: mismatched and unsupported encoding declarations reject', () => {
  for (const encoding of ['utf-16', 'windows-1252']) reject422(rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(`<?xml version="1.0" encoding="${encoding}"?>` + p['xl/worksheets/sheet1.xml']!.toString()); }));
});
test('XML repair: invalid UTF8 rejects instead of replacement-character corruption', () => reject422(rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.concat([p['xl/worksheets/sheet1.xml']!, Buffer.from([0xff])]); })));
test('XML repair: all XML parts reject hidden declarations including UTF16', () => reject422(rewriteWorkbook(literal(), p => { p['docProps/custom.xml'] = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="utf-16"?><!DOCTYPE x [<!ENTITY x "x">]><x/>', 'utf16le')]); })));
test('XML repair: actual supplied blank template is valid with zero domain rows', () => assert.equal(parseExcelWorkbook(fs.readFileSync(new URL('../../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx', import.meta.url))).totalRows, 0));

test('XML repair: CDATA is literal while normal references decode exactly once', () => {
  const bytes = rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(p['xl/worksheets/sheet1.xml']!.toString().replace('First Second', '<![CDATA[&amp;#x41; &unknown;]]>&#x1f642;&amp;#65;')); });
  assert.equal(parseExcelWorkbook(bytes).rows[0]!.title, '&amp;#x41; &unknown;🙂&#65;');
});
test('XML repair: shared rich text preserves all runs excluding phonetic annotations', () => {
  const bytes = rewriteWorkbook(workbook([{ externalId: '0001', title: 'Placeholder' }]), p => {
    p['xl/sharedStrings.xml'] = Buffer.from(p['xl/sharedStrings.xml']!.toString().replace('<si><t>Placeholder</t></si>', '<si><r><t xml:space="preserve">First </t></r><r><t>Second</t></r><rPh sb="0" eb="1"><t>phonetic</t></rPh></si>'));
  });
  assert.equal(parseExcelWorkbook(bytes).rows[0]!.title, 'First Second');
});
test('XML repair: alternative namespace prefixes and UTF16BE/LE declarations work', () => {
  for (const encoding of ['utf-8-bom', 'utf-16le-bom', 'utf-16be-bom', 'utf-16le', 'utf-16be']) {
    const bytes = rewriteWorkbook(literal(), p => {
      let xml = p['xl/worksheets/sheet1.xml']!.toString().replace('xmlns="', 'xmlns:s="').replace(/<(\/?)(worksheet|sheetData|row|c|is|t|v)(?=[\s/>])/g, '<$1s:$2');
      const utf16 = encoding.startsWith('utf-16');
      xml = `<?xml version='1.0' encoding='${encoding.endsWith('-bom') ? (utf16 ? 'utf-16' : 'utf-8') : encoding}'?>` + xml;
      let raw = Buffer.from(xml, utf16 ? 'utf16le' : 'utf8');
      if (encoding.includes('be')) raw = raw.swap16();
      const bom = encoding === 'utf-8-bom' ? Buffer.from([0xef,0xbb,0xbf]) : encoding === 'utf-16le-bom' ? Buffer.from([0xff,0xfe]) : encoding === 'utf-16be-bom' ? Buffer.from([0xfe,0xff]) : Buffer.alloc(0);
      p['xl/worksheets/sheet1.xml'] = Buffer.concat([bom, raw]);
    });
    assert.equal(parseExcelWorkbook(bytes).rows[0]!.externalId, '0001', encoding);
  }
});
for (const edit of [
  (xml: string) => xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="urn:wrong"'),
  (xml: string) => xml.replace('<c r="A2"', '<wrong:c r="A2"').replace('</c><c r="B2"', '</wrong:c><c r="B2"'),
  (xml: string) => xml.replace('r="B2"', 'r="A2"'),
  (xml: string) => xml.replace('r="B2"', 'r="B3"'),
  (xml: string) => xml.replace('<row r="2">', '<row r="1">'),
  (xml: string) => xml.replace('First Second', '<bad>lost</bad>'),
]) {
  test('XML repair: invalid namespace/reference/unsupported cell text structure rejects', () => reject422(rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(edit(p['xl/worksheets/sheet1.xml']!.toString())); })));
}
test('XML repair: XML forest, excessive nesting and gigantic text are bounded before unbounded AST allocation', () => {
  for (const value of ['<n/>'.repeat(5_000_000), 'x'.repeat(19 * 1024 * 1024), '<n>'.repeat(10000) + 'x' + '</n>'.repeat(10000)]) {
    const bytes = rewriteWorkbook(literal(), p => { p['xl/worksheets/sheet1.xml'] = Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${value}</worksheet>`); });
    const started = performance.now(); reject422(bytes);
    assert.ok(performance.now() - started < 2000, 'controlled parse rejection under2s wall time on localNode');
  }
});
test('XML repair: external relationships are rejected in every rels part, including unused UTF16rels', () => {
  reject422(rewriteWorkbook(literal(), p => {
    p['xl/worksheets/_rels/sheet1.xml.rels'] = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('<?xml version="1.0" encoding="utf-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.invalid/remote.xml" TargetMode="External"/></Relationships>', 'utf16le')]);
  }));
});
test('XML repair: ZIP CRC, duplicate names, local/central names and unsafe paths are enforced', () => {
  const bytes = literal(), corrupt = Buffer.from(bytes);
  const firstCentral = corrupt.readUInt32LE(corrupt.length - 22 + 16);
  corrupt.writeUInt32LE(123, 14); corrupt.writeUInt32LE(123, firstCentral + 16);
  assert.throws(() => parseExcelWorkbook(corrupt), (e: any) => e.status===422 && /CRC/.test(e.message));
  const duplicate=zipXmlParts({'a.xml':'<a/>','b.xml':'<b/>'});
  const central=duplicate.readUInt32LE(duplicate.length-22+16);
  const next=central+46+duplicate.readUInt16LE(central+28);
  duplicate[next+46]=0x61; duplicate[duplicate.readUInt32LE(next+42)+30]=0x61;
  assert.throws(() => parseExcelWorkbook(duplicate), (e: any) => e.status===422 && /duplicate/.test(e.message));
  for(const name of ['../evil.xml','/absolute.xml','a\\b.xml','a/%2e/b.xml']) {
    assert.throws(() => parseExcelWorkbook(zipXmlParts({[name]:'<x/>'})), (e: any) => e.status===422 && /Unsafe/.test(e.message));
  }
  const mismatch=Buffer.from(bytes); mismatch[30]=0x61;
  assert.throws(() => parseExcelWorkbook(mismatch), (e: any) => e.status===422 && /metadata/.test(e.message));
});

test('XML repair: nonempty unsupported string structure cannot silently disappear', () => {
  for(const title of ['<bad><t>Hidden</t></bad>','<r><t>First</t><t>Second</t></r>']) {
    reject422(rewriteWorkbook(literal(),p=>{p['xl/worksheets/sheet1.xml']=Buffer.from(p['xl/worksheets/sheet1.xml']!.toString().replace('<t>First Second</t>',title));}));
  }
});
