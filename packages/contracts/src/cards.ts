import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  nullableDateOnlySchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const CARD_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export const prioritySchema = z.enum(CARD_PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

export const CARD_STATES = ['active', 'trashed', 'purged'] as const;
export const cardStateSchema = z.enum(CARD_STATES);
export type CardState = z.infer<typeof cardStateSchema>;

export const createCardInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Card title cannot be empty')
    .max(200, 'Card title cannot exceed 200 characters'),
  columnId: z.string().min(1, 'Column ID is required'),
  description: z.string().max(20000, 'Description cannot exceed 20,000 characters').optional().default(''),
  priority: prioritySchema.optional().default('none'),
  dueDate: nullableDateOnlySchema.optional().default(null),
  assigneeIds: z
    .array(z.string().min(1))
    .max(20, 'At most 20 assignees can be assigned')
    .refine((items) => new Set(items).size === items.length, {
      message: 'Assignee IDs must be unique',
    })
    .optional()
    .default([]),
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type CreateCardInput = z.infer<typeof createCardInputSchema>;

export const updateCardInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Card title cannot be empty')
      .max(200, 'Card title cannot exceed 200 characters')
      .optional(),
    description: z.string().max(20000, 'Description cannot exceed 20,000 characters').nullable().optional(),
    priority: prioritySchema.optional(),
    dueDate: nullableDateOnlySchema.optional(),
    assigneeIds: z
      .array(z.string().min(1))
      .max(20, 'At most 20 assignees can be assigned')
      .refine((items) => new Set(items).size === items.length, {
        message: 'Assignee IDs must be unique',
      })
      .optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.priority !== undefined ||
      data.dueDate !== undefined ||
      data.assigneeIds !== undefined,
    { message: 'At least one field to update must be provided' },
  );
export type UpdateCardInput = z.infer<typeof updateCardInputSchema>;

export const moveCardInputSchema = z.object({
  toColumnId: z.string().min(1, 'Destination column ID is required'),
  previousCardId: z.string().min(1).nullable(),
  nextCardId: z.string().min(1).nullable(),
  expectedVersion: z.number().int().nonnegative(),
  expectedBoardVersion: z.number().int().nonnegative(),
});
export type MoveCardInput = z.infer<typeof moveCardInputSchema>;

export const cardSummarySchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z.array(z.string().min(1)),
  position: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type CardSummary = z.infer<typeof cardSummarySchema>;

export const cardSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z.array(z.string().min(1)),
  position: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  state: cardStateSchema,
  deletedAt: utcIsoTimestampSchema.nullable(),
  deletedBy: z.string().min(1).nullable(),
  restoreUntil: utcIsoTimestampSchema.nullable(),
  commentCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const cardResponseSchema = createDataEnvelopeSchema(cardSchema);
export type CardResponse = z.infer<typeof cardResponseSchema>;

export const cardListResponseSchema = createPaginatedEnvelopeSchema(cardSummarySchema);
export type CardListResponse = z.infer<typeof cardListResponseSchema>;

export const cardDueFilterSchema = z.enum(['overdue', 'today', 'upcoming', 'none']);
export type CardDueFilter = z.infer<typeof cardDueFilterSchema>;

export const cardsQuerySchema = z.object({
  columnId: z.string().min(1).optional(),
  query: z.string().trim().max(100).optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  due: cardDueFilterSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});
export type CardsQuery = z.infer<typeof cardsQuerySchema>;
