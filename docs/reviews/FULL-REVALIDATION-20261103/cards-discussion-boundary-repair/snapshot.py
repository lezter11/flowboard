import pathlib,hashlib,json,subprocess,datetime
root=pathlib.Path(__file__).resolve().parents[4];base=pathlib.Path(__file__).resolve().parent
owned=['apps/api/src/adapters/cards.ts','apps/api/src/adapters/comments.ts','apps/api/src/http/routes/cards.ts','apps/api/src/http/routes/comments.ts','apps/api/src/http/routes/boards.ts','apps/api/src/services/assignee-locks.ts','apps/api/src/services/comment-retention.ts','packages/contracts/src/cards.ts','packages/contracts/src/discussion.ts','apps/api/test/card-assignee-concurrency.test.ts','apps/api/test/cards-discussion-boundary.test.ts','apps/api/test/comment-edit-retention.test.ts']
tests=['crd01-crd11','qry01-qry03','b9-mention-access','comment-move-replay','board-access-activity-notifications','lifecycle-retention-repair','outbox-recovery','b14-outbox-privacy','board-notification-scope-draft']
extra=owned+['apps/api/test/'+x+'.test.ts' for x in tests]+['apps/api/package.json','apps/api/tsconfig.build.json','apps/api/wrangler.jsonc','tsconfig.json','package-lock.json','package.json','docs/API.md',str(base.relative_to(root)/'criteria.md')]
files=set(root/x for x in extra)
for directory in ['apps/api/src','packages/contracts/src','database/migrations','apps/api/test/support']:
 files.update(p for p in (root/directory).rglob('*') if p.is_file())
hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
records=[]
for cmd in [['git','rev-parse','HEAD'],['node','--version'],['npm','--version'],['docker','inspect','--format','{{.Config.Image}} {{.Image}}','flowboard-full-revalidation-20261103']]:
 p=subprocess.run(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);records.append({'command':cmd,'exitCode':p.returncode,'output':p.stdout.strip()})
manifest={'kind':'bounded_builder_snapshot_not_independent_approval','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'revision':records[0]['output'],'ownedFiles':owned,'files':hashes,'fileCount':len(hashes),'sourceDigestSHA256':hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'toolCommands':records,'databasePort':55931,'sourceScopeNote':'Includes current reachable API/contracts/migrations/support and nearest tested suites. Root may add OpenAPI/activity changes; any changed hash requires a fresh immutable review snapshot.'}
(base/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:manifest[k] for k in ['fileCount','sourceDigestSHA256','toolCommands']}))
