import zipfile,pathlib
out=pathlib.Path(__file__).parent
with zipfile.ZipFile(out.parent/'formal-import-round1/control.xlsx')as z:files={n:z.read(n)for n in z.namelist()}
old=b'Target="/xl/worksheets/sheet1.xml"';new=b'Target="https&#58;//invalid.example.test/sheet.xml"';assert old in files['xl/_rels/workbook.xml.rels'];files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace(old,new)
with zipfile.ZipFile(out/'external-uri-encoded-corrected.xlsx','w',zipfile.ZIP_DEFLATED)as z:
 for n,b in files.items():z.writestr(n,b)
with zipfile.ZipFile(out/'external-uri-encoded-corrected.xlsx')as z:assert z.testzip()is None;assert new in z.read('xl/_rels/workbook.xml.rels')
print('Corrected external relationship fixture: target genuinely mutated; CRC valid.')
