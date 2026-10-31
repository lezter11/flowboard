import { REFUSED_NAME_CHARACTERS, REFUSED_NAME_MESSAGE } from './common.ts';
import { z } from 'zod';
import {
  cardSummarySchema,
  prioritySchema,
  type CardDueFilter,
  type CardSummary,
  type Priority,
} from './cards.ts';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  dateOnlySchema,
  personDisplaySchema,
  utcIsoTimestampSchema,
  type DateOnly,
  type PersonDisplay,
} from './common.ts';

export const COLUMN_CATEGORIES = ['todo', 'active', 'done'] as const;
export const columnCategorySchema = z.enum(COLUMN_CATEGORIES);
export type ColumnCategory = z.infer<typeof columnCategorySchema>;

export const createBoardInputSchema = z.object({
  name: z.string()
    .refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE })
    .trim().min(1, 'Board name cannot be empty').max(100, 'Board name cannot exceed 100 characters'),
  // Optional. Same rule as project descriptions: plain text, up to 2000 characters.
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional(),
});
export type CreateBoardInput = z.infer<typeof createBoardInputSchema>;

// Owner only; see docs/API.md. At least one of name or description; null clears the description.
export const updateBoardInputSchema = z
  .object({
    name: z.string()
      .refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE })
      .trim().min(1, 'Board name cannot be empty').max(100, 'Board name cannot exceed 100 characters').optional(),
    description: z.string().max(2000, 'Description cannot exceed 2000 characters').nullable().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one field (name or description) must be provided to update',
  });
export type UpdateBoardInput = z.infer<typeof updateBoardInputSchema>;

export const boardLifecycleInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export type BoardLifecycleInput = z.infer<typeof boardLifecycleInputSchema>;

export const boardSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  // Optional, additive: the API always returns it (null when unset).
  description: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean(),
  structureVersion: z.number().int().nonnegative(),
  snapshotVersion: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Board = z.infer<typeof boardSchema>;

export const boardResponseSchema = createDataEnvelopeSchema(boardSchema);
export type BoardResponse = z.infer<typeof boardResponseSchema>;

export const boardListResponseSchema = createPaginatedEnvelopeSchema(boardSchema);
export type BoardListResponse = z.infer<typeof boardListResponseSchema>;

export const columnSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().trim().min(1, 'Column name cannot be empty').max(80, 'Column name cannot exceed 80 characters'),
  category: columnCategorySchema,
  color: z.string().trim().min(1).max(30),
  position: z.number().int().nonnegative(),
  activeCardCount: z.number().int().nonnegative(),
  matchingCardCount: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Column = z.infer<typeof columnSchema>;

export const createColumnInputSchema = z.object({
  name: z.string().trim().min(1, 'Column name cannot be empty').max(80, 'Column name cannot exceed 80 characters'),
  color: z.string().trim().min(1, 'Color cannot be empty').max(30, 'Color string cannot exceed 30 characters'),
  category: columnCategorySchema,
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type CreateColumnInput = z.infer<typeof createColumnInputSchema>;

export const updateColumnInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z.string().trim().min(1).max(30).optional(),
    category: columnCategorySchema.optional(),
    expectedBoardVersion: z.number().int().nonnegative(),
  })
  .refine(
    (data) => data.name !== undefined || data.color !== undefined || data.category !== undefined,
    { message: 'At least one field (name, color, or category) must be provided to update' },
  );
export type UpdateColumnInput = z.infer<typeof updateColumnInputSchema>;

export const reorderColumnsInputSchema = z.object({
  columnIds: z
    .array(z.string().min(1))
    .min(1, 'Must specify at least one column')
    .max(12, 'Cannot exceed 12 columns on a board')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Column IDs must be unique',
    }),
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type ReorderColumnsInput = z.infer<typeof reorderColumnsInputSchema>;

export const deleteColumnInputSchema = z.object({
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type DeleteColumnInput = z.infer<typeof deleteColumnInputSchema>;

export const placementInputSchema = z
  .object({
    movingCardId: z.string().min(1, 'Moving card ID is required'),
    at: z.enum(['first', 'last', 'before', 'after']),
    anchorCardId: z.string().min(1).optional(),
  })
  .refine(
    (data) => (data.at === 'before' || data.at === 'after' ? data.anchorCardId !== undefined : true),
    { message: 'anchorCardId is required when placement position is "before" or "after"' },
  );
export type PlacementInput = z.infer<typeof placementInputSchema>;

export const placementResultSchema = z.object({
  movingCardId: z.string().min(1),
  toColumnId: z.string().min(1),
  previousCardId: z.string().min(1).nullable(),
  nextCardId: z.string().min(1).nullable(),
  structureVersion: z.number().int().nonnegative(),
});
export type PlacementResult = z.infer<typeof placementResultSchema>;

export const placementResponseSchema = createDataEnvelopeSchema(placementResultSchema);
export type PlacementResponse = z.infer<typeof placementResponseSchema>;

export const COLUMN_TONES = [
  'lavender', 'ice', 'grey', 'green', 'coral', 'rose', 'mint', 'peach', 'butter', 'lilac',
] as const;
export const columnToneSchema = z.enum(COLUMN_TONES);
export type ColumnTone = z.infer<typeof columnToneSchema>;

export const columnSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  category: columnCategorySchema,
  color: z.string().trim().min(1).max(30),
  // Optional, additive: stored named tone, or absent when not set.
  tone: columnToneSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
  activeCardCount: z.number().int().nonnegative(),
  matchingCardCount: z.number().int().nonnegative(),
  cards: z.array(cardSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ColumnSummary = z.infer<typeof columnSummarySchema>;

export const boardFiltersSchema = z.object({
  titleQuery: z.string().nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
});
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

export const boardSnapshotTotalsSchema = z.object({
  activeCardCount: z.number().int().nonnegative(),
  matchingCardCount: z.number().int().nonnegative(),
  // Optional, additive: active cards outside done columns due before the workspace's today, and
  // due within the next 7 days (inclusive). Ignore filters; computed for the whole board.
  overdueCount: z.number().int().nonnegative().optional(),
  dueSoonCount: z.number().int().nonnegative().optional(),
});
export type BoardSnapshotTotals = z.infer<typeof boardSnapshotTotalsSchema>;

export const boardSnapshotDataSchema = z.object({
  board: boardSchema,
  filters: boardFiltersSchema,
  asOfDate: dateOnlySchema,
  totals: boardSnapshotTotalsSchema,
  columns: z.array(columnSummarySchema).max(12, 'A board cannot have more than 12 columns'),
  people: z.array(personDisplaySchema),
});
export type BoardSnapshotData = z.infer<typeof boardSnapshotDataSchema>;

export const boardSnapshotResponseSchema = createDataEnvelopeSchema(boardSnapshotDataSchema);
export type BoardSnapshotResponse = z.infer<typeof boardSnapshotResponseSchema>;

export const boardSnapshotQuerySchema = z.object({
  titleQuery: z.string().trim().optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  due: z.string().optional(),
  cardLimitPerColumn: z.coerce.number().int().min(1).max(15).default(10).optional(),
});
export type BoardSnapshotQuery = z.infer<typeof boardSnapshotQuerySchema>;
