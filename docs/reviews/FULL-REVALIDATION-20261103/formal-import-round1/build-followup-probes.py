import zipfile,pathlib,json,base64,re
out=pathlib.Path(__file__).parent
with zipfile.ZipFile(out/'control.xlsx') as z: base={n:z.read(n) for n in z.namelist()}
def write(name,edit):
 files=dict(base);files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml'].replace(b'<x:t>0001</x:t>',('<x:t>0001-'+name+'</x:t>').encode());edit(files)
 with zipfile.ZipFile(out/(name+'.xlsx'),'w',zipfile.ZIP_DEFLATED) as z:
  for n,data in files.items():z.writestr(n,data)
 with zipfile.ZipFile(out/(name+'.xlsx')) as z: assert z.testzip() is None
write('rich-inline-unique',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'<x:t>=Browser imported literal title</x:t>',b'<x:r><x:t>First </x:t></x:r><x:r><x:t>Second</x:t></x:r>')}))
write('utf16-worksheet',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].decode().replace("encoding='utf-8'","encoding='utf-16'").encode('utf-16')}))
write('utf16-formula',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].decode().replace("encoding='utf-8'","encoding='utf-16'").replace('<x:t>=Browser imported literal title</x:t>','<x:t>Ignored</x:t></x:is><x:f>1+1</x:f><x:is>').encode('utf-16')}))
write('single-quote-attributes',lambda f:f.update({'xl/workbook.xml':re.sub(rb'="([^"]*)"',lambda m:b"='"+m[1]+b"'",f['xl/workbook.xml'])}))
write('merged-data',lambda f:f.update({'xl/worksheets/sheet1.xml':f['xl/worksheets/sheet1.xml'].replace(b'</x:sheetData>',b'</x:sheetData><x:mergeCells count="1"><x:mergeCell ref="B2:C2"/></x:mergeCells>')}))
write('actual-image-package',lambda f:f.update({'xl/media/image1.png':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),'xl/drawings/drawing1.xml':b'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>'}))
print(json.dumps({'generated':6,'crc':'all ZIP members validate'}))
