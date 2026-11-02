import { z } from 'zod';
import { createDataEnvelopeSchema, utcIsoTimestampSchema } from './common.ts';

export const TOKEN_SCOPES = [
  'cards:create',
  'cards:read',
  'boards:read',
  'projects:read',
] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const tokenScopeSchema = z.enum(TOKEN_SCOPES);

export const createTokenInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Token name cannot be empty')
    .max(64, 'Token name cannot exceed 64 characters'),
  scopes: z
    .array(tokenScopeSchema)
    .min(1, 'At least one scope is required')
    .refine((items) => new Set(items).size === items.length, {
      message: 'Scopes must be unique',
    }),
  projectId: z.string().min(1, 'Project ID cannot be empty').optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateTokenInput = z.infer<typeof createTokenInputSchema>;

export const tokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(tokenScopeSchema),
  projectId: z.string().nullable(),
  expiresAt: utcIsoTimestampSchema.nullable(),
  lastUsedAt: utcIsoTimestampSchema.nullable(),
  createdAt: utcIsoTimestampSchema,
});
export type TokenSummary = z.infer<typeof tokenSummarySchema>;

export const createdTokenResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    tokenDetails: tokenSummarySchema,
  }),
});
export type CreatedTokenResponse = z.infer<typeof createdTokenResponseSchema>;

export const tokenListResponseSchema = createDataEnvelopeSchema(z.array(tokenSummarySchema));
export type TokenListResponse = z.infer<typeof tokenListResponseSchema>;
