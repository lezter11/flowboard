import { z } from 'zod';
import { prioritySchema, type Priority } from './cards.ts';
import {
  createDataEnvelopeSchema,
  nullableDateOnlySchema,
  utcIsoTimestampSchema,
  type NullableDateOnly,
} from './common.ts';

export const IMPORT_STATES = [
  'uploaded',
  'validating',
  'invalid',
  'ready',
  'committing',
  'committed',
  'failed',
  'cancelled',
  'expired',
] as const;
export const importStateSchema = z.enum(IMPORT_STATES);
export type ImportState = z.infer<typeof importStateSchema>;

export const IMPORT_ROW_OUTCOMES = [
  'new',
  'already_imported',
  'invalid',
  'conflict',
  'created',
  'skipped',
] as const;
export const importRowOutcomeSchema = z.enum(IMPORT_ROW_OUTCOMES);
export type ImportRowOutcome = z.infer<typeof importRowOutcomeSchema>;

export const importRowErrorSchema = z.object({
  field: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  externalId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  status: z.string().trim().nullable(),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z.array(z.string().min(1)),
  outcome: importRowOutcomeSchema,
  errors: z.array(importRowErrorSchema),
  cardId: z.string().min(1).nullable(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;

export const importStatusErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ImportStatusError = z.infer<typeof importStatusErrorSchema>;

export const importStatusSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  defaultColumnId: z.string().min(1),
  version: z.number().int().nonnegative(),
  state: importStateSchema,
  previewDigest: z.string().min(1).nullable(),
  expiresAt: utcIsoTimestampSchema.nullable(),
  serverNow: utcIsoTimestampSchema,
  counts: importCountsSchema,
  canCommit: z.boolean(),
  cancellationAllowed: z.boolean(),
  rows: z.array(importRowSchema),
  nextCursor: z.string().nullable(),
  error: importStatusErrorSchema.nullable(),
});
export type ImportStatus = z.infer<typeof importStatusSchema>;

export const importStatusResponseSchema = createDataEnvelopeSchema(importStatusSchema);
export type ImportStatusResponse = z.infer<typeof importStatusResponseSchema>;

export const commitImportInputSchema = z.object({
  previewDigest: z.string().min(1, 'Preview digest is required'),
  defaultColumnId: z.string().min(1, 'Default column ID is required'),
  expectedVersion: z.number().int().nonnegative(),
});
export type CommitImportInput = z.infer<typeof commitImportInputSchema>;

export const updateImportMappingsInputSchema = z.object({
  mappings: z.record(z.string(), z.string().min(1)),
  expectedVersion: z.number().int().nonnegative(),
});
export type UpdateImportMappingsInput = z.infer<typeof updateImportMappingsInputSchema>;
