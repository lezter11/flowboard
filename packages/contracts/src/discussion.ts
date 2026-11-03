import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  personDisplaySchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const mentionSpanSchema = z
  .object({
    userId: z.string().min(1, 'User ID is required'),
    start: z.number().int().nonnegative('Start offset must be non-negative'),
    end: z.number().int().positive('End offset must be positive'),
  })
  .strict()
  .refine((data) => data.start < data.end, {
    message: 'Start offset must be strictly less than end offset',
  });
export type MentionSpan = z.infer<typeof mentionSpanSchema>;

export function validateNoOverlappingMentions(mentions: MentionSpan[]): boolean {
  if (mentions.length <= 1) return true;
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current !== undefined && next !== undefined && current.end > next.start) {
      return false;
    }
  }
  return true;
}

export const mentionsListSchema = z
  .array(mentionSpanSchema)
  .max(20, 'At most 20 mentions are allowed per comment')
  .refine(validateNoOverlappingMentions, {
    message: 'Mentions must not overlap',
  });
export type MentionsList = z.infer<typeof mentionsListSchema>;

/** Mention offsets are UTF-16 positions into submitted text, shifted with canonical trim. */
function normalizeComment<T extends { body: string; mentions?: MentionSpan[] | undefined }>(input: T): T {
  const leading = input.body.length - input.body.trimStart().length;
  return { ...input, body: input.body.trim(), ...(input.mentions === undefined ? {} : {
    mentions: input.mentions.map((m) => ({ ...m, start: m.start - leading, end: m.end - leading })),
  }) };
}
function validateCommentSpans(input: { body: string; mentions?: MentionSpan[] | undefined }, ctx: z.RefinementCtx): void {
  const splitsPair = (at: number) => at > 0 && at < input.body.length &&
    /[\uD800-\uDBFF]/.test(input.body[at - 1]!) && /[\uDC00-\uDFFF]/.test(input.body[at]!);
  for (const [index, mention] of (input.mentions ?? []).entries()) {
    if (mention.start < 0 || mention.end > input.body.length || splitsPair(mention.start) || splitsPair(mention.end)) {
      ctx.addIssue({ code: 'custom', path: ['mentions', index], message: 'Mention must cover complete UTF-16 characters within the trimmed body' });
    }
  }
}
const commentBodyInput = z.string().refine((body) => body.trim().length > 0, 'Comment body cannot be empty')
  .refine((body) => body.trim().length <= 10000, 'Comment body cannot exceed 10,000 characters');
export const postCommentInputSchema = z.object({
  body: commentBodyInput,
  mentions: mentionsListSchema.optional().default([]),
}).strict().transform(normalizeComment).superRefine(validateCommentSpans);
export type PostCommentInput = z.infer<typeof postCommentInputSchema>;

export const editCommentInputSchema = z.object({
  body: commentBodyInput,
  mentions: mentionsListSchema.optional(),
  expectedVersion: z.number().int().nonnegative(),
}).strict().transform(normalizeComment).superRefine(validateCommentSpans);
export type EditCommentInput = z.infer<typeof editCommentInputSchema>;

// A date-only bound retains the existing inclusive UTC-midnight meaning. Timestamps
// are normalized only for SQL safety (including large valid RFC3339 offset values).
const activityDateBoundSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })])
  .refine((value) => Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)), 'Invalid activity date')
  .transform((value) => value.length === 10 ? value : new Date(value).toISOString());
export const cardActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
const activityFeedQueryBaseSchema = cardActivityQuerySchema.extend({
  projectId: z.string().min(1).optional(),
  cardId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  fromDate: activityDateBoundSchema.optional(),
  toDate: activityDateBoundSchema.optional(),
});
const orderedActivityDates = (query: { fromDate?: string | undefined; toDate?: string | undefined }) =>
  !query.fromDate || !query.toDate || Date.parse(query.fromDate) <= Date.parse(query.toDate);
const activityRangeIssue = { path: ['toDate'], message: 'toDate must not precede fromDate' };
export const activityFeedQuerySchema = activityFeedQueryBaseSchema.refine(orderedActivityDates, activityRangeIssue);
export const projectActivityQuerySchema = activityFeedQueryBaseSchema.omit({ projectId: true })
  .refine(orderedActivityDates, activityRangeIssue);
export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;

export const deleteCommentInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
}).strict();

/** HTTP query integers are decimal digits, never parseInt prefixes or coercible empty text. */
export const commentsQuerySchema = z.object({
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(50),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;
export const deleteCommentQuerySchema = z.object({
  expectedVersion: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number)
    .pipe(z.number().int().nonnegative()).optional(),
}).strict();
export type DeleteCommentQuery = z.infer<typeof deleteCommentQuerySchema>;
export type DeleteCommentInput = z.infer<typeof deleteCommentInputSchema>;

export const commentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  authorId: z.string().min(1),
  body: z.string(),
  mentions: mentionsListSchema,
  version: z.number().int().nonnegative(),
  deletedAt: utcIsoTimestampSchema.nullable(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  author: personDisplaySchema.optional(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentResponseSchema = createDataEnvelopeSchema(commentSchema);
export type CommentResponse = z.infer<typeof commentResponseSchema>;

export const commentListResponseSchema = createPaginatedEnvelopeSchema(commentSchema);
export type CommentListResponse = z.infer<typeof commentListResponseSchema>;

export const activityItemSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1).nullable(),
  projectId: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  safeChanges: z.record(z.string(), z.unknown()),
  createdAt: utcIsoTimestampSchema,
  actor: personDisplaySchema.optional(),
  referencedPeople: z.array(personDisplaySchema).optional(),
  // Optional, additive: set on card-scoped feeds only (the actor already passed that card's check).
  boardId: z.string().min(1).optional(),
  cardKey: z.string().min(1).optional(),
  cardTitle: z.string().min(1).max(200).optional(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activityResponseSchema = createDataEnvelopeSchema(activityItemSchema);
export type ActivityResponse = z.infer<typeof activityResponseSchema>;

export const activityListResponseSchema = createPaginatedEnvelopeSchema(activityItemSchema);
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(4096).optional(),
  unreadOnly: z.enum(['true', 'false']).optional().default('false').transform((value) => value === 'true'),
}).strict();
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const NOTIFICATION_TYPES = ['mention', 'assigned', 'system'] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: notificationTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().max(2000),
  link: z.string().min(1),
  read: z.boolean(),
  createdAt: utcIsoTimestampSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationResponseSchema = createDataEnvelopeSchema(notificationSchema);
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const notificationListResponseSchema = createPaginatedEnvelopeSchema(notificationSchema);
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
