import { z } from 'zod';
import { prioritySchema, type Priority } from './cards.ts';
import {
  createDataEnvelopeSchema,
  nullableDateOnlySchema,
  personDisplaySchema,
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

const importRowFields = {
  rowNumber: z.number().int().positive(),
  status: z.string().trim().nullable(),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z.array(z.string().min(1)),
  errors: z.array(importRowErrorSchema),
  cardId: z.string().min(1).nullable(),
};
const validatedImportRowSchema = z.object({
  ...importRowFields,
  contentRedacted: z.literal(false).optional(),
  externalId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional(),
  outcome: z.enum(['new','already_imported','created','skipped']),
});
// Invalid source rows are evidence for correction, never valid card input. XML
// text is bounded at65,536 code units; NFC normalization can expand an ID.
const invalidImportRowSchema = z.object({
  ...importRowFields,
  contentRedacted: z.literal(false).optional(),
  externalId: z.string().max(196608),
  title: z.string().max(65536),
  description: z.string().max(65536).optional(),
  outcome: z.enum(['invalid','conflict']),
  errors: z.array(importRowErrorSchema).min(1),
});
const redactedImportRowSchema = z.object({
  rowNumber: importRowFields.rowNumber,
  contentRedacted: z.literal(true),
  externalId: z.null(), title: z.null(), description: z.null(), status: z.null(),
  priority: z.null(), dueDate: z.null(),
  assigneeIds: z.array(z.never()).max(0),
  outcome: importRowOutcomeSchema,
  errors: z.array(z.never()).max(0),
  cardId: importRowFields.cardId,
}).strict();
export const importRowSchema = z.union([validatedImportRowSchema,invalidImportRowSchema,redactedImportRowSchema]);
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
  createdAt: utcIsoTimestampSchema.optional(),
  createdById: z.string().min(1).optional(),
  createdBy: personDisplaySchema.nullable().optional(),
  committedAt: utcIsoTimestampSchema.nullable().optional(),
  committedById: z.string().min(1).nullable().optional(),
  committedBy: personDisplaySchema.nullable().optional(),
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
  mappingEntries: z.array(z.object({sourceStatus:z.string().min(1),columnId:z.string().min(1)})).max(200).optional(),
  expectedVersion: z.number().int().nonnegative(),
}).refine(input=>{
  const labels=[...Object.keys(input.mappings),...(input.mappingEntries??[]).map(entry=>entry.sourceStatus)];
  return labels.length<=200 && new Set(labels).size===labels.length;
},{message:'Provide at most200 unique status mappings, without duplicate labels.'});
export type UpdateImportMappingsInput = z.infer<typeof updateImportMappingsInputSchema>;

export const importPreviewQuerySchema = z.object({
  limit:z.coerce.number().int().min(1).max(100).default(50),
  cursor:z.string().regex(/^(?:0|[1-9]\d*)$/).max(16).refine(value=>Number.isSafeInteger(Number(value))).optional(),
}).strict();
