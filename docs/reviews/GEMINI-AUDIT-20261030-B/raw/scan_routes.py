import os, re

route_dir = "apps/api/src/http/routes"

routes = []
# Match pattern like app.get('/...', ...), router.post('/...', ...)
method_pat = re.compile(r'(app|router|sub)\.(get|post|put|patch|delete)\(\s*[\x27"`]([^\x27"`]+)[\x27"`]', re.IGNORECASE)
status_pat = re.compile(r'c\.(json|text|body)\([^,)]*,\s*(\d{3})\)')
header_status_pat = re.compile(r'c\.status\((\d{3})\)')

for fname in sorted(os.listdir(route_dir)):
    if not fname.endswith(".ts") or fname.endswith(".test.ts"):
        continue
    fpath = os.path.join(route_dir, fname)
    with open(fpath) as f:
        content = f.read()
    
    # Find all routes
    for m in method_pat.finditer(content):
        obj, method, path = m.group(1), m.group(2).upper(), m.group(3)
        line_no = content[:m.start()].count("\n") + 1
        
        # Look forward a few lines to find status codes
        sub_content = content[m.start():m.start() + 2500]
        statuses = set(status_pat.findall(sub_content))
        statuses_num = set([int(s[1]) for s in statuses] + [int(s) for s in header_status_pat.findall(sub_content)])
        
        routes.append({
            "file": fname,
            "line": line_no,
            "method": method,
            "path": path,
            "statuses": sorted(list(statuses_num))
        })

print(f"Total routes detected: {len(routes)}")
with open("docs/reviews/GEMINI-AUDIT-20261030-B/raw/detected-routes.txt", "w") as out:
    for r in routes:
        line = f"{r['method']} {r['path']} ({r['file']}:{r['line']}) -> statuses: {r['statuses']}\n"
        out.write(line)
        print(line, end="")
