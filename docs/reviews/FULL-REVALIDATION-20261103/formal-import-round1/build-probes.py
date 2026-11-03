import zipfile,pathlib,json
out=pathlib.Path(__file__).parent
with zipfile.ZipFile('apps/api/test/fixtures/import-blank-assignee.xlsx') as z:
 base={n:z.read(n) for n in z.namelist()}
base['xl/worksheets/sheet1.xml']=base['xl/worksheets/sheet1.xml'].replace(b'Prototype Review',b'Current column')
def write(name,edit):
 files=dict(base);edit(files)
 with zipfile.ZipFile(out/(name+'.xlsx'),'w',zipfile.ZIP_DEFLATED) as z:
  for n,data in files.items():z.writestr(n,data)
 with zipfile.ZipFile(out/(name+'.xlsx')) as z: assert z.testzip() is None
write('control',lambda f:None)
write('embedded-image',lambda f:f.update({'xl/media/image1.png':bytes.fromhex('89504e470d0a1a0a')}))
write('external-relationship',lambda f:f.update({'xl/worksheets/_rels/sheet1.xml.rels':b'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://invalid.example.test/synthetic.xlsx" TargetMode="External"/></Relationships>'}))
write('macro-content-type',lambda f:f.update({'[Content_Types].xml':f['[Content_Types].xml'].replace(b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',b'application/vnd.ms-excel.sheet.macroEnabled.main+xml')}))
write('double-entity',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'=Browser imported literal title',b'Literal &amp;#x41; and &amp;#65;')}))
write('rich-inline-text',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:t>=Browser imported literal title</x:t>',b'<x:r><x:t>First </x:t></x:r><x:r><x:t>Second</x:t></x:r>')}))
write('invalid-numeric-entity',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'=Browser imported literal title',b'Invalid &#x110000; entity')}))
write('formula',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:t>=Browser imported literal title</x:t>',b'<x:t>Ignored</x:t></x:is><x:f>1+1</x:f><x:is>')}))
write('xxe',lambda f:f.update({'xl/worksheets/sheet1.xml':b'<!DOCTYPE x [<!ENTITY test SYSTEM "file:///not-read">]>'+f['xl/worksheets/sheet1.xml']}))
print(json.dumps({'generated':len(list(out.glob('*.xlsx'))),'crc':'all ZIP members validate','base':'apps/api/test/fixtures/import-blank-assignee.xlsx'}))
