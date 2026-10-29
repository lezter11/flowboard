import { z } from 'zod';
import { roleSchema, utcIsoTimestampSchema } from './common.ts';

export const sessionActorSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(100),
  avatarUrl: z.string().url().nullable(),
});
export type SessionActor = z.infer<typeof sessionActorSchema>;

export const sessionWorkspaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  timezone: z.string().min(1).max(100),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type SessionWorkspaceSummary = z.infer<typeof sessionWorkspaceSummarySchema>;

export const sessionProjectSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullable(),
  role: roleSchema,
  isArchived: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type SessionProjectSummary = z.infer<typeof sessionProjectSummarySchema>;

// Where the user last was. Additive and optional: the API returns null when nothing is set
// or when the stored project or board is no longer readable by this user.
export const lastLocationSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1).nullable(),
});
export type LastLocation = z.infer<typeof lastLocationSchema>;

export const updateLastLocationInputSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    boardId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
export type UpdateLastLocationInput = z.infer<typeof updateLastLocationInputSchema>;

export const lastLocationResponseSchema = z.object({
  data: lastLocationSchema,
});
export type LastLocationResponse = z.infer<typeof lastLocationResponseSchema>;

export const sessionDataSchema = z.object({
  actor: sessionActorSchema,
  ownedWorkspaces: z.array(sessionWorkspaceSummarySchema),
  accessibleProjects: z.array(sessionProjectSummarySchema),
  lastLocation: lastLocationSchema.nullable().optional(),
});
export type SessionData = z.infer<typeof sessionDataSchema>;

export const getSessionResponseSchema = z.object({
  data: sessionDataSchema,
});
export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

export const logoutResponseSchema = z.object({
  data: z.object({
    success: z.literal(true),
  }),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
