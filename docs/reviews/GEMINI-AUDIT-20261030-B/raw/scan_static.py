import urllib.request, ssl, os, re

base = "https://flowboard-app-uat.pages.dev"
ctx = ssl.create_default_context()

with open("docs/reviews/GEMINI-AUDIT-20261030-B/raw/static/signin.html") as f:
    html = f.read()

srcs = re.findall(r'src=["\']([^"\']+)["\']', html)
hrefs = re.findall(r'href=["\']([^"\']+)["\']', html)

assets = sorted(list(set([u for u in (srcs + hrefs) if "_next" in u or u.endswith(".js") or u.endswith(".css")])))

out_dir = "docs/reviews/GEMINI-AUDIT-20261030-B/raw/static"
os.makedirs(out_dir, exist_ok=True)
report_lines = []

map_results = []
secret_matches = []
dev_login_matches = []

for asset in assets:
    full_url = base + asset
    local_path = os.path.join(out_dir, os.path.basename(asset))
    try:
        req = urllib.request.Request(full_url, headers={"User-Agent": "FlowboardAudit/1.0"})
        content = urllib.request.urlopen(req, context=ctx).read()
        with open(local_path, "wb") as f:
            f.write(content)
        text = content.decode("utf-8", errors="replace")
        
        # Check dev-login
        if "dev-login" in text or "dev_login" in text or "devLogin" in text:
            dev_login_matches.append((asset, "Found dev-login reference"))
        
        # Check suspicious strings/secrets
        for pat in [r"xkeysib-[a-zA-Z0-9]+", r"GOCSPX-[a-zA-Z0-9]+", r"postgres://[^\s\"'\`]+", r"eyJ[a-zA-Z0-9_\-]{20,}"]:
            m = re.findall(pat, text)
            if m:
                secret_matches.append((asset, pat, len(m)))

    except Exception as e:
        report_lines.append(f"Failed to fetch {asset}: {e}")

    # Test .map file
    map_url = full_url + ".map"
    try:
        mreq = urllib.request.Request(map_url, headers={"User-Agent": "FlowboardAudit/1.0"})
        with urllib.request.urlopen(mreq, context=ctx) as mresp:
            map_results.append((asset, map_url, mresp.status, "EXISTS"))
    except urllib.error.HTTPError as he:
        map_results.append((asset, map_url, he.code, "NOT_FOUND"))
    except Exception as me:
        map_results.append((asset, map_url, "ERR", str(me)))

with open("docs/reviews/GEMINI-AUDIT-20261030-B/raw/static-scan-report.txt", "w") as out:
    out.write("=== STATIC ASSET SCAN ===\n")
    out.write(f"Total assets downloaded: {len(assets)}\n\n")
    out.write("--- SOURCE MAP CHECKS (.map) ---\n")
    for a, murl, status, note in map_results:
        out.write(f"{status} {note} : {murl}\n")
    out.write("\n--- DEV-LOGIN REFERENCES ---\n")
    if dev_login_matches:
        for a, msg in dev_login_matches:
            out.write(f"FOUND in {a}: {msg}\n")
    else:
        out.write("None found across all downloaded assets.\n")
    out.write("\n--- SECRET SEARCH ---\n")
    if secret_matches:
        for a, pat, count in secret_matches:
            out.write(f"MATCH in {a} (pat: {pat}): {count} occurrences\n")
    else:
        out.write("Zero secrets/keys found across all downloaded assets.\n")

print("Scan complete. Summary:")
print("Assets scanned:", len(assets))
print("Map files accessible:", sum(1 for _, _, s, _ in map_results if s == 200))
print("Dev login matches:", len(dev_login_matches))
print("Secret matches:", len(secret_matches))
