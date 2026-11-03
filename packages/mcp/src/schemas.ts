import { z } from 'zod';

export const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/, 'Use an exact Flowboard resource ID.');
export const cursorSchema = z.string().min(1).max(16384);
export const operationIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/, 'Use a stable 16-128 character operation ID.');
export const prioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !value.startsWith('0000-') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real Gregorian date in YYYY-MM-DD format.');

export const paginationShape = {
  cursor: cursorSchema.optional().describe('Opaque nextCursor returned by the previous page; do not invent or decode it.'),
  limit: z.number().int().min(1).max(100).optional().default(50).describe('Maximum records in this page (1-100, default 50).'),
};
export const paginationInputSchema = z.object(paginationShape);
export const createCardShape = {
  operationId: operationIdSchema.describe('Generate one UUID for this logical create and preserve it with identical input on every retry, including after timeout or process restart. A new operationId creates a different card.'),
  boardId: idSchema.describe('Exact ID of the target board.'),
  column: z.string().trim().min(1).max(200).describe('Prefer an exact column ID; a unique case-insensitive column name is also accepted.'),
  title: z.string().trim().min(1).max(200).describe('Plain-text card title, 1-200 characters.'),
  description: z.string().max(20000).optional().default('').describe('Optional plain-text details; no HTML or markdown interpretation.'),
  priority: prioritySchema.optional().default('none'),
  dueDate: dateSchema.optional().describe('Optional calendar date, YYYY-MM-DD, without time or timezone.'),
};
export const createCardInputSchema = z.object(createCardShape).strict();
export const searchInputSchema = z.object({
  projectId: idSchema,
  query: z.string().trim().min(1).max(100),
  ...paginationShape,
});
