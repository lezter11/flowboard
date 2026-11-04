// Build/test-time bindings only. Product runtimes do not import this module or generate JSON Schema.
import { z } from 'zod';
import * as shared from '../index.ts';
import { HOSTED_MCP_OPENAPI_SCHEMAS } from './hosted-mcp-schemas.ts';

export interface SchemaBinding {
  schema: z.ZodType;
  io: 'input' | 'output';
  source: string;
  notes?: string;
}
export const OPENAPI_SCHEMAS: Record<string, SchemaBinding> = {};
for (const [name, value] of Object.entries(shared)) {
  if (name.endsWith('Schema') && value instanceof z.ZodType) {
    const component = name[0]!.toUpperCase() + name.slice(1, -6);
    OPENAPI_SCHEMAS[component] = { schema: value, io: /Input|Query/.test(component) ? 'input' : 'output',
      source: `packages/contracts/src/index.ts:${name}` };
  }
}
const id = z.string().min(1), revision = z.number().int().nonnegative(), timestamp = shared.utcIsoTimestampSchema;
const data = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const page = <T extends z.ZodType>(schema: T) => z.object({ data: z.array(schema), nextCursor: z.string().nullable() });
function wire(name: string, schema: z.ZodType, source: string, notes?: string) {
  OPENAPI_SCHEMAS[name] = { schema, io: /Input|Query/.test(name) ? 'input' : 'output', source, ...(notes ? { notes } : {}) };
}
wire('Health', data(z.object({ status: z.literal('ok') })), 'apps/api/src/http/app.ts; routes/activity.ts; routes/notifications.ts');
wire('Ready', data(z.object({ status: z.literal('ready') })), 'apps/api/src/http/app.ts');
wire('ProfileResponse', data(shared.sessionActorSchema), 'apps/api/src/http/routes/session.ts:profile');
wire('LastLocationWireResponse', data(shared.lastLocationSchema.nullable()), 'apps/api/src/http/routes/session.ts:last-location', 'Shared LastLocationResponse requires a non-null value; the mounted adapter can return null.');
wire('DevLoginInput', z.object({ email: z.string().email(), displayName: z.string().trim().min(1).max(100).optional() }), 'apps/api/src/http/routes/session.ts:devLoginRequestSchema');
wire('DevLoginResponse', data(z.object({ actor: shared.sessionActorSchema, session: z.object({ id, expiresAt: timestamp }) })), 'apps/api/src/http/routes/session.ts:dev-login', 'Local/test-only raw session token; never a supported deployed login.');
wire('GoogleStartQuery', z.object({ next: z.string().optional() }), 'apps/api/src/http/routes/google-auth.ts:startGoogleSignIn');
wire('GoogleCallbackQuery', z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }), 'apps/api/src/http/routes/google-auth.ts:completeGoogleSignIn', 'Callback checks code/state/cookie and provider claims; failures redirect to fixed sign-in state.');
wire('ListQuery', z.object({ limit: z.coerce.number().int().min(1).max(100).default(50).optional(), cursor: z.string().optional() }), 'apps/api/src/http/routes/projects.ts:parseLimit; activity.ts; notifications.ts', 'These legacy list routes clamp/fallback malformed limits rather than rejecting every invalid value; documented bounds are output/query semantics.');
wire('BoardAccessQuery', z.object({ after: z.string().max(4096).optional() }), 'apps/api/src/http/routes/board-grants.ts');
wire('BoardGrantInput', z.object({ expectedAccessRevision: z.string().regex(/^[1-9][0-9]{0,18}$/) }).strict(), 'apps/api/src/http/routes/board-grants.ts:parseRevision', 'Server additionally caps revision at signed64-bit maximum.');
wire('BoardAccessResponse', data(z.object({ grants: z.array(z.object({ userId: id })).max(100), accessRevision: id, nextCursor: z.string().nullable() })), 'apps/api/src/http/routes/board-grants.ts');
wire('BoardGrantResponse', data(z.object({ changed: z.boolean() })), 'apps/api/src/http/routes/board-grants.ts:writeGrant');
wire('PatBoardListResponse', data(z.array(z.object({ id, name: z.string(), structureVersion: revision }).strict())), 'apps/api/src/http/routes/boards.ts:GET projects/:projectId/boards token projection', 'Bearer board discovery excludes descriptions, columns, cards and counts.');
wire('BoardMetadataResponse', data(z.object({ id, name: z.string(), structureVersion: revision,
  columns: z.array(z.object({ id, name: z.string(), category: shared.columnCategorySchema, position: revision }).strict()).max(100),
}).strict()), 'apps/api/src/http/routes/boards.ts:GET boards/:boardId/metadata', 'This route serves the same narrow metadata shape to session and PAT callers; it is not a board snapshot.');
wire('BoardLifecycleResponse', data(shared.boardSchema.omit({ workspaceId: true, description: true })), 'apps/api/src/http/routes/boards.ts:archive/reopen response projection', 'Mounted archive/reopen omit workspaceId and description; base BoardResponse cannot represent this response.');
wire('ColumnResponse', data(shared.columnSchema), 'apps/api/src/adapters/boards.ts:addColumn/updateColumn');
wire('BoardRevisionResponse', data(z.object({ id, structureVersion: revision, snapshotVersion: revision })), 'apps/api/src/adapters/boards.ts:reorderColumns/deleteColumn');
wire('DeleteColumnQuery', z.object({ expectedBoardVersion: z.coerce.number().nonnegative().optional() }), 'apps/api/src/http/routes/boards.ts:DELETE columns', 'Version may be supplied in query or JSON body; current route uses parseInt/query fallback.');
wire('CardDetailResponse', z.object({ data: shared.cardSchema.extend({ people: z.array(shared.personDisplaySchema) }), people: z.array(shared.personDisplaySchema) }), 'apps/api/src/http/routes/cards.ts:GET cards/:cardId');
wire('CardSearchResponse', shared.cardListResponseSchema.extend({ activeCardCount: revision, matchingCardCount: revision }), 'apps/api/src/adapters/cards.ts:searchProjectCards');
wire('MoveUndoInput', shared.moveUndoInputSchema, 'packages/contracts/src/cards.ts:moveUndoInputSchema');
wire('SuccessResponse', data(z.object({ success: z.literal(true) })), 'apps/api/src/http/routes/members.ts:DELETE; routes/tokens.ts:DELETE; routes/invitations.ts:leave');
wire('CommentDeleteResponse', data(z.object({ success: z.literal(true), id, version: revision })), 'apps/api/src/adapters/comments.ts:deleteComment');
wire('DeleteCommentBodyInput', shared.deleteCommentInputSchema.partial(), 'apps/api/src/http/routes/comments.ts:delete', 'The JSON body may omit expectedVersion only when supplied in the validated query. Runtime requires one source and rejects disagreement.');
wire('ImageDeleteResponse', data(z.object({ success: z.literal(true), imageId: id })), 'apps/api/src/adapters/images.ts:removeImage');
wire('MarkAllReadResponse', data(z.object({ success: z.literal(true), count: revision })), 'apps/api/src/http/routes/notifications.ts:mark-all-read');
wire('ImportUploadQuery', z.object({ defaultColumnId: id.optional() }), 'apps/api/src/http/routes/imports.ts:handleCreateImport', 'Required through multipart field, query or X-Default-Column-Id header.');
wire('ImportMultipartInput', z.object({ file: z.string().meta({ description: 'Macro-free XLSX binary part' }), defaultColumnId: id }), 'apps/api/src/http/routes/imports.ts:handleCreateImport multipart fields');
wire('ImportCancelResponse', data(z.object({ id, state: z.literal('cancelled') })), 'apps/api/src/adapters/imports.ts:cancelCardImport');
wire('TrashQuery', z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(4096).optional() }), 'apps/api/src/http/routes/trash.ts:GET project trash');
wire('SystemStatusResponse', data(z.object({ migrations: z.array(z.object({ version: z.string(), name: z.string(), applied_at: timestamp })),
  rateLimitBindings: z.object({ FB_RL_WRITES: z.boolean() }) })), 'apps/api/src/http/routes/system.ts:status; adapters/rate-limit-cloudflare.ts');
wire('SystemMigrateResponse', data(z.object({ status: z.literal('ok'), appliedCount: revision, applied: z.array(z.object({ version: z.string(), name: z.string() })) })), 'apps/api/src/http/routes/system.ts:migrate');
wire('AdminStatusError', z.object({ error: z.object({ code: z.literal('FORBIDDEN'), message: z.string() }) }), 'apps/api/src/http/routes/system.ts:GET status 403', 'This route-specific denial lacks requestId; do not represent it as ordinary ErrorEnvelope.');
wire('WorkerBootstrapError', z.object({ error: z.object({ code: z.literal('CONFIG_ERROR'), message: z.string() }) }), 'apps/api/src/runtime/worker.ts:missing database bindings before createApp', 'Worker bootstrap errors lack requestId because global middleware has not run.');
// Exactly the allowlist implemented by minimalReceiptOutcome, not an unrestricted resource schema.
const replayItem = z.object({ id: id.optional(), version: revision.optional(), structureVersion: revision.optional(), snapshotVersion: revision.optional(),
  operationId: id.optional(), success: z.boolean().optional(), role: z.string().optional(), projectId: id.optional(), workspaceId: id.optional(), state: z.string().optional(), status: z.string().optional() }).strict();
wire('MinimalReplayResponse', z.object({ data: replayItem.or(z.array(replayItem)), replayed: z.literal(true) }), 'apps/api/src/adapters/idempotency.ts:minimalReceiptOutcome', 'A replay returns only safe operation identifiers/versions. Fetch the current authorized resource after replay; full bodies are not retained. Empty marker objects are possible for unsupported original fields.');
wire('ProjectMemberResponse', data(shared.projectMemberSchema), 'apps/api/src/http/routes/members.ts:PATCH');
wire('WorkspaceCreateRetiredError', z.object({ error: shared.errorDetailSchema.extend({ code: z.literal('WORKSPACE_CREATE_RETIRED') }) }), 'apps/api/src/http/routes/workspaces.ts:POST workspaces');
wire('OwnershipTransferRetiredError', z.object({ error: shared.errorDetailSchema.extend({ code: z.literal('TRANSFER_OWNERSHIP_RETIRED') }) }), 'apps/api/src/http/routes/workspaces.ts:POST transfer-ownership');
// Route-specific subsets avoid advertising ignored selectors on an otherwise shared filter family.
wire('WorkspaceMyTasksQuery', (OPENAPI_SCHEMAS.MyTasksQuery!.schema as z.ZodObject).omit({ workspaceId: true }), 'apps/api/src/http/routes/cards.ts:GET workspace my-tasks');

OPENAPI_SCHEMAS.SaveNameInput!.notes = 'Both first/last parts normalize whitespace (including tabs) and must contain1..60 Unicode code points. Shared normalizeNamePart rejects disallowed control/format/line/paragraph separators; custom refinements/transforms are validated by Zod, not fully compiled into structural JSON Schema.';
OPENAPI_SCHEMAS.MentionsList!.notes = 'At most20 UTF-16 spans. Shared refinements enforce start<end and nonoverlapping spans; handler checks verify actual body slices/current eligible recipient authority.';
OPENAPI_SCHEMAS.DateOnly!.notes = 'Date-only YYYY-MM-DD; shared Gregorian-day refinement rejects impossible/leap-day dates beyond the structural regex.';

Object.assign(OPENAPI_SCHEMAS, HOSTED_MCP_OPENAPI_SCHEMAS);
