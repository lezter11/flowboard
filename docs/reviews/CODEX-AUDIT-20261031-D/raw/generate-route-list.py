import json,re,pathlib
root=pathlib.Path('/private/tmp/flowboard-audit-99ae250')
app=(root/'apps/api/src/http/app.ts').read_text()
mounts={name:prefix for prefix,name in re.findall(r"app\.route\('([^']*)',\s*(\w+)\)",app)}
found=[]
for f in (root/'apps/api/src/http/routes').glob('*.ts'):
 s=f.read_text(); m=re.search(r'export const (\w+) = new Hono',s)
 if not m: continue
 var=m.group(1); prefix=mounts.get(var,'')
 for meth,_quote,path in re.findall(rf"{var}\.(get|post|put|patch|delete)\(\s*(['\"])(.*?)\2",s,re.S):
  full=prefix.rstrip('/')+'/'+path.lstrip('/') if prefix else path
  if full not in ['/health/live','/health/ready']: found.append((meth.upper(),full))
old=json.loads((root/'docs/reviews/CODEX-AUDIT-20261030/route-authorization-matrix.json').read_text())
out={'generated_from':'apps/api/src/http/app.ts + apps/api/src/http/routes/*.ts','routes':[{'method':m,'path':p} for m,p in sorted(set(found))],'roles':old['roles']}
pathlib.Path('/Users/shubham/Documents/Flowboard/docs/reviews/CODEX-AUDIT-20261031-D/raw/route-list-generated.json').write_text(json.dumps(out,indent=2)+'\n')
