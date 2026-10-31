import { z } from 'zod';
import { roleSchema, utcIsoTimestampSchema } from './common.ts';

// displayName is 'First Last' once names are saved (B-16): up to 60 + 1 + 60 characters.
export const sessionActorSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(121),
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

// First and last name (B-16). A part is 1 to 60 characters after trimming and collapsing whitespace.
// Control characters, format characters (zero-width and bidirectional overrides among them) and line
// or paragraph separators are refused before trimming, so none can hide in a name.
export const NAME_PART_MAX = 60;
// A tab is whitespace and collapses to a space. Every other control character, CR and LF included, is refused.
const REFUSED_NAME_CHARACTERS = /(?!\t)\p{Cc}|[\p{Cf}\p{Zl}\p{Zp}]/u;

/** The normalised name part, or null when it is refused. The one rule the API and the tests share. */
export function normalizeNamePart(value: string): string | null {
  if (REFUSED_NAME_CHARACTERS.test(value)) return null;
  const collapsed = value.trim().replace(/\s+/gu, ' ');
  const length = [...collapsed].length;
  return length >= 1 && length <= NAME_PART_MAX ? collapsed : null;
}

const namePartSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (REFUSED_NAME_CHARACTERS.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Name must not contain control, zero-width or bidirectional characters' });
    } else if (normalizeNamePart(value) === null) {
      ctx.addIssue({ code: 'custom', message: 'Name must be 1 to 60 characters' });
    }
  })
  .transform((value) => normalizeNamePart(value) ?? '');

// PATCH /api/v1/session/name (B-16). Both parts are required. Unknown fields are refused with 422.
export const saveNameInputSchema = z
  .object({
    firstName: namePartSchema,
    lastName: namePartSchema,
  })
  .strict();
export type SaveNameInput = z.infer<typeof saveNameInputSchema>;

export const saveNameResponseSchema = z.object({
  data: z.object({
    actor: sessionActorSchema,
    firstName: z.string().min(1).max(NAME_PART_MAX),
    lastName: z.string().min(1).max(NAME_PART_MAX),
    needsName: z.literal(false),
  }),
});
export type SaveNameResponse = z.infer<typeof saveNameResponseSchema>;

/** The error code for an invitation accept while the user still has to save a name (HTTP 409). */
export const NAME_REQUIRED_CODE = 'NAME_REQUIRED';

export const sessionDataSchema = z.object({
  actor: sessionActorSchema,
  ownedWorkspaces: z.array(sessionWorkspaceSummarySchema),
  accessibleProjects: z.array(sessionProjectSummarySchema),
  lastLocation: lastLocationSchema.nullable().optional(),
  // True until the user saves a first and last name (name_confirmed_at is null). Google's given and
  // family name are suggestions only: they arrive as suggestedFirstName and suggestedLastName.
  needsName: z.boolean(),
  suggestedFirstName: z.string().min(1).max(NAME_PART_MAX).nullable(),
  suggestedLastName: z.string().min(1).max(NAME_PART_MAX).nullable(),
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
