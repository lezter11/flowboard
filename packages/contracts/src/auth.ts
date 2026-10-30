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
  // Optional, additive: set only when the caller can read that board, else null.
  defaultBoardId: z.string().min(1).nullable().optional(),
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

// PATCH /api/v1/session/profile (B-9). The user may change their own display name only. Email and
// avatar are owned by Google and refreshed at sign-in. Control characters are refused before trim,
// so a trailing CR or LF cannot slip through as whitespace.
export const PROFILE_DISPLAY_NAME_MAX = 80;
export const updateProfileInputSchema = z
  .object({
    displayName: z
      .string()
      .refine((value) => !/\p{Cc}/u.test(value), { message: 'Display name must not contain control characters' })
      .trim()
      .min(1, 'Display name cannot be empty')
      .max(PROFILE_DISPLAY_NAME_MAX, 'Display name cannot exceed 80 characters'),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
