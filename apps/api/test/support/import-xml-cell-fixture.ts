import { workbook } from './import-workbook.ts';
import { rewriteWorkbook } from './import-xml-fixture.ts';

export const CELL_TYPES = ['', 'n', 's', 'str', 'inlineStr', 'b', 'e', 'd'] as const;
export const INVALID_CELL_CHILDREN = [
  ['foreign-v', '<bad:v xmlns:bad="urn:unsupported">Hidden</bad:v>'],
  ['foreign-is', '<bad:is xmlns:bad="urn:unsupported"><bad:t>Hidden</bad:t></bad:is>'],
  ['foreign-f', '<bad:f xmlns:bad="urn:unsupported">1+1</bad:f>'],
  ['unknown', '<unknown>Hidden</unknown>'],
  ['mixed', '<v>1</v><is><t>Hidden</t></is>'],
  ['multiple-values', '<v>1</v><v>2</v>'],
  ['multiple-inline', '<is><t>First</t></is><is><t>Second</t></is>'],
  ['direct-text', 'Hidden'],
  ['direct-cdata', '<![CDATA[Hidden]]>'],
] as const;
export function cellWorkbook(type: string, content: string, utf16 = false): Buffer {
  return rewriteWorkbook(workbook([{ externalId: '0001', title: 'Cell control' }], { inlineStrings:true }), parts => {
    let xml=parts['xl/worksheets/sheet1.xml']!.toString().replace(/<c r="C2"[^>]*>[\s\S]*?<\/c>/, `<c r="C2" s="0"${type ? ` t="${type}"` : ''}>${content}</c>`);
    if(utf16) xml='<?xml version="1.0" encoding="utf-16"?>'+xml;
    parts['xl/worksheets/sheet1.xml']=utf16 ? Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(xml,'utf16le')]) : Buffer.from(xml);
  });
}
