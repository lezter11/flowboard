import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { PERSONAL_ACCESS_TOKEN_ROUTES } from '../src/http/middleware/token-policy.ts';
import { OPENAPI_ROUTES } from '@flowboard/contracts/openapi';

const normalized = (path: string) => path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}');
const fullPath = (route: (typeof OPENAPI_ROUTES)[number]) =>
  `${'basePath' in route ? route.basePath : '/api/v1'}${route.path}`;

test('OpenAPI parity: every explicit mounted method/path and alias exists exactly once, with no phantom operation', () => {
  const mounted = [...new Set(createApp().routes.filter((r) => r.method !== 'ALL')
    .map((r) => `${r.method} ${normalized(r.path)}`))].sort();
  const documented = OPENAPI_ROUTES.map((r) => `${r.method} ${fullPath(r)}`).sort();
  assert.equal(new Set(documented).size, documented.length, 'duplicate operation definition');
  assert.deepEqual(documented, mounted);
});

test('OpenAPI parity: exactly the six mounted PAT capabilities advertise bearer authority', () => {
  const actual = PERSONAL_ACCESS_TOKEN_ROUTES.map((r) => `${r.method} ${normalized(r.path)} ${r.scope}`).sort();
  const documented = OPENAPI_ROUTES.filter((r) => 'patScope' in r)
    .map((r) => `${r.method} ${fullPath(r)} ${'patScope' in r ? r.patScope : ''}`).sort();
  assert.deepEqual(documented, actual);
});

// The shared app registrations are used by both runtime entry points. Environment changes affect
// local-login availability, not permission to invent/delete operations in the contract inventory.
test('OpenAPI parity: production and synthetic app registrations retain the same documented inventory', () => {
  const previous = process.env['NODE_ENV'];
  try {
    const inventories = ['production','test'].map((environment) => {
      process.env['NODE_ENV'] = environment;
      return [...new Set(createApp().routes.filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method} ${normalized(r.path)}`))].sort();
    });
    assert.deepEqual(inventories[0], inventories[1]);
  } finally {
    if(previous === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV']=previous;
  }
});

test('OpenAPI wire projections validate actual mounted session, PAT, replay, lifecycle and MIME responses', {
  skip: !process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'] && 'Set isolated identity-extra database for mounted OpenAPI wire verification.',
}, async (t) => {
  const [{default:pg},crypto,{z},{runMigrations},{createDevUserAndSession},{MemoryStorageDriver},{generateOpenApiDocument}] = await Promise.all([
    import('pg'),import('node:crypto'),import('zod'),import('../src/adapters/migrations.ts'),
    import('../src/adapters/session.ts'),import('../src/adapters/storage.ts'),import('../../../scripts/generate-openapi.ts'),
  ]);
  const uri=process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL']!;
  const target=new URL(uri);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));
  assert.equal(target.pathname,'/flowboard_identity_extra_test');
  const schema=`openapi_wire_${crypto.randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:uri,max:1});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:uri,max:4,options:`-c search_path=${schema}`});
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
  await runMigrations(pool);
  const owner=await createDevUserAndSession('openapi.owner@flowboard.example','Synthetic Owner',pool);
  const viewer=await createDevUserAndSession('openapi.viewer@flowboard.example','Synthetic Viewer',pool);
  const app=createApp(async()=>{}, {pool,storage:new MemoryStorageDriver(),
    rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const generated=generateOpenApiDocument();
  const validate=(name:string,body:unknown)=>{
    const result=z.fromJSONSchema(generated.components.schemas[name]!).safeParse(body);
    assert.equal(result.success,true,`${name}: ${result.success?'':JSON.stringify(result.error.issues)}`);
  };
  const headers=(key:string=crypto.randomUUID())=>({Cookie:`flowboard_session=${owner.session.id}`,Origin:'http://localhost',
    'Content-Type':'application/json','Idempotency-Key':key});
  const req=(path:string,method='GET',body?:unknown,key?:string)=>app.request(`http://localhost${path}`,{method,headers:headers(key),...(body===undefined?{}:{body:JSON.stringify(body)})});
  const live=await app.request('/health/live');validate('Health',await live.json());
  const session=await req('/api/v1/session');validate('GetSessionResponse',await session.json());
  const createProject=await req('/api/v1/projects','POST',{name:'OpenAPI project',description:'Project description'});
  assert.equal(createProject.status,201);const projectBody=await createProject.json() as any;
  validate('ProjectResponseWithReplayFlag',projectBody);const projectId=projectBody.data.id as string;
  const createBoard=await req(`/api/v1/projects/${projectId}/boards`,'POST',{name:'Board',description:'PRIVATE BOARD DESCRIPTION'});
  assert.equal(createBoard.status,201);const boardBody=await createBoard.json() as any;
  validate('BoardResponseWithReplayFlag',boardBody);const boardId=boardBody.data.id as string;
  const boards=await req(`/api/v1/projects/${projectId}/boards`);validate('BoardListResponse',await boards.json());
  const snapshot=await req(`/api/v1/boards/${boardId}`);const snapshotBody=await snapshot.json() as any;
  validate('BoardSnapshotResponse',snapshotBody);const columnId=snapshotBody.data.columns[0].id as string;
  const cardInput={title:'Task',columnId,description:'Card detail body',priority:'medium',assigneeIds:[owner.user.id],expectedBoardVersion:snapshotBody.data.board.structureVersion};
  const cardKey=crypto.randomUUID();const created=await req(`/api/v1/boards/${boardId}/cards`,'POST',cardInput,cardKey);
  assert.equal(created.status,201);const cardBody=await created.json() as any;validate('CardResponseWithReplayFlag',cardBody);
  const replay=await req(`/api/v1/boards/${boardId}/cards`,'POST',cardInput,cardKey);
  assert.equal(replay.status,201);validate('MinimalReplayResponse',await replay.json());
  const detail=await req(`/api/v1/cards/${cardBody.data.id}`);validate('CardDetailResponse',await detail.json());
  const gallery=await req(`/api/v1/cards/${cardBody.data.id}/images`);validate('ImageGalleryResponse',await gallery.json());
  const tasks=await req(`/api/v1/me/tasks?projectId=${projectId}`);validate('MyTasksResponse',await tasks.json());
  const readAll=await req('/api/v1/notifications/mark-all-read','POST');validate('MarkAllReadResponse',await readAll.json());
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES('pm_openapi_viewer',$1,$2,$3,'viewer','active',NOW(),NOW())`,[projectId,projectBody.data.workspaceId,viewer.user.id]);
  const directory=await app.request(`/api/v1/projects/${projectId}/members`,{headers:{Cookie:`flowboard_session=${viewer.session.id}`}});
  assert.equal(directory.status,403,'User-confirmed full People directory excludes Viewer');
  const deniedDirectory=await directory.json() as any;validate('ErrorEnvelope',deniedDirectory);
  assert.equal(deniedDirectory.data,undefined);
  const directoryBody=await (await req(`/api/v1/projects/${projectId}/members`)).json() as any;
  validate('ProjectDirectoryResponse',directoryBody);
  assert.ok(directoryBody.data.some((person:any)=>person.email==='openapi.owner@flowboard.example'));
  const minted=await req('/api/v1/tokens','POST',{name:'Metadata token',scopes:['boards:read'],projectId});
  assert.equal(minted.status,201);const tokenBody=await minted.json() as any;validate('CreatedTokenResponse',tokenBody);
  const bearer={Authorization:`Bearer ${tokenBody.data.token}`};
  const narrow=await app.request(`/api/v1/projects/${projectId}/boards`,{headers:bearer});
  assert.equal(narrow.status,200);const narrowBody=await narrow.json();validate('PatBoardListResponse',narrowBody);
  assert.equal(JSON.stringify(narrowBody).includes('PRIVATE BOARD DESCRIPTION'),false);
  const metadata=await app.request(`/api/v1/boards/${boardId}/metadata`,{headers:bearer});validate('BoardMetadataResponse',await metadata.json());
  const forbidden=await app.request(`/api/v1/boards/${boardId}`,{headers:bearer});assert.equal(forbidden.status,403);validate('ErrorEnvelope',await forbidden.json());
  const boardSnapshot=await req(`/api/v1/boards/${boardId}`);const beforeArchive=await boardSnapshot.json() as any;
  const archive=await req(`/api/v1/boards/${boardId}/archive`,'POST',{expectedVersion:beforeArchive.data.board.snapshotVersion});assert.equal(archive.status,200);validate('BoardLifecycleResponseWithReplayFlag',await archive.json());
  const template=await req('/api/v1/import/template');assert.equal(template.status,200);
  assert.match(template.headers.get('Content-Type')!,/application\/vnd.openxmlformats/);assert.equal(new Uint8Array(await template.arrayBuffer())[0],0x50);
  const retired=await req('/api/v1/workspaces','POST',{});assert.equal(retired.status,410);validate('WorkspaceCreateRetiredError',await retired.json());
  const logout=await req('/api/v1/session/logout','POST');assert.equal(logout.status,204);assert.equal(await logout.text(),'');
});
