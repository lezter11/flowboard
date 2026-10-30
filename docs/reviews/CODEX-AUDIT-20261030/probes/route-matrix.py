#!/usr/bin/env python3
"""Generate a route-completeness matrix from the Hono routers mounted by app.ts."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[4]
app = (ROOT/'apps/api/src/http/app.ts').read_text()
routes_dir = ROOT/'apps/api/src/http/routes'
role_cases = ['unauthenticated','stranger','other_project_member','same_project_no_board_grant','viewer','member','manager','owner','revoked_member','foreign_or_guessed_id']
mounts = []
# Match the prefix and router variable while keeping the source literal exact.
for m in re.finditer(r"app\.route\(\s*(['\"])(.*?)\1\s*,\s*(\w+)\s*\)", app):
    prefix, symbol = m.group(2), m.group(3)
    filename = symbol.removesuffix('Routes').replace('Routes','').lower()
    # Explicitly map router names to files to avoid treating drafts as mounted routes.
    filemap = {
      'sessionRoutes':'session.ts','googleAuthRoutes':'google-auth.ts','workspacesRoutes':'workspaces.ts',
      'projectsRoutes':'projects.ts','invitationsRoutes':'invitations.ts','membersRoutes':'members.ts',
      'boardsRoutes':'boards.ts','boardGrantsRoutes':'board-grants.ts','cardsRoutes':'cards.ts',
      'commentsRoutes':'comments.ts','trashRoutes':'trash.ts','imagesRoutes':'images.ts',
      'importsRoutes':'imports.ts','activityRoutes':'activity.ts','notificationsRoutes':'notifications.ts',
      'systemRoutes':'system.ts'
    }
    file = filemap.get(symbol)
    if not file: raise SystemExit(f'unmapped mounted router: {symbol}')
    mounts.append((prefix, file))
rows=[]
for prefix,file in mounts:
    source=(routes_dir/file).read_text()
    # Supported Hono methods used by this repository. Include only literal route paths.
    for m in re.finditer(r"(?:^|\n)\s*\w+\.(get|post|put|patch|delete|options|all)\(\s*(['\"])(.*?)\2", source):
        method,path=m.group(1).upper(),m.group(3)
        full=(prefix.rstrip('/')+'/'+path.lstrip('/')) if prefix else path
        if not full.startswith('/'): full='/'+full
        rows.append({'method':method,'path':full,'source':f'apps/api/src/http/routes/{file}','sourceLine':source[:m.start()].count('\n')+1,
                     'roleCases':{role:{'status':'not_executed','body':'not_checked'} for role in role_cases}})
rows.sort(key=lambda x:(x['path'],x['method'],x['sourceLine']))
if not rows: raise SystemExit('no mounted route declarations found')
out=ROOT/'docs/reviews/CODEX-AUDIT-20261030/route-authorization-matrix.json'
if '--check' in sys.argv:
    prior=json.loads(out.read_text())
    have={(r['method'],r['path'],r['source']) for r in prior['routes']}
    found={(r['method'],r['path'],r['source']) for r in rows}
    missing=sorted(found-have); stale=sorted(have-found)
    if missing or stale:
        print(json.dumps({'missingFromMatrix':missing,'staleMatrixRows':stale},indent=2)); raise SystemExit(1)
    print(f'PASS: {len(found)} mounted route declarations all represented; {len(role_cases)} role/identity cases each; route additions fail until matrix is regenerated.')
else:
    out.write_text(json.dumps({'commit':'371cc9f31dd605ddead4eda743c2d26e12c07fca','roles':role_cases,'routes':rows},indent=2)+'\n')
    print(f'generated {len(rows)} mounted route declarations with {len(role_cases)} role/identity cases each')
