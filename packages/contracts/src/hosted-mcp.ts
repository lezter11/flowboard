import { z } from 'zod';
import { TOKEN_SCOPES } from './tokens.ts';
import { utcIsoTimestampSchema } from './common.ts';

export const hostedMcpScopeSchema = z.enum(TOKEN_SCOPES);
const opaqueId = z.string().min(8).max(200);
const csrf = z.string().min(20).max(200);
const project = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(200),
  role: z.enum(['owner', 'manager', 'member', 'viewer']),
}).strict();

export const hostedMcpAuthorizationViewSchema = z.object({ data: z.object({
  requestId: opaqueId,
  client: z.object({ name: z.string().min(1).max(120), origin: z.string().url(), redirectOrigin: z.string().url(), verified: z.literal(false) }).strict(),
  scopes: z.array(hostedMcpScopeSchema).min(1).max(4),
  offlineAccess: z.boolean(),
  accessTokenLifetimeSeconds: z.literal(900),
  connectionLifetimeDays: z.literal(30),
  refreshTokenIdleDays: z.union([z.literal(7), z.null()]),
  expiresAt: utcIsoTimestampSchema,
  csrfToken: csrf,
  projects: z.array(project).max(100),
  nextCursor: z.string().max(4096).nullable(),
}).strict() }).strict();

export const hostedMcpDecisionInputSchema = z.object({
  decision: z.enum(['allow', 'deny']), projectId: z.string().min(1).max(200).optional(), csrfToken: csrf,
}).strict().refine(value => value.decision !== 'allow' || !!value.projectId, { message: 'Choose a project before allowing access.', path: ['projectId'] });

export const hostedMcpDecisionResponseSchema = z.object({ data: z.object({
  redirectUrl: z.string().url().max(8192),
}).strict() }).strict();

export const hostedMcpConnectionSchema = z.object({
  id: opaqueId,
  clientName: z.string().min(1).max(120), clientOrigin: z.string().url(), redirectOrigin: z.string().url(),
  projectId: z.string().min(1).max(200), projectName: z.string().min(1).max(200),
  scopes: z.array(hostedMcpScopeSchema).min(1).max(4),
  offlineAccess: z.boolean(),
  createdAt: utcIsoTimestampSchema, expiresAt: utcIsoTimestampSchema,
  lastUsedAt: utcIsoTimestampSchema.nullable(), revokedAt: utcIsoTimestampSchema.nullable(),
}).strict();

export const hostedMcpConnectionsResponseSchema = z.object({ data: z.array(hostedMcpConnectionSchema).max(100) }).strict();
export type HostedMcpAuthorizationView = z.infer<typeof hostedMcpAuthorizationViewSchema>['data'];
export type HostedMcpDecisionInput = z.infer<typeof hostedMcpDecisionInputSchema>;
export type HostedMcpConnection = z.infer<typeof hostedMcpConnectionSchema>;
