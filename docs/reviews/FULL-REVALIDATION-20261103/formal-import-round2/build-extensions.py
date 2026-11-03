import zipfile,pathlib,json
out=pathlib.Path(__file__).parent
with zipfile.ZipFile(out.parent/'formal-import-round1/control.xlsx') as z:base={n:z.read(n)for n in z.namelist()}
def write(name,edit):
 files=dict(base);edit(files)
 with zipfile.ZipFile(out/(name+'.xlsx'),'w',zipfile.ZIP_DEFLATED) as z:
  for n,data in files.items():z.writestr(n,data)
 with zipfile.ZipFile(out/(name+'.xlsx'))as z:assert z.testzip()is None
# Unrecognized cell-content representations must reject rather than silently lose description.
old=b'<x:c r="C2" s="7" t="inlineStr"><x:is><x:t>Synthetic official workbook row</x:t></x:is></x:c>'
write('str-cell-inline-child',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(old,old.replace(b't="inlineStr"',b't="str"'))}))
write('foreign-cell-value',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(old,b'<x:c r="C2" s="7" t="str"><bad:v xmlns:bad="urn:unsupported">Description must not vanish</bad:v></x:c>')}))
write('mixed-value-inline',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(old,b'<x:c r="C2" s="7" t="str"><x:v>Visible</x:v><x:is><x:t>Silently ignored</x:t></x:is></x:c>')}))
write('wrong-string-namespace',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:t>Synthetic official workbook row</x:t>',b'<bad:t xmlns:bad="urn:unsupported">Lost</bad:t>')}))
write('duplicate-expanded-attribute',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:worksheet ',b'<x:worksheet xmlns:a="urn:dup" xmlns:b="urn:dup" a:thing="one" b:thing="two" ')}))
write('zero-reference',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'Synthetic official workbook row',b'&#0;')}))
write('literal-cdata-order',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'Synthetic official workbook row',b'Before<![CDATA[&amp;#65;]]>After&#x1f642;')}))
write('namespace-prefix-rebind',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:t>Synthetic official workbook row</x:t>',b'<x:t xmlns:x="urn:fake">Lost</x:t>')}))
write('deep-nesting',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'Synthetic official workbook row',b'<x:r>'*80+b'No'+b'</x:r>'*80)}))
write('external-uri-encoded',lambda f:f.update({'xl/_rels/workbook.xml.rels':f['xl/_rels/workbook.xml.rels'].replace(b'Target="worksheets/sheet1.xml"',b'Target="https&#58;//invalid.example.test/sheet.xml"')}))
print(json.dumps({'generated':10,'crc':'all members pass'}))
