import { z } from 'zod';
import { createDataEnvelopeSchema, utcIsoTimestampSchema } from './common.ts';

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_CARD_DOCUMENTS = 10;

export const DOCUMENT_MEDIA_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export const documentMediaTypeSchema = z.enum(DOCUMENT_MEDIA_TYPES);
export type DocumentMediaType = z.infer<typeof documentMediaTypeSchema>;

export const documentFilenameSchema = z.string().min(5).max(160)
  .regex(/^[^\\/]+\.(?:[pP][dD][fF]|[dD][oO][cC][xX]|[xX][lL][sS][xX])$/)
  .refine(filename => !/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(filename), 'Document filenames cannot contain control characters.');

export function documentMediaTypeForFilename(filename: string): DocumentMediaType | null {
  if (!documentFilenameSchema.safeParse(filename).success) return null;
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return DOCUMENT_MEDIA_TYPES[extension as keyof typeof DOCUMENT_MEDIA_TYPES] ?? null;
}

export const cardDocumentSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  filename: documentFilenameSchema,
  mediaType: documentMediaTypeSchema,
  byteLength: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  originalByteLength: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  createdAt: utcIsoTimestampSchema,
  uploaderId: z.string().min(1),
  canRemove: z.boolean(),
}).refine(document => document.mediaType === documentMediaTypeForFilename(document.filename), {
  path: ['mediaType'], message: 'Document media type must match the filename extension.',
});
export type CardDocument = z.infer<typeof cardDocumentSchema>;

export const cardDocumentResponseSchema = createDataEnvelopeSchema(cardDocumentSchema);
export const cardDocumentsResponseSchema = createDataEnvelopeSchema(z.object({
  items: z.array(cardDocumentSchema).max(MAX_CARD_DOCUMENTS),
  count: z.number().int().min(0).max(MAX_CARD_DOCUMENTS),
  canUpload: z.boolean(),
}));
export const cardDocumentDeleteResponseSchema = createDataEnvelopeSchema(z.object({
  id: z.string().min(1), success: z.literal(true),
}));
