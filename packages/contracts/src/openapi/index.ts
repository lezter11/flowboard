/** Lightweight operation metadata. Schema generation is build-time in scripts/generate-openapi.ts. */
export interface OpenApiResponseDefinition { schema?: string; contentType?: string; description: string; }
export interface OpenApiRouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  basePath?: string;
  summary: string;
  description: string;
  minimumRole: 'owner' | 'manager' | 'member' | 'viewer' | 'authenticated';
  requiresIdempotencyKey?: boolean;
}
/** Rich build-time operation bindings extend the original consumer metadata interface. */
export interface OpenApiOperationDefinition extends OpenApiRouteDefinition {
  auth: 'public' | 'optional-session' | 'session' | 'session-or-token' | 'admin-secret' | 'local-test';
  patScope?: 'projects:read' | 'boards:read' | 'cards:read' | 'cards:create';
  requestSchema?: string;
  querySchema?: string;
  requestKind?: 'json' | 'image' | 'xlsx';
  requestOptional?: boolean;
  replay?: boolean;
  source: string;
  responses: Record<string, OpenApiResponseDefinition>;
  variants?: Record<string, string>;
  lifecycle?: 'retired' | 'local-only' | 'active';
}
export const OPENAPI_SPEC_METADATA = {
  openapi: '3.1.0',
  info: { title: 'Flowboard API', version: '0.3.0',
    description: 'Current mounted Node/Worker HTTP operations. Project membership plus board grants protect board-derived data; six bearer capabilities are an explicit subset of session authority.' },
  servers: [{ url: '/', description: 'Current origin; paths include /api/v1 or root health namespace.' }],
} as const;

type Options = Partial<Omit<OpenApiOperationDefinition, 'method'|'path'|'minimumRole'|'summary'|'responses'|'source'>> & {
  status?: number; contentType?: string; source?: string; responses?: Record<string, OpenApiResponseDefinition>;
};
function operation(method: OpenApiRouteDefinition['method'], path: string, minimumRole: OpenApiRouteDefinition['minimumRole'], summary: string,
  responseSchema: string | undefined, options: Options = {}): OpenApiOperationDefinition {
  const { status = 200, contentType, source = 'apps/api/src/http/routes/', responses, ...rest } = options;
  return { method, path, minimumRole, summary, auth: 'session', description: summary, source,
    responses: responses ?? { [status]: { ...(responseSchema ? { schema: responseSchema } : {}), ...(contentType ? { contentType } : {}), description: summary } }, ...rest };
}
const source = (name: string) => `apps/api/src/http/routes/${name}.ts`;
const rows: OpenApiOperationDefinition[] = [];
const add = (...args: Parameters<typeof operation>) => rows.push(operation(...args));
const mutation = (requestSchema?: string, extra: Options = {}): Options => ({ requiresIdempotencyKey: true, replay: true,
  ...(requestSchema ? { requestSchema } : {}), ...extra });

for (const path of ['/health/live','/api/v1/activity/health','/api/v1/notifications/health']) {
  add('GET', path.startsWith('/api/v1') ? path.slice(7) : path, 'authenticated', 'Liveness without private data', 'Health',
    { auth: 'public', basePath: path.startsWith('/api/v1') ? '/api/v1' : '', source: path === '/health/live' ? 'apps/api/src/http/app.ts' : source(path.includes('activity') ? 'activity' : 'notifications') });
}
add('GET','/health/ready','authenticated','Database readiness probe','Ready',{auth:'public',basePath:'',source:'apps/api/src/http/app.ts'});
add('GET','/session','authenticated','Read signed-in actor, owned containers, authorized project summaries, limits and last location','GetSessionResponse',{source:source('session')});
add('PATCH','/session/profile','authenticated','Update own display name; avatar/email remain provider-managed','ProfileResponse',{requestSchema:'UpdateProfileInput',source:source('session')});
add('PATCH','/session/name','authenticated','Save and confirm first/last names','SaveNameResponse',{requestSchema:'SaveNameInput',source:source('session')});
add('PUT','/session/last-location','authenticated','Remember currently authorized project/board location','LastLocationWireResponse',{requestSchema:'UpdateLastLocationInput',source:source('session')});
add('POST','/session/logout','authenticated','Revoke an optional current cookie session and clear cookie; anonymous/expired sessions also receive204 with no JSON response',undefined,{auth:'optional-session',status:204,source:source('session')});
add('POST','/session/dev-login','authenticated','Synthetic/local opt-in email login; unavailable on deployed Worker','DevLoginResponse',{auth:'local-test',lifecycle:'local-only',requestSchema:'DevLoginInput',source:source('session')});
for(const path of ['/auth/google','/auth/google/start']) add('GET',path,'authenticated','Begin Google OAuth; optional safe same-app next path',undefined,{auth:'public',querySchema:'GoogleStartQuery',status:302,source:source('google-auth')});
add('GET','/auth/google/callback','authenticated','Verify provider/state and issue session; failures redirect to fixed sign-in state',undefined,{auth:'public',querySchema:'GoogleCallbackQuery',status:302,source:source('google-auth')});
add('GET','/workspaces','authenticated','List owned workspaces only','WorkspaceListResponse',{source:source('workspaces')});
add('POST','/workspaces','authenticated','Retired manual workspace creation; personal workspace is ensured internally','WorkspaceCreateRetiredError',{status:410,lifecycle:'retired',source:source('workspaces')});
add('PATCH','/workspaces/{workspaceId}','owner','Update owned workspace name/timezone using expectedVersion','WorkspaceResponse',{requestSchema:'UpdateWorkspaceInput',source:source('workspaces')});
add('POST','/workspaces/{workspaceId}/transfer-ownership','authenticated','Retired beta ownership transfer; no ownership mutation','OwnershipTransferRetiredError',{status:410,lifecycle:'retired',source:source('workspaces')});
add('GET','/projects','authenticated','List only owned or explicitly granted projects, paginated','ProjectListResponse',{querySchema:'ListQuery',auth:'session-or-token',patScope:'projects:read',source:source('projects')});
add('POST','/projects','authenticated','Create owned project in ensured personal workspace; strict body excludes workspaceId','ProjectResponse',mutation('CreateOwnProjectInput',{status:201,source:source('projects')}));
add('GET','/workspaces/{workspaceId}/projects','viewer','List accessible projects inside one workspace','ProjectListResponse',{querySchema:'ListQuery',source:source('projects')});
add('POST','/workspaces/{workspaceId}/projects','owner','Legacy explicit-owned-workspace project creation with current quotas','ProjectResponse',mutation('CreateProjectInput',{status:201,source:source('projects')}));
add('GET','/projects/{projectId}','viewer','Read currently accessible project metadata','ProjectResponse',{source:source('projects')});
add('PATCH','/projects/{projectId}','manager','Edit project settings; default landing-board change remains Owner-only','ProjectResponse',mutation('UpdateProjectInput',{source:source('projects')}));
add('GET','/projects/{projectId}/overview','viewer','Read counts and activity restricted to accessible boards and role','ProjectOverviewResponse',{source:source('projects')});
add('GET','/projects/{projectId}/people','viewer','Owner/Manager directory or authorized board-scoped assignee/mention picker','ProjectPeopleResponse',{querySchema:'ProjectPeopleQuery',source:source('projects'),description:'Default/display requires Owner/Project Manager, even with a board, query or cursor. Members/Viewers403 without directory data; outsiders/removed404. Explicit assignee/mention purposes return eligible safe identities only inside an authorized board/card context.'});
add('GET','/projects/{projectId}/members','manager','Owner/Project Manager full People directory including authorized project emails','ProjectDirectoryResponse',{source:source('projects'),description:'User-confirmed Owner/Project Manager only. Member/Viewer403 with no directory data; outsider/removed404. Archived project reads remain allowed for current administrators. Board-scoped public identity pickers are separate.'});
add('GET','/projects/{projectId}/access-summary','viewer','Disclose project membership and separate explicit board access with only visible board counts','ProjectAccessSummaryResponse',{source:source('projects')});
add('PATCH','/projects/{projectId}/members/{userId}','manager','Change roles/status with target protection, optimistic version, quotas and archived-context policy','ProjectMemberResponse',mutation('UpdateProjectMemberInput',{source:source('members')}));
add('DELETE','/projects/{projectId}/members/{userId}','manager','Remove permitted project grant; pure authorized removal remains possible while archived','SuccessResponse',mutation(undefined,{source:source('members')}));
for(const action of ['archive','reopen']) add('POST',`/projects/{projectId}/${action}`,'owner',`${action} project; read-only archive does not pause card trash deadlines`,'ProjectResponse',mutation('ProjectLifecycleInput',{source:source('projects')}));
add('POST','/projects/{projectId}/leave','viewer','Leave own grant, including archived project; Owner cannot leave','SuccessResponse',mutation(undefined,{source:source('invitations')}));
add('POST','/projects/{projectId}/invitations','manager','Invite exact project only; Owner may invite Manager, Manager only Member/Viewer; no implicit boards','InvitationResponse',mutation('CreateInvitationInput',{status:201,source:source('invitations')}));
add('GET','/projects/{projectId}/invitations','manager','Bounded signed-cursor history and safe delivery status/retry eligibility','InvitationListResponse',{querySchema:'InvitationListQuery',source:source('invitations')});
add('POST','/invitations/accept','authenticated','Accept matching verified-email token and project grant; no implicit board access','AcceptInvitationResponse',mutation('AcceptInvitationInput',{source:source('invitations')}));
add('POST','/projects/{projectId}/invitations/{invitationId}/resend','manager','Rotate an unexpired pending token under role/seat/rate checks','InvitationResponse',mutation(undefined,{source:source('invitations')}));
add('POST','/projects/{projectId}/invitations/{invitationId}/revoke','manager','Revoke permitted pending invitation','RevokeInvitationResponse',mutation(undefined,{source:source('invitations')}));
add('GET','/projects/{projectId}/boards','viewer','List accessible boards; bearer variant is metadata-only','BoardListResponse',{querySchema:'ProjectBoardsListQuery',auth:'session-or-token',patScope:'boards:read',variants:{session:'BoardListResponse',personalAccessToken:'PatBoardListResponse'},source:source('boards'),description:'Default or includeArchived=false lists active readable boards. includeArchived=true is session-only Owner/Project Manager administration with current project/board grants; Member/Viewer403, PAT403 TOKEN_OPERATION_FORBIDDEN, foreign404. Literal query text true/false only; current response envelopes remain unchanged.'});
add('POST','/projects/{projectId}/boards','manager','Create board/default columns; Manager creator receives this new board grant only','BoardResponse',mutation('CreateBoardInput',{status:201,source:source('boards')}));
add('GET','/boards/{boardId}/metadata','viewer','Read narrow board/column metadata; no descriptions, cards or counts','BoardMetadataResponse',{auth:'session-or-token',patScope:'boards:read',source:source('boards')});
add('GET','/boards/{boardId}','viewer','Read full bounded board snapshot using session only; PAT deliberately forbidden','BoardSnapshotResponse',{querySchema:'BoardSnapshotQuery',source:source('boards')});
add('PATCH','/boards/{boardId}','owner','Owner-only board name/description edit with optimistic version','BoardResponse',mutation('UpdateBoardInput',{source:source('boards')}));
for(const action of ['archive','reopen']) add('POST',`/boards/{boardId}/${action}`,'manager',`${action} board with expected snapshotVersion, without deleting cards`,'BoardLifecycleResponse',mutation('BoardLifecycleInput',{source:source('boards')}));
add('GET','/boards/{boardId}/access','owner','Read paginated grants for one board and current revision','BoardAccessResponse',{querySchema:'BoardAccessQuery',source:source('board-grants')});
for(const method of ['PUT','DELETE'] as const) add(method,'/boards/{boardId}/grants/{userId}','owner',`${method==='PUT'?'Grant':'Revoke'} board access using expectedAccessRevision; no Idempotency-Key receipt`,'BoardGrantResponse',{requestSchema:'BoardGrantInput',source:source('board-grants')});
add('POST','/boards/{boardId}/columns','manager','Add bounded unique column','ColumnResponse',mutation('CreateColumnInput',{status:201,source:source('boards')}));
add('PATCH','/boards/{boardId}/columns/{columnId}','manager','Edit column with expected board version','ColumnResponse',mutation('UpdateColumnInput',{source:source('boards')}));
add('POST','/boards/{boardId}/columns/reorder','manager','Persist complete column order','BoardRevisionResponse',mutation('ReorderColumnsInput',{source:source('boards')}));
add('DELETE','/boards/{boardId}/columns/{columnId}','manager','Retire an empty live column while preserving history; active/restorable cards and final-column guards prevent removal','BoardRevisionResponse',mutation('DeleteColumnInput',{requestOptional:true,querySchema:'DeleteColumnQuery',source:source('boards')}));
add('GET','/boards/{boardId}/columns/{columnId}/placement','member','Get full-order movement neighbors','PlacementResponse',{querySchema:'PlacementInput',source:source('boards')});
add('GET','/boards/{boardId}/cards','viewer','Page authorized board cards with stable order/filter cursor','CardListResponse',{querySchema:'CardsQuery',source:source('boards')});
add('POST','/boards/{boardId}/cards','member','Create card atomically; credential-bound retry receipt for PAT callers','CardResponse',mutation('CreateCardInput',{status:201,auth:'session-or-token',patScope:'cards:create',source:source('cards')}));
add('GET','/cards/{cardId}','viewer','Read card detail and public referenced people under current project/board access','CardDetailResponse',{auth:'session-or-token',patScope:'cards:read',source:source('cards')});
add('PATCH','/cards/{cardId}','member','Save card fields with expectedVersion','CardResponse',mutation('UpdateCardInput',{source:source('cards')}));
add('POST','/cards/{cardId}/move','member','Move using canonical neighbors and card/board versions','CardResponse',mutation('MoveCardInput',{source:source('cards')}));
add('POST','/cards/{cardId}/move-undo','member','Undo as new versioned move without overwriting intervening work','CardResponse',mutation('MoveUndoInput',{source:source('cards')}));
add('GET','/projects/{projectId}/cards/search','viewer','Search active authorized cards within one project','CardSearchResponse',{querySchema:'CardsQuery',auth:'session-or-token',patScope:'cards:read',source:source('cards')});
for(const path of ['/me/tasks','/workspaces/{workspaceId}/my-tasks']) add('GET',path,'viewer','Read own assignments in one required project with bounded cursor pages and due/priority filters; no cross-project aggregation','MyTasksResponse',{querySchema:path.startsWith('/workspaces/')?'WorkspaceMyTasksQuery':'MyTasksQuery',source:source('cards')});
add('GET','/cards/{cardId}/comments','viewer','Read authorized chronological comments with strict bounded paging','CommentListResponse',{querySchema:'CommentsQuery',source:source('comments')});
add('POST','/cards/{cardId}/comments','member','Post comment with validated UTF-16 mention spans','CommentResponse',mutation('PostCommentInput',{status:201,source:source('comments')}));
add('PATCH','/comments/{commentId}','member','Author-only comment edit; edits do not resend mentions','CommentResponse',mutation('EditCommentInput',{source:source('comments')}));
add('DELETE','/comments/{commentId}','member','Author or Owner/Manager tombstones comment with expectedVersion','CommentDeleteResponse',mutation('DeleteCommentBodyInput',{querySchema:'DeleteCommentQuery',requestOptional:true,description:'Send expectedVersion in JSON or the canonical query value; when both are present they must agree. Unknown fields and malformed query shape are rejected before mutation.',source:source('comments')}));
for(const [path,role] of [['/cards/{cardId}/activity','viewer'],['/projects/{projectId}/activity','manager'],['/workspaces/{workspaceId}/activity','owner']] as const) add('GET',path,role,'Read current authorized activity scope','ActivityListResponse',{querySchema:path.includes('/cards/')?'CardActivityQuery':path.startsWith('/projects/')?'ProjectActivityQuery':'ActivityFeedQuery',source:source('activity')});
add('GET','/notifications','authenticated','Read own reauthorized inbox','NotificationListResponse',{querySchema:'NotificationQuery',source:source('notifications')});
add('PATCH','/notifications/{id}/read','authenticated','Mark visible own notification read; no body/key required','NotificationResponse',{source:source('notifications')});
add('POST','/notifications/mark-all-read','authenticated','Mark currently visible notifications read','MarkAllReadResponse',{source:source('notifications')});
add('POST','/cards/{cardId}/image-uploads','member','Stage bounded private image upload','ImageUploadResponse',mutation('CreateImageUploadInput',{status:201,source:source('images')}));
add('PUT','/image-uploads/{uploadId}/content','member','Upload bounded bytes for staged image digest/size validation','ImageUploadResponse',{requestKind:'image',source:source('images')});
add('POST','/image-uploads/{uploadId}/finalize','member','Validate and finalize staged image','FinalizedImageResponse',mutation(undefined,{source:source('images')}));
add('GET','/image-uploads/{uploadId}','member','Read own authorized image upload state','ImageUploadResponse',{source:source('images')});
add('DELETE','/image-uploads/{uploadId}','member','Cancel staged image and schedule cleanup','ImageUploadResponse',{source:source('images')});
add('GET','/cards/{cardId}/images','viewer','Read nested image gallery items and saved count','ImageGalleryResponse',{source:source('images')});
for(const suffix of ['content','thumbnail']) add('GET',`/images/{imageId}/${suffix}`,'viewer','Authenticated private image delivery; current board access checked',undefined,{contentType:'image/*',source:source('images')});
add('DELETE','/images/{imageId}','member','Uploader or authorized moderator removes image','ImageDeleteResponse',mutation('DeleteImageInput',{source:source('images')}));
add('POST','/cards/{cardId}/delete','manager','Move card to exact24-hour trash','CardResponse',mutation('SoftDeleteCardInput',{source:source('trash')}));
add('POST','/cards/{cardId}/restore','manager','Restore before exact server cutoff; reauthorize destination','CardResponse',mutation('RestoreCardInput',{source:source('trash')}));
add('GET','/projects/{projectId}/trash','manager','Read authorized trash deadlines and restore actions','TrashListResponse',{querySchema:'TrashQuery',source:source('trash')});
for(const path of ['/import/template','/boards/{boardId}/card-import-template','/boards/{boardId}/import-template']) add('GET',path,path.includes('{boardId}')?'viewer':'authenticated','Download versioned blank seven-column XLSX template',undefined,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',source:source('imports')});
for(const path of ['/boards/{boardId}/imports','/boards/{boardId}/card-imports']) add('POST',path,'manager','Upload bounded literal XLSX preview; description retained; no cards created yet','ImportStatusResponse',{requestKind:'xlsx',querySchema:'ImportUploadQuery',status:201,source:source('imports')});
for(const prefix of ['/imports/{importId}','/card-imports/{importId}']) {
  add('GET',prefix,'manager','Read actor-owned import preview/results with row pagination','ImportStatusResponse',{querySchema:'ImportPreviewQuery',source:source('imports')});
  add('POST',`${prefix}/mappings`,'manager','Revalidate explicit source-status to authorized-column mapping','ImportStatusResponse',{requestSchema:'UpdateImportMappingsInput',source:source('imports')});
  add('POST',`${prefix}/commit`,'manager','Confirm atomic bounded import with digest/version and retry key','ImportStatusResponse',mutation('CommitImportInput',{source:source('imports')}));
  add('DELETE',prefix,'manager','Cancel pre-commit import and remove temporary content','ImportCancelResponse',{source:source('imports')});
  add('GET',`${prefix}/report`,'manager','Download safe UTF-8 CSV outcome report, not JSON',undefined,{contentType:'text/csv',source:source('imports')});
}
add('POST','/tokens','authenticated','Mint own hashed project-limited capability token; session required; raw token returned once','CreatedTokenResponse',{requestSchema:'CreateTokenInput',status:201,source:source('tokens')});
add('GET','/tokens','authenticated','List own token summaries, never raw bearer secrets','TokenListResponse',{source:source('tokens')});
add('DELETE','/tokens/{tokenId}','authenticated','Revoke own token; cannot administer credentials using a PAT','SuccessResponse',{source:source('tokens')});
add('GET','/system/status','authenticated','Administrative migration/binding status; X-Dev-Secret required','SystemStatusResponse',{auth:'admin-secret',source:source('system'),responses:{200:{schema:'SystemStatusResponse',description:'Migration and binding status'},403:{schema:'AdminStatusError',description:'Route-specific administrative denial (no requestId)'}}});
add('POST','/system/migrate','authenticated','Administrative migration runner; explicit admin secret, no user-session authority','SystemMigrateResponse',{auth:'admin-secret',source:source('system')});

export const OPENAPI_ROUTES: OpenApiOperationDefinition[] = rows;
