import json,pathlib,hashlib,subprocess
oldpath=pathlib.Path('docs/reviews/HOSTED-MCP-20261104/hosted-browser-linux-repair/independent-review/new-reviewer/0cd36f07dc66739a759272722d1da017f56588fb6f3a062805f3d62de6a95ea8-round-1.json')
r=json.loads(oldpath.read_text())
changed=[name for name,h in r['target']['files'].items() if not pathlib.Path(name).is_file() or hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()!=h]
expected=['apps/api/wrangler.jsonc','apps/web/src/components/integrations/connections-panel.tsx','apps/web/src/styles/connections.css']
assert sorted(changed)==sorted(expected),(changed,expected)
config=json.loads('\n'.join(line for line in pathlib.Path('apps/api/wrangler.jsonc').read_text().splitlines() if not line.lstrip().startswith('//')))
assert config['images']==config['env']['uat']['images']=={'binding':'IMAGE_VERIFIER'}
assert config['vars']['APP_ORIGIN']=='https://flowboard-app.pages.dev'
assert config['vars']['CORS_ORIGIN']==config['vars']['FRONTEND_URL']==config['vars']['APP_ORIGIN']
assert config['env']['uat']['vars']['APP_ORIGIN']=='https://flowboard-app-uat.pages.dev'
assert config['r2_buckets'][0]['bucket_name']=='flowboard-images-prod'
assert config['env']['uat']['r2_buckets'][0]['bucket_name']=='flowboard-images-uat'
assert config['hyperdrive'][0]['id']!=config['env']['uat']['hyperdrive'][0]['id']
assert not any(('TEST' in k or 'DEV' in k) for k in config['vars'])
assert 'staging-expire' not in pathlib.Path('apps/api/wrangler.jsonc').read_text()
help=pathlib.Path('apps/web/src/components/integrations/mcp-prompt-help.tsx').read_text()
assert not any(s in help for s in ('fetch(', 'localStorage', 'sessionStorage', 'hostedMcpApi', 'dangerouslySetInnerHTML'))
print(json.dumps({'status':'pass','oldRecord':str(oldpath),'oldRecordSHA256':hashlib.sha256(oldpath.read_bytes()).hexdigest(),'oldDigest':r['target']['digest'],'oldManifestFiles':len(r['target']['files']),'unchangedFiles':len(r['target']['files'])-len(changed),'changedOnly':changed,'backendLogicSchemaMigrationToolBytesUnchanged':True,'productionVerifierMatchesUAT':True,'prodUatIsolationConfig':True,'testFlagsAbsent':True,'noAutomaticSubmissionOrStorageInPromptComponent':True,'historicalBackendTestsNotRerun':True},indent=2))
