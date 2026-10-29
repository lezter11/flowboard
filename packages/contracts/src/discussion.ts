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

export const postCommentInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment body cannot be empty')
    .max(10000, 'Comment body cannot exceed 10,000 characters'),
  mentions: mentionsListSchema.optional().default([]),
});
export type PostCommentInput = z.infer<typeof postCommentInputSchema>;

export const editCommentInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment body cannot be empty')
    .max(10000, 'Comment body cannot exceed 10,000 characters'),
  mentions: mentionsListSchema.optional(),
  expectedVersion: z.number().int().nonnegative(),
});
export type EditCommentInput = z.infer<typeof editCommentInputSchema>;

export const deleteCommentInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
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
