import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const imageContentTypeSchema = z.enum(IMAGE_CONTENT_TYPES);
export type ImageContentType = z.infer<typeof imageContentTypeSchema>;

export const MAX_IMAGE_BYTE_LENGTH = 10 * 1024 * 1024; // 10 MiB (10,485,760 bytes)

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export const createImageUploadInputSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, 'Filename cannot be empty')
    .max(255, 'Filename cannot exceed 255 characters')
    .refine((name) => !/[\\/\p{Cc}]/u.test(name), 'Filename cannot contain slashes, backslashes or control characters'),
  byteLength: z
    .number()
    .int()
    .min(1, 'Byte length must be positive')
    .max(MAX_IMAGE_BYTE_LENGTH, 'Image file size cannot exceed 10 MiB (10,485,760 bytes)'),
  contentType: imageContentTypeSchema,
  sha256: z
    .string()
    .regex(SHA256_HEX_REGEX, 'Must be a 64-character hexadecimal SHA-256 digest')
    .toLowerCase(),
});
export type CreateImageUploadInput = z.infer<typeof createImageUploadInputSchema>;

export const IMAGE_UPLOAD_STATES = [
  'awaiting_content',
  'content_received',
  'validating',
  'finalized',
  'failed',
  'cancelled',
  'expired',
] as const;
export const imageUploadStateSchema = z.enum(IMAGE_UPLOAD_STATES);
export type ImageUploadState = z.infer<typeof imageUploadStateSchema>;

export const imageUploadErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type ImageUploadError = z.infer<typeof imageUploadErrorSchema>;

export const imageUploadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  version: z.number().int().nonnegative(),
  state: imageUploadStateSchema,
  expectedBytes: z.number().int().positive(),
  receivedBytes: z.number().int().nonnegative().nullable(),
  expiresAt: utcIsoTimestampSchema,
  serverNow: utcIsoTimestampSchema,
  finalizedImageId: z.string().min(1).nullable(),
  error: imageUploadErrorSchema.nullable(),
});
export type ImageUpload = z.infer<typeof imageUploadSchema>;

export const imageUploadResponseSchema = createDataEnvelopeSchema(imageUploadSchema);
export type ImageUploadResponse = z.infer<typeof imageUploadResponseSchema>;

export const finalizedImageSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  byteLength: z.number().int().positive(),
  contentType: imageContentTypeSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploaderId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
});
export type FinalizedImage = z.infer<typeof finalizedImageSchema>;

export const finalizedImageResponseSchema = createDataEnvelopeSchema(finalizedImageSchema);
export type FinalizedImageResponse = z.infer<typeof finalizedImageResponseSchema>;

export const finalizedImageListResponseSchema = createPaginatedEnvelopeSchema(finalizedImageSchema);
export type FinalizedImageListResponse = z.infer<typeof finalizedImageListResponseSchema>;

export const deleteImageInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export type DeleteImageInput = z.infer<typeof deleteImageInputSchema>;
