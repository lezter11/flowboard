import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseExcelWorkbook } from '../src/services/excel-parser.ts';
import { CELL_TYPES, INVALID_CELL_CHILDREN, cellWorkbook } from './support/import-xml-cell-fixture.ts';
const reject=(bytes:Buffer)=>assert.throws(()=>parseExcelWorkbook(bytes),(e:any)=>e.status===422);
for(const name of ['str-cell-inline-child','foreign-cell-value','mixed-value-inline']) {
  test(`Outer XML cell: reviewer ${name} rejects rather than loses description`,()=>reject(fs.readFileSync(new URL(`../../../docs/reviews/FULL-REVALIDATION-20261103/formal-import-round2/${name}.xlsx`,import.meta.url))));
}
for(const type of CELL_TYPES) for(const [name,content]of INVALID_CELL_CHILDREN) {
  test(`Outer XML cell: type=${type||'default'} ${name} rejected`,()=>reject(cellWorkbook(type,content)));
}
test('Outer XML cell: str must not contain inline-only text and inlineStr must not contain v',()=>{
  reject(cellWorkbook('str','<is><t>Hidden</t></is>'));
  reject(cellWorkbook('inlineStr','<v>Hidden</v>'));
});
test('Outer XML cell: valid empty/style cells remain blank for every supported type',()=>{
  for(const type of CELL_TYPES) {
    const p=parseExcelWorkbook(cellWorkbook(type,''));
    assert.equal(p.rows[0]!.description,'',type);assert.equal(p.rows[0]!.externalId,'0001');assert.deepEqual(p.rows[0]!.rawErrors,[]);
  }
});
test('Outer XML cell: whitespace around supported string/CDATA value preserves literal content',()=>{
  const p=parseExcelWorkbook(cellWorkbook('str',' \n <v>Before<![CDATA[&amp;#65;]]>After&#x1f642;</v>\t '));
  assert.equal(p.rows[0]!.description,'Before&amp;#65;After🙂');
});
test('Outer XML cell: UTF16 has the same mixed/foreign/direct-text rejection',()=>{
  for(const type of CELL_TYPES) for(const [,content]of INVALID_CELL_CHILDREN) reject(cellWorkbook(type,content,true));
});
