import { z } from 'zod';

export const STANDARD_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STALE_VERSION',
  'STALE_CURSOR',
  'RESTORE_WINDOW_EXPIRED',
  'RESTORE_DESTINATION_REQUIRED',
  'READ_ONLY_CONTEXT',
  'PREVIEW_EXPIRED',
  'PREVIEW_STALE',
  'COMMIT_IN_PROGRESS',
  'ALREADY_FINALIZED',
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const standardErrorCodeSchema = z.enum(STANDARD_ERROR_CODES);
export type StandardErrorCode = z.infer<typeof standardErrorCodeSchema>;

export const errorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const errorEnvelopeSchema = z.object({
  error: errorDetailSchema,
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function createDataEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
  });
}

export function createPaginatedEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}

export function isValidGregorianDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const yearStr = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) return false;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[month - 1];
  if (maxDay === undefined || day > maxDay) return false;
  return true;
}

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format')
  .refine(isValidGregorianDate, { message: 'Must be a valid Gregorian calendar date' });
export type DateOnly = z.infer<typeof dateOnlySchema>;

export const nullableDateOnlySchema = dateOnlySchema.nullable();
export type NullableDateOnly = z.infer<typeof nullableDateOnlySchema>;

export const utcIsoTimestampSchema = z
  .string()
  .refine(
    (val) => {
      if (!val.endsWith('Z')) return false;
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return false;
      return val.includes('T');
    },
    { message: 'Must be a valid UTC ISO 8601 timestamp string ending in Z' },
  );
export type UtcIsoTimestamp = z.infer<typeof utcIsoTimestampSchema>;

export const idempotencyKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._:-]{16,128}$/,
    'Idempotency key must be 16 to 128 ASCII characters consisting of A-Z, a-z, 0-9, dot, underscore, colon, or hyphen',
  );
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const roleSchema = z.enum(['owner', 'manager', 'member', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export const projectRoleSchema = z.enum(['manager', 'member', 'viewer']);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const personDisplaySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(100),
  avatarUrl: z.string().url().nullable(),
  activeInProject: z.boolean(),
  scopedRole: roleSchema.optional(),
  assignable: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});
export type PersonDisplay = z.infer<typeof personDisplaySchema>;

export const mutationReceiptSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative().optional(),
  structureVersion: z.number().int().nonnegative().optional(),
  snapshotVersion: z.number().int().nonnegative().optional(),
  operationId: z.string().optional(),
});
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;

export const mutationResponseSchema = z.object({
  data: mutationReceiptSchema,
  replayed: z.boolean(),
});
export type MutationResponse = z.infer<typeof mutationResponseSchema>;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// Own-projects limits (B-17, edge-case review rules 16-17). 409 for a limit, 429 for speed. The
// error envelope carries them in error.details: { scope, limit, current?, remedy }.
export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED';
export const quotaScopeSchema = z.enum(['owned_projects', 'boards_per_project', 'members', 'pending_invitations', 'owned_projects_total', 'boards_per_project_total']);
export type QuotaScope = z.infer<typeof quotaScopeSchema>;
export const quotaRemedySchema = z.enum(['archive_project', 'archive_board', 'remove_member', 'revoke_invitation', 'none']);
export type QuotaRemedy = z.infer<typeof quotaRemedySchema>;
export const quotaExceededDetailsSchema = z.object({
  scope: quotaScopeSchema,
  limit: z.number().int().positive(),
  // Only when the caller may already see that count (for example the Owner sees board counts).
  current: z.number().int().nonnegative().optional(),
  remedy: quotaRemedySchema,
});
export type QuotaExceededDetails = z.infer<typeof quotaExceededDetailsSchema>;

// Characters refused in names of people, projects and boards (B-16 rule, extended by B-22 to projects and
// boards, edge-case review F-17). Control characters (except a tab, which is whitespace), format characters
// (zero-width, bidirectional overrides and isolates), and line or paragraph separators.
export const REFUSED_NAME_CHARACTERS = /(?!\t)\p{Cc}|[\p{Cf}\p{Zl}\p{Zp}]/u;
export const REFUSED_NAME_MESSAGE = 'Name must not contain control, zero-width or bidirectional characters';
