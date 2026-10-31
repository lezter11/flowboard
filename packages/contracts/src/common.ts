import { z } from 'zod';

// Every error code the API can return (ERR-R1, S13). The static-scan test in apps/api parses each
// HttpError code literal in apps/api/src and fails when a code is missing from this list. status is the most
// common status the code is sent with; codes sent with more than one status are noted in docs/API.md.
// hasDetails is true when some call site passes a details object.
export const ERROR_CATALOG = {
  ACCESS_CHANGED: { status: 409, hasDetails: false },
  ALREADY_FINALIZED: { status: 409, hasDetails: false },
  ALREADY_MEMBER: { status: 400, hasDetails: false },
  ANCHOR_CARD_NOT_FOUND: { status: 400, hasDetails: false },
  ASSIGNEE_LIMIT_EXCEEDED: { status: 0, hasDetails: false },
  ASSIGNEE_NOT_ELIGIBLE: { status: 422, hasDetails: true },
  BOARD_ARCHIVED: { status: 409, hasDetails: false },
  BOARD_REQUIRED: { status: 422, hasDetails: false },
  CARDS_SHEET_NOT_FOUND: { status: 422, hasDetails: false },
  CARD_ALREADY_TRASHED: { status: 409, hasDetails: false },
  CARD_IS_TRASHED: { status: 400, hasDetails: false },
  CARD_NOT_TRASHED: { status: 400, hasDetails: false },
  CARD_TRASHED: { status: 409, hasDetails: false },
  COLUMN_HAS_ACTIVE_CARDS: { status: 409, hasDetails: false },
  COLUMN_HAS_RESTORABLE_CARDS: { status: 409, hasDetails: false },
  COLUMN_LIMIT_EXCEEDED: { status: 400, hasDetails: false },
  COMMENT_DELETED: { status: 400, hasDetails: false },
  COMMIT_IN_PROGRESS: { status: 409, hasDetails: false },
  CONFIG_ERROR: { status: 503, hasDetails: false },
  CONTENT_MISSING: { status: 400, hasDetails: false },
  CSRF_MISMATCH: { status: 403, hasDetails: false },
  DATABASE_UNAVAILABLE: { status: 0, hasDetails: false },
  DEADLINE_EXCEEDED: { status: 504, hasDetails: true },
  DECOMPRESSION_FAILED: { status: 422, hasDetails: false },
  DESTINATION_COLUMN_MISSING: { status: 409, hasDetails: false },
  DIGEST_MISMATCH: { status: 400, hasDetails: true },
  DUPLICATE_COLUMN_NAME: { status: 409, hasDetails: false },
  DUPLICATE_HEADER: { status: 422, hasDetails: true },
  DUPLICATE_IN_BATCH: { status: 0, hasDetails: false },
  EMAIL_MISMATCH: { status: 403, hasDetails: false },
  EMAIL_NOT_VERIFIED: { status: 403, hasDetails: false },
  EMAIL_REQUIRED: { status: 400, hasDetails: false },
  EMPTY_WORKBOOK: { status: 422, hasDetails: false },
  EXTERNAL_LINKS_REJECTED: { status: 422, hasDetails: false },
  FINAL_COLUMN_CANNOT_BE_DELETED: { status: 400, hasDetails: false },
  FORBIDDEN: { status: 403, hasDetails: true },
  FORMULA_REJECTED: { status: 422, hasDetails: false },
  IDEMPOTENCY_CONFLICT: { status: 409, hasDetails: false },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, hasDetails: false },
  IMAGE_LIMIT_EXCEEDED: { status: 422, hasDetails: true },
  IMPORT_CONFLICT: { status: 0, hasDetails: false },
  IMPORT_HAS_ERRORS: { status: 422, hasDetails: false },
  INTERNAL_ERROR: { status: 500, hasDetails: false },
  INVALID_ACCESS_REVISION: { status: 400, hasDetails: false },
  INVALID_ANCHOR_CARD: { status: 400, hasDetails: false },
  INVALID_CALLBACK: { status: 400, hasDetails: false },
  INVALID_COLUMN_ORDER: { status: 400, hasDetails: false },
  INVALID_CONTENT_TYPE: { status: 400, hasDetails: false },
  INVALID_CURSOR: { status: 400, hasDetails: false },
  INVALID_DATE: { status: 0, hasDetails: false },
  INVALID_DESTINATION: { status: 400, hasDetails: false },
  INVALID_EMAIL_FORMAT: { status: 0, hasDetails: false },
  INVALID_FILE: { status: 400, hasDetails: false },
  INVALID_INVITATION: { status: 400, hasDetails: false },
  INVALID_MOVING_CARD: { status: 400, hasDetails: false },
  INVALID_PRIORITY: { status: 0, hasDetails: false },
  INVALID_STATE: { status: 409, hasDetails: true },
  INVALID_UPLOAD_STATE: { status: 409, hasDetails: true },
  INVALID_WORKBOOK: { status: 422, hasDetails: true },
  INVITATION_ALREADY_EXISTS: { status: 400, hasDetails: false },
  INVITATION_EXPIRED: { status: 400, hasDetails: false },
  INVITATION_SUPERSEDED: { status: 400, hasDetails: false },
  MACRO_OR_EXECUTABLE_REJECTED: { status: 422, hasDetails: false },
  MALFORMED_REQUEST: { status: 400, hasDetails: false },
  MAX_LENGTH_EXCEEDED: { status: 0, hasDetails: false },
  MIGRATION_FAILED: { status: 0, hasDetails: false },
  MISSING_DEFAULT_COLUMN: { status: 400, hasDetails: false },
  MISSING_FILE: { status: 400, hasDetails: false },
  MISSING_REQUIRED_HEADER: { status: 422, hasDetails: false },
  NOT_FOUND: { status: 404, hasDetails: false },
  NO_PREVIOUS_MOVE: { status: 409, hasDetails: false },
  NUMERIC_ID_REJECTED: { status: 0, hasDetails: false },
  OAUTH_ERROR: { status: 400, hasDetails: true },
  OLE_EMBEDDINGS_REJECTED: { status: 422, hasDetails: false },
  PAYLOAD_TOO_LARGE: { status: 413, hasDetails: true },
  PREVIEW_EXPIRED: { status: 410, hasDetails: false },
  PREVIEW_STALE: { status: 409, hasDetails: true },
  QUOTA_EXCEEDED: { status: 409, hasDetails: false },
  RATE_LIMITED: { status: 429, hasDetails: true },
  READ_ONLY_CONTEXT: { status: 409, hasDetails: true },
  REQUIRED: { status: 0, hasDetails: false },
  RESTORE_DESTINATION_REQUIRED: { status: 409, hasDetails: true },
  RESTORE_WINDOW_EXPIRED: { status: 410, hasDetails: true },
  ROW_LIMIT_EXCEEDED: { status: 422, hasDetails: true },
  SERVICE_UNAVAILABLE: { status: 503, hasDetails: false },
  SIZE_MISMATCH: { status: 400, hasDetails: true },
  STALE_ACCESS_REVISION: { status: 409, hasDetails: false },
  STALE_BOARD_VERSION: { status: 409, hasDetails: true },
  STALE_CURSOR: { status: 409, hasDetails: false },
  STALE_VERSION: { status: 409, hasDetails: true },
  TOKEN_EXCHANGE_FAILED: { status: 400, hasDetails: false },
  TRANSFER_OWNERSHIP_RETIRED: { status: 410, hasDetails: false },
  UNAUTHORIZED: { status: 401, hasDetails: false },
  UNKNOWN_HEADER: { status: 422, hasDetails: true },
  UNKNOWN_OR_INELIGIBLE_ASSIGNEE: { status: 0, hasDetails: false },
  UNRECOGNIZED_STATUS: { status: 0, hasDetails: false },
  UNSUPPORTED_WORKSHEET: { status: 422, hasDetails: true },
  UPLOAD_CANCELLED: { status: 409, hasDetails: false },
  UPLOAD_EXPIRED: { status: 400, hasDetails: false },
  USERINFO_FAILED: { status: 400, hasDetails: false },
  VALIDATION_ERROR: { status: 422, hasDetails: true },
  WORKSHEET_NOT_FOUND: { status: 422, hasDetails: true },
  WORKSPACE_CREATE_RETIRED: { status: 410, hasDetails: false },
  XXE_DETECTED: { status: 422, hasDetails: true },
} as const satisfies Record<string, { status: number; hasDetails: boolean }>;

export type ErrorCatalogCode = keyof typeof ERROR_CATALOG;

// The code list, in one place. Kept under its old name for existing imports.
export const STANDARD_ERROR_CODES = Object.keys(ERROR_CATALOG) as [ErrorCatalogCode, ...ErrorCatalogCode[]];
export const standardErrorCodeSchema = z.enum(STANDARD_ERROR_CODES);

// Details schemas (ERR-R1 S13). Passthrough, so a field added later does not break an old client. Codes with
// details but no specific schema use the generic one.
const genericDetails = z.object({}).passthrough();
export const ERROR_DETAILS_SCHEMAS: Partial<Record<ErrorCatalogCode, z.ZodType>> = Object.fromEntries(
  (Object.keys(ERROR_CATALOG) as ErrorCatalogCode[])
    .filter((code) => ERROR_CATALOG[code].hasDetails)
    .map((code) => [code, genericDetails]),
);
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
  // Optional, additive (B-23). Set only when another active member of the same project has the same name:
  // the first keeps no number, then 2, 3 and so on. Absent or null when the name is unique in the project.
  nameSuffix: z.number().int().min(2).nullable().optional(),
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

// Specific details schemas (ERR-R1 S1, S11). Assigned here, after the schemas they reference.
export const assigneeNotEligibleReasonSchema = z.enum(['no_board_access', 'viewer', 'not_active']);
export const assigneeNotEligibleDetailsSchema = z
  .object({
    boardId: z.string().min(1),
    ineligibleUserIds: z.array(z.string().min(1)),
    invalidAssigneeIds: z.array(z.string().min(1)),
    reasons: z.array(z.object({ userId: z.string().min(1), reason: assigneeNotEligibleReasonSchema })),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .passthrough();
Object.assign(ERROR_DETAILS_SCHEMAS, {
  ASSIGNEE_NOT_ELIGIBLE: assigneeNotEligibleDetailsSchema,
  QUOTA_EXCEEDED: quotaExceededDetailsSchema,
  RATE_LIMITED: z
    .object({
      retryAfterSeconds: z.number().int().min(1),
      scope: z.enum(['invitations', 'projects', 'general']).optional(),
    })
    .passthrough(),
  RESTORE_DESTINATION_REQUIRED: z
    .object({
      reason: z.string().min(1),
      boardId: z.string().min(1),
      columns: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
    })
    .passthrough(),
});

// Rate-limit details (ERR-R1 S11): the same shape the RATE_LIMITED entry in ERROR_DETAILS_SCHEMAS describes.
export const rateLimitDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().min(1),
  scope: z.enum(['invitations', 'projects', 'general']).optional(),
}).passthrough();
