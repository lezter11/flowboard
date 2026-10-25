import { z } from 'zod';
import { personDisplaySchema, utcIsoTimestampSchema } from './common.ts';

export const softDeleteCardInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type SoftDeleteCardInput = z.infer<typeof softDeleteCardInputSchema>;

export const restoreCardInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  expectedBoardVersion: z.number().int().nonnegative(),
  toColumnId: z.string().min(1).optional(),
});
export type RestoreCardInput = z.infer<typeof restoreCardInputSchema>;

export const TRASH_BLOCKED_REASONS = [
  'window_expired',
  'project_archived',
  'board_archived',
  'destination_missing',
] as const;
export const trashBlockedReasonSchema = z.enum(TRASH_BLOCKED_REASONS).nullable();
export type TrashBlockedReason = z.infer<typeof trashBlockedReasonSchema>;

export const trashRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  originalColumnId: z.string().min(1),
  version: z.number().int().nonnegative(),
  structureVersion: z.number().int().nonnegative(),
  deletedAt: utcIsoTimestampSchema,
  deletedBy: z.string().min(1),
  restoreUntil: utcIsoTimestampSchema,
  canRestore: z.boolean(),
  blockedReason: trashBlockedReasonSchema,
  actor: personDisplaySchema.optional(),
});
export type TrashRow = z.infer<typeof trashRowSchema>;

export const trashListResponseSchema = z.object({
  data: z.array(trashRowSchema),
  nextCursor: z.string().nullable(),
  serverNow: utcIsoTimestampSchema,
});
export type TrashListResponse = z.infer<typeof trashListResponseSchema>;

export const restoreWindowExpiredDetailsSchema = z.object({
  serverNow: utcIsoTimestampSchema,
  restoreUntil: utcIsoTimestampSchema,
});
export type RestoreWindowExpiredDetails = z.infer<typeof restoreWindowExpiredDetailsSchema>;

export const restoreDestinationRequiredDetailsSchema = z.object({
  reason: z.literal('destination_missing'),
  boardId: z.string().min(1),
});
export type RestoreDestinationRequiredDetails = z.infer<typeof restoreDestinationRequiredDetailsSchema>;

export const readOnlyContextDetailsSchema = z.object({
  reason: z.enum(['project_archived', 'board_archived']),
  contextId: z.string().min(1),
});
export type ReadOnlyContextDetails = z.infer<typeof readOnlyContextDetailsSchema>;
