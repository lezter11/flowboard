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

export const sessionDataSchema = z.object({
  actor: sessionActorSchema,
  ownedWorkspaces: z.array(sessionWorkspaceSummarySchema),
  accessibleProjects: z.array(sessionProjectSummarySchema),
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
