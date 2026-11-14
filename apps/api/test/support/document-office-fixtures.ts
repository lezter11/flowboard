import { zipXmlParts } from './import-xml-fixture.ts';

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const CONTENT_PREFIX = 'application/vnd.openxmlformats-officedocument.';

export const relationshipPart = (body: string) => `<Relationships xmlns="${PACKAGE_REL_NS}">${body}</Relationships>`;
export const relationship = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${OFFICE_REL_NS}/${type}" Target="${target}"/>`;

const contentTypes = (parts: Record<string, string>) => `<Types xmlns="${CONTENT_NS}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${Object.entries(parts).map(([name, type]) => `<Override PartName="/${name}" ContentType="${CONTENT_PREFIX}${type}+xml"/>`).join('')}
</Types>`;

export function wordParts() {
  return {
    '[Content_Types].xml': contentTypes({ 'word/document.xml': 'wordprocessingml.document.main', 'word/styles.xml': 'wordprocessingml.styles' }),
    '_rels/.rels': relationshipPart(relationship('rId1', 'officeDocument', 'word/document.xml')),
    'word/document.xml': `<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:bookmarkStart w:id="1" w:name="Overview"/><w:r><w:t>Synthetic project notes</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:p><w:hyperlink w:anchor="Overview"><w:r><w:t>Overview</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    'word/styles.xml': `<w:styles xmlns:w="${WORD_NS}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    'word/_rels/document.xml.rels': relationshipPart(relationship('rId1', 'styles', 'styles.xml')),
  } as Record<string, string | Buffer>;
}

export function excelParts(formula = 'IF(SUM($A$1:A2)>0,SUM($A$1:A2),0)') {
  return {
    '[Content_Types].xml': contentTypes({ 'xl/workbook.xml': 'spreadsheetml.sheet.main', 'xl/worksheets/sheet1.xml': 'spreadsheetml.worksheet' }),
    '_rels/.rels': relationshipPart(relationship('rId1', 'officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': `<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL_NS}"><sheets><sheet name="Totals" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': relationshipPart(relationship('rId1', 'worksheet', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${SHEET_NS}"><sheetData><row r="1"><c r="A1"><v>5</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><f>${formula}</f><v>8</v></c></row></sheetData></worksheet>`,
  } as Record<string, string | Buffer>;
}

export const wordDocumentFixture = () => zipXmlParts(wordParts());
export const excelDocumentFixture = () => zipXmlParts(excelParts());
