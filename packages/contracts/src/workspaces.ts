import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const workspaceTimezoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; }
  catch { return false; }
}, { message: 'Choose a supported timezone, for example UTC or Asia/Kolkata.' });

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name cannot be empty').max(100, 'Workspace name cannot exceed 100 characters'),
  timezone: workspaceTimezoneSchema,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: workspaceTimezoneSchema.optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((data) => data.name !== undefined || data.timezone !== undefined, {
    message: 'At least one field (name or timezone) must be provided to update',
  });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const transferWorkspaceOwnershipInputSchema = z.object({
  targetUserId: z.string().min(1, 'Target user ID is required'),
  expectedVersion: z.number().int().nonnegative(),
});
export type TransferWorkspaceOwnershipInput = z.infer<typeof transferWorkspaceOwnershipInputSchema>;

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  timezone: z.string().min(1).max(100),
  ownerId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceResponseSchema = createDataEnvelopeSchema(workspaceSchema);
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

export const workspaceListResponseSchema = createPaginatedEnvelopeSchema(workspaceSchema);
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
