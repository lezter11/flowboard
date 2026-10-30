import json, os

def get_pkg_info(pkg_name):
    paths = [
        os.path.join("node_modules", pkg_name, "package.json"),
        os.path.join("apps", "web", "node_modules", pkg_name, "package.json"),
        os.path.join("apps", "api", "node_modules", pkg_name, "package.json")
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p) as f:
                    return json.load(f), p
            except Exception:
                pass
    return None, None

targets = [
    ("apps/api", "apps/api/package.json"),
    ("apps/web", "apps/web/package.json")
]

FLAGGED_LICENSES = ["AGPL", "GPL", "SSPL", "COMMONS", "UNKNOWN"]

results = {}

for app_name, pkg_path in targets:
    with open(pkg_path) as f:
        manifest = json.load(f)
    
    prod_deps = manifest.get("dependencies", {})
    results[app_name] = []
    
    for dep, ver in sorted(prod_deps.items()):
        info, resolved_path = get_pkg_info(dep)
        license_str = "UNKNOWN"
        scripts = {}
        if info:
            lic = info.get("license") or info.get("licenses")
            if isinstance(lic, dict):
                license_str = lic.get("type", str(lic))
            elif isinstance(lic, list):
                license_str = " / ".join([l.get("type", str(l)) if isinstance(l, dict) else str(l) for l in lic])
            elif lic:
                license_str = str(lic)
            scripts = info.get("scripts", {})
        
        postinstall = scripts.get("postinstall") or scripts.get("install")
        
        is_flagged = any(bad in license_str.upper() for bad in FLAGGED_LICENSES) or license_str == "UNKNOWN"
        
        results[app_name].append({
            "name": dep,
            "version_spec": ver,
            "resolved_version": info.get("version") if info else None,
            "license": license_str,
            "flagged_license": is_flagged,
            "postinstall": postinstall,
            "resolved_path": resolved_path
        })

output_file = "docs/reviews/GEMINI-AUDIT-20261030-B/raw/licenses-and-scripts.json"
with open(output_file, "w") as out:
    json.dump(results, out, indent=2)

print(f"License scan saved to {output_file}")
for app_name, deps in results.items():
    print(f"\n=== {app_name} ({len(deps)} production dependencies) ===")
    flagged = [d for d in deps if d["flagged_license"]]
    scripts = [d for d in deps if d["postinstall"]]
    for d in deps:
        flag_mark = " [FLAGGED]" if d["flagged_license"] else ""
        script_mark = f" [POSTINSTALL: {d['postinstall']}]" if d["postinstall"] else ""
        print(f"  {d['name']}@{d['resolved_version'] or d['version_spec']} -> {d['license']}{flag_mark}{script_mark}")
    print(f"Summary for {app_name}: {len(flagged)} flagged licenses, {len(scripts)} postinstall scripts.")
