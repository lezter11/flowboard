import os, re

# Mount table from app.ts
mounts = {
    "session.ts": "/api/v1/session",
    "google-auth.ts": "/api/v1/auth",
    "workspaces.ts": "",
    "projects.ts": "",
    "invitations.ts": "/api/v1",
    "members.ts": "/api/v1",
    "boards.ts": "",
    "board-grants.ts": "/api/v1",
    "cards.ts": "",
    "comments.ts": "/api/v1",
    "trash.ts": "/api/v1",
    "images.ts": "",
    "imports.ts": "/api/v1",
    "activity.ts": "/api/v1",
    "notifications.ts": "/api/v1",
    "system.ts": "/api/v1/system",
    "board-grants-draft.ts": "DRAFT_NOT_MOUNTED"
}

route_dir = "apps/api/src/http/routes"
method_pat = re.compile(r'\b(\w+Routes|\w+Router|app)\.(get|post|put|patch|delete)\(\s*[\x27"`]([^\x27"`]+)[\x27"`]')

all_endpoints = []

for fname, prefix in mounts.items():
    fpath = os.path.join(route_dir, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath) as f:
        content = f.read()
    
    for m in method_pat.finditer(content):
        router_var = m.group(1)
        method = m.group(2).upper()
        subpath = m.group(3)
        line_no = content[:m.start()].count("\n") + 1
        
        # Combine prefix and subpath
        if subpath == "/":
            full_path = prefix if prefix else "/"
        else:
            full_path = f"{prefix.rstrip('/')}/{subpath.lstrip('/')}"
        
        all_endpoints.append({
            "file": fname,
            "line": line_no,
            "method": method,
            "path": full_path,
            "mounted": prefix != "DRAFT_NOT_MOUNTED"
        })

print(f"Total endpoints found in route files: {len(all_endpoints)}")
with open("docs/reviews/GEMINI-AUDIT-20261030-B/raw/all-api-endpoints.txt", "w") as out:
    for ep in all_endpoints:
        line = f"{ep['method']} {ep['path']} ({ep['file']}:{ep['line']}) [mounted={ep['mounted']}]\n"
        out.write(line)
        print(line, end="")
