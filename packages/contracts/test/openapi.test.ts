import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { OPENAPI_ROUTES } from '../src/openapi/index.ts';
import { OPENAPI_SCHEMAS } from '../src/openapi/schemas.ts';
import { generateOpenApiDocument } from '../../../scripts/generate-openapi.ts';
import { FIXTURE_BOARD_SNAPSHOT, FIXTURE_BOARDS, FIXTURE_CARDS, FIXTURE_CARD_SUMMARIES,
  FIXTURE_COLUMNS, FIXTURE_COMMENTS, FIXTURE_IMAGES, FIXTURE_IMPORT_STATUS, FIXTURE_MEMBERSHIPS,
  FIXTURE_PROJECTS, FIXTURE_UPLOADS, FIXTURE_WORKSPACES } from '../src/fixtures/index.ts';

const generated = generateOpenApiDocument();
const validate = (name: string, value: unknown) => z.fromJSONSchema(generated.components.schemas[name]!).safeParse(value);

test('generated OpenAPI artifact is deterministic and matches current schema/operation bindings', async () => {
  const artifact = await fs.readFile(new URL('../../../docs/openapi.json', import.meta.url), 'utf8');
  assert.equal(artifact, JSON.stringify(generated, null, 2) + '\n');
  assert.ok(generated.components.schemas['CreateCardInput']!.properties);
  for (const route of OPENAPI_ROUTES) {
    for (const name of [route.requestSchema, route.querySchema, ...Object.values(route.responses).map((r) => r.schema)].filter((v): v is string => Boolean(v))) {
      assert.ok(OPENAPI_SCHEMAS[name], `${route.method} ${route.path} missing ${name}`);
    }
  }
});

test('request fixtures are checked by shared Zod and the emitted structural JSON Schema', () => {
  const fixtures: Array<[string,unknown]> = [
    ['CreateOwnProjectInput',{name:'Synthetic own project',description:'Description'}],
    ['CreateCardInput',{title:'Task',columnId:'col_a',expectedBoardVersion:1,description:'Retained import description'}],
    ['PostCommentInput',{body:'Hello',mentions:[]}],
    ['CreateTokenInput',{name:'Synthetic token',scopes:['boards:read'],projectId:'project_a',expiresInDays:30}],
    ['SaveNameInput',{firstName:'Synthetic',lastName:'Person'}],
    ['InvitationListQuery',{limit:50,status:'pending'}],
    ['CommitImportInput',{previewDigest:'digest',defaultColumnId:'col_a',expectedVersion:1}],
  ];
  for(const [name,value] of fixtures) {
    assert.equal(OPENAPI_SCHEMAS[name]!.schema.safeParse(value).success,true,name);
    assert.equal(validate(name,value).success,true,name);
  }
  for(const [name,bad] of [
    ['CreateOwnProjectInput',{name:'Project',workspaceId:'foreign'}],
    ['CreateCardInput',{title:5,columnId:'col_a',expectedBoardVersion:1}],
    ['CreateTokenInput',{name:'Token',scopes:['admin:all']}],
    ['InvitationListQuery',{limit:101}],
  ] as Array<[string,unknown]>) {
    assert.equal(OPENAPI_SCHEMAS[name]!.schema.safeParse(bad).success,false,name);
    assert.equal(validate(name,bad).success,false,name);
  }
  // Semantic refinement remains a Zod check, and generation states that limitation explicitly.
  assert.equal(OPENAPI_SCHEMAS.SaveNameInput!.schema.safeParse({firstName:'Bad\u202e',lastName:'Name'}).success,false);
  assert.match(String(generated.components.schemas.SaveNameInput!['x-validation-limit']),/refinements/);
});

test('response fixtures reject missing/wrong fields in emitted JSON Schema; source wire projections remain distinct', () => {
  const fixtures: Array<[string,unknown]> = [
    ['WorkspaceListResponse',{data:Object.values(FIXTURE_WORKSPACES),nextCursor:null}],
    ['ProjectListResponse',{data:Object.values(FIXTURE_PROJECTS),nextCursor:null}],
    ['BoardListResponse',{data:Object.values(FIXTURE_BOARDS),nextCursor:null}],
    ['BoardSnapshotResponse',{data:FIXTURE_BOARD_SNAPSHOT}],
    ['CardResponse',{data:Object.values(FIXTURE_CARDS)[0]}],
    ['CardListResponse',{data:FIXTURE_CARD_SUMMARIES,nextCursor:null}],
    ['ColumnResponse',{data:FIXTURE_COLUMNS[0]}],
    ['CommentListResponse',{data:FIXTURE_COMMENTS,nextCursor:null}],
    ['ImageGalleryResponse',{data:{items:FIXTURE_IMAGES,nextCursor:null,totalCount:FIXTURE_IMAGES.length}}],
    ['ImageUploadResponse',{data:FIXTURE_UPLOADS[0]}],
    ['ImportStatusResponse',{data:FIXTURE_IMPORT_STATUS}],
    ['PatBoardListResponse',{data:[{id:'board_a',name:'Board A',structureVersion:1}]}],
    ['MinimalReplayResponse',{data:{id:'card_a',version:2},replayed:true}],
  ];
  for(const [name,value] of fixtures) {
    assert.equal(validate(name,value).success,true,name);
    assert.equal(validate(name,{data:123}).success,false,`${name}: wrong wire type`);
  }
  assert.equal(validate('PatBoardListResponse',{data:[{id:'b',name:'B',structureVersion:1,description:'private'}]}).success,false);
  assert.equal(validate('MinimalReplayResponse',{data:{id:'c',description:'deleted body'},replayed:true}).success,false);
  const board=Object.values(FIXTURE_BOARDS)[0]!;
  const {workspaceId:_workspaceId,description:_description,...lifecycle}=board;
  assert.equal(validate('BoardLifecycleResponse',{data:lifecycle}).success,true);
  assert.equal(validate('BoardResponse',{data:lifecycle}).success,false,'full Board schema must not pretend lifecycle projection is full');
  assert.equal(validate('ImageGalleryResponse',{data:FIXTURE_IMAGES,nextCursor:null}).success,false);
});

test('fixtures preserve distinct sibling project membership instead of one global people grant', () => {
  const first=FIXTURE_PROJECTS.website.id,second=FIXTURE_PROJECTS.operations.id;
  const firstMembers=new Set(FIXTURE_MEMBERSHIPS.filter((m)=>m.projectId===first&&m.status==='active').map((m)=>m.userId));
  const secondMembers=new Set(FIXTURE_MEMBERSHIPS.filter((m)=>m.projectId===second&&m.status==='active').map((m)=>m.userId));
  assert.ok(firstMembers.size>0&&secondMembers.size>0);
  assert.ok([...firstMembers].some((id)=>!secondMembers.has(id)));
  assert.ok([...secondMembers].some((id)=>!firstMembers.has(id)));
});

test('retired paths, session/PAT variants, empty logout and binary reports are explicit in generated operations',()=>{
  const paths=generated.paths;
  assert.ok(paths['/api/v1/workspaces/{workspaceId}/transfer-ownership']!.post);
  assert.equal(paths['/api/v1/workspaces/{workspaceId}/transfer-owner'],undefined);
  const logout=paths['/api/v1/session/logout']!.post as any;
  assert.equal(logout.responses['204'].content,undefined);
  const snapshot=paths['/api/v1/boards/{boardId}']!.get as any;
  assert.deepEqual(snapshot.security,[{sessionCookie:[]}]);
  const boardList=paths['/api/v1/projects/{projectId}/boards']!.get as any;
  assert.deepEqual(boardList['x-auth-response-variants'],{session:'BoardListResponse',personalAccessToken:'PatBoardListResponse'});
  assert.ok((paths['/api/v1/imports/{importId}/report']!.get as any).responses['200'].content['text/csv']);
  assert.equal((paths['/api/v1/projects/{projectId}/members']!.get as any)['x-minimum-project-role'],'manager');
});


test('board archive query uses explicit literal false input rather than truthy string coercion',()=>{
  const schema=OPENAPI_SCHEMAS.ProjectBoardsListQuery!.schema;
  assert.deepEqual(schema.parse({includeArchived:'false'}),{includeArchived:false});
  assert.deepEqual(schema.parse({includeArchived:'true'}),{includeArchived:true});
  assert.equal(schema.safeParse({includeArchived:'yes'}).success,false);
  assert.equal(validate('ProjectBoardsListQuery',{includeArchived:'false'}).success,true);
  assert.equal(validate('ProjectBoardsListQuery',{includeArchived:'yes'}).success,false);
  const route=generated.paths['/api/v1/projects/{projectId}/boards']!.get as any;
  assert.ok(route.parameters.some((p:any)=>p.name==='includeArchived'&&p.in==='query'));
  assert.match(route.description,/session-only Owner\/Project Manager/);
});
