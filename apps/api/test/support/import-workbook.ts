import { zipXmlParts } from './import-xml-fixture.ts';
export interface Row {
  externalId?: string;
  title?: string;
  description?: string;
  priority?: string;
  dueDate?: string | number;
  assignees?: string;
  status?: string;
}
export function workbook(rows: Row[], opts: {
  dateStyle?: boolean;
  inlineStrings?: boolean;
  date1904?: boolean;
} = {}): Buffer {
  const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const fields = ['externalId', 'title', 'description', 'priority', 'dueDate', 'assignees', 'status'] as const;
  const values: (string | number)[][] = [['External ID', 'Title', 'Description', 'Priority', 'Due Date', 'Assignees', 'Status'], ...rows.map(r => fields.map(k => r[k] ?? ''))];
  const strings: string[] = [];
  const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + values.map((r, n) => `<row r="${n + 1}">` + r.map((v, c) => {
    const ref = `${String.fromCharCode(65 + c)}${n + 1}`;
    return typeof v === 'number' ? `<c r="${ref}" t="n"${opts.dateStyle && c === 4 ? ' s="1"' : ''}><v>${v}</v></c>` : opts.inlineStrings ? `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>` : `<c r="${ref}" t="s"><v>${strings.push(v) - 1}</v></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ['worksheets/sheet1', 'sharedStrings', 'styles'].map((name, i) => `<Override PartName="/xl/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${['worksheet', 'sharedStrings', 'styles'][i]}+xml"/>`).join('') + '</Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${opts.date1904 ? '1' : '0'}"/><sheets><sheet name="Cards" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + strings.map(s => '<si><t>' + xml(s) + '</t></si>').join('') + '</sst>',
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
  };
  return zipXmlParts(files);
}
