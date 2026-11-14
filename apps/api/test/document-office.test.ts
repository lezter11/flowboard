import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOfficeDocument, type OfficeMediaType } from '../src/services/document-office.ts';
import { zipXmlParts } from './support/import-xml-fixture.ts';
import {
  CONTENT_PREFIX, EXCEL_MIME, excelDocumentFixture, excelParts, OFFICE_REL_NS, relationship, relationshipPart,
  WORD_MIME, WORD_NS, wordDocumentFixture, wordParts,
} from './support/document-office-fixtures.ts';

const signal = new AbortController().signal;
const expectInvalid = (bytes: Buffer, type: OfficeMediaType = WORD_MIME) =>
  assert.throws(() => validateOfficeDocument(bytes, type, signal), /Unsupported Office document/);

test('allows ordinary macro-free Word content and local Excel calculations without rewriting either file', () => {
  for (const [fixture, mime] of [[wordDocumentFixture(), WORD_MIME], [excelDocumentFixture(), EXCEL_MIME]] as const) {
    const original = Buffer.from(fixture);
    validateOfficeDocument(fixture, mime, signal);
    assert.deepEqual(fixture, original);
  }
});

test('the claimed MIME must match the Office package and an abort fails closed', () => {
  expectInvalid(wordDocumentFixture(), EXCEL_MIME);
  expectInvalid(excelDocumentFixture(), WORD_MIME);
  expectInvalid(Buffer.from('not a zip'));
  const abort = new Error('synthetic abort');
  assert.throws(() => validateOfficeDocument(wordDocumentFixture(), WORD_MIME, AbortSignal.abort(abort)), error => error === abort);
});

test('rejects embedded content, external relationship modes, forms that call out, and Word fields', () => {
  for (const part of ['word/vbaProject.bin', 'word/activeX/a.xml', 'word/embeddings/oleObject1.bin', 'word/media/image1.png']) {
    expectInvalid(zipXmlParts({ ...wordParts(), [part]: 'not safe' }));
  }
  for (const value of [
    `<Relationship Id="ext" Type="${OFFICE_REL_NS}/hyperlink" Target="https://example.invalid/" TargetMode="External"/>`,
    `<Relationship Id="ext" Type="${OFFICE_REL_NS}/styles" Target="word/styles.xml" xmlns:x="urn:mode" x:TargetMode="External"/>`,
    relationship('ext', 'attachedTemplate', 'styles.xml'),
    relationship('ext', 'styles', '%2e%2e/styles.xml'),
  ]) {
    const files = wordParts();
    files['word/_rels/document.xml.rels'] = relationshipPart(value);
    expectInvalid(zipXmlParts(files));
  }
  for (const body of [
    '<w:p><w:r><w:instrText>INCLUDETEXT somebody</w:instrText></w:r></w:p>',
    '<w:fldSimple w:instr="DDE value"/>',
    '<w:altChunk w:id="X"/>',
    '<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="unknown"/>',
  ]) {
    expectInvalid(zipXmlParts({ ...wordParts(), 'word/document.xml': `<w:document xmlns:w="${WORD_NS}"><w:body>${body}</w:body></w:document>` }));
  }
});

test('checks ancillary Word web settings and rejects alternate processing instructions and external markup', () => {
  const web = (content: string) => {
    const files = wordParts();
    files['[Content_Types].xml'] = String(files['[Content_Types].xml']).replace('</Types>',
      `<Override PartName="/word/webSettings.xml" ContentType="${CONTENT_PREFIX}wordprocessingml.webSettings+xml"/></Types>`);
    files['word/_rels/document.xml.rels'] = relationshipPart(relationship('rId1', 'styles', 'styles.xml') + relationship('rId2', 'webSettings', 'webSettings.xml'));
    files['word/webSettings.xml'] = `<w:webSettings xmlns:w="${WORD_NS}">${content}</w:webSettings>`;
    return zipXmlParts(files);
  };
  validateOfficeDocument(web('<w:allowPNG/><w:doNotSaveAsSingleFile w:val="1"/>'), WORD_MIME, signal);
  expectInvalid(web('<w:frameset><w:frame><w:name w:val="audit"/><w:sourceFileName w:val="https://outside.invalid/synthetic"/></w:frame></w:frameset>'));
  expectInvalid(web('<w:allowPNG w:val="https://outside.invalid/synthetic"/>'));
  expectInvalid(web('<w:allowPNG xml:base="https://outside.invalid"/>'));
  expectInvalid(web('<w:allowPNG xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:ProcessContent="w:allowPNG"/>'));
  expectInvalid(zipXmlParts({ ...wordParts(), 'word/document.xml': `<w:document xmlns:w="${WORD_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><mc:AlternateContent><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent></w:body></w:document>` }));
});

test('validates all Excel formula locations, including definitions, tables and conditional formatting', () => {
  for (const formula of ['WEBSERVICE("https://example.invalid/")', 'RTD("name",,"a")', 'HYPERLINK("https://example.invalid/")',
    '&apos;[1]Totals&apos;!A1', '_xlfn.WEBSERVICE("url")', 'DDE|"service"!A1', 'A1SUM(A1)', 'CELL("filename")']) {
    expectInvalid(zipXmlParts(excelParts(formula)), EXCEL_MIME);
  }
  for (const [part, element] of [
    ['xl/workbook.xml', '<definedNames><definedName name="Auto_Open">Totals!A1</definedName></definedNames>'],
    ['xl/workbook.xml', '<definedNames><definedName name="_xlnm.Print_Area">WEBSERVICE("url")</definedName></definedNames>'],
    ['xl/workbook.xml', '<definedNames><definedName name="_xlnm.Print_Area" xlm="1" vbProcedure="1" function="1" refersTo="WEBSERVICE(&quot;https://outside.invalid/test&quot;)">Totals!A1</definedName></definedNames>'],
    ['xl/worksheets/sheet1.xml', '<dataValidations><dataValidation><formula1>RTD("server")</formula1></dataValidation></dataValidations>'],
    ['xl/worksheets/sheet1.xml', '<conditionalFormatting><cfRule><formula>HYPERLINK("url")</formula></cfRule></conditionalFormatting>'],
    ['xl/workbook.xml', '<externalReferences/>'],
  ] as const) {
    const files = excelParts();
    files[part] = String(files[part]).replace(/<\/(?:workbook|worksheet)>$/, end => element + end);
    expectInvalid(zipXmlParts(files), EXCEL_MIME);
  }
  validateOfficeDocument(zipXmlParts(excelParts(`'Totals'!$A$1+'Totals'!A2`)), EXCEL_MIME, signal);
});

test('rejects extra package parts, malformed XML, mislabeled content, and nested archive bytes', () => {
  for (const body of ['<!DOCTYPE w:document SYSTEM "file:///tmp/fixture">', '<?xml-stylesheet href="https://example.invalid/"?>']) {
    expectInvalid(zipXmlParts({ ...wordParts(), 'word/document.xml': body + wordParts()['word/document.xml'] }));
  }
  expectInvalid(zipXmlParts({ ...wordParts(), 'word/styles.xml': excelDocumentFixture() }));
  const parts = wordParts();
  parts['[Content_Types].xml'] = String(parts['[Content_Types].xml']).replace(`${CONTENT_PREFIX}wordprocessingml.document.main+xml`, 'application/vnd.ms-word.document.macroEnabled.main+xml');
  expectInvalid(zipXmlParts(parts));
  expectInvalid(zipXmlParts({ ...wordParts(), 'WORD/STYLES.XML': '<xml/>' }));
  expectInvalid(zipXmlParts({ ...wordParts(), 'word/../styles.xml': '<xml/>' }));
  const unlinked = wordParts();
  delete unlinked['word/_rels/document.xml.rels'];
  expectInvalid(zipXmlParts(unlinked));
});

test('rejects CRC failures, inconsistent headers, extra outer bytes, and expansion beyond the limit', () => {
  const tampered = wordDocumentFixture();
  tampered.writeUInt32LE(tampered.readUInt32LE(14) ^ 1, 14);
  expectInvalid(tampered);
  const encrypted = wordDocumentFixture();
  encrypted.writeUInt16LE(1, 6);
  expectInvalid(encrypted);
  expectInvalid(Buffer.concat([wordDocumentFixture(), Buffer.from('trailing')]));
  expectInvalid(Buffer.concat([Buffer.from('prefix'), wordDocumentFixture()]));
  const expanded = wordParts();
  expanded['word/document.xml'] = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
  const bomb = zipXmlParts(expanded);
  assert(bomb.length < 20_000);
  expectInvalid(bomb);
});

test('bounds XML namespace inheritance and declarations before constructing a tree', () => {
  const wrap = (declarations: string, body: string) => `<w:document xmlns:w="${WORD_NS}"${declarations}><w:body>${body}</w:body></w:document>`;
  const archive = (markup: string) => zipXmlParts({ ...wordParts(), 'word/document.xml': markup });
  const declarations = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => ` xmlns:${prefix}${index}="urn:${prefix}:${index}"`).join('');
  const concentrated = archive(wrap(declarations(19_000, 'n'), '<w:p/>'.repeat(36_000)));
  assert(concentrated.length < 1024 * 1024);
  const started = performance.now();
  expectInvalid(concentrated);
  assert(performance.now() - started < 1000, 'a valid package must not tie up the scanner while rejecting namespaced markup');

  const inherited = archive(wrap(declarations(40, 'n'), `<w:p${declarations(30, 'b')}/>`));
  expectInvalid(inherited);
  expectInvalid(archive(wrap(` title="${'a'.repeat(8192)}"`, '<w:p/>')));
  expectInvalid(archive(wrap(Array.from({ length: 97 }, (_, i) => ` a${i}="1"`).join(''), '<w:p/>')));
  validateOfficeDocument(archive(wrap('', '<!-- xmlns:harmless="urn:example" --><w:p><w:r><w:t><![CDATA[xmlns:harmless="urn:example"]]></w:t></w:r></w:p>')), WORD_MIME, signal);
});

test('keeps long allowed local formulas bounded', () => {
  const expression = `SUM($A$1:A2)${'+A1'.repeat(2000)}`;
  const started = performance.now();
  validateOfficeDocument(zipXmlParts(excelParts(expression)), EXCEL_MIME, signal);
  assert(performance.now() - started < 1000);
});
