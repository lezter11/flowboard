// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/limits.ts
var DEFAULT_LIMITS = Object.freeze({
  ownedProjects: 3,
  boardsPerProject: 5,
  membersPerProject: 50,
  pendingInvitesPerProject: 50,
  ownedProjectsTotal: 20,
  boardsPerProjectTotal: 25
});
var LIMIT_ENV_NAMES = Object.freeze({
  ownedProjects: "FB_LIMIT_OWNED_PROJECTS",
  boardsPerProject: "FB_LIMIT_BOARDS_PER_PROJECT",
  membersPerProject: "FB_LIMIT_MEMBERS_PER_PROJECT",
  pendingInvitesPerProject: "FB_LIMIT_PENDING_INVITES_PER_PROJECT",
  ownedProjectsTotal: "FB_LIMIT_OWNED_PROJECTS_TOTAL",
  boardsPerProjectTotal: "FB_LIMIT_BOARDS_PER_PROJECT_TOTAL"
});
function limitsOf(c) {
  return c.get("limits") ?? { ...DEFAULT_LIMITS };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/app.ts
import { Hono as Hono17 } from "hono";
import { cors } from "hono/cors";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/correlation.ts
var REQUEST_ID_HEADER = "x-request-id";
var REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{8,64}$/;
function isValidRequestId(id) {
  return typeof id === "string" && REQUEST_ID_REGEX.test(id);
}
var correlationMiddleware = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header(REQUEST_ID_HEADER, requestId);
  await next();
  c.header(REQUEST_ID_HEADER, requestId);
};

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/timing.ts
var timingMiddleware = async (c, next) => {
  const start = performance.now();
  try {
    await next();
  } finally {
    const elapsed = (performance.now() - start).toFixed(2);
    const metric = `app;dur=${elapsed}`;
    const existing = c.res.headers.get("Server-Timing");
    c.header("Server-Timing", existing ? `${existing}, ${metric}` : metric);
  }
};

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/limits.ts
import { bodyLimit } from "hono/body-limit";
import { timeout } from "hono/timeout";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/errors.ts
import { HTTPException } from "hono/http-exception";
var HttpError = class _HttpError extends HTTPException {
  code;
  details;
  constructor(status, code, message, details) {
    super(status, { message });
    this.name = "HttpError";
    this.code = code;
    this.details = details;
  }
  static badRequest(first = "Malformed request.", second, third) {
    let code = "MALFORMED_REQUEST";
    let message = "Malformed request.";
    let details;
    if (typeof second === "string") {
      if (/^[A-Z0-9_]+$/.test(first) && !/^[A-Z0-9_]+$/.test(second)) {
        code = first;
        message = second;
      } else {
        message = first;
        code = second;
      }
      details = third;
    } else {
      if (/^[A-Z0-9_]+$/.test(first)) {
        code = first;
      } else {
        message = first;
      }
      details = second;
    }
    return new _HttpError(400, code, message, details);
  }
  static unauthorized(message = "Invalid or missing authentication session.", code = "UNAUTHORIZED") {
    return new _HttpError(401, code, message);
  }
  static forbidden(message = "Insufficient permissions for this resource.", code = "FORBIDDEN") {
    return new _HttpError(403, code, message);
  }
  static notFound(first = "Route or resource not found.", second) {
    let code = "NOT_FOUND";
    let message = "Route or resource not found.";
    if (second) {
      if (/^[A-Z0-9_]+$/.test(second)) {
        message = first;
        code = second;
      } else {
        code = first;
        message = second;
      }
    } else if (/^[A-Z0-9_]+$/.test(first)) {
      code = first;
    } else {
      message = first;
    }
    return new _HttpError(404, code, message);
  }
  static conflict(first = "CONFLICT", second, third) {
    let code = "CONFLICT";
    let message = "Resource conflict or stale version.";
    let details;
    if (typeof second === "string") {
      if (/^[A-Z0-9_]+$/.test(first) && !/^[A-Z0-9_]+$/.test(second)) {
        code = first;
        message = second;
      } else {
        message = first;
        code = second;
      }
      details = third;
    } else {
      if (/^[A-Z0-9_]+$/.test(first)) {
        code = first;
      } else {
        message = first;
      }
      details = second;
    }
    return new _HttpError(409, code, message, details);
  }
  static payloadTooLarge(message = "Payload too large.", code = "PAYLOAD_TOO_LARGE") {
    return new _HttpError(413, code, message);
  }
  static internal(message = "Internal server error.", code = "INTERNAL_ERROR") {
    return new _HttpError(500, code, message);
  }
  static unprocessableEntity(first = "Unprocessable entity.", second, third) {
    return _HttpError.unprocessable(first, second, third);
  }
  static unprocessable(first = "Unprocessable entity.", second, third) {
    let code = "VALIDATION_ERROR";
    let message = "Unprocessable entity.";
    let details;
    if (typeof second === "string") {
      if (/^[A-Z0-9_]+$/.test(first) && !/^[A-Z0-9_]+$/.test(second)) {
        code = first;
        message = second;
      } else {
        message = first;
        code = second;
      }
      details = third;
    } else if (second && typeof second === "object") {
      message = first;
      details = second;
    } else if (/^[A-Z0-9_]+$/.test(first)) {
      code = first;
    } else {
      message = first;
    }
    return new _HttpError(422, code, message, details);
  }
  static serviceUnavailable(first = "SERVICE_UNAVAILABLE", second) {
    let code = "SERVICE_UNAVAILABLE";
    let message = "Service is temporarily unavailable.";
    if (second) {
      if (/^[A-Z0-9_]+$/.test(first)) {
        code = first;
        message = second;
      } else {
        message = first;
        code = second;
      }
    } else if (/^[A-Z0-9_]+$/.test(first)) {
      code = first;
    } else {
      message = first;
    }
    return new _HttpError(503, code, message);
  }
};
function validationError(message = "Validation failed.", details) {
  return new HttpError(422, "VALIDATION_ERROR", message, details);
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/limits.ts
var DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
var DEFAULT_DEADLINE_MS = 5e3;
var MULTIPART_ALLOWANCE_BYTES = 64 * 1024;
var IMPORT_BODY_LIMIT_BYTES = 5 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES;
var IMAGE_BODY_LIMIT_BYTES = 10 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES;
var SESSION_COOKIE = /(^|;\s*)(flowboard_session|session)=/;
function bodyLimitFor(method, path3, cookieHeader, defaultBytes = DEFAULT_BODY_LIMIT_BYTES) {
  if (!SESSION_COOKIE.test(cookieHeader ?? "")) return defaultBytes;
  if (method === "POST" && /^\/api\/v1\/boards\/[^/]+\/(card-)?imports$/.test(path3)) return IMPORT_BODY_LIMIT_BYTES;
  if (method === "PUT" && /^\/api\/v1\/image-uploads\/[^/]+\/content$/.test(path3)) return IMAGE_BODY_LIMIT_BYTES;
  return defaultBytes;
}
function routeBodyLimitMiddleware(defaultBytes = DEFAULT_BODY_LIMIT_BYTES) {
  const limiters = /* @__PURE__ */ new Map();
  return (c, next) => {
    const bytes = bodyLimitFor(c.req.method, c.req.path, c.req.header("cookie"), defaultBytes);
    let limiter = limiters.get(bytes);
    if (!limiter) {
      limiter = bodyLimitMiddleware(bytes);
      limiters.set(bytes, limiter);
    }
    return limiter(c, next);
  };
}
function bodyLimitMiddleware(maxBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new HttpError(
        413,
        "PAYLOAD_TOO_LARGE",
        "The request is too large."
      );
    }
  });
}
function deadlineMiddleware(deadlineMs = DEFAULT_DEADLINE_MS) {
  return timeout(
    deadlineMs,
    () => new HttpError(504, "DEADLINE_EXCEEDED", "The request took too long. Try again.")
  );
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/error-handler.ts
import { HTTPException as HTTPException2 } from "hono/http-exception";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/common.ts
import { z } from "zod";
var ERROR_CATALOG = {
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
  XXE_DETECTED: { status: 422, hasDetails: true }
};
var STANDARD_ERROR_CODES = Object.keys(ERROR_CATALOG);
var standardErrorCodeSchema = z.enum(STANDARD_ERROR_CODES);
var genericDetails = z.object({}).passthrough();
var ERROR_DETAILS_SCHEMAS = Object.fromEntries(
  Object.keys(ERROR_CATALOG).filter((code) => ERROR_CATALOG[code].hasDetails).map((code) => [code, genericDetails])
);
var errorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()).optional()
});
var errorEnvelopeSchema = z.object({
  error: errorDetailSchema
});
function createDataEnvelopeSchema(dataSchema) {
  return z.object({
    data: dataSchema
  });
}
function createPaginatedEnvelopeSchema(itemSchema) {
  return z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable()
  });
}
function isValidGregorianDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split("-");
  const yearStr = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];
  if (yearStr === void 0 || monthStr === void 0 || dayStr === void 0) return false;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const isLeap = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[month - 1];
  if (maxDay === void 0 || day > maxDay) return false;
  return true;
}
var dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format").refine(isValidGregorianDate, { message: "Must be a valid Gregorian calendar date" });
var nullableDateOnlySchema = dateOnlySchema.nullable();
var utcIsoTimestampSchema = z.string().refine(
  (val) => {
    if (!val.endsWith("Z")) return false;
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return false;
    return val.includes("T");
  },
  { message: "Must be a valid UTC ISO 8601 timestamp string ending in Z" }
);
var idempotencyKeySchema = z.string().regex(
  /^[A-Za-z0-9._:-]{16,128}$/,
  "Idempotency key must be 16 to 128 ASCII characters consisting of A-Z, a-z, 0-9, dot, underscore, colon, or hyphen"
);
var roleSchema = z.enum(["owner", "manager", "member", "viewer"]);
var projectRoleSchema = z.enum(["manager", "member", "viewer"]);
var personDisplaySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(100),
  avatarUrl: z.string().url().nullable(),
  activeInProject: z.boolean(),
  scopedRole: roleSchema.optional(),
  assignable: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  // Optional, additive (B-23). Set only when another active member of the same project has the same name:
  // the first keeps no number, then 2, 3 and so on. Absent or null when the name is unique in the project.
  nameSuffix: z.number().int().min(2).nullable().optional()
});
var mutationReceiptSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative().optional(),
  structureVersion: z.number().int().nonnegative().optional(),
  snapshotVersion: z.number().int().nonnegative().optional(),
  operationId: z.string().optional()
});
var mutationResponseSchema = z.object({
  data: mutationReceiptSchema,
  replayed: z.boolean()
});
var paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional()
});
var quotaScopeSchema = z.enum(["owned_projects", "boards_per_project", "members", "pending_invitations", "owned_projects_total", "boards_per_project_total"]);
var quotaRemedySchema = z.enum(["archive_project", "archive_board", "remove_member", "revoke_invitation", "none"]);
var quotaExceededDetailsSchema = z.object({
  scope: quotaScopeSchema,
  limit: z.number().int().positive(),
  // Only when the caller may already see that count (for example the Owner sees board counts).
  current: z.number().int().nonnegative().optional(),
  remedy: quotaRemedySchema
});
var REFUSED_NAME_CHARACTERS = /(?!\t)\p{Cc}|[\p{Cf}\p{Zl}\p{Zp}]/u;
var REFUSED_NAME_MESSAGE = "Name must not contain control, zero-width or bidirectional characters";
var assigneeNotEligibleReasonSchema = z.enum(["no_board_access", "viewer", "not_active"]);
var assigneeNotEligibleDetailsSchema = z.object({
  boardId: z.string().min(1),
  ineligibleUserIds: z.array(z.string().min(1)),
  invalidAssigneeIds: z.array(z.string().min(1)),
  reasons: z.array(z.object({ userId: z.string().min(1), reason: assigneeNotEligibleReasonSchema })),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional()
}).passthrough();
Object.assign(ERROR_DETAILS_SCHEMAS, {
  ASSIGNEE_NOT_ELIGIBLE: assigneeNotEligibleDetailsSchema,
  QUOTA_EXCEEDED: quotaExceededDetailsSchema,
  RATE_LIMITED: z.object({
    retryAfterSeconds: z.number().int().min(1),
    scope: z.enum(["invitations", "projects", "general"]).optional()
  }).passthrough(),
  RESTORE_DESTINATION_REQUIRED: z.object({
    reason: z.string().min(1),
    boardId: z.string().min(1),
    columns: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
  }).passthrough()
});
var rateLimitDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().min(1),
  scope: z.enum(["invitations", "projects", "general"]).optional()
}).passthrough();

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/auth.ts
import { z as z2 } from "zod";
var sessionActorSchema = z2.object({
  id: z2.string().min(1),
  email: z2.string().email(),
  displayName: z2.string().trim().min(1).max(121),
  avatarUrl: z2.string().url().nullable()
});
var sessionWorkspaceSummarySchema = z2.object({
  id: z2.string().min(1),
  name: z2.string().trim().min(1).max(100),
  timezone: z2.string().min(1).max(100),
  version: z2.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var sessionProjectSummarySchema = z2.object({
  id: z2.string().min(1),
  workspaceId: z2.string().min(1),
  // Optional, additive (B-17). True when the caller owns the project's workspace. Drives Yours and Shared with you.
  isOwned: z2.boolean().optional(),
  name: z2.string().trim().min(1).max(100),
  description: z2.string().max(2e3).nullable(),
  // Optional, additive: set only when the caller can read that board, else null.
  defaultBoardId: z2.string().min(1).nullable().optional(),
  role: roleSchema,
  isArchived: z2.boolean(),
  version: z2.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var lastLocationSchema = z2.object({
  projectId: z2.string().min(1),
  boardId: z2.string().min(1).nullable()
});
var updateLastLocationInputSchema = z2.object({
  projectId: z2.string().min(1).max(200),
  boardId: z2.string().min(1).max(200).nullable().optional()
}).strict();
var lastLocationResponseSchema = z2.object({
  data: lastLocationSchema
});
var NAME_PART_MAX = 60;
function normalizeNamePart(value) {
  if (REFUSED_NAME_CHARACTERS.test(value)) return null;
  const collapsed = value.trim().replace(/\s+/gu, " ");
  const length = [...collapsed].length;
  return length >= 1 && length <= NAME_PART_MAX ? collapsed : null;
}
var namePartSchema = z2.string().superRefine((value, ctx) => {
  if (REFUSED_NAME_CHARACTERS.test(value)) {
    ctx.addIssue({ code: "custom", message: "Name must not contain control, zero-width or bidirectional characters" });
  } else if (normalizeNamePart(value) === null) {
    ctx.addIssue({ code: "custom", message: "Name must be 1 to 60 characters" });
  }
}).transform((value) => normalizeNamePart(value) ?? "");
var saveNameInputSchema = z2.object({
  firstName: namePartSchema,
  lastName: namePartSchema
}).strict();
var saveNameResponseSchema = z2.object({
  data: z2.object({
    actor: sessionActorSchema,
    firstName: z2.string().min(1).max(NAME_PART_MAX),
    lastName: z2.string().min(1).max(NAME_PART_MAX),
    needsName: z2.literal(false)
  })
});
var NAME_REQUIRED_CODE = "NAME_REQUIRED";
var sessionLimitsSchema = z2.object({
  ownedProjects: z2.object({ limit: z2.number().int().positive(), used: z2.number().int().nonnegative() }),
  boardsPerProject: z2.object({ limit: z2.number().int().positive() }),
  membersPerProject: z2.object({ limit: z2.number().int().positive() }),
  pendingInvitationsPerProject: z2.object({ limit: z2.number().int().positive() })
});
var sessionDataSchema = z2.object({
  actor: sessionActorSchema,
  ownedWorkspaces: z2.array(sessionWorkspaceSummarySchema),
  accessibleProjects: z2.array(sessionProjectSummarySchema),
  lastLocation: lastLocationSchema.nullable().optional(),
  // Optional, additive (B-17). Effective limits, so the UI never hardcodes them.
  limits: sessionLimitsSchema.optional(),
  // True until the user saves a first and last name (name_confirmed_at is null). Google's given and
  // family name are suggestions only: they arrive as suggestedFirstName and suggestedLastName.
  needsName: z2.boolean(),
  suggestedFirstName: z2.string().min(1).max(NAME_PART_MAX).nullable(),
  suggestedLastName: z2.string().min(1).max(NAME_PART_MAX).nullable()
});
var getSessionResponseSchema = z2.object({
  data: sessionDataSchema
});
var logoutResponseSchema = z2.object({
  data: z2.object({
    success: z2.literal(true)
  })
});
var PROFILE_DISPLAY_NAME_MAX = 80;
var updateProfileInputSchema = z2.object({
  displayName: z2.string().refine((value) => !/\p{Cc}/u.test(value), { message: "Display name must not contain control characters" }).trim().min(1, "Display name cannot be empty").max(PROFILE_DISPLAY_NAME_MAX, "Display name cannot exceed 80 characters")
}).strict();

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/workspaces.ts
import { z as z3 } from "zod";
var createWorkspaceInputSchema = z3.object({
  name: z3.string().trim().min(1, "Workspace name cannot be empty").max(100, "Workspace name cannot exceed 100 characters"),
  timezone: z3.string().trim().min(1, "Timezone cannot be empty").max(100, "Timezone cannot exceed 100 characters")
});
var updateWorkspaceInputSchema = z3.object({
  name: z3.string().trim().min(1).max(100).optional(),
  timezone: z3.string().trim().min(1).max(100).optional(),
  expectedVersion: z3.number().int().nonnegative()
}).refine((data) => data.name !== void 0 || data.timezone !== void 0, {
  message: "At least one field (name or timezone) must be provided to update"
});
var transferWorkspaceOwnershipInputSchema = z3.object({
  targetUserId: z3.string().min(1, "Target user ID is required"),
  expectedVersion: z3.number().int().nonnegative()
});
var workspaceSchema = z3.object({
  id: z3.string().min(1),
  name: z3.string().trim().min(1).max(100),
  timezone: z3.string().min(1).max(100),
  ownerId: z3.string().min(1),
  version: z3.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var workspaceResponseSchema = createDataEnvelopeSchema(workspaceSchema);
var workspaceListResponseSchema = createPaginatedEnvelopeSchema(workspaceSchema);

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/projects.ts
import { z as z4 } from "zod";
var PROJECT_BRIEF_MAX = 5e3;
var PROJECT_LINKS_MAX = 10;
var PROJECT_LINK_URL_MAX = 2e3;
function isSafeHttpsUrl(value) {
  if (value.length > PROJECT_LINK_URL_MAX || /\s/.test(value)) return false;
  if (!/^https:\/\/[^/]/i.test(value)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "";
}
var projectLinkInputSchema = z4.object({
  title: z4.string().trim().min(1, "Link title cannot be empty").max(100, "Link title cannot exceed 100 characters"),
  url: z4.string().trim().max(PROJECT_LINK_URL_MAX, "Link URL cannot exceed 2000 characters").refine(isSafeHttpsUrl, { message: "Links must be https URLs without a username or password" })
});
var projectLinkSchema = z4.object({
  id: z4.string().min(1),
  title: z4.string().min(1).max(100),
  url: z4.string().min(1).max(PROJECT_LINK_URL_MAX),
  position: z4.number().int().nonnegative()
});
var createProjectInputSchema = z4.object({
  name: z4.string().refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE }).trim().min(1, "Project name cannot be empty").max(100, "Project name cannot exceed 100 characters"),
  description: z4.string().max(2e3, "Description cannot exceed 2000 characters").optional()
});
var updateProjectInputSchema = z4.object({
  name: z4.string().refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE }).trim().min(1).max(100).optional(),
  description: z4.string().max(2e3, "Description cannot exceed 2000 characters").nullable().optional(),
  brief: z4.string().max(PROJECT_BRIEF_MAX, "Brief cannot exceed 5000 characters").nullable().optional(),
  links: z4.array(projectLinkInputSchema).max(PROJECT_LINKS_MAX, "A project can have at most 10 links").optional(),
  defaultBoardId: z4.string().min(1).max(200).nullable().optional(),
  expectedVersion: z4.number().int().nonnegative()
}).refine(
  (data) => data.name !== void 0 || data.description !== void 0 || data.brief !== void 0 || data.links !== void 0 || data.defaultBoardId !== void 0,
  { message: "At least one field (name, description, brief, links or defaultBoardId) must be provided to update" }
);
var projectLifecycleInputSchema = z4.object({
  expectedVersion: z4.number().int().nonnegative()
});
var projectMemberStatusSchema = z4.enum(["active", "removed"]);
var updateProjectMemberInputSchema = z4.object({
  role: projectRoleSchema,
  status: projectMemberStatusSchema,
  expectedVersion: z4.number().int().nonnegative()
});
var projectMemberSchema = z4.object({
  id: z4.string().min(1),
  projectId: z4.string().min(1),
  userId: z4.string().min(1),
  role: projectRoleSchema,
  status: projectMemberStatusSchema,
  version: z4.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  user: personDisplaySchema.optional()
});
var projectSchema = z4.object({
  id: z4.string().min(1),
  workspaceId: z4.string().min(1),
  name: z4.string().trim().min(1).max(100),
  description: z4.string().max(2e3).nullable(),
  // Optional, additive. The landing board id only when the caller can read that board; otherwise null.
  defaultBoardId: z4.string().min(1).nullable().optional(),
  // Optional, additive. Returned by the single-project read and the PATCH response only.
  brief: z4.string().max(PROJECT_BRIEF_MAX).nullable().optional(),
  links: z4.array(projectLinkSchema).max(PROJECT_LINKS_MAX).optional(),
  isArchived: z4.boolean(),
  version: z4.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var projectOverviewSchema = z4.object({
  projectId: z4.string().min(1),
  asOfDate: dateOnlySchema,
  readableBoardCount: z4.number().int().nonnegative(),
  cards: z4.object({
    active: z4.number().int().nonnegative(),
    byCategory: z4.object({
      todo: z4.number().int().nonnegative(),
      active: z4.number().int().nonnegative(),
      done: z4.number().int().nonnegative()
    }),
    // Open means the card's column is not in the done category.
    overdue: z4.number().int().nonnegative(),
    dueSoon: z4.number().int().nonnegative(),
    unassignedOpen: z4.number().int().nonnegative()
  }),
  // Open cards per assignee, highest first, at most 50 people.
  assignees: z4.array(z4.object({
    userId: z4.string().min(1),
    displayName: z4.string().min(1),
    avatarUrl: z4.string().nullable(),
    openCount: z4.number().int().nonnegative()
  })).max(50),
  // Last 10 activity rows: board rows on readable boards; project-scope rows for owner and managers only (B-6). cardId is null for non-card rows.
  recentActivity: z4.array(z4.object({
    id: z4.string().min(1),
    action: z4.string().min(1),
    cardId: z4.string().min(1).nullable(),
    createdAt: utcIsoTimestampSchema,
    actor: z4.object({ id: z4.string().min(1), displayName: z4.string().min(1) })
  })).max(10)
});
var projectOverviewResponseSchema = createDataEnvelopeSchema(projectOverviewSchema);
var projectResponseSchema = createDataEnvelopeSchema(projectSchema);
var projectListResponseSchema = createPaginatedEnvelopeSchema(projectSchema);
var projectMemberListResponseSchema = createPaginatedEnvelopeSchema(projectMemberSchema);
var projectDirectoryMemberSchema = z4.object({
  id: z4.string().min(1),
  userId: z4.string().min(1).optional(),
  name: z4.string().min(1),
  displayName: z4.string().min(1).optional(),
  email: z4.string().email(),
  avatarUrl: z4.string().nullable().optional(),
  role: roleSchema,
  status: projectMemberStatusSchema,
  version: z4.number().int().nonnegative(),
  membershipId: z4.string().optional()
});
var projectDirectoryResponseSchema = createPaginatedEnvelopeSchema(projectDirectoryMemberSchema);
var projectPeoplePurposeSchema = z4.enum(["display", "assignee", "mention"]);
var projectPeopleQuerySchema = z4.object({
  purpose: projectPeoplePurposeSchema.default("display").optional(),
  boardId: z4.string().min(1).max(200).optional(),
  cardId: z4.string().min(1).max(200).optional(),
  query: z4.string().trim().max(100).optional(),
  cursor: z4.string().min(1).optional(),
  limit: z4.coerce.number().int().min(1).max(100).default(50).optional()
});
var projectPeopleResponseSchema = createPaginatedEnvelopeSchema(personDisplaySchema);
var projectAccessSummarySchema = z4.object({
  projectId: z4.string().min(1),
  projectName: z4.string().min(1),
  workspaceId: z4.string().min(1),
  workspaceName: z4.string().min(1),
  workspaceOwner: z4.object({
    id: z4.string().min(1),
    displayName: z4.string().min(1),
    avatarUrl: z4.string().url().nullable(),
    role: z4.literal("owner"),
    inherited: z4.literal(true),
    disclosure: z4.string().min(1)
  }),
  actor: z4.object({
    id: z4.string().min(1),
    role: projectRoleSchema.or(z4.literal("owner")),
    inheritedFrom: z4.enum(["workspace_owner", "project_membership"])
  }),
  boardInheritance: z4.object({
    model: z4.literal("explicit_board_grants"),
    allBoardsInherit: z4.literal(false),
    hasBoardOnlyExceptions: z4.literal(true),
    boardCount: z4.number().int().nonnegative(),
    disclosure: z4.string().min(1)
  }),
  memberSummary: z4.object({
    activeManagers: z4.number().int().nonnegative(),
    activeMembers: z4.number().int().nonnegative(),
    activeViewers: z4.number().int().nonnegative(),
    totalActiveMembers: z4.number().int().nonnegative()
  })
});
var projectAccessSummaryResponseSchema = createDataEnvelopeSchema(projectAccessSummarySchema);
var createOwnProjectInputSchema = createProjectInputSchema.strict();
var createOwnProjectResponseSchema = z4.object({
  data: projectSchema,
  replayed: z4.boolean().optional()
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/invitations.ts
import { z as z5 } from "zod";
var EMAIL_LOCAL_ATOM = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
var EMAIL_DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
var EMAIL_TLD = /^[a-z]{2,63}$/;
var EMAIL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
var EMAIL_REFUSED_CHARACTERS = /[\u0000-\u0020\u007f-\uffff<>"(),;:[\]\\]/;
function isValidInvitationEmail(value) {
  if (value.length > 254 || EMAIL_REFUSED_CHARACTERS.test(value)) return false;
  const at = value.indexOf("@");
  if (at === -1 || value.indexOf("@", at + 1) !== -1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0 || local.length > 64 || domain.length === 0 || domain.length > 255) return false;
  if (!local.split(".").every((atom) => EMAIL_LOCAL_ATOM.test(atom))) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))) return false;
  return EMAIL_TLD.test(labels[labels.length - 1]);
}
var createInvitationInputSchema = z5.object({
  email: z5.string().refine((value) => !EMAIL_CONTROL_CHARACTERS.test(value), { message: "Invalid email address format" }).trim().max(254, "Email must not exceed 254 characters").toLowerCase().refine(isValidInvitationEmail, { message: "Invalid email address format" }),
  role: projectRoleSchema
});
var acceptInvitationInputSchema = z5.object({
  token: z5.string().trim().min(16, "Invitation token is too short").max(128, "Invitation token is too long")
});
var invitationStatusSchema = z5.enum(["pending", "accepted", "revoked", "expired"]);
var invitationSchema = z5.object({
  id: z5.string().min(1),
  projectId: z5.string().min(1),
  email: z5.string().email(),
  role: projectRoleSchema,
  status: invitationStatusSchema,
  invitedBy: z5.string().min(1),
  expiresAt: utcIsoTimestampSchema,
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  token: z5.string().optional()
});
var invitationResponseSchema = createDataEnvelopeSchema(invitationSchema);
var invitationListResponseSchema = createPaginatedEnvelopeSchema(invitationSchema);
var acceptInvitationResultSchema = z5.object({
  success: z5.boolean().optional(),
  projectId: z5.string().min(1),
  workspaceId: z5.string().min(1).optional(),
  role: projectRoleSchema,
  membershipId: z5.string().min(1).optional()
});
var acceptInvitationResponseSchema = createDataEnvelopeSchema(acceptInvitationResultSchema);
var revokeInvitationResultSchema = z5.object({
  success: z5.boolean(),
  id: z5.string().min(1),
  status: z5.literal("revoked")
});
var revokeInvitationResponseSchema = createDataEnvelopeSchema(revokeInvitationResultSchema);
var leaveProjectResultSchema = z5.object({
  success: z5.boolean()
});
var leaveProjectResponseSchema = createDataEnvelopeSchema(leaveProjectResultSchema);

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/cards.ts
import { z as z6 } from "zod";
var CARD_PRIORITIES = ["none", "low", "medium", "high", "urgent"];
var prioritySchema = z6.enum(CARD_PRIORITIES);
var CARD_STATES = ["active", "trashed", "purged"];
var cardStateSchema = z6.enum(CARD_STATES);
var createCardInputSchema = z6.object({
  title: z6.string().trim().min(1, "Card title cannot be empty").max(200, "Card title cannot exceed 200 characters"),
  columnId: z6.string().min(1, "Column ID is required"),
  description: z6.string().max(2e4, "Description cannot exceed 20,000 characters").optional().default(""),
  priority: prioritySchema.optional().default("none"),
  dueDate: nullableDateOnlySchema.optional().default(null),
  assigneeIds: z6.array(z6.string().min(1)).max(20, "At most 20 assignees can be assigned").refine((items) => new Set(items).size === items.length, {
    message: "Assignee IDs must be unique"
  }).optional().default([]),
  expectedBoardVersion: z6.number().int().nonnegative()
});
var updateCardInputSchema = z6.object({
  title: z6.string().trim().min(1, "Card title cannot be empty").max(200, "Card title cannot exceed 200 characters").optional(),
  description: z6.string().max(2e4, "Description cannot exceed 20,000 characters").nullable().optional(),
  priority: prioritySchema.optional(),
  dueDate: nullableDateOnlySchema.optional(),
  assigneeIds: z6.array(z6.string().min(1)).max(20, "At most 20 assignees can be assigned").refine((items) => new Set(items).size === items.length, {
    message: "Assignee IDs must be unique"
  }).optional(),
  expectedVersion: z6.number().int().nonnegative()
}).refine(
  (data) => data.title !== void 0 || data.description !== void 0 || data.priority !== void 0 || data.dueDate !== void 0 || data.assigneeIds !== void 0,
  { message: "At least one field to update must be provided" }
);
var moveCardInputSchema = z6.object({
  toColumnId: z6.string().min(1, "Destination column ID is required"),
  previousCardId: z6.string().min(1).nullable(),
  nextCardId: z6.string().min(1).nullable(),
  expectedVersion: z6.number().int().nonnegative(),
  expectedBoardVersion: z6.number().int().nonnegative()
});
var cardSummarySchema = z6.object({
  id: z6.string().min(1),
  boardId: z6.string().min(1),
  columnId: z6.string().min(1),
  title: z6.string().trim().min(1).max(200),
  // Added optionally (additive): human key such as WEB-101, and up to 160 plain-text characters.
  key: z6.string().min(1).optional(),
  descriptionExcerpt: z6.string().max(160).optional(),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z6.array(z6.string().min(1)),
  position: z6.number().int().nonnegative(),
  version: z6.number().int().nonnegative(),
  commentCount: z6.number().int().nonnegative(),
  imageCount: z6.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var cardSchema = z6.object({
  id: z6.string().min(1),
  key: z6.string().min(1).optional(),
  // Null for cards created before creator tracking, or when no creation fact exists.
  createdBy: personDisplaySchema.nullable().optional(),
  workspaceId: z6.string().min(1),
  projectId: z6.string().min(1),
  boardId: z6.string().min(1),
  columnId: z6.string().min(1),
  title: z6.string().trim().min(1).max(200),
  description: z6.string().max(2e4),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z6.array(z6.string().min(1)),
  position: z6.number().int().nonnegative(),
  version: z6.number().int().nonnegative(),
  state: cardStateSchema,
  deletedAt: utcIsoTimestampSchema.nullable(),
  deletedBy: z6.string().min(1).nullable(),
  restoreUntil: utcIsoTimestampSchema.nullable(),
  commentCount: z6.number().int().nonnegative(),
  imageCount: z6.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var cardResponseSchema = createDataEnvelopeSchema(cardSchema);
var cardListResponseSchema = createPaginatedEnvelopeSchema(cardSummarySchema);
var cardDueFilterSchema = z6.enum(["overdue", "today", "upcoming", "none"]);
var cardsQuerySchema = z6.object({
  columnId: z6.string().min(1).optional(),
  query: z6.string().trim().max(100).optional(),
  priority: prioritySchema.optional(),
  assigneeId: z6.string().min(1).optional(),
  due: cardDueFilterSchema.optional(),
  cursor: z6.string().min(1).optional(),
  limit: z6.coerce.number().int().min(1).max(100).default(50).optional()
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/boards.ts
import { z as z7 } from "zod";
var COLUMN_CATEGORIES = ["todo", "active", "done"];
var columnCategorySchema = z7.enum(COLUMN_CATEGORIES);
var createBoardInputSchema = z7.object({
  name: z7.string().refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE }).trim().min(1, "Board name cannot be empty").max(100, "Board name cannot exceed 100 characters"),
  // Optional. Same rule as project descriptions: plain text, up to 2000 characters.
  description: z7.string().max(2e3, "Description cannot exceed 2000 characters").optional()
});
var updateBoardInputSchema = z7.object({
  name: z7.string().refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE }).trim().min(1, "Board name cannot be empty").max(100, "Board name cannot exceed 100 characters").optional(),
  description: z7.string().max(2e3, "Description cannot exceed 2000 characters").nullable().optional(),
  expectedVersion: z7.number().int().nonnegative()
}).refine((data) => data.name !== void 0 || data.description !== void 0, {
  message: "At least one field (name or description) must be provided to update"
});
var boardLifecycleInputSchema = z7.object({
  expectedVersion: z7.number().int().nonnegative()
});
var boardSchema = z7.object({
  id: z7.string().min(1),
  workspaceId: z7.string().min(1),
  projectId: z7.string().min(1),
  name: z7.string().trim().min(1).max(100),
  // Optional, additive: the API always returns it (null when unset).
  description: z7.string().max(2e3).nullable().optional(),
  isArchived: z7.boolean(),
  structureVersion: z7.number().int().nonnegative(),
  snapshotVersion: z7.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var boardResponseSchema = createDataEnvelopeSchema(boardSchema);
var boardListResponseSchema = createPaginatedEnvelopeSchema(boardSchema);
var columnSchema = z7.object({
  id: z7.string().min(1),
  boardId: z7.string().min(1),
  name: z7.string().trim().min(1, "Column name cannot be empty").max(80, "Column name cannot exceed 80 characters"),
  category: columnCategorySchema,
  color: z7.string().trim().min(1).max(30),
  position: z7.number().int().nonnegative(),
  activeCardCount: z7.number().int().nonnegative(),
  matchingCardCount: z7.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema
});
var createColumnInputSchema = z7.object({
  name: z7.string().trim().min(1, "Column name cannot be empty").max(80, "Column name cannot exceed 80 characters"),
  color: z7.string().trim().min(1, "Color cannot be empty").max(30, "Color string cannot exceed 30 characters"),
  category: columnCategorySchema,
  expectedBoardVersion: z7.number().int().nonnegative()
});
var updateColumnInputSchema = z7.object({
  name: z7.string().trim().min(1).max(80).optional(),
  color: z7.string().trim().min(1).max(30).optional(),
  category: columnCategorySchema.optional(),
  expectedBoardVersion: z7.number().int().nonnegative()
}).refine(
  (data) => data.name !== void 0 || data.color !== void 0 || data.category !== void 0,
  { message: "At least one field (name, color, or category) must be provided to update" }
);
var reorderColumnsInputSchema = z7.object({
  columnIds: z7.array(z7.string().min(1)).min(1, "Must specify at least one column").max(12, "Cannot exceed 12 columns on a board").refine((ids) => new Set(ids).size === ids.length, {
    message: "Column IDs must be unique"
  }),
  expectedBoardVersion: z7.number().int().nonnegative()
});
var deleteColumnInputSchema = z7.object({
  expectedBoardVersion: z7.number().int().nonnegative()
});
var placementInputSchema = z7.object({
  movingCardId: z7.string().min(1, "Moving card ID is required"),
  at: z7.enum(["first", "last", "before", "after"]),
  anchorCardId: z7.string().min(1).optional()
}).refine(
  (data) => data.at === "before" || data.at === "after" ? data.anchorCardId !== void 0 : true,
  { message: 'anchorCardId is required when placement position is "before" or "after"' }
);
var placementResultSchema = z7.object({
  movingCardId: z7.string().min(1),
  toColumnId: z7.string().min(1),
  previousCardId: z7.string().min(1).nullable(),
  nextCardId: z7.string().min(1).nullable(),
  structureVersion: z7.number().int().nonnegative()
});
var placementResponseSchema = createDataEnvelopeSchema(placementResultSchema);
var COLUMN_TONES = [
  "lavender",
  "ice",
  "grey",
  "green",
  "coral",
  "rose",
  "mint",
  "peach",
  "butter",
  "lilac"
];
var columnToneSchema = z7.enum(COLUMN_TONES);
var columnSummarySchema = z7.object({
  id: z7.string().min(1),
  name: z7.string().trim().min(1).max(80),
  category: columnCategorySchema,
  color: z7.string().trim().min(1).max(30),
  // Optional, additive: stored named tone, or absent when not set.
  tone: columnToneSchema.nullable().optional(),
  position: z7.number().int().nonnegative(),
  activeCardCount: z7.number().int().nonnegative(),
  matchingCardCount: z7.number().int().nonnegative(),
  cards: z7.array(cardSummarySchema),
  nextCursor: z7.string().nullable()
});
var boardFiltersSchema = z7.object({
  titleQuery: z7.string().nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  assigneeId: z7.string().nullable().optional(),
  due: z7.string().nullable().optional()
});
var boardSnapshotTotalsSchema = z7.object({
  activeCardCount: z7.number().int().nonnegative(),
  matchingCardCount: z7.number().int().nonnegative(),
  // Optional, additive: active cards outside done columns due before the workspace's today, and
  // due within the next 7 days (inclusive). Ignore filters; computed for the whole board.
  overdueCount: z7.number().int().nonnegative().optional(),
  dueSoonCount: z7.number().int().nonnegative().optional()
});
var boardSnapshotDataSchema = z7.object({
  board: boardSchema,
  filters: boardFiltersSchema,
  asOfDate: dateOnlySchema,
  totals: boardSnapshotTotalsSchema,
  columns: z7.array(columnSummarySchema).max(12, "A board cannot have more than 12 columns"),
  people: z7.array(personDisplaySchema)
});
var boardSnapshotResponseSchema = createDataEnvelopeSchema(boardSnapshotDataSchema);
var boardSnapshotQuerySchema = z7.object({
  titleQuery: z7.string().trim().optional(),
  priority: prioritySchema.optional(),
  assigneeId: z7.string().min(1).optional(),
  due: z7.string().optional(),
  cardLimitPerColumn: z7.coerce.number().int().min(1).max(15).default(10).optional()
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/discussion.ts
import { z as z8 } from "zod";
var mentionSpanSchema = z8.object({
  userId: z8.string().min(1, "User ID is required"),
  start: z8.number().int().nonnegative("Start offset must be non-negative"),
  end: z8.number().int().positive("End offset must be positive")
}).refine((data) => data.start < data.end, {
  message: "Start offset must be strictly less than end offset"
});
function validateNoOverlappingMentions(mentions) {
  if (mentions.length <= 1) return true;
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current !== void 0 && next !== void 0 && current.end > next.start) {
      return false;
    }
  }
  return true;
}
var mentionsListSchema = z8.array(mentionSpanSchema).max(20, "At most 20 mentions are allowed per comment").refine(validateNoOverlappingMentions, {
  message: "Mentions must not overlap"
});
var postCommentInputSchema = z8.object({
  body: z8.string().trim().min(1, "Comment body cannot be empty").max(1e4, "Comment body cannot exceed 10,000 characters"),
  mentions: mentionsListSchema.optional().default([])
});
var editCommentInputSchema = z8.object({
  body: z8.string().trim().min(1, "Comment body cannot be empty").max(1e4, "Comment body cannot exceed 10,000 characters"),
  mentions: mentionsListSchema.optional(),
  expectedVersion: z8.number().int().nonnegative()
});
var deleteCommentInputSchema = z8.object({
  expectedVersion: z8.number().int().nonnegative()
});
var commentSchema = z8.object({
  id: z8.string().min(1),
  projectId: z8.string().min(1),
  cardId: z8.string().min(1),
  authorId: z8.string().min(1),
  body: z8.string(),
  mentions: mentionsListSchema,
  version: z8.number().int().nonnegative(),
  deletedAt: utcIsoTimestampSchema.nullable(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  author: personDisplaySchema.optional()
});
var commentResponseSchema = createDataEnvelopeSchema(commentSchema);
var commentListResponseSchema = createPaginatedEnvelopeSchema(commentSchema);
var activityItemSchema = z8.object({
  id: z8.string().min(1),
  cardId: z8.string().min(1).nullable(),
  projectId: z8.string().min(1),
  actorId: z8.string().min(1),
  action: z8.string().min(1),
  safeChanges: z8.record(z8.string(), z8.unknown()),
  createdAt: utcIsoTimestampSchema,
  actor: personDisplaySchema.optional(),
  // Optional, additive: set on card-scoped feeds only (the actor already passed that card's check).
  boardId: z8.string().min(1).optional(),
  cardKey: z8.string().min(1).optional(),
  cardTitle: z8.string().min(1).max(200).optional()
});
var activityResponseSchema = createDataEnvelopeSchema(activityItemSchema);
var activityListResponseSchema = createPaginatedEnvelopeSchema(activityItemSchema);
var NOTIFICATION_TYPES = ["mention", "assigned", "system"];
var notificationTypeSchema = z8.enum(NOTIFICATION_TYPES);
var notificationSchema = z8.object({
  id: z8.string().min(1),
  userId: z8.string().min(1),
  type: notificationTypeSchema,
  title: z8.string().min(1).max(200),
  body: z8.string().max(2e3),
  link: z8.string().min(1),
  read: z8.boolean(),
  createdAt: utcIsoTimestampSchema
});
var notificationResponseSchema = createDataEnvelopeSchema(notificationSchema);
var notificationListResponseSchema = createPaginatedEnvelopeSchema(notificationSchema);

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/images.ts
import { z as z9 } from "zod";
var IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
var imageContentTypeSchema = z9.enum(IMAGE_CONTENT_TYPES);
var MAX_IMAGE_BYTE_LENGTH = 10 * 1024 * 1024;
var SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
var createImageUploadInputSchema = z9.object({
  filename: z9.string().trim().min(1, "Filename cannot be empty").max(255, "Filename cannot exceed 255 characters").refine((name) => !/[\\/\p{Cc}]/u.test(name), "Filename cannot contain slashes, backslashes or control characters"),
  byteLength: z9.number().int().min(1, "Byte length must be positive").max(MAX_IMAGE_BYTE_LENGTH, "Image file size cannot exceed 10 MiB (10,485,760 bytes)"),
  contentType: imageContentTypeSchema,
  sha256: z9.string().regex(SHA256_HEX_REGEX, "Must be a 64-character hexadecimal SHA-256 digest").toLowerCase()
});
var IMAGE_UPLOAD_STATES = [
  "awaiting_content",
  "content_received",
  "validating",
  "finalized",
  "failed",
  "cancelled",
  "expired"
];
var imageUploadStateSchema = z9.enum(IMAGE_UPLOAD_STATES);
var imageUploadErrorSchema = z9.object({
  code: z9.string(),
  message: z9.string(),
  retryable: z9.boolean()
});
var imageUploadSchema = z9.object({
  id: z9.string().min(1),
  projectId: z9.string().min(1),
  cardId: z9.string().min(1),
  version: z9.number().int().nonnegative(),
  state: imageUploadStateSchema,
  expectedBytes: z9.number().int().positive(),
  receivedBytes: z9.number().int().nonnegative().nullable(),
  expiresAt: utcIsoTimestampSchema,
  serverNow: utcIsoTimestampSchema,
  finalizedImageId: z9.string().min(1).nullable(),
  error: imageUploadErrorSchema.nullable()
});
var imageUploadResponseSchema = createDataEnvelopeSchema(imageUploadSchema);
var finalizedImageSchema = z9.object({
  id: z9.string().min(1),
  projectId: z9.string().min(1),
  cardId: z9.string().min(1),
  filename: z9.string().trim().min(1).max(255),
  byteLength: z9.number().int().positive(),
  contentType: imageContentTypeSchema,
  width: z9.number().int().positive().nullable(),
  height: z9.number().int().positive().nullable(),
  sha256: z9.string().regex(/^[a-f0-9]{64}$/),
  uploaderId: z9.string().min(1),
  version: z9.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema
});
var finalizedImageResponseSchema = createDataEnvelopeSchema(finalizedImageSchema);
var finalizedImageListResponseSchema = createPaginatedEnvelopeSchema(finalizedImageSchema);
var deleteImageInputSchema = z9.object({
  expectedVersion: z9.number().int().nonnegative()
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/trash.ts
import { z as z10 } from "zod";
var softDeleteCardInputSchema = z10.object({
  expectedVersion: z10.number().int().nonnegative(),
  expectedBoardVersion: z10.number().int().nonnegative()
});
var restoreCardInputSchema = z10.object({
  expectedVersion: z10.number().int().nonnegative(),
  expectedBoardVersion: z10.number().int().nonnegative(),
  toColumnId: z10.string().min(1).optional()
});
var TRASH_BLOCKED_REASONS = [
  "window_expired",
  "project_archived",
  "board_archived",
  "destination_missing"
];
var trashBlockedReasonSchema = z10.enum(TRASH_BLOCKED_REASONS).nullable();
var trashRowSchema = z10.object({
  id: z10.string().min(1),
  title: z10.string().trim().min(1).max(200),
  // Optional, additive: human key such as WEB-101.
  key: z10.string().min(1).optional(),
  projectId: z10.string().min(1),
  boardId: z10.string().min(1),
  originalColumnId: z10.string().min(1),
  version: z10.number().int().nonnegative(),
  structureVersion: z10.number().int().nonnegative(),
  deletedAt: utcIsoTimestampSchema,
  deletedBy: z10.string().min(1),
  restoreUntil: utcIsoTimestampSchema,
  canRestore: z10.boolean(),
  blockedReason: trashBlockedReasonSchema,
  actor: personDisplaySchema.optional()
});
var trashListResponseSchema = z10.object({
  data: z10.array(trashRowSchema),
  nextCursor: z10.string().nullable(),
  serverNow: utcIsoTimestampSchema
});
var restoreWindowExpiredDetailsSchema = z10.object({
  serverNow: utcIsoTimestampSchema,
  restoreUntil: utcIsoTimestampSchema
});
var restoreDestinationRequiredDetailsSchema = z10.object({
  reason: z10.literal("destination_missing"),
  boardId: z10.string().min(1)
});
var readOnlyContextDetailsSchema = z10.object({
  reason: z10.enum(["project_archived", "board_archived"]),
  contextId: z10.string().min(1)
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/imports.ts
import { z as z11 } from "zod";
var IMPORT_STATES = [
  "uploaded",
  "validating",
  "invalid",
  "ready",
  "committing",
  "committed",
  "failed",
  "cancelled",
  "expired"
];
var importStateSchema = z11.enum(IMPORT_STATES);
var IMPORT_ROW_OUTCOMES = [
  "new",
  "already_imported",
  "invalid",
  "conflict",
  "created",
  "skipped"
];
var importRowOutcomeSchema = z11.enum(IMPORT_ROW_OUTCOMES);
var importRowErrorSchema = z11.object({
  field: z11.string().min(1),
  code: z11.string().min(1),
  message: z11.string().min(1)
});
var importRowSchema = z11.object({
  rowNumber: z11.number().int().positive(),
  externalId: z11.string().trim().min(1).max(64),
  title: z11.string().trim().min(1).max(200),
  status: z11.string().trim().nullable(),
  priority: prioritySchema,
  dueDate: nullableDateOnlySchema,
  assigneeIds: z11.array(z11.string().min(1)),
  outcome: importRowOutcomeSchema,
  errors: z11.array(importRowErrorSchema),
  cardId: z11.string().min(1).nullable()
});
var importCountsSchema = z11.object({
  total: z11.number().int().nonnegative(),
  new: z11.number().int().nonnegative(),
  existing: z11.number().int().nonnegative(),
  invalid: z11.number().int().nonnegative(),
  conflict: z11.number().int().nonnegative(),
  created: z11.number().int().nonnegative(),
  skipped: z11.number().int().nonnegative()
});
var importStatusErrorSchema = z11.object({
  code: z11.string(),
  message: z11.string()
});
var importStatusSchema = z11.object({
  id: z11.string().min(1),
  projectId: z11.string().min(1),
  boardId: z11.string().min(1),
  defaultColumnId: z11.string().min(1),
  version: z11.number().int().nonnegative(),
  state: importStateSchema,
  previewDigest: z11.string().min(1).nullable(),
  expiresAt: utcIsoTimestampSchema.nullable(),
  serverNow: utcIsoTimestampSchema,
  counts: importCountsSchema,
  canCommit: z11.boolean(),
  cancellationAllowed: z11.boolean(),
  rows: z11.array(importRowSchema),
  nextCursor: z11.string().nullable(),
  error: importStatusErrorSchema.nullable()
});
var importStatusResponseSchema = createDataEnvelopeSchema(importStatusSchema);
var commitImportInputSchema = z11.object({
  previewDigest: z11.string().min(1, "Preview digest is required"),
  defaultColumnId: z11.string().min(1, "Default column ID is required"),
  expectedVersion: z11.number().int().nonnegative()
});
var updateImportMappingsInputSchema = z11.object({
  mappings: z11.record(z11.string(), z11.string().min(1)),
  expectedVersion: z11.number().int().nonnegative()
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/packages/contracts/src/index.ts
function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code
  }));
}
var ValidationError = class extends Error {
  issues;
  constructor(issues) {
    super(`Validation failed: ${issues.map((f) => `${f.path || "(root)"}: ${f.message}`).join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
};
function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/error-handler.ts
var STATUS_TO_DEFAULT_CODE = {
  400: "MALFORMED_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "RESTORE_WINDOW_EXPIRED",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
  504: "DEADLINE_EXCEEDED"
};
var errorHandler = (err, c) => {
  const requestId = c.get("requestId") || crypto.randomUUID();
  c.header(REQUEST_ID_HEADER, requestId);
  c.header("Cache-Control", "no-store");
  if (err instanceof ValidationError || err instanceof Error && err.name === "ValidationError") {
    const issues = "issues" in err && Array.isArray(err.issues) ? err.issues : [];
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: err.message || "Validation failed.",
          requestId,
          details: { issues }
        }
      },
      422
    );
  }
  if (err instanceof SyntaxError || err instanceof Error && err.name === "SyntaxError") {
    return c.json(
      {
        error: {
          code: "MALFORMED_REQUEST",
          message: "Malformed JSON payload in request body.",
          requestId
        }
      },
      400
    );
  }
  if (err instanceof HttpError) {
    if (err.status === 429) {
      const retry = err.details?.["retryAfterSeconds"];
      c.header("Retry-After", typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? String(Math.ceil(retry)) : "60");
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...err.details ? { details: err.details } : {}
        }
      },
      err.status
    );
  }
  if (err instanceof HTTPException2) {
    const status = err.status;
    const defaultCode = STATUS_TO_DEFAULT_CODE[status] || (status >= 500 ? "INTERNAL_ERROR" : "MALFORMED_REQUEST");
    if (status === 429) {
      c.header("Retry-After", "60");
    }
    if (status >= 500) {
      return c.json(
        {
          error: {
            code: defaultCode,
            message: status === 503 ? "Service is temporarily unavailable." : "Internal server error.",
            requestId
          }
        },
        status
      );
    }
    return c.json(
      {
        error: {
          code: defaultCode,
          message: err.message || "Request failed.",
          requestId
        }
      },
      status
    );
  }
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
    const status = err.status;
    const code = "code" in err && typeof err.code === "string" ? err.code : STATUS_TO_DEFAULT_CODE[status] || "INTERNAL_ERROR";
    if (status === 429) {
      c.header("Retry-After", "60");
    }
    if (status >= 500 && status !== 503 && status !== 504) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
            requestId
          }
        },
        500
      );
    }
    const message = err.message || "Request failed.";
    const details = "details" in err && typeof err.details === "object" ? err.details : void 0;
    return c.json(
      {
        error: {
          code,
          message,
          requestId,
          ...details ? { details } : {}
        }
      },
      status
    );
  }
  const pgCode = typeof err === "object" && err !== null && "code" in err ? err.code : void 0;
  if (pgCode === "40P01" || pgCode === "40001") {
    c.header("Retry-After", "1");
    return c.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The request conflicted with another update. Retry shortly.",
          requestId
        }
      },
      503
    );
  }
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        requestId
      }
    },
    500
  );
};
var notFoundHandler = (c) => {
  const requestId = c.get("requestId") || crypto.randomUUID();
  c.header(REQUEST_ID_HEADER, requestId);
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId
      }
    },
    404
  );
};

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/auth.ts
import { getCookie } from "hono/cookie";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/session.ts
import crypto2 from "node:crypto";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/postgres.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/runtime/local-config.ts
var LOCAL_DATABASE_URL = "postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55432/flowboard_harness";
function localDatabaseUrl(value = LOCAL_DATABASE_URL) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Database connection URL must use postgres: or postgresql: protocol");
  }
  const isRemoteAllowed = process.env["NODE_ENV"] === "production" || process.env["ALLOW_REMOTE_DB"] === "true" || Boolean(process.env["FLY_APP_NAME"] || process.env["RAILWAY_ENVIRONMENT"]);
  if (isRemoteAllowed) {
    return value;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/flowboard_harness" || url.username !== "flowboard_harness" || url.search !== "") {
    throw new Error("FND-01 requires the local flowboard_harness database and user");
  }
  return value;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/postgres.ts
var globalPool = null;
var poolStorage = new AsyncLocalStorage();
function createPool(connectionString, maxConnections = 4) {
  const isLocal = connectionString.includes("127.0.0.1") || connectionString.includes("localhost");
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: isLocal ? 2e3 : 1e4,
    idleTimeoutMillis: 1e4,
    statement_timeout: isLocal ? 3e3 : 15e3,
    query_timeout: isLocal ? 4e3 : 15e3,
    application_name: "flowboard-api"
  });
  pool.on("error", () => console.error("Idle PostgreSQL connection failed"));
  return pool;
}
function getPool(target) {
  if (target && typeof target === "object") {
    if ("query" in target && typeof target.query === "function") {
      return target;
    }
    if ("get" in target && typeof target.get === "function") {
      const contextPool2 = target.get("pool");
      if (contextPool2) return contextPool2;
    }
  }
  const contextPool = poolStorage.getStore();
  if (contextPool) return contextPool;
  if (globalPool) return globalPool;
  const connStr = localDatabaseUrl(typeof target === "string" ? target : process.env["DATABASE_URL"]);
  globalPool = createPool(connStr, 4);
  return globalPool;
}
function setGlobalPool(pool) {
  globalPool = pool;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/session.ts
function isLocalhost(hostOrHostname) {
  if (!hostOrHostname) {
    return process.env.NODE_ENV !== "production";
  }
  let host = hostOrHostname;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
    }
  }
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    if (endBracket !== -1) {
      host = host.substring(1, endBracket);
      return host === "::1";
    }
  }
  const [hostnamePart = ""] = host.split(":");
  const hostname = hostnamePart.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
function getSessionCookieOptions(hostOrHostname) {
  const local = isLocalhost(hostOrHostname);
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: !local,
    maxAge: 7 * 24 * 3600
  };
}
function getClearSessionCookieOptions(hostOrHostname) {
  const local = isLocalhost(hostOrHostname);
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: !local,
    maxAge: 0
  };
}
async function getUserByEmail(email, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `SELECT id, email, display_name, avatar_url
     FROM users
     WHERE email = $1`,
    [email]
  );
  const row = res.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null
  };
}
function hashSessionToken(token) {
  return crypto2.createHash("sha256").update(token).digest("hex");
}
async function createSession(userId, ttlHours = 24 * 7, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const rawToken = crypto2.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1e3);
  const res = await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at, created_at`,
    [tokenHash, userId, expiresAt.toISOString(), now.toISOString()]
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error("Failed to create session");
  }
  return {
    id: rawToken,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString()
  };
}
async function getSessionWithUser(sessionIdOrToken, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const tokenHash = hashSessionToken(sessionIdOrToken);
  const res = await pool.query(
    `SELECT 
       s.id AS session_id,
       s.user_id,
       s.expires_at,
       s.created_at AS session_created_at,
       u.email,
       u.display_name,
       u.avatar_url
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );
  const row = res.rows[0];
  if (!row) {
    return null;
  }
  return {
    session: {
      id: row.session_id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.session_created_at).toISOString()
    },
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null
    }
  };
}
async function revokeSession(storedSessionId, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  await pool.query("DELETE FROM sessions WHERE id = $1", [storedSessionId]);
}
async function createDevUserAndSession(email, displayName, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const userId = `usr_${crypto2.randomBytes(8).toString("hex")}`;
  const [first, ...rest] = displayName.trim().split(/\s+/);
  const firstName = normalizeNamePart(first ?? "") ?? "User";
  const lastName = normalizeNamePart(rest.join(" ")) ?? firstName;
  const userRes = await pool.query(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at, first_name, last_name, name_confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)
     ON CONFLICT (email) DO UPDATE SET
       display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
       updated_at = EXCLUDED.updated_at
     RETURNING id, email, display_name, avatar_url`,
    [userId, email, displayName, null, now, now, firstName, lastName]
  );
  const userRow = userRes.rows[0];
  if (!userRow) {
    throw new Error("Failed to create or update user");
  }
  const session = await createSession(userRow.id, 24 * 7, pool);
  return {
    session,
    user: {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      avatarUrl: userRow.avatar_url ?? null
    }
  };
}
async function updateUserProfile(userId, input, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const fields = ["display_name = $1", "updated_at = NOW()"];
  const values = [input.displayName.trim()];
  const idx = 2;
  values.push(userId);
  const res = await pool.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${idx}
     RETURNING id, email, display_name, avatar_url`,
    values
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error("User not found");
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null
  };
}
async function readNameState(userId, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    "SELECT first_name, last_name, name_confirmed_at FROM users WHERE id = $1",
    [userId]
  );
  const row = res.rows[0];
  const confirmed = row?.name_confirmed_at != null;
  return {
    needsName: !confirmed,
    suggestedFirstName: confirmed ? null : row?.first_name ?? null,
    suggestedLastName: confirmed ? null : row?.last_name ?? null
  };
}
async function saveUserName(userId, firstName, lastName, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `UPDATE users
     SET first_name = $2,
         last_name = $3,
         display_name = $4,
         name_confirmed_at = COALESCE(name_confirmed_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, display_name, avatar_url`,
    [userId, firstName, lastName, `${firstName} ${lastName}`]
  );
  const row = res.rows[0];
  if (!row) throw new Error("User not found");
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url ?? null };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/auth.ts
var SESSION_COOKIE_NAME = "flowboard_session";
var authMiddleware = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, "session");
  if (!sessionId) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const sessionData = await getSessionWithUser(sessionId);
  if (!sessionData) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  c.set("actor", sessionData.user);
  c.set("sessionId", sessionData.session.id);
  await next();
};
var optionalAuthMiddleware = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME) || getCookie(c, "session");
  if (sessionId) {
    const sessionData = await getSessionWithUser(sessionId);
    if (sessionData) {
      c.set("actor", sessionData.user);
      c.set("sessionId", sessionData.session.id);
    }
  }
  await next();
};

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/board-assignees.ts
async function boardAssigneeIds(db, projectId, boardId) {
  const res = await db.query(
    `SELECT w.owner_id AS id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1
     UNION
     SELECT pm.user_id AS id
     FROM project_memberships pm
     JOIN board_grants bg ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id AND bg.board_id = $2
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.role IN ('manager', 'member')`,
    [projectId, boardId]
  );
  return new Set(res.rows.map((row) => row.id));
}
async function assigneeIneligibilityReasons(db, projectId, boardId, userIds) {
  const eligible = await boardAssigneeIds(db, projectId, boardId);
  const refused = userIds.filter((id) => !eligible.has(id));
  if (refused.length === 0) return [];
  const res = await db.query(
    `SELECT pm.user_id, pm.role, pm.status,
            EXISTS (SELECT 1 FROM board_grants bg
                    WHERE bg.board_id = $2 AND bg.project_id = pm.project_id AND bg.user_id = pm.user_id) AS granted
     FROM project_memberships pm
     WHERE pm.project_id = $1 AND pm.user_id = ANY($3::text[])`,
    [projectId, boardId, refused]
  );
  const byUser = new Map(res.rows.map((r) => [r.user_id, r]));
  return refused.map((userId) => {
    const row = byUser.get(userId);
    if (!row || row.status !== "active") return { userId, reason: "not_active" };
    if (row.role === "viewer") return { userId, reason: "viewer" };
    if (!row.granted) return { userId, reason: "no_board_access" };
    return { userId, reason: "not_active" };
  });
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/person-suffix.ts
function nameKey(name) {
  return name.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
async function projectNameSuffixes(db, projectId) {
  const res = await db.query(
    `SELECT u.id AS user_id, u.display_name, TRUE AS is_owner, w.created_at AS joined_at, u.id AS tiebreak
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     JOIN users u ON u.id = w.owner_id
     WHERE p.id = $1
     UNION ALL
     SELECT u.id AS user_id, u.display_name, FALSE AS is_owner, pm.created_at AS joined_at, u.id AS tiebreak
     FROM project_memberships pm
     JOIN projects p ON p.id = pm.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> w.owner_id`,
    [projectId]
  );
  const ordered = [...res.rows].sort((a, b) => {
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    const byTime = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    if (byTime !== 0) return byTime;
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
  });
  const groups = /* @__PURE__ */ new Map();
  for (const row of ordered) {
    const key = nameKey(row.display_name);
    const list = groups.get(key) ?? [];
    list.push(row.user_id);
    groups.set(key, list);
  }
  const suffixes = /* @__PURE__ */ new Map();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, index) => {
      if (index >= 1) suffixes.set(id, index + 1);
    });
  }
  return suffixes;
}
function withNameSuffix(person, suffixes) {
  const suffix = suffixes.get(person.id);
  return suffix === void 0 ? person : { ...person, nameSuffix: suffix };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/default-board.ts
function readableDefaultBoardJoin(actorParam) {
  return `LEFT JOIN boards dbd
            ON dbd.id = p.default_board_id
           AND dbd.project_id = p.id
           AND dbd.archived = FALSE
           AND (w.owner_id = ${actorParam}
                OR EXISTS (
                  SELECT 1 FROM board_grants dbg
                  WHERE dbg.board_id = dbd.id
                    AND dbg.project_id = p.id
                    AND dbg.user_id = ${actorParam}
                ))`;
}
async function readReadableDefaultBoardId(client, projectId, actorId) {
  const res = await client.query(
    `SELECT dbd.id AS default_board_id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     ${readableDefaultBoardJoin("$2")}
     WHERE p.id = $1`,
    [projectId, actorId]
  );
  return res.rows[0]?.default_board_id ?? null;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/rbac.ts
async function resolveProjectRole(projectId, userId, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const prjRes = await pool.query(
    `SELECT p.id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1`,
    [projectId]
  );
  if (prjRes.rows.length === 0) {
    return null;
  }
  if (prjRes.rows[0]?.owner_id === userId) {
    return "owner";
  }
  const memberRes = await pool.query(
    `SELECT role
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
    [projectId, userId]
  );
  if (memberRes.rows.length === 0) {
    return null;
  }
  const role = memberRes.rows[0]?.role;
  return role ?? null;
}
async function getOwnedWorkspaces(userId, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `SELECT id, name, timezone, version, created_at, updated_at
     FROM workspaces
     WHERE owner_id = $1
     ORDER BY name ASC`,
    [userId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
}
async function getAccessibleProjects(userId, clientOrPool) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `SELECT 
       p.id,
       p.workspace_id,
       p.name,
       p.description,
       p.archived,
       p.version,
       p.created_at,
       p.updated_at,
       dbd.id AS default_board_id,
       CASE 
         WHEN w.owner_id = $1 THEN 'owner'
         ELSE pm.role
       END AS role
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     LEFT JOIN project_memberships pm 
       ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
     ${readableDefaultBoardJoin("$1")}
     WHERE w.owner_id = $1 OR (pm.user_id = $1 AND pm.status = 'active')
     ORDER BY p.name ASC`,
    [userId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    isOwned: row.role === "owner",
    name: row.name,
    description: row.description ?? null,
    defaultBoardId: row.default_board_id,
    role: row.role,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
}
var RESOURCE_TABLE_MAP = {
  board: { table: "boards", workspaceCol: "workspace_id", projectCol: "project_id" },
  column: { table: "columns", workspaceCol: "workspace_id", projectCol: "project_id" },
  card: { table: "cards", workspaceCol: "workspace_id", projectCol: "project_id" },
  comment: { table: "comments", workspaceCol: "workspace_id", projectCol: "project_id" },
  image: { table: "card_images", workspaceCol: "workspace_id", projectCol: "project_id" },
  upload: { table: "card_image_uploads", workspaceCol: "workspace_id", projectCol: "project_id" },
  import: { table: "card_imports", workspaceCol: "workspace_id", projectCol: "project_id" }
};
function inferResourceType(resourceId) {
  if (resourceId.startsWith("brd_") || resourceId.startsWith("board_")) return "board";
  if (resourceId.startsWith("col_")) return "column";
  if (resourceId.startsWith("card_") || resourceId.startsWith("crd_")) return "card";
  if (resourceId.startsWith("cmt_") || resourceId.startsWith("comment_")) return "comment";
  if (resourceId.startsWith("img_")) return "image";
  if (resourceId.startsWith("upl_")) return "upload";
  if (resourceId.startsWith("imp_")) return "import";
  return void 0;
}
async function verifyProjectAncestry(clientOrPool, workspaceId, projectId, resource) {
  const pool = clientOrPool ?? getPool();
  const prjRes = await pool.query(
    `SELECT id, workspace_id
     FROM projects
     WHERE id = $1 AND workspace_id = $2`,
    [projectId, workspaceId]
  );
  if (prjRes.rows.length === 0) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  if (!resource) {
    return { projectId, workspaceId };
  }
  const resourceId = typeof resource === "string" ? resource : resource.id;
  const explicitType = typeof resource === "string" ? void 0 : resource.type;
  const resourceType = explicitType ?? inferResourceType(resourceId);
  if (resourceType) {
    const mapping = RESOURCE_TABLE_MAP[resourceType];
    const res = await pool.query(
      `SELECT ${mapping.workspaceCol} AS workspace_id, ${mapping.projectCol} AS project_id
       FROM ${mapping.table}
       WHERE id = $1`,
      [resourceId]
    );
    if (res.rows.length === 0) {
      throw HttpError.notFound("Resource not found.", "NOT_FOUND");
    }
    const row = res.rows[0];
    if (row.workspace_id !== workspaceId || row.project_id !== projectId) {
      throw HttpError.notFound("Resource not found.", "NOT_FOUND");
    }
    return { projectId, workspaceId, resourceId, resourceType };
  }
  const unionRes = await pool.query(
    `SELECT 'board'::TEXT AS res_type, workspace_id, project_id FROM boards WHERE id = $1
     UNION ALL
     SELECT 'column'::TEXT AS res_type, workspace_id, project_id FROM columns WHERE id = $1
     UNION ALL
     SELECT 'card'::TEXT AS res_type, workspace_id, project_id FROM cards WHERE id = $1
     UNION ALL
     SELECT 'comment'::TEXT AS res_type, workspace_id, project_id FROM comments WHERE id = $1
     UNION ALL
     SELECT 'image'::TEXT AS res_type, workspace_id, project_id FROM card_images WHERE id = $1
     UNION ALL
     SELECT 'upload'::TEXT AS res_type, workspace_id, project_id FROM card_image_uploads WHERE id = $1
     UNION ALL
     SELECT 'import'::TEXT AS res_type, workspace_id, project_id FROM card_imports WHERE id = $1`,
    [resourceId]
  );
  if (unionRes.rows.length === 0) {
    throw HttpError.notFound("Resource not found.", "NOT_FOUND");
  }
  const foundRow = unionRes.rows[0];
  if (foundRow.workspace_id !== workspaceId || foundRow.project_id !== projectId) {
    throw HttpError.notFound("Resource not found.", "NOT_FOUND");
  }
  return {
    projectId,
    workspaceId,
    resourceId,
    resourceType: foundRow.res_type
  };
}
async function acquireWriteGrantLock(client, projectId, userId, minRole = "member", boardId) {
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const projectRow = prjRes.rows[0];
  if (boardId) {
    const boardRes = await client.query(
      `SELECT id FROM boards
       WHERE id = $1 AND project_id = $2 AND workspace_id = $3`,
      [boardId, projectId, projectRow.workspace_id]
    );
    if (!boardRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
  }
  if (projectRow.owner_id === userId) {
    return { role: "owner", isOwner: true, ownerId: projectRow.owner_id };
  }
  const memberRes = await client.query(
    `SELECT role, status
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR SHARE`,
    [projectId, userId]
  );
  if (memberRes.rows.length === 0) {
    throw HttpError.notFound("Project not found or access revoked.", "NOT_FOUND");
  }
  const member = memberRes.rows[0];
  if (member.status === "removed") {
    throw HttpError.notFound("Project not found or access revoked.", "NOT_FOUND");
  }
  if (boardId) {
    const grantRes = await client.query(
      `SELECT board_id FROM board_grants
       WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4
       FOR SHARE`,
      [boardId, projectId, projectRow.workspace_id, userId]
    );
    if (!grantRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
  }
  if (member.role === "viewer") {
    throw HttpError.forbidden("Viewers cannot perform write operations.", "FORBIDDEN");
  }
  if (minRole === "manager" && member.role !== "manager") {
    throw HttpError.forbidden("Only a manager or the owner can do this.", "FORBIDDEN");
  }
  return { role: member.role, isOwner: false, ownerId: projectRow.owner_id };
}
async function acquireWritableProjectContextLock(client, projectId, boardId) {
  if (boardId) {
    const contextRes = await client.query(
      `SELECT p.archived AS project_archived, b.archived AS board_archived
       FROM projects p
       JOIN boards b ON b.project_id = p.id
       WHERE p.id = $1 AND b.id = $2
       FOR SHARE OF p
       FOR UPDATE OF b`,
      [projectId, boardId]
    );
    if (!contextRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    if (contextRes.rows[0].project_archived) {
      throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot write in an archived project.", {
        reason: "project_archived",
        contextId: projectId
      });
    }
    if (contextRes.rows[0].board_archived) {
      throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot write on an archived board.", {
        reason: "board_archived",
        contextId: boardId
      });
    }
    return;
  }
  const projectRes = await client.query(
    "SELECT archived FROM projects WHERE id = $1 FOR SHARE",
    [projectId]
  );
  if (!projectRes.rows[0]) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  if (projectRes.rows[0].archived) {
    throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot write in an archived project.", {
      reason: "project_archived",
      contextId: projectId
    });
  }
}
async function getProjectPeople(clientOrPool, projectId, purpose = "display", query, cursor, limit = 50, boardId, actorId) {
  const pool = clientOrPool ?? getPool();
  let boardEligibleIds = null;
  let boardAssignees = null;
  if (boardId) {
    const board = await pool.query(
      `SELECT w.owner_id FROM boards b
       JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE b.id = $1 AND b.project_id = $2 AND b.archived = FALSE`,
      [boardId, projectId]
    );
    if (!board.rows[0]) throw HttpError.notFound("Board not found.", "NOT_FOUND");
    const grants = await pool.query(
      `SELECT bg.user_id FROM board_grants bg
       JOIN project_memberships pm ON pm.project_id = bg.project_id
         AND pm.user_id = bg.user_id AND pm.status = 'active'
       WHERE bg.board_id = $1 AND bg.project_id = $2`,
      [boardId, projectId]
    );
    boardEligibleIds = /* @__PURE__ */ new Set([board.rows[0].owner_id, ...grants.rows.map((row) => row.user_id)]);
    boardAssignees = await boardAssigneeIds(pool, projectId, boardId);
    if (actorId && !boardEligibleIds.has(actorId)) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
  }
  const res = await pool.query(
    `WITH project_context AS (
       SELECT p.id AS project_id, p.workspace_id, w.owner_id AS workspace_owner_id
       FROM projects p
       JOIN workspaces w ON p.workspace_id = w.id
       WHERE p.id = $1
     ),
     all_candidates AS (
       -- 1. Workspace Owner (has permanent owner privileges in this project)
       SELECT 
         u.id,
         u.display_name,
         u.avatar_url,
         'owner'::TEXT AS scoped_role,
         'active'::TEXT AS status,
         1 AS priority
       FROM project_context pc
       JOIN users u ON pc.workspace_owner_id = u.id
       
       UNION ALL
       
       -- 2. Explicit Project Members
       SELECT 
         u.id,
         u.display_name,
         u.avatar_url,
         pm.role::TEXT AS scoped_role,
         pm.status::TEXT AS status,
         2 AS priority
       FROM project_memberships pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1
     ),
     deduped AS (
       SELECT DISTINCT ON (id)
         id,
         display_name,
         avatar_url,
         scoped_role,
         status
       FROM all_candidates
       ORDER BY id, priority ASC
     )
     SELECT id, display_name, avatar_url, scoped_role, status
     FROM deduped
     ORDER BY display_name ASC, id ASC`,
    [projectId]
  );
  let people = res.rows.map((row) => {
    const isActive = row.status === "active";
    const role = row.scoped_role;
    const isWritableRole = role === "owner" || role === "manager" || role === "member";
    const hasBoardAccess = !boardEligibleIds || boardEligibleIds.has(row.id);
    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      activeInProject: isActive,
      scopedRole: role,
      assignable: isActive && isWritableRole && hasBoardAccess && (boardAssignees ? boardAssignees.has(row.id) : true),
      mentionable: isActive && hasBoardAccess
    };
  });
  const suffixes = await projectNameSuffixes(pool, projectId);
  people = people.map((p) => withNameSuffix(p, suffixes));
  if (purpose === "assignee") {
    people = people.filter((p) => p.assignable === true);
  } else if (purpose === "mention") {
    people = people.filter((p) => p.mentionable === true);
  } else {
    people = people.filter((p) => p.activeInProject === true);
  }
  if (query && query.trim().length > 0) {
    const q = query.trim().toLowerCase();
    people = people.filter((p) => p.displayName.toLowerCase().includes(q));
  }
  let startIndex = 0;
  if (cursor) {
    const cursorIdx = people.findIndex((p) => p.id === cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }
  const paginated = people.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < people.length ? paginated[paginated.length - 1]?.id ?? null : null;
  return { data: paginated, nextCursor };
}
async function getEligibleMentionees(clientOrPool, projectId, query, boardId) {
  const { data } = await getProjectPeople(clientOrPool, projectId, "mention", query, void 0, 100, boardId);
  return data;
}
async function getHistoricalPersonDisplay(clientOrPool, projectId, userId) {
  const person = await historicalPersonBase(clientOrPool, projectId, userId);
  if (!person) return null;
  const suffixes = await projectNameSuffixes(clientOrPool ?? getPool(), projectId);
  return withNameSuffix(person, suffixes);
}
async function historicalPersonBase(clientOrPool, projectId, userId) {
  const pool = clientOrPool ?? getPool();
  const prjRes = await pool.query(
    `SELECT w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1`,
    [projectId]
  );
  if (prjRes.rows.length > 0 && prjRes.rows[0]?.owner_id === userId) {
    const userRes = await pool.query(
      "SELECT id, display_name, avatar_url FROM users WHERE id = $1",
      [userId]
    );
    if (userRes.rows.length === 0) return null;
    const u = userRes.rows[0];
    return {
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      activeInProject: true,
      scopedRole: "owner",
      assignable: true,
      mentionable: true
    };
  }
  const memRes = await pool.query(
    `SELECT u.id, u.display_name, u.avatar_url, pm.role, pm.status
     FROM project_memberships pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1 AND pm.user_id = $2`,
    [projectId, userId]
  );
  if (memRes.rows.length === 0) {
    return null;
  }
  const row = memRes.rows[0];
  const isActive = row.status === "active";
  const role = row.role;
  const isWritable = role === "manager" || role === "member";
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    activeInProject: isActive,
    scopedRole: role,
    assignable: isActive && isWritable,
    mentionable: isActive
  };
}
async function getProjectAccessSummary(clientOrPool, projectId, actorId, authorizedBoardIds) {
  const pool = clientOrPool ?? getPool();
  const prjRes = await pool.query(
    `SELECT 
       p.id AS project_id,
       p.name AS project_name,
       p.workspace_id,
       w.name AS workspace_name,
       w.owner_id AS workspace_owner_id,
       u.display_name AS workspace_owner_name,
       u.avatar_url AS workspace_owner_avatar
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     JOIN users u ON w.owner_id = u.id
     WHERE p.id = $1`,
    [projectId]
  );
  if (prjRes.rows.length === 0) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const projectRow = prjRes.rows[0];
  const actorRole = await resolveProjectRole(projectId, actorId, pool);
  if (!actorRole) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const boardCountRes = await pool.query(
    `SELECT COUNT(*)::INT AS board_count
     FROM boards b
     WHERE b.project_id = $1 AND b.archived = FALSE
       AND ($4::text[] IS NULL OR b.id = ANY($4::text[]))
       AND ($3::boolean OR EXISTS (
         SELECT 1 FROM board_grants bg
         JOIN project_memberships pm ON pm.project_id = bg.project_id
           AND pm.user_id = bg.user_id AND pm.status = 'active'
         WHERE bg.board_id = b.id AND bg.project_id = b.project_id
           AND bg.workspace_id = b.workspace_id AND bg.user_id = $2
       ))`,
    [projectId, actorId, actorRole === "owner", authorizedBoardIds ?? null]
  );
  const memberStatsRes = await pool.query(
    `SELECT role, COUNT(*)::INT AS count
     FROM project_memberships
     WHERE project_id = $1 AND status = 'active'
     GROUP BY role`,
    [projectId]
  );
  const roleCounts = { manager: 0, member: 0, viewer: 0 };
  for (const r of memberStatsRes.rows) {
    roleCounts[r.role] = Number(r.count);
  }
  return {
    projectId: projectRow.project_id,
    projectName: projectRow.project_name,
    workspaceId: projectRow.workspace_id,
    workspaceName: projectRow.workspace_name,
    workspaceOwner: {
      id: projectRow.workspace_owner_id,
      displayName: projectRow.workspace_owner_name,
      avatarUrl: projectRow.workspace_owner_avatar,
      role: "owner",
      inherited: true,
      disclosure: "Workspace owner holds full administrative authority across all boards in this project."
    },
    actor: {
      id: actorId,
      role: actorRole,
      inheritedFrom: actorRole === "owner" ? "workspace_owner" : "project_membership"
    },
    boardInheritance: {
      model: "explicit_board_grants",
      allBoardsInherit: false,
      hasBoardOnlyExceptions: true,
      boardCount: Number(boardCountRes.rows[0]?.board_count ?? 0),
      disclosure: "Project membership alone does not grant board access. This count includes only boards you can open; the workspace Owner can open all boards."
    },
    memberSummary: {
      activeManagers: roleCounts["manager"] ?? 0,
      activeMembers: roleCounts["member"] ?? 0,
      activeViewers: roleCounts["viewer"] ?? 0,
      totalActiveMembers: (roleCounts["manager"] ?? 0) + (roleCounts["member"] ?? 0) + (roleCounts["viewer"] ?? 0)
    }
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/origin.ts
var UNSAFE_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function isLocalOrigin(origin) {
  return origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:") || origin.startsWith("https://localhost:");
}
function configuredOrigins(c) {
  const env = c.env;
  const configured = env?.CORS_ORIGIN ?? (typeof process !== "undefined" ? process.env?.["CORS_ORIGIN"] : void 0) ?? "";
  return configured.split(",").map((s) => s.trim()).filter(Boolean);
}
function isTrustedOrigin(origin, c) {
  return isLocalOrigin(origin) || configuredOrigins(c).includes(origin);
}
var originCheckMiddleware = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method) || !/(^|;\s*)(flowboard_session|session)=/.test(c.req.header("cookie") ?? "")) {
    return next();
  }
  const own = new URL(c.req.url).origin;
  const sources = [c.req.header("origin"), c.req.header("referer")];
  const declared = sources.find((value) => value !== void 0 && value !== "");
  if (declared !== void 0) {
    let origin;
    try {
      origin = declared === "null" ? "null" : new URL(declared).origin;
    } catch {
      origin = "null";
    }
    if (origin === own || isTrustedOrigin(origin, c)) return next();
    throw HttpError.forbidden("Cross-site request rejected.", "FORBIDDEN");
  }
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    throw HttpError.forbidden("Cross-site request rejected.", "FORBIDDEN");
  }
  return next();
};

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/rate-limit.ts
var RATE_LIMIT_BINDINGS = {
  FB_RL_WRITES: { limit: 60, periodSeconds: 60 }
};
var SOFT_WRITE_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function softBindingsFor(method, path3) {
  if (path3.startsWith("/health/")) return [];
  return SOFT_WRITE_METHODS.has(method) && path3.startsWith("/api/v1/") ? ["FB_RL_WRITES"] : [];
}
var WINDOW_BUCKETS = {
  auth: { limit: 10, windowSeconds: 60 },
  invite: { limit: 10, windowSeconds: 60 },
  import: { limit: 5, windowSeconds: 60 },
  upload: { limit: 10, windowSeconds: 60 },
  // Invitation scope limits, counted per authenticated inviter and per project on top of the per-IP
  // 'invite' bucket (B-7, FB-AUD-05). Counted only after the actor is shown to hold the grant.
  "invite-inviter": { limit: 20, windowSeconds: 60 },
  "invite-inviter-hour": { limit: 200, windowSeconds: 3600 },
  "invite-project": { limit: 30, windowSeconds: 60 },
  "invite-project-hour": { limit: 300, windowSeconds: 3600 },
  // Own-projects creates, counted per actor id (edge-case review rule 14, F-19).
  "project-create": { limit: 5, windowSeconds: 60 },
  "project-create-hour": { limit: 30, windowSeconds: 3600 },
  "board-create": { limit: 10, windowSeconds: 60 },
  "board-create-hour": { limit: 60, windowSeconds: 3600 }
};
var LONGEST_WINDOW_SECONDS = Math.max(...Object.values(WINDOW_BUCKETS).map((b) => b.windowSeconds));
function windowBucketsFor(method, path3) {
  if (path3.startsWith("/health/")) return [];
  const buckets = [];
  if (path3.startsWith("/api/v1/auth/google")) buckets.push("auth");
  if (method === "POST" && /^\/api\/v1\/projects\/[^/]+\/invitations$/.test(path3)) buckets.push("invite");
  if (method === "POST" && (/^\/api\/v1\/boards\/[^/]+\/(card-)?imports$/.test(path3) || /^\/api\/v1\/(card-)?imports\/[^/]+\/commit$/.test(path3))) {
    buckets.push("import");
  }
  if (method === "POST" && (/^\/api\/v1\/cards\/[^/]+\/image-uploads$/.test(path3) || /^\/api\/v1\/image-uploads\/[^/]+\/finalize$/.test(path3))) {
    buckets.push("upload");
  }
  return buckets;
}
var CLIENT_IP_HEADER = "cf-connecting-ip";
var UNKNOWN_CLIENT_KEY = "unknown-client";
var IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;
function clientKey(headers) {
  const value = headers.get(CLIENT_IP_HEADER)?.trim() ?? "";
  return IP_SHAPE.test(value) ? value : UNKNOWN_CLIENT_KEY;
}
function scopeForBucket(bucket) {
  if (bucket.startsWith("invite")) return "invitations";
  if (bucket.startsWith("project-create")) return "projects";
  return "general";
}
function scopeForPath(path3) {
  if (path3.includes("/invitations")) return "invitations";
  if (path3 === "/api/v1/projects" || /^\/api\/v1\/workspaces\/[^/]+\/projects$/.test(path3)) return "projects";
  return "general";
}
var EDGE_RETRY_AFTER_SECONDS = 60;

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/middleware/rate-limit.ts
function logLine(level, event, fields) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else console.warn(line);
}
function errorClass(error) {
  return error instanceof Error ? error.name : typeof error;
}
function rateLimitMiddleware(resolve, options = {}) {
  return async (c, next) => {
    const bindings = softBindingsFor(c.req.method, c.req.path);
    if (bindings.length === 0) return next();
    const key = clientKey(c.req.raw.headers);
    for (const binding of bindings) {
      const limiter = resolve(c, binding);
      if (!limiter) {
        if (options.bindingsRequired) logLine("error", "rate_limit_binding_absent", { binding });
        continue;
      }
      let success;
      try {
        ({ success } = await limiter.limit(key));
      } catch (error) {
        logLine("error", "rate_limit_error", { binding, errorClass: errorClass(error) });
        continue;
      }
      if (!success) {
        logLine("warn", "rate_limit_refused", { binding });
        throw new HttpError(429, "RATE_LIMITED", "Too many requests. Try again later.", {
          retryAfterSeconds: EDGE_RETRY_AFTER_SECONDS,
          scope: scopeForPath(c.req.path)
        });
      }
    }
    return next();
  };
}
function windowRateLimitMiddleware(resolve, options = {}) {
  return async (c, next) => {
    const buckets = windowBucketsFor(c.req.method, c.req.path);
    if (buckets.length === 0) return next();
    const key = clientKey(c.req.raw.headers);
    if (key === UNKNOWN_CLIENT_KEY) {
      if (!options.bindingsRequired) return next();
      logLine("warn", "rate_limit_client_ip_missing", {});
    }
    const requestId = c.get("requestId");
    const headers = { "Cache-Control": "no-store" };
    for (const bucket of buckets) {
      const config = WINDOW_BUCKETS[bucket];
      let counted;
      try {
        const counter = resolve(c);
        if (!counter) throw new Error("no database pool for rate limit");
        counted = await counter.consume(bucket, key, config.windowSeconds);
      } catch (error) {
        logLine("error", "rate_limit_store_error", { bucket, errorClass: errorClass(error) });
        return c.json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "Rate limit check unavailable. Try again shortly.", requestId } },
          503,
          { ...headers, "Retry-After": "1" }
        );
      }
      if (counted.count > config.limit) {
        logLine("warn", "rate_limit_window_refused", { bucket });
        return c.json(
          { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later.", requestId, details: { retryAfterSeconds: counted.retryAfterSeconds, scope: scopeForBucket(bucket) } } },
          429,
          { ...headers, "Retry-After": String(counted.retryAfterSeconds) }
        );
      }
    }
    return next();
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/rate-limit-cloudflare.ts
function bindingFrom(env, binding) {
  const candidate = env?.[binding];
  return typeof candidate?.limit === "function" ? candidate : void 0;
}
function cloudflareRateLimiter(c, binding) {
  const limiter = bindingFrom(c.env, binding);
  if (!limiter) return void 0;
  return { limit: (key) => limiter.limit({ key }) };
}
function rateLimitBindingStatus(env) {
  const status = {};
  for (const binding of Object.keys(RATE_LIMIT_BINDINGS)) {
    status[binding] = bindingFrom(env, binding) !== void 0;
  }
  return status;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/rate-limit-postgres.ts
var CONSUME_SQL = `
WITH clock AS (
  SELECT floor(extract(epoch FROM now()))::bigint AS now_s
),
win AS (
  SELECT (now_s - now_s % $3::bigint)::bigint AS window_start, now_s FROM clock
),
upserted AS (
  INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count)
  SELECT $1::text, $2::text, window_start, 1 FROM win
  ON CONFLICT (bucket, client_key, window_start)
  DO UPDATE SET request_count = rate_limit_windows.request_count + 1
  RETURNING request_count, window_start
)
SELECT upserted.request_count, upserted.window_start, win.now_s
FROM upserted, win`;
async function consumeWindow(pool, bucket, clientKey2, windowSeconds) {
  const result = await pool.query(CONSUME_SQL, [bucket, clientKey2, windowSeconds]);
  const row = result.rows[0];
  if (!row) throw new Error("rate limit upsert returned no row");
  const windowEnd = Number(row.window_start) + windowSeconds;
  return {
    count: Number(row.request_count),
    retryAfterSeconds: Math.max(1, windowEnd - Number(row.now_s))
  };
}
function postgresWindowCounter(pool) {
  return {
    consume: (bucket, clientKey2, windowSeconds) => consumeWindow(pool, bucket, clientKey2, windowSeconds)
  };
}
async function consumeActorWindows(client, actorId, buckets) {
  for (const bucket of buckets) {
    const config = WINDOW_BUCKETS[bucket];
    let counted;
    try {
      counted = await consumeWindow(client, bucket, actorId, config.windowSeconds);
    } catch {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Rate limit check unavailable. Try again shortly.");
    }
    if (counted.count > config.limit) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests. Try again later.", {
        retryAfterSeconds: counted.retryAfterSeconds,
        scope: scopeForBucket(bucket)
      });
    }
  }
}
async function consumeInvitationScopeLimits(client, inviterId, projectId) {
  const checks = [
    { bucket: "invite-inviter", key: inviterId },
    { bucket: "invite-inviter-hour", key: inviterId },
    { bucket: "invite-project", key: projectId },
    { bucket: "invite-project-hour", key: projectId }
  ];
  for (const { bucket, key } of checks) {
    const config = WINDOW_BUCKETS[bucket];
    let counted;
    try {
      counted = await consumeWindow(client, bucket, key, config.windowSeconds);
    } catch {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Rate limit check unavailable. Try again shortly.");
    }
    if (counted.count > config.limit) {
      throw new HttpError(
        429,
        "RATE_LIMITED",
        "Too many invitations sent recently. Try again later.",
        { retryAfterSeconds: counted.retryAfterSeconds, scope: scopeForBucket(bucket) }
      );
    }
  }
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/session.ts
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z as z12 } from "zod";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/last-location.ts
async function canReadLocation(db, userId, projectId, boardId) {
  const project = await db.query(
    `SELECT (w.owner_id = $2) AS is_owner,
            COALESCE(pm.status = 'active', FALSE) AS is_member
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1 AND p.archived = FALSE`,
    [projectId, userId]
  );
  const row = project.rows[0];
  if (!row || !(row.is_owner || row.is_member)) return false;
  if (boardId === null) return true;
  const board = await db.query(
    `SELECT 1
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1 AND b.project_id = $2 AND b.archived = FALSE
       AND (
         w.owner_id = $3
         OR EXISTS (
           SELECT 1 FROM board_grants bg
           WHERE bg.board_id = b.id AND bg.project_id = b.project_id AND bg.user_id = $3
         )
       )`,
    [boardId, projectId, userId]
  );
  return (board.rowCount ?? 0) > 0;
}
async function readLastLocation(userId, db = getPool()) {
  const res = await db.query(
    "SELECT last_project_id, last_board_id FROM users WHERE id = $1",
    [userId]
  );
  const row = res.rows[0];
  if (!row?.last_project_id) return null;
  const boardId = row.last_board_id;
  if (!await canReadLocation(db, userId, row.last_project_id, boardId)) return null;
  return { projectId: row.last_project_id, boardId };
}
async function writeLastLocation(userId, projectId, boardId, db = getPool()) {
  if (!await canReadLocation(db, userId, projectId, boardId)) {
    if (!await canReadLocation(db, userId, projectId, null)) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  await db.query(
    `UPDATE users SET last_project_id = $2, last_board_id = $3
     WHERE id = $1
       AND (last_project_id IS DISTINCT FROM $2 OR last_board_id IS DISTINCT FROM $3)`,
    [userId, projectId, boardId]
  );
  return { projectId, boardId };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/quotas.ts
async function lockUserQuota(client, userId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fb:quota:user:${userId}`]);
}
async function lockProjectQuota(client, projectId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fb:quota:project:${projectId}`]);
}
async function countOwnedActiveProjects(client, userId) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM projects p JOIN workspaces w ON w.id = p.workspace_id
     WHERE w.owner_id = $1 AND p.archived = FALSE`,
    [userId]
  );
  return res.rows[0]?.n ?? 0;
}
async function countActiveBoards(client, projectId) {
  const res = await client.query(
    "SELECT COUNT(*)::int AS n FROM boards WHERE project_id = $1 AND archived = FALSE",
    [projectId]
  );
  return res.rows[0]?.n ?? 0;
}
async function countOwnedTotalProjects(client, userId) {
  const res = await client.query("SELECT COUNT(*)::int AS n FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE w.owner_id=$1", [userId]);
  return res.rows[0]?.n ?? 0;
}
async function countTotalBoards(client, projectId) {
  const res = await client.query("SELECT COUNT(*)::int AS n FROM boards WHERE project_id=$1", [projectId]);
  return res.rows[0]?.n ?? 0;
}
async function countActiveMembers(client, projectId) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM project_memberships pm
     JOIN projects p ON p.id = pm.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> w.owner_id`,
    [projectId]
  );
  return res.rows[0]?.n ?? 0;
}
async function countPendingInvitations(client, projectId) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM project_invitations
     WHERE project_id = $1 AND status = 'pending' AND expires_at > NOW()`,
    [projectId]
  );
  return res.rows[0]?.n ?? 0;
}
var MESSAGES = {
  owned_projects: "You have reached the limit of active projects you own. Archive a project to free a slot.",
  boards_per_project: "This project has reached its board limit. Archive a board to free a slot.",
  members: "This project has reached its member limit. Remove a member to free a slot.",
  pending_invitations: "This project has reached its limit of pending invitations. Revoke one to free a slot.",
  owned_projects_total: "You have reached the total number of projects allowed, including archived projects.",
  boards_per_project_total: "This project has reached the total number of boards allowed, including archived boards."
};
function quotaExceeded(scope, limit, remedy, current) {
  const details = { scope, limit, remedy };
  if (current !== void 0) details["current"] = current;
  return new HttpError(409, "QUOTA_EXCEEDED", MESSAGES[scope], details);
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/admin-secret.ts
import crypto3 from "node:crypto";
var TEST_ONLY_SECRET = "flowboard-dev-secret";
var MIN_SECRET_LENGTH = 32;
function configuredAdminSecret(workerSecret, deployed = false) {
  const configured = workerSecret || (typeof process !== "undefined" ? process.env?.["DEV_LOGIN_SECRET"] : void 0);
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (!deployed && typeof process !== "undefined" && process.env?.["NODE_ENV"] === "test") return configured || TEST_ONLY_SECRET;
  return null;
}
function adminSecretMatches(provided, workerSecret, deployed = false) {
  const expected = configuredAdminSecret(workerSecret, deployed);
  if (!expected || !provided) return false;
  const digest2 = (value) => crypto3.createHash("sha256").update(value).digest();
  return crypto3.timingSafeEqual(digest2(provided), digest2(expected));
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/session.ts
var devLoginRequestSchema = z12.object({
  email: z12.string().email(),
  displayName: z12.string().trim().min(1).max(100).optional()
});
var sessionRoutes = new Hono();
sessionRoutes.get("/", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Authentication required.");
  }
  const ownedWorkspaces = await getOwnedWorkspaces(actor.id);
  const accessibleProjects = await getAccessibleProjects(actor.id);
  const lastLocation = await readLastLocation(actor.id);
  const names = await readNameState(actor.id);
  const limits = limitsOf(c);
  const ownedUsed = await countOwnedActiveProjects(getPool(), actor.id);
  const response = getSessionResponseSchema.parse({
    data: {
      actor,
      ownedWorkspaces,
      accessibleProjects,
      limits: {
        ownedProjects: { limit: limits.ownedProjects, used: ownedUsed },
        boardsPerProject: { limit: limits.boardsPerProject },
        membersPerProject: { limit: limits.membersPerProject },
        pendingInvitationsPerProject: { limit: limits.pendingInvitesPerProject }
      },
      lastLocation,
      needsName: names.needsName,
      suggestedFirstName: names.suggestedFirstName,
      suggestedLastName: names.suggestedLastName
    }
  });
  return c.json(response);
});
sessionRoutes.put("/last-location", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Authentication required.");
  }
  const rawBody = await c.req.json();
  const input = parseOrThrow(updateLastLocationInputSchema, rawBody);
  const lastLocation = await writeLastLocation(actor.id, input.projectId, input.boardId ?? null);
  return c.json({ data: lastLocation }, 200);
});
sessionRoutes.patch("/profile", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Authentication required.");
  }
  const rawBody = await c.req.json();
  const parsed = parseOrThrow(updateProfileInputSchema, rawBody);
  const updatedActor = await updateUserProfile(actor.id, parsed);
  return c.json({ data: updatedActor }, 200);
});
sessionRoutes.patch("/name", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Authentication required.");
  }
  const rawBody = await c.req.json();
  const input = parseOrThrow(saveNameInputSchema, rawBody);
  const saved = await saveUserName(actor.id, input.firstName, input.lastName);
  return c.json({
    data: { actor: saved, firstName: input.firstName, lastName: input.lastName, needsName: false }
  }, 200);
});
sessionRoutes.post("/logout", optionalAuthMiddleware, async (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) {
    await revokeSession(sessionId);
  }
  const host = c.req.header("host") || (c.req.url ? new URL(c.req.url).hostname : void 0);
  const clearOpts = getClearSessionCookieOptions(host);
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: clearOpts.path,
    secure: clearOpts.secure
  });
  return c.body(null, 204);
});
sessionRoutes.post("/dev-login", async (c) => {
  const workerBindings = c.env;
  const testMode = process.env.NODE_ENV === "test";
  const localDevelopmentMode = process.env.NODE_ENV === "development" && process.env.DEV_LOGIN_ENABLED === "true" && typeof process.env.DEV_LOGIN_SECRET === "string" && process.env.DEV_LOGIN_SECRET.length >= 32;
  if (workerBindings?.HYPERDRIVE || workerBindings?.DATABASE_URL || !testMode && !localDevelopmentMode) {
    throw HttpError.notFound("Route not found.");
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }
  const parsed = devLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw HttpError.badRequest("Invalid login payload: valid email is required.", {
      issues: parsed.error.issues
    });
  }
  const { email, displayName } = parsed.data;
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    if (!adminSecretMatches(c.req.header("x-dev-secret"))) {
      throw HttpError.forbidden("Cannot sign in to existing account without development secret.");
    }
  }
  const name = displayName?.trim() || email.split("@")[0] || "User";
  const { session, user } = await createDevUserAndSession(email, name);
  const host = c.req.header("host") || (c.req.url ? new URL(c.req.url).hostname : void 0);
  const cookieOpts = getSessionCookieOptions(host);
  setCookie(c, SESSION_COOKIE_NAME, session.id, {
    path: cookieOpts.path,
    httpOnly: cookieOpts.httpOnly,
    sameSite: cookieOpts.sameSite,
    secure: cookieOpts.secure,
    maxAge: cookieOpts.maxAge
  });
  return c.json({
    data: {
      actor: user,
      session: {
        id: session.id,
        expiresAt: session.expiresAt
      }
    }
  });
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/google-auth.ts
import crypto5 from "node:crypto";
import { Hono as Hono2 } from "hono";
import { getCookie as getCookie2, setCookie as setCookie2, deleteCookie as deleteCookie2 } from "hono/cookie";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/personal-workspace.ts
import crypto4 from "node:crypto";
var PERSONAL_WORKSPACE_NAME = "Personal workspace";
async function ensurePersonalWorkspace(client, userId) {
  await lockUserQuota(client, userId);
  const found = await client.query(
    "SELECT id FROM workspaces WHERE owner_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1",
    [userId]
  );
  const existing = found.rows[0];
  if (existing) return existing.id;
  const id = `ws_${crypto4.randomUUID()}`;
  await client.query(
    `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
     VALUES ($1, $2, 'UTC', $3, 1, NOW(), NOW())`,
    [id, PERSONAL_WORKSPACE_NAME, userId]
  );
  return id;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/safe-next.ts
var MAX_NEXT_LENGTH = 300;
var APP_ROUTES = [
  "/projects",
  "/project",
  "/board",
  "/activity",
  "/trash",
  "/people",
  "/inbox",
  "/my-tasks",
  "/settings",
  "/import",
  "/add-card",
  "/all-work",
  "/invitation",
  "/invitations/accept"
];
var SAFE_PATH = /^\/[A-Za-z0-9_/-]*$/;
var SAFE_QUERY = /^[A-Za-z0-9_=&.-]*$/;
var CONTROL_CHARS = /[\x00-\x1f\x7f]/;
function sanitizeNextPath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (CONTROL_CHARS.test(raw) || raw.includes("\\")) return null;
  if (raw.startsWith("//")) return null;
  const queryAt = raw.indexOf("?");
  const path3 = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = queryAt === -1 ? "" : raw.slice(queryAt + 1);
  if (!SAFE_PATH.test(path3)) return null;
  if (!SAFE_QUERY.test(query)) return null;
  const allowed = APP_ROUTES.some((route) => path3 === route || path3.startsWith(`${route}/`));
  return allowed ? raw : null;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/google-auth.ts
var OAUTH_STATE_COOKIE = "flowboard_oauth_state";
var googleAuthRoutes = new Hono2();
function decodeNextCookie(encoded) {
  return Buffer.from(encoded, "base64url").toString("utf8");
}
function resolveRedirectUri(c) {
  const envUri = c.env?.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  if (envUri) return envUri;
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}/api/v1/auth/google/callback`;
}
function cleanCredential(val) {
  if (!val) return "";
  let str = val.trim();
  if (str.includes("]")) {
    str = str.split("]")[0].trim();
  }
  if (str.includes("(")) {
    str = str.split("(")[0].trim();
  }
  str = str.replace(/^["']|["']$/g, "").trim();
  return str;
}
function getGoogleConfig(c) {
  const rawId = c.env?.GOOGLE_CLIENT_ID || (typeof process !== "undefined" ? process.env?.["GOOGLE_CLIENT_ID"] : void 0);
  const rawSecret = c.env?.GOOGLE_CLIENT_SECRET || (typeof process !== "undefined" ? process.env?.["GOOGLE_CLIENT_SECRET"] : void 0);
  return {
    clientId: cleanCredential(rawId),
    clientSecret: cleanCredential(rawSecret)
  };
}
var startGoogleSignIn = (c) => {
  const { clientId } = getGoogleConfig(c);
  if (!clientId) {
    throw HttpError.internal("Google OAuth is not configured on this server. Missing GOOGLE_CLIENT_ID.");
  }
  const redirectUri = resolveRedirectUri(c);
  const state = crypto5.randomBytes(24).toString("hex");
  const host = c.req.header("host") || new URL(c.req.url).hostname;
  const local = isLocalhost(host);
  const next = sanitizeNextPath(c.req.query("next"));
  const stateCookieValue = next ? `${state}.${Buffer.from(next, "utf8").toString("base64url")}` : state;
  setCookie2(c, OAUTH_STATE_COOKIE, stateCookieValue, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: !local,
    maxAge: 600
    // 10 minutes
  });
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");
  return c.redirect(authUrl.toString(), 302);
};
googleAuthRoutes.get("/google", startGoogleSignIn);
googleAuthRoutes.get("/google/start", startGoogleSignIn);
async function completeGoogleSignIn(c) {
  const query = c.req.query();
  if (query.error) {
    throw HttpError.badRequest(`Google sign-in was denied: ${query.error}`, "OAUTH_ERROR");
  }
  const code = query.code;
  const state = query.state;
  if (!code || !state) {
    throw HttpError.badRequest("Missing authorization code or state parameter.", "INVALID_CALLBACK");
  }
  const [savedState, encodedNext] = (getCookie2(c, OAUTH_STATE_COOKIE) ?? "").split(".", 2);
  if (!savedState || savedState !== state) {
    throw HttpError.forbidden("Invalid or expired OAuth state session.", "CSRF_MISMATCH");
  }
  const host = c.req.header("host") || new URL(c.req.url).hostname;
  const local = isLocalhost(host);
  deleteCookie2(c, OAUTH_STATE_COOKIE, {
    path: "/",
    secure: !local
  });
  const { clientId, clientSecret } = getGoogleConfig(c);
  if (!clientId || !clientSecret) {
    throw HttpError.internal("Google OAuth client configuration incomplete.");
  }
  const redirectUri = resolveRedirectUri(c);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) {
    await tokenResponse.body?.cancel();
    console.error(JSON.stringify({ event: "google_token_exchange_failed", status: tokenResponse.status }));
    throw HttpError.badRequest("Failed to authenticate with Google identity provider.", "TOKEN_EXCHANGE_FAILED");
  }
  const tokens = await tokenResponse.json();
  const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!userinfoResponse.ok) {
    throw HttpError.badRequest("Failed to fetch user profile from Google.", "USERINFO_FAILED");
  }
  const profile = await userinfoResponse.json();
  if (!profile.email) {
    throw HttpError.badRequest("Google account must have an associated email address.", "EMAIL_REQUIRED");
  }
  if (profile.email_verified !== true) {
    throw HttpError.forbidden("Google account email is not verified.", "EMAIL_NOT_VERIFIED");
  }
  const normalizedEmail = profile.email.trim().toLowerCase();
  const displayName = profile.name?.trim() || normalizedEmail.split("@")[0] || "User";
  const avatarUrl = profile.picture || null;
  const suggestedFirstName = normalizeNamePart(profile.given_name ?? "");
  const suggestedLastName = normalizeNamePart(profile.family_name ?? "");
  const pool = getPool(c);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = "usr_" + crypto5.randomUUID();
    const userRes = await client.query(
      `INSERT INTO users (id, email, display_name, avatar_url, first_name, last_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (email)
       DO UPDATE SET
         display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
         avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), users.avatar_url),
         -- Google's names are suggestions: they replace the stored ones only until the user confirms.
         first_name = CASE WHEN users.name_confirmed_at IS NULL THEN EXCLUDED.first_name ELSE users.first_name END,
         last_name = CASE WHEN users.name_confirmed_at IS NULL THEN EXCLUDED.last_name ELSE users.last_name END,
         updated_at = NOW()
       RETURNING id, email, display_name, avatar_url`,
      [userId, normalizedEmail, displayName, avatarUrl, suggestedFirstName, suggestedLastName]
    );
    const user = userRes.rows[0];
    await ensurePersonalWorkspace(client, user.id);
    const session = await createSession(user.id, 24 * 7, client);
    await client.query("COMMIT");
    const cookieOpts = getSessionCookieOptions(host);
    setCookie2(c, SESSION_COOKIE_NAME, session.id, {
      path: cookieOpts.path,
      httpOnly: cookieOpts.httpOnly,
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
      maxAge: cookieOpts.maxAge
    });
    const envObj = c.env;
    const frontendUrl = envObj?.FRONTEND_URL || (typeof process !== "undefined" ? process.env?.["FRONTEND_URL"] : void 0);
    const safeNext = encodedNext ? sanitizeNextPath(decodeNextCookie(encodedNext)) : null;
    const landingPath = safeNext ?? "/projects";
    const redirectTarget = frontendUrl ? `${frontendUrl.replace(/\/$/, "")}${landingPath}` : landingPath;
    return c.redirect(redirectTarget, 302);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
}
var SIGNIN_STATE_BY_CODE = {
  OAUTH_ERROR: "denied",
  CSRF_MISMATCH: "expired",
  EMAIL_NOT_VERIFIED: "email_unverified",
  EMAIL_REQUIRED: "email_missing"
};
function frontendOrigin(c) {
  const envObj = c.env;
  const frontendUrl = envObj?.FRONTEND_URL || (typeof process !== "undefined" ? process.env?.["FRONTEND_URL"] : void 0);
  return frontendUrl ? frontendUrl.replace(/\/$/, "") : "";
}
googleAuthRoutes.get("/google/callback", async (c) => {
  try {
    return await completeGoogleSignIn(c);
  } catch (err) {
    const code = err?.code;
    const codeText = typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : "UNEXPECTED";
    console.error(JSON.stringify({ event: "google_callback_failed", code: codeText }));
    const state = SIGNIN_STATE_BY_CODE[codeText] ?? "failed";
    return c.redirect(`${frontendOrigin(c)}/signin?state=${state}`, 302);
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/workspaces.ts
import { Hono as Hono3 } from "hono";
var workspacesRoutes = new Hono3();
workspacesRoutes.post("/api/v1/workspaces", authMiddleware, async () => {
  throw new HttpError(410, "WORKSPACE_CREATE_RETIRED", "Creating workspaces is no longer available. Projects are created in your personal workspace with POST /api/v1/projects.");
});
workspacesRoutes.get("/api/v1/workspaces", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const pool = getPool();
  const res = await pool.query(
    // B-20: owned workspaces only. A membership in someone else's project does not list their workspace.
    `SELECT w.id, w.name, w.timezone, w.owner_id, w.version, w.created_at, w.updated_at
     FROM workspaces w
     WHERE w.owner_id = $1
     ORDER BY w.name ASC, w.id ASC`,
    [actor.id]
  );
  const workspaces = res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    ownerId: row.owner_id,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
  return c.json({ data: workspaces, nextCursor: null }, 200);
});
workspacesRoutes.patch("/api/v1/workspaces/:workspaceId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const workspaceId = c.req.param("workspaceId");
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateWorkspaceInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wsRes = await client.query(
      `SELECT id, name, timezone, owner_id, version, created_at, updated_at
       FROM workspaces
       WHERE id = $1
       FOR UPDATE`,
      [workspaceId]
    );
    if (wsRes.rows.length === 0 || !wsRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    }
    const current = wsRes.rows[0];
    if (current.owner_id !== actor.id) {
      await client.query("ROLLBACK");
      throw HttpError.forbidden("Only workspace owner can update workspace preferences.");
    }
    if (current.version !== body.expectedVersion) {
      await client.query("ROLLBACK");
      throw HttpError.conflict("STALE_VERSION", "Workspace version does not match expected version.");
    }
    const newName = body.name ?? current.name;
    const newTimezone = body.timezone ?? current.timezone;
    const newVersion = current.version + 1;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updateRes = await client.query(
      `UPDATE workspaces
       SET name = $1, timezone = $2, version = $3, updated_at = $4
       WHERE id = $5
       RETURNING id, name, timezone, owner_id, version, created_at, updated_at`,
      [newName, newTimezone, newVersion, nowIso, workspaceId]
    );
    await client.query("COMMIT");
    const updatedRow = updateRes.rows[0];
    const workspace = {
      id: updatedRow.id,
      name: updatedRow.name,
      timezone: updatedRow.timezone,
      ownerId: updatedRow.owner_id,
      version: updatedRow.version,
      createdAt: new Date(updatedRow.created_at).toISOString(),
      updatedAt: new Date(updatedRow.updated_at).toISOString()
    };
    return c.json({ data: workspace }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
workspacesRoutes.post("/api/v1/workspaces/:workspaceId/transfer-ownership", authMiddleware, async () => {
  throw new HttpError(410, "TRANSFER_OWNERSHIP_RETIRED", "Ownership transfer is not available in this beta.");
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/own-projects.ts
import crypto6 from "node:crypto";
async function assertOwnedProjectRoom(client, userId, limits) {
  const used = await countOwnedActiveProjects(client, userId);
  if (used >= limits.ownedProjects) {
    throw quotaExceeded("owned_projects", limits.ownedProjects, "archive_project", used);
  }
}
async function assertOwnedProjectTotalRoom(client, userId, limits) {
  const used = await countOwnedTotalProjects(client, userId);
  if (used >= limits.ownedProjectsTotal) throw quotaExceeded("owned_projects_total", limits.ownedProjectsTotal, "none", used);
}
async function consumeProjectCreateWindows(client, userId) {
  await consumeActorWindows(client, userId, ["project-create", "project-create-hour"]);
}
function projectKeyPrefix(name) {
  const letters = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return letters || "PRJ";
}
async function insertProjectRow(client, workspaceId, name, description) {
  const projectId = "prj_" + crypto6.randomUUID();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const res = await client.query(
    `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at, key_prefix)
     VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5, $6)
     RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
    [projectId, workspaceId, name, description, nowIso, projectKeyPrefix(name)]
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(500, "INTERNAL_ERROR", "Failed to insert project row.");
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/projects.ts
import { Hono as Hono4 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/boards.ts
import crypto7 from "node:crypto";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/activity.ts
import { createHash } from "node:crypto";
function encodeActivityCursor(cursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeActivityCursor(value, expectedScope, expectedScopeId, actorId, scopeDigest) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const parsed = JSON.parse(atob(base64));
    if (parsed.v !== 2 || parsed.scope !== expectedScope || parsed.scopeId !== expectedScopeId || parsed.actorId !== actorId || parsed.scopeDigest !== scopeDigest || typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || parsed.id.length === 0) {
      throw new Error("invalid activity cursor");
    }
    return parsed;
  } catch {
    throw HttpError.conflict("STALE_CURSOR", "Activity cursor is invalid or belongs to another scope.");
  }
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function inActivityTransaction(db, run) {
  if (typeof db.totalCount !== "number") return run(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
}
async function lockProjectActivityAccess(client, projectId, actorId) {
  const context = await client.query(
    `SELECT p.workspace_id, w.owner_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     WHERE p.id=$1 FOR SHARE OF w`,
    [projectId]
  );
  const row = context.rows[0];
  if (!row) throw HttpError.notFound("Project not found.", "NOT_FOUND");
  if (row.owner_id === actorId) return { owner: true, digest: digest({ projectId, actorId, owner: true }) };
  const membership = await client.query(
    `SELECT role,status FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE`,
    [projectId, actorId]
  );
  if (membership.rows[0]?.status !== "active") throw HttpError.notFound("Project not found.", "NOT_FOUND");
  if (membership.rows[0]?.role !== "manager") throw HttpError.forbidden("Only project managers and workspace owners can view project-wide activity.", "FORBIDDEN");
  const grants = await client.query(
    `SELECT b.id,b.access_revision FROM boards b JOIN board_grants g
       ON g.board_id=b.id AND g.project_id=b.project_id AND g.workspace_id=b.workspace_id
     WHERE b.project_id=$1 AND g.user_id=$2 ORDER BY b.id FOR SHARE OF g`,
    [projectId, actorId]
  );
  return { owner: false, digest: digest({ projectId, actorId, role: "manager", grants: grants.rows }) };
}
async function listCardActivity(poolOrClient, cardId, actorId, options) {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {
    const cardRes = await pool.query(
      `SELECT c.id, c.project_id, c.workspace_id, c.board_id, c.state, c.title,
       p.key_prefix || '-' || c.card_number::text AS card_key
     FROM cards c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1`,
      [cardId]
    );
    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const card = cardRes.rows[0];
    if (card.state === "trashed" || card.state === "purged") {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    let isOwner = false;
    try {
      const access = await lockBoardAccess(pool, card.board_id, actorId);
      isOwner = access.role === "owner";
      if (access.projectId !== card.project_id || access.workspaceId !== card.workspace_id) throw HttpError.notFound("Card not found.", "NOT_FOUND");
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw HttpError.notFound("Card not found.", "NOT_FOUND");
      throw error;
    }
    const currentCard = await pool.query(
      `SELECT state FROM cards WHERE id=$1 AND project_id=$2 AND workspace_id=$3 AND board_id=$4 FOR SHARE`,
      [cardId, card.project_id, card.workspace_id, card.board_id]
    );
    if (currentCard.rows[0]?.state !== "active") throw HttpError.notFound("Card not found.", "NOT_FOUND");
    const revision = await pool.query("SELECT access_revision FROM boards WHERE id=$1", [card.board_id]);
    const scopeDigest = digest({ cardId, actorId, boardId: card.board_id, revision: revision.rows[0]?.access_revision });
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const cursor = options?.cursor ? decodeActivityCursor(options.cursor, "card", cardId, actorId, scopeDigest) : void 0;
    const activityRes = await pool.query(
      `SELECT id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log
     WHERE card_id = $1 AND project_id=$5 AND workspace_id=$6
       AND ((visibility_scope='board' AND board_id=$7) OR ($8::boolean AND visibility_scope='unknown'))
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::text))
     ORDER BY created_at ASC, id ASC
     LIMIT $4`,
      [cardId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1, card.project_id, card.workspace_id, card.board_id, isOwner]
    );
    const rawRows = activityRes.rows;
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeActivityCursor({
      v: 2,
      scope: "card",
      scopeId: cardId,
      actorId,
      scopeDigest,
      createdAt: lastRow.cursor_time,
      id: lastRow.id
    }) : null;
    const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
    const actorsMap = /* @__PURE__ */ new Map();
    await Promise.all(
      actorIds.map(async (actId) => {
        const display = await getHistoricalPersonDisplay(pool, card.project_id, actId);
        if (display) {
          actorsMap.set(actId, display);
        } else {
          const userRes = await pool.query(
            "SELECT id, display_name, avatar_url FROM users WHERE id = $1",
            [actId]
          );
          if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            actorsMap.set(actId, {
              id: u.id,
              displayName: u.display_name,
              avatarUrl: u.avatar_url,
              activeInProject: false,
              scopedRole: "viewer",
              assignable: false,
              mentionable: false
            });
          }
        }
      })
    );
    const data = pageRows.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      projectId: row.project_id,
      actorId: row.actor_id,
      action: row.action,
      safeChanges: row.safe_changes ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      actor: actorsMap.get(row.actor_id),
      // Card title and key are shown only because this feed is already scoped to one card the actor passed.
      boardId: card.board_id,
      cardKey: card.card_key,
      cardTitle: card.title
    }));
    return { data, nextCursor };
  });
}
async function listProjectActivity(poolOrClient, projectId, actorId, options) {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {
    const prjRes = await pool.query(
      "SELECT id, workspace_id FROM projects WHERE id = $1",
      [projectId]
    );
    if (prjRes.rows.length === 0) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    const access = await lockProjectActivityAccess(pool, projectId, actorId);
    const scopeDigest = digest({ access: access.digest, filters: {
      cardId: options?.cardId ?? null,
      actorId: options?.actorId ?? null,
      action: options?.action ?? null,
      fromDate: options?.fromDate ?? null,
      toDate: options?.toDate ?? null
    } });
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const cursor = options?.cursor ? decodeActivityCursor(options.cursor, "project", projectId, actorId, scopeDigest) : void 0;
    const params = [projectId];
    let paramIdx = 2;
    let whereClause = `WHERE a.project_id = $1 AND ($2::boolean OR a.visibility_scope='project' OR
    (a.visibility_scope='board' AND EXISTS (
      SELECT 1 FROM board_grants g JOIN boards b ON b.id=g.board_id
        AND b.project_id=g.project_id AND b.workspace_id=g.workspace_id
      WHERE g.board_id=a.board_id AND g.project_id=a.project_id AND g.workspace_id=a.workspace_id AND g.user_id=$3)))`;
    params.push(access.owner, actorId);
    paramIdx = 4;
    if (options?.cardId) {
      whereClause += ` AND a.card_id = $${paramIdx++}`;
      params.push(options.cardId);
    }
    if (options?.actorId) {
      whereClause += ` AND a.actor_id = $${paramIdx++}`;
      params.push(options.actorId);
    }
    if (options?.action) {
      whereClause += ` AND a.action = $${paramIdx++}`;
      params.push(options.action);
    }
    if (options?.fromDate) {
      whereClause += ` AND a.created_at >= $${paramIdx++}::timestamptz`;
      params.push(options.fromDate);
    }
    if (options?.toDate) {
      whereClause += ` AND a.created_at <= $${paramIdx++}::timestamptz`;
      params.push(options.toDate);
    }
    if (cursor) {
      whereClause += ` AND (a.created_at, a.id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::text)`;
      params.push(cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const limitParamIdx = paramIdx;
    const activityRes = await pool.query(
      `SELECT a.id, a.workspace_id, a.project_id, a.card_id, a.actor_id, a.action, a.safe_changes, a.created_at,
       to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log a
     ${whereClause}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${limitParamIdx}`,
      params
    );
    const rawRows = activityRes.rows;
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeActivityCursor({
      v: 2,
      scope: "project",
      scopeId: projectId,
      actorId,
      scopeDigest,
      createdAt: lastRow.cursor_time,
      id: lastRow.id
    }) : null;
    const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
    const actorsMap = /* @__PURE__ */ new Map();
    await Promise.all(
      actorIds.map(async (actId) => {
        const display = await getHistoricalPersonDisplay(pool, projectId, actId);
        if (display) {
          actorsMap.set(actId, display);
        } else {
          const userRes = await pool.query(
            "SELECT id, display_name, avatar_url FROM users WHERE id = $1",
            [actId]
          );
          if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            actorsMap.set(actId, {
              id: u.id,
              displayName: u.display_name,
              avatarUrl: u.avatar_url,
              activeInProject: false,
              scopedRole: "viewer",
              assignable: false,
              mentionable: false
            });
          }
        }
      })
    );
    const data = pageRows.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      projectId: row.project_id,
      actorId: row.actor_id,
      action: row.action,
      safeChanges: row.safe_changes ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      actor: actorsMap.get(row.actor_id)
    }));
    return { data, nextCursor };
  });
}
async function listWorkspaceActivity(poolOrClient, workspaceId, actorId, options) {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {
    const wsRes = await pool.query(
      "SELECT id, owner_id FROM workspaces WHERE id = $1 FOR SHARE",
      [workspaceId]
    );
    if (wsRes.rows.length === 0) {
      throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    }
    const ws = wsRes.rows[0];
    if (ws.owner_id !== actorId) {
      const memberRes = await pool.query(
        `SELECT 1 FROM project_memberships pm
       JOIN projects p ON p.id = pm.project_id
       WHERE p.workspace_id = $1 AND pm.user_id = $2 AND pm.status = 'active'
       LIMIT 1`,
        [workspaceId, actorId]
      );
      if (memberRes.rows.length > 0) {
        throw HttpError.forbidden("Only workspace owners can view workspace activity.", "FORBIDDEN");
      }
      throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const scopeDigest = digest({ workspaceId, actorId, filters: {
      projectId: options?.projectId ?? null,
      cardId: options?.cardId ?? null,
      actorId: options?.actorId ?? null,
      action: options?.action ?? null,
      fromDate: options?.fromDate ?? null,
      toDate: options?.toDate ?? null
    } });
    const cursor = options?.cursor ? decodeActivityCursor(options.cursor, "workspace", workspaceId, actorId, scopeDigest) : void 0;
    const params = [workspaceId];
    let paramIdx = 2;
    let whereClause = "WHERE workspace_id = $1";
    if (options?.projectId) {
      whereClause += ` AND project_id = $${paramIdx++}`;
      params.push(options.projectId);
    }
    if (options?.cardId) {
      whereClause += ` AND card_id = $${paramIdx++}`;
      params.push(options.cardId);
    }
    if (options?.actorId) {
      whereClause += ` AND actor_id = $${paramIdx++}`;
      params.push(options.actorId);
    }
    if (options?.action) {
      whereClause += ` AND action = $${paramIdx++}`;
      params.push(options.action);
    }
    if (options?.fromDate) {
      whereClause += ` AND created_at >= $${paramIdx++}::timestamptz`;
      params.push(options.fromDate);
    }
    if (options?.toDate) {
      whereClause += ` AND created_at <= $${paramIdx++}::timestamptz`;
      params.push(options.toDate);
    }
    if (cursor) {
      whereClause += ` AND (created_at, id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::text)`;
      params.push(cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const limitParamIdx = paramIdx;
    const activityRes = await pool.query(
      `SELECT id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${limitParamIdx}`,
      params
    );
    const rawRows = activityRes.rows;
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeActivityCursor({
      v: 2,
      scope: "workspace",
      scopeId: workspaceId,
      actorId,
      scopeDigest,
      createdAt: lastRow.cursor_time,
      id: lastRow.id
    }) : null;
    const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
    const actorsMap = /* @__PURE__ */ new Map();
    await Promise.all(
      actorIds.map(async (actId) => {
        const userRes = await pool.query(
          "SELECT id, display_name, avatar_url FROM users WHERE id = $1",
          [actId]
        );
        if (userRes.rows.length > 0) {
          const u = userRes.rows[0];
          const isOwner = ws.owner_id === actId;
          actorsMap.set(actId, {
            id: u.id,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
            activeInProject: true,
            scopedRole: isOwner ? "owner" : "member",
            assignable: true,
            mentionable: true
          });
        }
      })
    );
    const data = pageRows.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      projectId: row.project_id,
      actorId: row.actor_id,
      action: row.action,
      safeChanges: row.safe_changes ?? {},
      createdAt: new Date(row.created_at).toISOString(),
      actor: actorsMap.get(row.actor_id)
    }));
    return { data, nextCursor };
  });
}
async function recordActivity(client, options) {
  const actId = options.id ?? "act_" + crypto.randomUUID();
  const safeChangesJson = options.safeChanges ? JSON.stringify(options.safeChanges) : "{}";
  const scopeRes = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute 
       WHERE attrelid = to_regclass('activity_log') 
         AND attname = 'visibility_scope' 
         AND NOT attisdropped
     ) AS exists`
  );
  const hasScope = Boolean(scopeRes.rows[0]?.exists);
  if (hasScope) {
    let scope = options.visibilityScope;
    let boardId = options.boardId ?? null;
    if (options.cardId) {
      scope = "board";
      if (!boardId) {
        const cRes = await client.query(
          "SELECT board_id FROM cards WHERE id = $1",
          [options.cardId]
        );
        boardId = cRes.rows[0]?.board_id ?? null;
      }
    } else if (boardId) {
      scope = scope ?? "board";
    } else {
      scope = scope ?? "project";
    }
    if (scope === "board" && !boardId) {
      scope = "unknown";
    } else if (scope !== "board") {
      boardId = null;
    }
    if (options.createdAt) {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, board_id, visibility_scope, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          boardId,
          scope,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
          options.createdAt instanceof Date ? options.createdAt.toISOString() : options.createdAt
        ]
      );
    } else {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, board_id, visibility_scope, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          boardId,
          scope,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson
        ]
      );
    }
  } else {
    if (options.createdAt) {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
          options.createdAt instanceof Date ? options.createdAt.toISOString() : options.createdAt
        ]
      );
    } else {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson
        ]
      );
    }
  }
  return actId;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/board-grants-foundation.ts
var unavailable = () => HttpError.notFound("Board not found.", "NOT_FOUND");
async function lockBoardAccess(client, boardId, actorId) {
  const context = await client.query(
    `SELECT b.project_id, b.workspace_id, w.owner_id FROM boards b
     JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
     JOIN workspaces w ON w.id = p.workspace_id WHERE b.id = $1 FOR SHARE OF w`,
    [boardId]
  );
  const row = context.rows[0];
  if (!row) throw unavailable();
  if (row.owner_id === actorId) return { role: "owner", projectId: row.project_id, workspaceId: row.workspace_id };
  const member = await client.query(
    "SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE",
    [row.project_id, actorId]
  );
  if (member.rows[0]?.status !== "active") throw unavailable();
  const grant = await client.query(
    "SELECT board_id FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 FOR SHARE",
    [boardId, row.project_id, actorId]
  );
  if (!grant.rows[0]) throw unavailable();
  return { role: member.rows[0].role, projectId: row.project_id, workspaceId: row.workspace_id };
}
async function lockProjectBoardReadScope(client, projectId, actorId) {
  const project = await client.query(
    `SELECT p.workspace_id, w.owner_id FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1 FOR SHARE OF w`,
    [projectId]
  );
  if (!project.rows[0]) throw HttpError.notFound("Project not found.", "NOT_FOUND");
  if (project.rows[0].owner_id === actorId) return null;
  const membership = await client.query(
    `SELECT status FROM project_memberships
     WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
    [projectId, actorId]
  );
  if (membership.rows[0]?.status !== "active") throw HttpError.notFound("Project not found.", "NOT_FOUND");
  const grants = await client.query(
    `SELECT bg.board_id FROM board_grants bg
     JOIN boards b ON b.id = bg.board_id AND b.project_id = bg.project_id AND b.workspace_id = bg.workspace_id
     WHERE bg.project_id = $1 AND bg.workspace_id = $2 AND bg.user_id = $3
     ORDER BY bg.board_id FOR SHARE OF bg`,
    [projectId, project.rows[0].workspace_id, actorId]
  );
  return grants.rows.map((row) => row.board_id);
}
async function lockOwnerAndMember(client, boardId, actorId, targetId) {
  const context = await client.query(
    `SELECT b.project_id, b.workspace_id, w.owner_id FROM boards b
     JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
     JOIN workspaces w ON w.id = p.workspace_id WHERE b.id = $1 FOR SHARE OF w`,
    [boardId]
  );
  const row = context.rows[0];
  if (!row || row.owner_id !== actorId || targetId === row.owner_id) throw unavailable();
  const member = await client.query(
    "SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE",
    [row.project_id, targetId]
  );
  if (member.rows[0]?.status !== "active") throw unavailable();
  return row;
}
async function changeBoardGrant(client, boardId, actorId, targetId, allow, expectedAccessRevision) {
  const row = await lockOwnerAndMember(client, boardId, actorId, targetId);
  await client.query(
    "SELECT board_id FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 FOR UPDATE",
    [boardId, row.project_id, targetId]
  );
  const revision = await client.query(
    "SELECT access_revision FROM boards WHERE id = $1 AND project_id = $2 AND workspace_id = $3 FOR UPDATE",
    [boardId, row.project_id, row.workspace_id]
  );
  if (!revision.rows[0]) throw unavailable();
  if (BigInt(revision.rows[0].access_revision) !== expectedAccessRevision) {
    throw HttpError.conflict("Board access changed. Refresh and try again.", "STALE_ACCESS_REVISION");
  }
  const result = allow ? await client.query(
    `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (board_id, user_id) DO NOTHING RETURNING board_id`,
    [boardId, row.project_id, row.workspace_id, targetId, actorId]
  ) : await client.query(
    "DELETE FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 RETURNING board_id",
    [boardId, row.project_id, targetId]
  );
  if (!result.rowCount) return false;
  await client.query("UPDATE boards SET access_revision = access_revision + 1 WHERE id = $1", [boardId]);
  await recordActivity(client, {
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId,
    visibilityScope: "board",
    actorId,
    action: allow ? "board_access_granted" : "board_access_revoked",
    safeChanges: { boardId, userId: targetId }
  });
  return true;
}
async function grantCreatorBoardAccess(client, boardId, projectId, creatorId) {
  const boardRes = await client.query("SELECT workspace_id FROM boards WHERE id = $1", [boardId]);
  const workspaceId = boardRes.rows[0]?.workspace_id;
  if (!workspaceId) throw new Error("creator grant: board not found");
  const inserted = await client.query(
    `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
     VALUES ($1, $2, $3, $4, $4) ON CONFLICT (board_id, user_id) DO NOTHING RETURNING board_id`,
    [boardId, projectId, workspaceId, creatorId]
  );
  if (!inserted.rowCount) return;
  await client.query("UPDATE boards SET access_revision = access_revision + 1 WHERE id = $1", [boardId]);
  await recordActivity(client, {
    workspaceId,
    projectId,
    boardId,
    visibilityScope: "board",
    actorId: creatorId,
    action: "board_access_granted",
    safeChanges: { boardId, userId: creatorId, source: "creator" }
  });
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/boards.ts
async function requireBoardRead(client, boardId, projectId, actorId) {
  const role = await resolveProjectRole(projectId, actorId, client);
  if (!role) throw HttpError.notFound("Board not found.", "NOT_FOUND");
  if (role !== "owner") {
    const grant = await client.query(
      "SELECT 1 FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3",
      [boardId, projectId, actorId]
    );
    if (!grant.rows[0]) throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  return role;
}
function getWorkspaceToday(timezone = "UTC") {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(/* @__PURE__ */ new Date());
  } catch {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}
function computeCardFilterHash(filters) {
  const norm = [
    filters.columnId ?? "",
    (filters.titleQuery ?? filters.query ?? "").trim(),
    filters.priority ?? "",
    filters.assigneeId ?? "",
    filters.due ?? "",
    filters.asOfDate ?? ""
  ].join("|");
  return crypto7.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}
function encodeCardCursor(card) {
  return Buffer.from(
    JSON.stringify({
      bId: card.boardId,
      fH: card.filterHash,
      sV: card.snapshotVersion,
      oV: card.structureVersion,
      position: card.position,
      id: card.id
    })
  ).toString("base64url");
}
function decodeCardCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.bId === "string" && typeof parsed.fH === "string" && typeof parsed.sV === "number" && typeof parsed.oV === "number" && typeof parsed.position === "number" && typeof parsed.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
async function createBoard(client, projectId, name, actorId, description = null) {
  await acquireWriteGrantLock(client, projectId, actorId, "manager");
  const prjRes = await client.query(
    `SELECT id, workspace_id FROM projects WHERE id = $1`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const workspaceId = prjRes.rows[0].workspace_id;
  const boardId = "brd_" + crypto7.randomUUID();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const boardRes = await client.query(
    `INSERT INTO boards (
       id, workspace_id, project_id, name, description,
       structure_version, snapshot_version, archived,
       created_at, updated_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, 1, 1, FALSE, $6, $6, $7)
     RETURNING id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at`,
    [boardId, workspaceId, projectId, name.trim(), description, nowIso, actorId]
  );
  const bRow = boardRes.rows[0];
  if (!bRow) {
    throw new Error("Failed to insert board.");
  }
  const defaultCols = [
    { name: "Not started", category: "todo", color: "#64748b", position: 0 },
    { name: "In progress", category: "active", color: "#0ea5e9", position: 1 },
    { name: "Testing", category: "active", color: "#f59e0b", position: 2 },
    { name: "Blocked", category: "active", color: "#ef4444", position: 3 },
    { name: "Completed", category: "done", color: "#10b981", position: 4 }
  ];
  for (const col of defaultCols) {
    const colId = "col_" + crypto7.randomUUID();
    await client.query(
      `INSERT INTO columns (
         id, workspace_id, project_id, board_id,
         name, color, category, position, version,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)`,
      [colId, workspaceId, projectId, boardId, col.name, col.color, col.category, col.position, nowIso]
    );
  }
  await recordActivity(client, {
    workspaceId,
    projectId,
    boardId,
    visibilityScope: "board",
    actorId,
    action: "board_created",
    safeChanges: { name: bRow.name }
  });
  return {
    id: bRow.id,
    workspaceId: bRow.workspace_id,
    projectId: bRow.project_id,
    name: bRow.name,
    description: bRow.description,
    isArchived: Boolean(bRow.archived),
    structureVersion: bRow.structure_version,
    snapshotVersion: bRow.snapshot_version,
    createdAt: new Date(bRow.created_at).toISOString(),
    updatedAt: new Date(bRow.updated_at).toISOString()
  };
}
async function listProjectBoards(clientOrPool, projectId, actorId, authorizedBoardIds) {
  const pool = clientOrPool ?? getPool();
  const role = await resolveProjectRole(projectId, actorId, pool);
  if (!role) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  let res;
  if (role !== "owner") {
    res = await pool.query(
      `SELECT b.id, b.workspace_id, b.project_id, b.name, b.description, b.structure_version, b.snapshot_version, b.archived, b.created_at, b.updated_at
       FROM boards b
       JOIN board_grants bg ON bg.board_id = b.id AND bg.project_id = b.project_id AND bg.user_id = $2
       WHERE b.project_id = $1 AND b.archived = FALSE
         AND ($3::text[] IS NULL OR b.id = ANY($3::text[]))
       ORDER BY b.created_at ASC, b.id ASC`,
      [projectId, actorId, authorizedBoardIds ?? null]
    );
  } else {
    res = await pool.query(
      `SELECT id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at
       FROM boards
       WHERE project_id = $1 AND archived = FALSE
       ORDER BY created_at ASC, id ASC`,
      [projectId]
    );
  }
  const boards = res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    structureVersion: row.structure_version,
    snapshotVersion: row.snapshot_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
  return {
    data: boards,
    nextCursor: null
  };
}
async function updateBoard(client, boardId, input, expectedVersion, actorId) {
  await lockBoardAccess(client, boardId, actorId);
  const bRes = await client.query(
    `SELECT id, workspace_id, project_id, name, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  const grant = await acquireWriteGrantLock(client, boardRow.project_id, actorId, "manager", boardId);
  if (!grant.isOwner) {
    throw HttpError.forbidden(
      "Only the project owner can change a board name or description.",
      "FORBIDDEN"
    );
  }
  if (boardRow.snapshot_version !== expectedVersion) {
    throw HttpError.conflict("Stale board snapshot version.", "STALE_VERSION");
  }
  const updateRes = await client.query(
    `UPDATE boards
     SET name = CASE WHEN $1::boolean THEN $2 ELSE name END,
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at`,
    [
      input.name !== void 0,
      input.name?.trim() ?? null,
      input.description !== void 0,
      input.description ?? null,
      boardId
    ]
  );
  const row = updateRes.rows[0];
  if (!row) {
    throw new Error("Failed to update board.");
  }
  if (input.name !== void 0) {
    await recordActivity(client, {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      boardId,
      visibilityScope: "board",
      actorId,
      action: "board_renamed",
      safeChanges: { name: row.name }
    });
  }
  if (input.description !== void 0) {
    await recordActivity(client, {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      boardId,
      visibilityScope: "board",
      actorId,
      action: "board_described",
      safeChanges: { cleared: input.description === null }
    });
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    structureVersion: row.structure_version,
    snapshotVersion: row.snapshot_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
async function addColumn(client, boardId, input, actorId) {
  await lockBoardAccess(client, boardId, actorId);
  const bRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, "manager", boardId);
  if (boardRow.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict("Stale board structure version.", "STALE_VERSION");
  }
  const countRes = await client.query(
    `SELECT COUNT(*)::text AS count FROM columns WHERE board_id = $1`,
    [boardId]
  );
  if (parseInt(countRes.rows[0]?.count ?? "0", 10) >= 12) {
    throw HttpError.badRequest("A board cannot have more than 12 columns.", "COLUMN_LIMIT_EXCEEDED");
  }
  const trimmedName = input.name.trim();
  const dupRes = await client.query(
    `SELECT id FROM columns WHERE board_id = $1 AND LOWER(TRIM(name)) = LOWER($2)`,
    [boardId, trimmedName]
  );
  if (dupRes.rows.length > 0) {
    throw HttpError.conflict("A column with this name already exists on the board.", "DUPLICATE_COLUMN_NAME");
  }
  const posRes = await client.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM columns WHERE board_id = $1`,
    [boardId]
  );
  const nextPos = posRes.rows[0]?.next_pos ?? 0;
  const colId = "col_" + crypto7.randomUUID();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const insertRes = await client.query(
    `INSERT INTO columns (
       id, workspace_id, project_id, board_id,
       name, color, category, position, version,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
     RETURNING id, board_id, name, category, color, position, created_at, updated_at`,
    [colId, boardRow.workspace_id, boardRow.project_id, boardId, trimmedName, input.color.trim(), input.category, nextPos, nowIso]
  );
  const colRow = insertRes.rows[0];
  if (!colRow) {
    throw new Error("Failed to insert column.");
  }
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId]
  );
  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: "board",
    actorId,
    action: "column_added",
    safeChanges: { columnId: colRow.id, name: trimmedName, category: input.category }
  });
  return {
    id: colRow.id,
    boardId: colRow.board_id,
    name: colRow.name,
    category: colRow.category,
    color: colRow.color,
    position: colRow.position,
    activeCardCount: 0,
    matchingCardCount: 0,
    createdAt: new Date(colRow.created_at).toISOString(),
    updatedAt: new Date(colRow.updated_at).toISOString()
  };
}
async function updateColumn(client, boardId, columnId, input, actorId) {
  await lockBoardAccess(client, boardId, actorId);
  const bRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, "manager", boardId);
  if (boardRow.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict("Stale board structure version.", "STALE_VERSION");
  }
  const colRes = await client.query(
    `SELECT id, name, color, category, position
     FROM columns
     WHERE id = $1 AND board_id = $2
     FOR UPDATE`,
    [columnId, boardId]
  );
  if (colRes.rows.length === 0 || !colRes.rows[0]) {
    throw HttpError.notFound("Column not found.", "NOT_FOUND");
  }
  const existingCol = colRes.rows[0];
  let newName = existingCol.name;
  if (input.name !== void 0) {
    newName = input.name.trim();
    const dupRes = await client.query(
      `SELECT id FROM columns
       WHERE board_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND id != $3`,
      [boardId, newName, columnId]
    );
    if (dupRes.rows.length > 0) {
      throw HttpError.conflict("A column with this name already exists on the board.", "DUPLICATE_COLUMN_NAME");
    }
  }
  const newColor = input.color !== void 0 ? input.color.trim() : existingCol.color;
  const newCategory = input.category !== void 0 ? input.category : existingCol.category;
  const updateRes = await client.query(
    `UPDATE columns
     SET name = $1, color = $2, category = $3, version = version + 1, updated_at = NOW()
     WHERE id = $4 AND board_id = $5
     RETURNING id, board_id, name, category, color, position, created_at, updated_at`,
    [newName, newColor, newCategory, columnId, boardId]
  );
  const row = updateRes.rows[0];
  if (!row) {
    throw new Error("Failed to update column.");
  }
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId]
  );
  const columnEvent = { workspaceId: boardRow.workspace_id, projectId: boardRow.project_id, boardId, actorId };
  if (input.name !== void 0) {
    await recordActivity(client, {
      ...columnEvent,
      visibilityScope: "board",
      action: "column_renamed",
      safeChanges: { columnId, name: newName }
    });
  }
  if (input.color !== void 0) {
    await recordActivity(client, {
      ...columnEvent,
      visibilityScope: "board",
      action: "column_recoloured",
      safeChanges: { columnId, color: newColor }
    });
  }
  if (input.category !== void 0) {
    await recordActivity(client, {
      ...columnEvent,
      visibilityScope: "board",
      action: "column_recategorised",
      safeChanges: { columnId, category: newCategory }
    });
  }
  const cardCountRes = await client.query(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'active'`,
    [columnId]
  );
  const cardCount = parseInt(cardCountRes.rows[0]?.count ?? "0", 10);
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    activeCardCount: cardCount,
    matchingCardCount: cardCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
async function reorderColumns(client, boardId, columnIds, expectedBoardVersion, actorId) {
  await lockBoardAccess(client, boardId, actorId);
  const bRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, "manager", boardId);
  if (boardRow.structure_version !== expectedBoardVersion) {
    throw HttpError.conflict("Stale board structure version.", "STALE_VERSION");
  }
  const colsRes = await client.query(
    `SELECT id FROM columns WHERE board_id = $1`,
    [boardId]
  );
  const existingIds = new Set(colsRes.rows.map((r) => r.id));
  const uniqueInputIds = new Set(columnIds);
  if (columnIds.length !== existingIds.size || uniqueInputIds.size !== columnIds.length || columnIds.some((id) => !existingIds.has(id))) {
    throw HttpError.badRequest(
      "Provided columnIds must match the exact set of columns on the board.",
      "INVALID_COLUMN_ORDER"
    );
  }
  for (let i = 0; i < columnIds.length; i++) {
    await client.query(
      `UPDATE columns SET position = $1, updated_at = NOW() WHERE id = $2 AND board_id = $3`,
      [i, columnIds[i], boardId]
    );
  }
  const bUpdate = await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING structure_version, snapshot_version`,
    [boardId]
  );
  const updatedBoard = bUpdate.rows[0];
  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: "board",
    actorId,
    action: "columns_reordered",
    safeChanges: { columnIds }
  });
  return {
    id: boardId,
    structureVersion: updatedBoard.structure_version,
    snapshotVersion: updatedBoard.snapshot_version
  };
}
async function deleteColumn(client, boardId, columnId, expectedBoardVersion, actorId) {
  await lockBoardAccess(client, boardId, actorId);
  const bRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, "manager", boardId);
  if (boardRow.structure_version !== expectedBoardVersion) {
    throw HttpError.conflict("Stale board structure version.", "STALE_VERSION");
  }
  const colRes = await client.query(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2 FOR UPDATE`,
    [columnId, boardId]
  );
  if (colRes.rows.length === 0 || !colRes.rows[0]) {
    throw HttpError.notFound("Column not found.", "NOT_FOUND");
  }
  const deletedColumnName = colRes.rows[0].name;
  const totalColsRes = await client.query(
    `SELECT COUNT(*)::text AS count FROM columns WHERE board_id = $1`,
    [boardId]
  );
  if (parseInt(totalColsRes.rows[0]?.count ?? "0", 10) <= 1) {
    throw HttpError.badRequest("Cannot delete the final column of a board.", "FINAL_COLUMN_CANNOT_BE_DELETED");
  }
  const activeCardsRes = await client.query(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'active'`,
    [columnId]
  );
  if (parseInt(activeCardsRes.rows[0]?.count ?? "0", 10) > 0) {
    throw HttpError.conflict("Column contains active cards and cannot be deleted.", "COLUMN_HAS_ACTIVE_CARDS");
  }
  const restorableCardsRes = await client.query(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'trashed' AND restore_until > NOW()`,
    [columnId]
  );
  if (parseInt(restorableCardsRes.rows[0]?.count ?? "0", 10) > 0) {
    throw HttpError.conflict("Column contains restorable cards and cannot be deleted.", "COLUMN_HAS_RESTORABLE_CARDS");
  }
  await client.query(`DELETE FROM columns WHERE id = $1 AND board_id = $2`, [columnId, boardId]);
  const remainingColsRes = await client.query(
    `SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC, id ASC`,
    [boardId]
  );
  for (let i = 0; i < remainingColsRes.rows.length; i++) {
    await client.query(
      `UPDATE columns SET position = $1, updated_at = NOW() WHERE id = $2 AND board_id = $3`,
      [i, remainingColsRes.rows[i].id, boardId]
    );
  }
  const bUpdate = await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING structure_version, snapshot_version`,
    [boardId]
  );
  const updatedBoard = bUpdate.rows[0];
  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: "board",
    actorId,
    action: "column_deleted",
    safeChanges: { columnId, name: deletedColumnName }
  });
  return {
    id: columnId,
    structureVersion: updatedBoard.structure_version,
    snapshotVersion: updatedBoard.snapshot_version
  };
}
async function getPlacement(clientOrPool, boardId, columnId, movingCardId, at, anchorCardId, actorId) {
  const pool = clientOrPool ?? getPool();
  const bRes = await pool.query(
    `SELECT b.id, b.project_id, b.workspace_id, b.structure_version
     FROM boards b
     JOIN columns c ON c.board_id = b.id AND c.id = $2
     WHERE b.id = $1`,
    [boardId, columnId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board or column not found.", "NOT_FOUND");
  }
  const boardRow = bRes.rows[0];
  if (actorId) {
    await requireBoardRead(pool, boardId, boardRow.project_id, actorId);
  }
  const movingCardRes = await pool.query(
    `SELECT id, board_id, project_id, workspace_id, state FROM cards WHERE id = $1`,
    [movingCardId]
  );
  if (movingCardRes.rows.length === 0 || movingCardRes.rows[0]?.state !== "active") {
    throw HttpError.notFound("Moving card not found.", "NOT_FOUND");
  }
  if (movingCardRes.rows[0].board_id !== boardId || movingCardRes.rows[0].project_id !== boardRow.project_id || movingCardRes.rows[0].workspace_id !== boardRow.workspace_id) {
    throw HttpError.badRequest("Moving card does not belong to this board and project.", "INVALID_MOVING_CARD");
  }
  if (anchorCardId && anchorCardId === movingCardId) {
    throw HttpError.badRequest("Anchor card cannot be the moving card.", "INVALID_ANCHOR_CARD");
  }
  const cardsRes = await pool.query(
    `SELECT id FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC`,
    [columnId, movingCardId]
  );
  const cards = cardsRes.rows;
  let previousCardId = null;
  let nextCardId = null;
  if (at === "first") {
    previousCardId = null;
    nextCardId = cards[0]?.id ?? null;
  } else if (at === "last") {
    previousCardId = cards.length > 0 ? cards[cards.length - 1]?.id ?? null : null;
    nextCardId = null;
  } else if (at === "before") {
    if (!anchorCardId) {
      throw HttpError.badRequest("anchorCardId is required for placement before", "VALIDATION_ERROR");
    }
    const idx = cards.findIndex((c) => c.id === anchorCardId);
    if (idx === -1) {
      throw HttpError.badRequest("Anchor card not found in destination column.", "ANCHOR_CARD_NOT_FOUND");
    }
    previousCardId = idx > 0 ? cards[idx - 1]?.id ?? null : null;
    nextCardId = anchorCardId;
  } else if (at === "after") {
    if (!anchorCardId) {
      throw HttpError.badRequest("anchorCardId is required for placement after", "VALIDATION_ERROR");
    }
    const idx = cards.findIndex((c) => c.id === anchorCardId);
    if (idx === -1) {
      throw HttpError.badRequest("Anchor card not found in destination column.", "ANCHOR_CARD_NOT_FOUND");
    }
    previousCardId = anchorCardId;
    nextCardId = idx < cards.length - 1 ? cards[idx + 1]?.id ?? null : null;
  }
  return {
    movingCardId,
    toColumnId: columnId,
    previousCardId,
    nextCardId,
    structureVersion: boardRow.structure_version
  };
}
function buildCardFilterClauses(filters, asOfDate, paramStartIndex) {
  const clauses = [];
  const params = [];
  let paramIdx = paramStartIndex;
  if (filters.columnId) {
    clauses.push(`c.column_id = $${paramIdx++}`);
    params.push(filters.columnId);
  }
  if (filters.titleQuery && filters.titleQuery.trim().length > 0) {
    clauses.push(`c.title ILIKE '%' || $${paramIdx++} || '%'`);
    params.push(filters.titleQuery.trim());
  }
  if (filters.priority) {
    clauses.push(`c.priority = $${paramIdx++}`);
    params.push(filters.priority);
  }
  if (filters.assigneeId) {
    clauses.push(`EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id AND ca.user_id = $${paramIdx++})`);
    params.push(filters.assigneeId);
  }
  if (filters.due) {
    if (filters.due === "overdue") {
      clauses.push(`c.due_date IS NOT NULL AND c.due_date < $${paramIdx++}::date AND col.category != 'done'`);
      params.push(asOfDate);
    } else if (filters.due === "today") {
      clauses.push(`c.due_date = $${paramIdx++}::date`);
      params.push(asOfDate);
    } else if (filters.due === "upcoming") {
      clauses.push(`c.due_date > $${paramIdx++}::date`);
      params.push(asOfDate);
    } else if (filters.due === "none") {
      clauses.push(`c.due_date IS NULL`);
    }
  }
  return {
    sql: clauses.length > 0 ? " AND " + clauses.join(" AND ") : "",
    params
  };
}
async function getBoardSnapshot(pool, boardId, actorId, query) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await lockBoardAccess(client, boardId, actorId);
    const bRes = await client.query(
      `SELECT b.id, b.workspace_id, b.project_id, b.name, b.description,
              b.structure_version, b.snapshot_version, b.archived,
              b.created_at, b.updated_at, w.timezone
       FROM boards b
       JOIN workspaces w ON w.id = b.workspace_id
       WHERE b.id = $1`,
      [boardId]
    );
    if (bRes.rows.length === 0 || !bRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const bRow = bRes.rows[0];
    const asOfDate = getWorkspaceToday(bRow.timezone);
    const cardLimit = Math.max(1, Math.min(query?.cardLimitPerColumn ?? 10, 15));
    const colsRes = await client.query(
      `SELECT id, board_id, name, category, color, tone, position
       FROM columns
       WHERE board_id = $1
       ORDER BY position ASC`,
      [boardId]
    );
    const columnsList = colsRes.rows;
    const activeCountsRes = await client.query(
      `SELECT col.id AS column_id, COUNT(c.id)::text AS count
       FROM columns col
       LEFT JOIN cards c ON c.column_id = col.id AND c.state = 'active'
       WHERE col.board_id = $1
       GROUP BY col.id`,
      [boardId]
    );
    const activeCountMap = /* @__PURE__ */ new Map();
    for (const r of activeCountsRes.rows) {
      activeCountMap.set(r.column_id, parseInt(r.count, 10));
    }
    const filterClauses = buildCardFilterClauses(
      {
        titleQuery: query?.titleQuery,
        priority: query?.priority,
        assigneeId: query?.assigneeId,
        due: query?.due
      },
      asOfDate,
      2
    );
    const matchingCountsRes = await client.query(
      `SELECT col.id AS column_id, COUNT(c.id)::text AS count
       FROM columns col
       LEFT JOIN cards c ON c.column_id = col.id AND c.state = 'active'
       ${filterClauses.sql}
       WHERE col.board_id = $1
       GROUP BY col.id`,
      [boardId, ...filterClauses.params]
    );
    const matchingCountMap = /* @__PURE__ */ new Map();
    for (const r of matchingCountsRes.rows) {
      matchingCountMap.set(r.column_id, parseInt(r.count, 10));
    }
    const dueCountsRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE c.due_date < $2::date)::text AS overdue,
         COUNT(*) FILTER (WHERE c.due_date >= $2::date AND c.due_date <= ($2::date + 7))::text AS due_soon
       FROM cards c
       JOIN columns col ON col.id = c.column_id
       WHERE c.board_id = $1 AND c.state = 'active' AND c.due_date IS NOT NULL AND col.category <> 'done'`,
      [boardId, asOfDate]
    );
    const dueCounts = {
      overdue: Number(dueCountsRes.rows[0]?.overdue ?? 0),
      dueSoon: Number(dueCountsRes.rows[0]?.due_soon ?? 0)
    };
    const cardsParamStart = 2 + filterClauses.params.length;
    const cardsQueryRes = await client.query(
      `WITH filtered_cards AS (
         SELECT
           c.id,
           c.board_id,
           c.column_id,
           c.title,
           p.key_prefix || '-' || c.card_number::text AS card_key,
           LEFT(BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(c.description, ''), '<[^>]*>|[#*_\`~>\\[\\]]', ' ', 'g'), '\\s+', ' ', 'g')), 160) AS description_excerpt,
           c.priority,
           TO_CHAR(c.due_date, 'YYYY-MM-DD') AS due_date,
           c.position,
           c.version,
           c.created_at,
           c.updated_at,
           COALESCE(comm.comment_count, 0)::int AS comment_count,
           COALESCE(img.image_count, 0)::int AS image_count,
           COALESCE(assignees.user_ids, ARRAY[]::text[]) AS assignee_ids,
           ROW_NUMBER() OVER (PARTITION BY c.column_id ORDER BY c.position ASC, c.id ASC) AS row_num
         FROM cards c
         JOIN columns col ON col.id = c.column_id
         JOIN projects p ON p.id = c.project_id
         LEFT JOIN (
           SELECT card_id, COUNT(*)::int AS comment_count
           FROM comments
           WHERE deleted_at IS NULL
           GROUP BY card_id
         ) comm ON comm.card_id = c.id
         LEFT JOIN (
           SELECT card_id, COUNT(*)::int AS image_count
           FROM card_images
           GROUP BY card_id
         ) img ON img.card_id = c.id
         LEFT JOIN (
           SELECT card_id, ARRAY_AGG(user_id ORDER BY user_id ASC) AS user_ids
           FROM card_assignees
           GROUP BY card_id
         ) assignees ON assignees.card_id = c.id
         WHERE c.board_id = $1 AND c.state = 'active'
           ${filterClauses.sql}
       )
       SELECT * FROM filtered_cards
       WHERE row_num <= $${cardsParamStart}
       ORDER BY column_id, row_num ASC`,
      [boardId, ...filterClauses.params, cardLimit + 1]
    );
    const cardsByCol = /* @__PURE__ */ new Map();
    for (const cardRow of cardsQueryRes.rows) {
      let list = cardsByCol.get(cardRow.column_id);
      if (!list) {
        list = [];
        cardsByCol.set(cardRow.column_id, list);
      }
      list.push(cardRow);
    }
    const peopleRes = await client.query(
      `SELECT DISTINCT
         u.id,
         u.display_name,
         u.avatar_url,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' THEN TRUE
           ELSE FALSE
         END AS active_in_project,
         CASE
           WHEN w.owner_id = u.id THEN 'owner'
           WHEN pm.id IS NOT NULL THEN pm.role
           ELSE NULL
         END AS scoped_role,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' AND pm.role IN ('manager', 'member') THEN TRUE
           ELSE FALSE
         END AS assignable,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' THEN TRUE
           ELSE FALSE
         END AS mentionable
       FROM card_assignees ca
       JOIN cards c ON c.id = ca.card_id
       JOIN users u ON u.id = ca.user_id
       JOIN projects p ON p.id = c.project_id
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = u.id
       WHERE c.board_id = $1 AND c.state = 'active'
       ORDER BY u.display_name ASC, u.id ASC`,
      [boardId]
    );
    const peopleRaw = peopleRes.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      activeInProject: Boolean(r.active_in_project),
      ...r.scoped_role ? { scopedRole: r.scoped_role } : {},
      assignable: Boolean(r.assignable),
      mentionable: Boolean(r.mentionable)
    }));
    const suffixes = await projectNameSuffixes(client, bRow.project_id);
    const people = peopleRaw.map((p) => withNameSuffix(p, suffixes));
    await client.query("COMMIT");
    let totalActiveCount = 0;
    let totalMatchingCount = 0;
    const columnSummaries = columnsList.map((col) => {
      const activeCount = activeCountMap.get(col.id) ?? 0;
      const matchingCount = matchingCountMap.get(col.id) ?? 0;
      totalActiveCount += activeCount;
      totalMatchingCount += matchingCount;
      const rawCards = cardsByCol.get(col.id) ?? [];
      const hasMore = rawCards.length > cardLimit;
      const visibleCards = hasMore ? rawCards.slice(0, cardLimit) : rawCards;
      const cardSummaries = visibleCards.map((c) => ({
        id: c.id,
        boardId: c.board_id,
        columnId: c.column_id,
        title: c.title,
        priority: c.priority,
        dueDate: c.due_date,
        assigneeIds: c.assignee_ids,
        position: Number(c.position),
        version: c.version,
        commentCount: c.comment_count,
        imageCount: c.image_count,
        key: c.card_key,
        descriptionExcerpt: c.description_excerpt,
        createdAt: new Date(c.created_at).toISOString(),
        updatedAt: new Date(c.updated_at).toISOString()
      }));
      const colFilterHash = computeCardFilterHash({
        columnId: col.id,
        titleQuery: query?.titleQuery,
        priority: query?.priority,
        assigneeId: query?.assigneeId,
        due: query?.due,
        asOfDate
      });
      const nextCursor = hasMore && visibleCards.length > 0 ? encodeCardCursor({
        boardId,
        filterHash: colFilterHash,
        snapshotVersion: bRow.snapshot_version,
        structureVersion: bRow.structure_version,
        position: Number(visibleCards[visibleCards.length - 1].position),
        id: visibleCards[visibleCards.length - 1].id
      }) : null;
      return {
        id: col.id,
        name: col.name,
        category: col.category,
        color: col.color,
        tone: col.tone,
        position: col.position,
        activeCardCount: activeCount,
        matchingCardCount: matchingCount,
        cards: cardSummaries,
        nextCursor
      };
    });
    return {
      board: {
        id: bRow.id,
        workspaceId: bRow.workspace_id,
        projectId: bRow.project_id,
        name: bRow.name,
        description: bRow.description,
        isArchived: Boolean(bRow.archived),
        structureVersion: bRow.structure_version,
        snapshotVersion: bRow.snapshot_version,
        createdAt: new Date(bRow.created_at).toISOString(),
        updatedAt: new Date(bRow.updated_at).toISOString()
      },
      filters: {
        titleQuery: query?.titleQuery ?? null,
        priority: query?.priority ?? null,
        assigneeId: query?.assigneeId ?? null,
        due: query?.due ?? null
      },
      asOfDate,
      totals: {
        activeCardCount: totalActiveCount,
        matchingCardCount: totalMatchingCount,
        overdueCount: dueCounts.overdue,
        dueSoonCount: dueCounts.dueSoon
      },
      columns: columnSummaries,
      people
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    if (err?.code === "40001") {
      throw HttpError.conflict("Board access changed. Retry the request.", "ACCESS_CHANGED");
    }
    throw err;
  } finally {
    client.release();
  }
}
async function listBoardCards(clientOrPool, boardId, query, actorId) {
  const pool = clientOrPool ?? getPool();
  const bRes = await pool.query(
    `SELECT b.id, b.project_id, b.workspace_id, b.structure_version, b.snapshot_version, w.timezone
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1`,
    [boardId]
  );
  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const bRow = bRes.rows[0];
  await requireBoardRead(pool, boardId, bRow.project_id, actorId);
  const asOfDate = getWorkspaceToday(bRow.timezone);
  const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
  const currentFilterHash = computeCardFilterHash({
    columnId: query.columnId,
    query: query.query,
    priority: query.priority,
    assigneeId: query.assigneeId,
    due: query.due,
    asOfDate
  });
  const filterClauses = buildCardFilterClauses(
    {
      columnId: query.columnId,
      titleQuery: query.query,
      priority: query.priority,
      assigneeId: query.assigneeId,
      due: query.due
    },
    asOfDate,
    2
  );
  const queryParams = [boardId, ...filterClauses.params];
  let cursorCondition = "";
  if (query.cursor) {
    const cursorPayload = decodeCardCursor(query.cursor);
    if (!cursorPayload || cursorPayload.bId !== boardId || cursorPayload.fH !== currentFilterHash || cursorPayload.sV !== bRow.snapshot_version || cursorPayload.oV !== bRow.structure_version) {
      throw HttpError.conflict("Stale or malformed pagination cursor.", "STALE_CURSOR");
    }
    const curPosIdx = queryParams.length + 1;
    const curIdIdx = queryParams.length + 2;
    cursorCondition = ` AND (c.position > $${curPosIdx} OR (c.position = $${curPosIdx} AND c.id > $${curIdIdx}))`;
    queryParams.push(cursorPayload.position, cursorPayload.id);
  }
  const limitParamIdx = queryParams.length + 1;
  queryParams.push(limit + 1);
  const sql2 = `
    SELECT
      c.id,
      c.board_id,
      c.column_id,
      c.title,
      c.priority,
      TO_CHAR(c.due_date, 'YYYY-MM-DD') AS due_date,
      c.position,
      c.version,
      c.created_at,
      c.updated_at,
      COALESCE(comm.comment_count, 0)::int AS comment_count,
      COALESCE(img.image_count, 0)::int AS image_count,
      COALESCE(assignees.user_ids, ARRAY[]::text[]) AS assignee_ids
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    LEFT JOIN (
      SELECT card_id, COUNT(*)::int AS comment_count
      FROM comments
      WHERE deleted_at IS NULL
      GROUP BY card_id
    ) comm ON comm.card_id = c.id
    LEFT JOIN (
      SELECT card_id, COUNT(*)::int AS image_count
      FROM card_images
      GROUP BY card_id
    ) img ON img.card_id = c.id
    LEFT JOIN (
      SELECT card_id, ARRAY_AGG(user_id ORDER BY user_id ASC) AS user_ids
      FROM card_assignees
      GROUP BY card_id
    ) assignees ON assignees.card_id = c.id
    WHERE c.board_id = $1 AND c.state = 'active'
      ${filterClauses.sql}
      ${cursorCondition}
    ORDER BY c.position ASC, c.id ASC
    LIMIT $${limitParamIdx}
  `;
  const res = await pool.query(sql2, queryParams);
  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const cards = pageRows.map((c) => ({
    id: c.id,
    boardId: c.board_id,
    columnId: c.column_id,
    title: c.title,
    priority: c.priority,
    dueDate: c.due_date,
    assigneeIds: c.assignee_ids,
    position: Number(c.position),
    version: c.version,
    commentCount: c.comment_count,
    imageCount: c.image_count,
    createdAt: new Date(c.created_at).toISOString(),
    updatedAt: new Date(c.updated_at).toISOString()
  }));
  const nextCursor = hasMore && pageRows.length > 0 ? encodeCardCursor({
    boardId,
    filterHash: currentFilterHash,
    snapshotVersion: bRow.snapshot_version,
    structureVersion: bRow.structure_version,
    position: Number(pageRows[pageRows.length - 1].position),
    id: pageRows[pageRows.length - 1].id
  }) : null;
  return {
    data: cards,
    nextCursor
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/project-overview.ts
var READABLE_BOARDS = `
  readable AS (
    SELECT b.id
    FROM boards b
    JOIN workspaces w ON w.id = b.workspace_id
    WHERE b.project_id = $1
      AND b.archived = FALSE
      AND (
        w.owner_id = $2
        OR EXISTS (
          SELECT 1 FROM board_grants g
          WHERE g.board_id = b.id AND g.project_id = b.project_id AND g.user_id = $2
        )
      )
  )`;
async function getProjectOverview(pool, projectId, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ctx = await client.query(
      `SELECT w.owner_id, w.timezone, pm.role
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN project_memberships pm
         ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
       WHERE p.id = $1`,
      [projectId, actorId]
    );
    const row = ctx.rows[0];
    if (!row || row.owner_id !== actorId && !row.role) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    const today = getWorkspaceToday(row.timezone);
    const boardCount = await client.query(
      `WITH ${READABLE_BOARDS} SELECT COUNT(*)::text AS n FROM readable`,
      [projectId, actorId]
    );
    const cardRows = await client.query(
      `WITH ${READABLE_BOARDS}
       SELECT col.category,
              COUNT(*)::text AS active,
              COUNT(*) FILTER (WHERE c.due_date < $3::date AND col.category <> 'done')::text AS overdue,
              COUNT(*) FILTER (
                WHERE c.due_date >= $3::date AND c.due_date <= ($3::date + 7) AND col.category <> 'done'
              )::text AS due_soon,
              COUNT(*) FILTER (
                WHERE col.category <> 'done'
                  AND NOT EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id)
              )::text AS unassigned_open
       FROM cards c
       JOIN readable r ON r.id = c.board_id
       JOIN columns col ON col.id = c.column_id
       WHERE c.project_id = $1 AND c.state = 'active'
       GROUP BY col.category`,
      [projectId, actorId, today]
    );
    const byCategory = { todo: 0, active: 0, done: 0 };
    let active = 0;
    let overdue = 0;
    let dueSoon = 0;
    let unassignedOpen = 0;
    for (const r of cardRows.rows) {
      byCategory[r.category] = Number(r.active);
      active += Number(r.active);
      overdue += Number(r.overdue);
      dueSoon += Number(r.due_soon);
      unassignedOpen += Number(r.unassigned_open);
    }
    const assigneeRows = await client.query(
      `WITH ${READABLE_BOARDS}
       SELECT u.id AS user_id, u.display_name, u.avatar_url, COUNT(*)::text AS open_count
       FROM card_assignees ca
       JOIN cards c ON c.id = ca.card_id AND c.state = 'active' AND c.project_id = $1
       JOIN readable r ON r.id = c.board_id
       JOIN columns col ON col.id = c.column_id AND col.category <> 'done'
       JOIN users u ON u.id = ca.user_id
       GROUP BY u.id, u.display_name, u.avatar_url
       ORDER BY COUNT(*) DESC, u.id ASC
       LIMIT 50`,
      [projectId, actorId]
    );
    const canSeeProjectRows = row.owner_id === actorId || row.role === "manager";
    const activityRows = await client.query(
      `WITH ${READABLE_BOARDS}
       SELECT a.id, a.action, a.card_id, a.created_at, a.actor_id, u.display_name AS actor_name
       FROM activity_log a
       JOIN users u ON u.id = a.actor_id
       WHERE a.project_id = $1
         AND (
           (a.visibility_scope = 'board' AND a.board_id IN (SELECT id FROM readable))
           OR (a.visibility_scope = 'project' AND $3::boolean)
         )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 10`,
      [projectId, actorId, canSeeProjectRows]
    );
    await client.query("COMMIT");
    return {
      projectId,
      asOfDate: today,
      readableBoardCount: Number(boardCount.rows[0]?.n ?? 0),
      cards: {
        active,
        byCategory,
        overdue,
        dueSoon,
        unassignedOpen
      },
      assignees: assigneeRows.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        openCount: Number(r.open_count)
      })),
      recentActivity: activityRows.rows.map((r) => ({
        id: r.id,
        action: r.action,
        cardId: r.card_id,
        createdAt: new Date(r.created_at).toISOString(),
        actor: { id: r.actor_id, displayName: r.actor_name }
      }))
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/idempotency.ts
import crypto8 from "node:crypto";
function minimalReceiptOutcome(responseBody) {
  const parseValue = (value) => {
    if (Array.isArray(value)) {
      return value.map(parseValue);
    }
    if (!value || typeof value !== "object") {
      return void 0;
    }
    const record = value;
    const outcome = {};
    for (const key of [
      "id",
      "version",
      "structureVersion",
      "snapshotVersion",
      "operationId",
      "success",
      "role",
      "projectId",
      "workspaceId",
      "state",
      "status"
    ]) {
      const field = record[key];
      if (typeof field === "string" || typeof field === "number" || typeof field === "boolean") {
        outcome[key] = field;
      }
    }
    if (Object.hasOwn(record, "data")) {
      outcome.data = parseValue(record.data) ?? {};
    }
    return outcome;
  };
  return parseValue(responseBody) ?? {};
}
async function checkOrReplayProjectWriteReceipt(client, actorId, projectId, minRole, idempotencyKey, methodPath, body, boardId) {
  await acquireWriteGrantLock(client, projectId, actorId, minRole, boardId);
  await acquireWritableProjectContextLock(client, projectId, boardId);
  return checkOrReplayReceipt(
    client,
    actorId,
    "project",
    projectId,
    idempotencyKey,
    methodPath,
    body
  );
}
function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const entries = [];
  for (const key of keys) {
    const val = obj[key];
    if (val !== void 0) {
      entries.push(`${JSON.stringify(key)}:${canonicalJson(val)}`);
    }
  }
  return `{${entries.join(",")}}`;
}
function sha256(input) {
  return crypto8.createHash("sha256").update(input).digest("hex");
}
async function checkOrReplayReceipt(client, actorId, scopeType, scopeId, idempotencyKey, methodPath, body) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [JSON.stringify([actorId, scopeType, scopeId, idempotencyKey])]
  );
  const currentPathHash = sha256(methodPath);
  const currentBodyHash = sha256(canonicalJson(body ?? {}));
  const res = await client.query(
    `SELECT id, method_path_hash, body_hash, status_code, response_body
     FROM idempotency_receipts
     WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3 AND expires_at > NOW()`,
    [actorId, scopeId, idempotencyKey]
  );
  if (res.rows.length === 0 || !res.rows[0]) {
    return null;
  }
  const receipt = res.rows[0];
  if (receipt.method_path_hash === currentPathHash && receipt.body_hash === currentBodyHash) {
    const responseBody = typeof receipt.response_body === "string" ? JSON.parse(receipt.response_body) : receipt.response_body;
    return {
      statusCode: receipt.status_code,
      responseBody: minimalReceiptOutcome(responseBody),
      replayed: true
    };
  }
  throw HttpError.conflict(
    "Idempotency key collision with different request payload.",
    "IDEMPOTENCY_CONFLICT"
  );
}
async function saveReceipt(client, actorId, scopeType, scopeId, idempotencyKey, methodPath, body, statusCode, responseBody, ttlDays = 7) {
  const methodPathHash = sha256(methodPath);
  const bodyHash = sha256(canonicalJson(body ?? {}));
  const id = "rcp_" + crypto8.randomUUID();
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1e3);
  const insertRes = await client.query(
    `INSERT INTO idempotency_receipts (
      id, actor_id, scope_type, scope_id, idempotency_key,
      method_path_hash, body_hash, status_code, response_body,
      expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (actor_id, scope_id, idempotency_key)
    DO UPDATE SET
      method_path_hash = EXCLUDED.method_path_hash,
      body_hash = EXCLUDED.body_hash,
      status_code = EXCLUDED.status_code,
      response_body = EXCLUDED.response_body,
      expires_at = EXCLUDED.expires_at,
      created_at = EXCLUDED.created_at
    WHERE idempotency_receipts.expires_at <= NOW()
    RETURNING id`,
    [
      id,
      actorId,
      scopeType,
      scopeId,
      idempotencyKey,
      methodPathHash,
      bodyHash,
      statusCode,
      JSON.stringify(minimalReceiptOutcome(responseBody)),
      expiresAt.toISOString(),
      now.toISOString()
    ]
  );
  if (insertRes.rows.length === 0) {
    const winnerRes = await client.query(
      `SELECT id, method_path_hash, body_hash, status_code, response_body
       FROM idempotency_receipts
       WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3`,
      [actorId, scopeId, idempotencyKey]
    );
    if (winnerRes.rows.length === 0 || !winnerRes.rows[0]) {
      return null;
    }
    const winner = winnerRes.rows[0];
    if (winner.method_path_hash !== methodPathHash || winner.body_hash !== bodyHash) {
      throw HttpError.conflict(
        "Idempotency key collision with different request payload.",
        "IDEMPOTENCY_CONFLICT"
      );
    }
    const parsedWinnerBody = typeof winner.response_body === "string" ? JSON.parse(winner.response_body) : winner.response_body;
    return {
      statusCode: winner.status_code,
      responseBody: minimalReceiptOutcome(parsedWinnerBody),
      replayed: true
    };
  }
  return null;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/projects.ts
function isPool(target) {
  return typeof target.connect === "function" && typeof target.totalCount === "number";
}
function encodeProjectCursor(item) {
  return Buffer.from(JSON.stringify({ name: item.name, id: item.id })).toString("base64url");
}
function decodeProjectCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === "string" && typeof parsed.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
async function getWorkspaceProjects(clientOrPool, actor, workspaceId, options = {}) {
  const pool = clientOrPool ?? getPool();
  const wsRes = await pool.query(
    `SELECT id, owner_id FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  if (!wsRes.rows[0]) {
    throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
  }
  const isOwner = wsRes.rows[0].owner_id === actor.id;
  if (!isOwner) {
    const grantCheck = await pool.query(
      `SELECT COUNT(*)::text AS count 
       FROM project_memberships 
       WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, actor.id]
    );
    if (grantCheck.rows[0]?.count === "0") {
      throw HttpError.notFound("Workspace not found or unauthorized.", "NOT_FOUND");
    }
  }
  const rawLimit = typeof options.limit === "number" && !Number.isNaN(options.limit) && options.limit >= 1 ? options.limit : 50;
  const limit = Math.min(rawLimit, 100);
  const cursorPayload = decodeProjectCursor(options.cursor);
  let query;
  let params;
  if (isOwner) {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
                    dbd.id AS default_board_id
             FROM projects p
             JOIN workspaces w ON w.id = p.workspace_id
             ${readableDefaultBoardJoin("$2")}
             WHERE p.workspace_id = $1
               AND ($3::text IS NULL OR (p.name > $3 OR (p.name = $3 AND p.id > $4)))
             ORDER BY p.name ASC, p.id ASC
             LIMIT $5`;
    params = [workspaceId, actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1];
  } else {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
                    dbd.id AS default_board_id
             FROM projects p
             JOIN workspaces w ON w.id = p.workspace_id
             JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
             ${readableDefaultBoardJoin("$2")}
             WHERE p.workspace_id = $1
               AND ($3::text IS NULL OR (p.name > $3 OR (p.name = $3 AND p.id > $4)))
             ORDER BY p.name ASC, p.id ASC
             LIMIT $5`;
    params = [workspaceId, actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1];
  }
  const res = await pool.query(query, params);
  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const projects = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
  const nextCursor = hasMore && pageRows.length > 0 ? encodeProjectCursor(pageRows[pageRows.length - 1]) : null;
  return {
    data: projects,
    nextCursor
  };
}
async function getAllAccessibleProjects(clientOrPool, actor, options = {}) {
  const pool = clientOrPool ?? getPool();
  const rawLimit = typeof options.limit === "number" && !Number.isNaN(options.limit) && options.limit >= 1 ? options.limit : 50;
  const limit = Math.min(rawLimit, 100);
  const cursorPayload = decodeProjectCursor(options.cursor);
  const query = `
    SELECT DISTINCT
      p.id,
      p.workspace_id,
      p.name,
      p.description,
      p.archived,
      p.version,
      p.created_at,
      p.updated_at,
      dbd.id AS default_board_id,
      CASE 
        WHEN w.owner_id = $1 THEN 'owner'
        ELSE pm.role
      END AS role
    FROM projects p
    JOIN workspaces w ON p.workspace_id = w.id
    LEFT JOIN project_memberships pm 
      ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
    ${readableDefaultBoardJoin("$1")}
    WHERE (w.owner_id = $1 OR (pm.user_id = $1 AND pm.status = 'active'))
      AND ($2::text IS NULL OR (p.name > $2 OR (p.name = $2 AND p.id > $3)))
    ORDER BY p.name ASC, p.id ASC
    LIMIT $4
  `;
  const res = await pool.query(query, [actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1]);
  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const projects = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    role: row.role
  }));
  const nextCursor = hasMore && pageRows.length > 0 ? encodeProjectCursor(pageRows[pageRows.length - 1]) : null;
  return {
    data: projects,
    nextCursor
  };
}
async function getProjectLinks(client, projectId) {
  const res = await client.query(
    "SELECT id, title, url, position FROM project_links WHERE project_id = $1 ORDER BY position ASC",
    [projectId]
  );
  return res.rows;
}
async function updateProjectSettings(clientOrPool, actor, projectId, input) {
  const pool = clientOrPool ?? getPool();
  let poolClient;
  let client;
  if (isPool(pool)) {
    poolClient = await pool.connect();
    client = poolClient;
  } else {
    client = pool;
  }
  try {
    if (poolClient) {
      await client.query("BEGIN");
    }
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    if (input.defaultBoardId !== void 0 && !grant.isOwner) {
      throw HttpError.forbidden("Only the project owner can change the default board.", "FORBIDDEN");
    }
    const prjRes = await client.query(
      `SELECT version FROM projects WHERE id = $1`,
      [projectId]
    );
    if (prjRes.rows.length === 0) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    if (prjRes.rows[0].version !== input.expectedVersion) {
      throw HttpError.conflict("Stale project version.", "STALE_VERSION");
    }
    if (input.defaultBoardId) {
      const boardRes = await client.query(
        `SELECT archived FROM boards WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [input.defaultBoardId, projectId]
      );
      if (!boardRes.rows[0]) {
        throw HttpError.notFound("Board not found.", "NOT_FOUND");
      }
      if (boardRes.rows[0].archived) {
        throw HttpError.unprocessable("BOARD_ARCHIVED", "The default board must be an active board.");
      }
    }
    const updateRes = await client.query(
      `UPDATE projects
       SET name = CASE WHEN $1::boolean THEN $2 ELSE name END,
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           brief = CASE WHEN $5::boolean THEN $6::text ELSE brief END,
           default_board_id = CASE WHEN $7::boolean THEN $8::text ELSE default_board_id END,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $9 AND version = $10
       RETURNING id, workspace_id, name, description, brief, archived, version, created_at, updated_at`,
      [
        input.name !== void 0,
        input.name ?? null,
        input.description !== void 0,
        input.description ?? null,
        input.brief !== void 0,
        input.brief ?? null,
        input.defaultBoardId !== void 0,
        input.defaultBoardId ?? null,
        projectId,
        input.expectedVersion
      ]
    );
    const updatedRow = updateRes.rows[0];
    if (!updatedRow) {
      throw HttpError.conflict("Stale project version.", "STALE_VERSION");
    }
    if (input.links !== void 0) {
      await client.query("DELETE FROM project_links WHERE project_id = $1", [projectId]);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      for (const [position, link] of input.links.entries()) {
        await client.query(
          `INSERT INTO project_links (id, workspace_id, project_id, title, url, position, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [`plk_${crypto.randomUUID()}`, updatedRow.workspace_id, projectId, link.title, link.url, position, nowIso]
        );
      }
    }
    if (input.brief !== void 0) {
      await recordActivity(client, {
        workspaceId: updatedRow.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: "project_brief_updated",
        safeChanges: { cleared: input.brief === null }
      });
    }
    if (input.links !== void 0) {
      await recordActivity(client, {
        workspaceId: updatedRow.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: "project_links_updated",
        safeChanges: { count: input.links.length }
      });
    }
    if (input.defaultBoardId !== void 0) {
      await recordActivity(client, {
        workspaceId: updatedRow.workspace_id,
        projectId,
        boardId: input.defaultBoardId,
        visibilityScope: input.defaultBoardId ? "board" : "project",
        actorId: actor.id,
        action: "default_board_changed",
        safeChanges: { defaultBoardId: input.defaultBoardId ?? null }
      });
    }
    const defaultBoardId = await readReadableDefaultBoardId(client, projectId, actor.id);
    const links = await getProjectLinks(client, projectId);
    if (poolClient) {
      await client.query("COMMIT");
    }
    return {
      id: updatedRow.id,
      workspaceId: updatedRow.workspace_id,
      name: updatedRow.name,
      description: updatedRow.description,
      defaultBoardId,
      brief: updatedRow.brief,
      links,
      isArchived: Boolean(updatedRow.archived),
      version: updatedRow.version,
      createdAt: new Date(updatedRow.created_at).toISOString(),
      updatedAt: new Date(updatedRow.updated_at).toISOString()
    };
  } catch (err) {
    if (poolClient) {
      await client.query("ROLLBACK").catch(() => {
      });
    }
    throw err;
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
}
async function getProjectMembers(clientOrPool, actor, projectId) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `SELECT p.id, p.workspace_id,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role,
            pm.status AS member_status
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1`,
    [projectId, actor.id]
  );
  const row = res.rows[0];
  if (!row) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const isWorkspaceOwner = row.workspace_owner_id === actor.id;
  if (!isWorkspaceOwner) {
    if (!row.member_role || row.member_status !== "active") {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
  }
  const pmRes = await pool.query(
    `SELECT 
       pm.id AS membership_id,
       pm.role,
       pm.status,
       pm.version,
       u.id AS user_id,
       u.display_name,
       u.email,
       u.avatar_url
     FROM project_memberships pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.status = 'active'
     ORDER BY pm.created_at ASC, u.display_name ASC`,
    [projectId]
  );
  const ownerRes = await pool.query(
    `SELECT u.id, u.display_name, u.email, u.avatar_url
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     WHERE w.id = $1`,
    [row.workspace_id]
  );
  const ownerUser = ownerRes.rows[0];
  const members = [];
  const ownerInMembers = ownerUser && pmRes.rows.find((r) => r.user_id === ownerUser.id);
  if (ownerUser && !ownerInMembers) {
    members.push({
      id: ownerUser.id,
      userId: ownerUser.id,
      name: ownerUser.display_name,
      displayName: ownerUser.display_name,
      email: ownerUser.email,
      avatarUrl: ownerUser.avatar_url,
      role: "owner",
      status: "active",
      version: 1,
      membershipId: `pm_owner_${ownerUser.id}`
    });
  }
  for (const r of pmRes.rows) {
    const isOwnerUser = ownerUser && r.user_id === ownerUser.id;
    members.push({
      id: r.user_id,
      userId: r.user_id,
      name: r.display_name,
      displayName: r.display_name,
      email: r.email,
      avatarUrl: r.avatar_url,
      role: isOwnerUser ? "owner" : r.role,
      status: "active",
      version: r.version,
      membershipId: r.membership_id
    });
  }
  return {
    data: members,
    nextCursor: null
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/projects.ts
var projectsRoutes = new Hono4();
async function lockProjectOwner(client, projectId, actorId, action = "archive") {
  const res = await client.query(
    `SELECT w.owner_id, pm.role
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId, actorId]
  );
  const row = res.rows[0];
  if (!row) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  if (row.owner_id === actorId) {
    return;
  }
  if (row.role) {
    throw HttpError.forbidden(`Only workspace owner can ${action} projects.`, "FORBIDDEN");
  }
  throw HttpError.notFound("Project not found.", "NOT_FOUND");
}
function parseLimit(limitParam) {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}
projectsRoutes.get("/api/v1/projects", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const queryParams = c.req.query();
  const limit = parseLimit(queryParams.limit);
  const cursor = queryParams.cursor;
  const pool = getPool();
  const result = await getAllAccessibleProjects(pool, actor, { limit, cursor });
  return c.json(result, 200);
});
projectsRoutes.post("/api/v1/workspaces/:workspaceId/projects", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const workspaceId = c.req.param("workspaceId");
  const pool = getPool();
  const wsRes = await pool.query(
    `SELECT id, owner_id FROM workspaces WHERE id = $1 AND owner_id = $2`,
    [workspaceId, actor.id]
  );
  if (!wsRes.rows[0]) {
    throw HttpError.notFound("Workspace not found or unauthorized.", "NOT_FOUND");
  }
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(createProjectInputSchema, rawBody);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockUserQuota(client, actor.id);
    const methodPath = `/api/v1/workspaces/${workspaceId}/projects`;
    const currentOwner = await client.query(
      "SELECT owner_id FROM workspaces WHERE id = $1 FOR SHARE",
      [workspaceId]
    );
    if (currentOwner.rows[0]?.owner_id !== actor.id) {
      throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    }
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "workspace",
      workspaceId,
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    await consumeProjectCreateWindows(client, actor.id);
    await assertOwnedProjectRoom(client, actor.id, limitsOf(c));
    await assertOwnedProjectTotalRoom(client, actor.id, limitsOf(c));
    const project = await insertProjectRow(client, workspaceId, body.name, body.description ?? null);
    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      "workspace",
      workspaceId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
projectsRoutes.post("/api/v1/projects", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(createOwnProjectInputSchema, rawBody);
  const limits = limitsOf(c);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockUserQuota(client, actor.id);
    const workspaceId = await ensurePersonalWorkspace(client, actor.id);
    const methodPath = "/api/v1/projects";
    const replay = await checkOrReplayReceipt(client, actor.id, "actor", actor.id, idempotencyKey, methodPath, body);
    if (replay) {
      await client.query("ROLLBACK");
      return c.json({ ...replay.responseBody, replayed: true }, replay.statusCode);
    }
    await consumeProjectCreateWindows(client, actor.id);
    await assertOwnedProjectRoom(client, actor.id, limits);
    await assertOwnedProjectTotalRoom(client, actor.id, limits);
    const project = await insertProjectRow(client, workspaceId, body.name, body.description ?? null);
    const responsePayload = { data: project };
    const saved = await saveReceipt(client, actor.id, "actor", actor.id, idempotencyKey, methodPath, body, 201, responsePayload);
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json({ ...saved.responseBody, replayed: true }, saved.statusCode);
    }
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
projectsRoutes.get("/api/v1/workspaces/:workspaceId/projects", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const workspaceId = c.req.param("workspaceId");
  const queryParams = c.req.query();
  const limit = parseLimit(queryParams.limit);
  const cursor = queryParams.cursor;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspace = await client.query(
      "SELECT owner_id FROM workspaces WHERE id = $1 FOR SHARE",
      [workspaceId]
    );
    if (!workspace.rows[0]) throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    if (workspace.rows[0].owner_id !== actor.id) {
      const memberships = await client.query(
        `SELECT id FROM project_memberships WHERE workspace_id = $1 AND user_id = $2
         AND status = 'active' ORDER BY project_id FOR SHARE`,
        [workspaceId, actor.id]
      );
      if (memberships.rows.length === 0) throw HttpError.notFound("Workspace not found.", "NOT_FOUND");
    }
    const result = await getWorkspaceProjects(client, actor, workspaceId, { limit, cursor });
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
projectsRoutes.get("/api/v1/projects/:projectId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const res = await pool.query(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.brief, p.archived, p.version, p.created_at, p.updated_at,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role,
            dbd.id AS default_board_id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     ${readableDefaultBoardJoin("$2")}
     WHERE p.id = $1`,
    [projectId, actor.id]
  );
  const row = res.rows[0];
  if (!row || row.workspace_owner_id !== actor.id && !row.member_role) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const links = await getProjectLinks(pool, projectId);
  const project = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
    brief: row.brief,
    links,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  return c.json({ data: project }, 200);
});
projectsRoutes.get("/api/v1/projects/:projectId/overview", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const overview = await getProjectOverview(getPool(), c.req.param("projectId"), actor.id);
  return c.json({ data: overview }, 200);
});
projectsRoutes.patch("/api/v1/projects/:projectId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateProjectInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    await acquireWritableProjectContextLock(client, projectId);
    const methodPath = `/api/v1/projects/${projectId}`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const project = await updateProjectSettings(client, actor, projectId, body);
    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
projectsRoutes.get("/api/v1/projects/:projectId/members", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getProjectMembers(client, actor, projectId);
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
projectsRoutes.get("/api/v1/projects/:projectId/people", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const queryParams = c.req.query();
  const parsedQuery = parseOrThrow(projectPeopleQuerySchema, queryParams);
  if (parsedQuery.purpose === "assignee" && !parsedQuery.boardId) {
    throw new HttpError(422, "BOARD_REQUIRED", "Choose a card or board first.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockProjectBoardReadScope(client, projectId, actor.id);
    let boardId = parsedQuery.boardId;
    if (parsedQuery.purpose === "mention") {
      if (parsedQuery.cardId) {
        const cardRes = await client.query(
          `SELECT board_id FROM cards WHERE id = $1 AND project_id = $2 AND state = 'active'`,
          [parsedQuery.cardId, projectId]
        );
        const card = cardRes.rows[0];
        if (!card) throw HttpError.notFound("Card not found.", "NOT_FOUND");
        const access = await lockBoardAccess(client, card.board_id, actor.id).catch(() => null);
        if (!access || access.projectId !== projectId) throw HttpError.notFound("Card not found.", "NOT_FOUND");
        boardId = card.board_id;
      } else if (!boardId) {
        await client.query("COMMIT");
        return c.json({ data: [], nextCursor: null }, 200);
      }
    }
    if (boardId) {
      const access = await lockBoardAccess(client, boardId, actor.id);
      if (access.projectId !== projectId) throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const result = await getProjectPeople(
      client,
      projectId,
      parsedQuery.purpose ?? "display",
      parsedQuery.query,
      parsedQuery.cursor,
      parsedQuery.limit ?? 50,
      boardId,
      actor.id
    );
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
projectsRoutes.get("/api/v1/projects/:projectId/access-summary", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const summary = await getProjectAccessSummary(client, projectId, actor.id, boardIds);
    await client.query("COMMIT");
    return c.json({ data: summary }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
projectsRoutes.post("/api/v1/projects/:projectId/archive", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/projects/${projectId}/archive`;
    await lockProjectOwner(client, projectId, actor.id, "archive");
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      const role2 = await resolveProjectRole(projectId, actor.id, client);
      if (!role2) {
        throw HttpError.notFound("Project not found.", "NOT_FOUND");
      }
      if (role2 !== "owner") {
        throw HttpError.forbidden("Only workspace owner can archive projects.", "FORBIDDEN");
      }
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const role = await resolveProjectRole(projectId, actor.id, client);
    if (!role) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    if (role !== "owner") {
      throw HttpError.forbidden("Only workspace owner can archive projects.", "FORBIDDEN");
    }
    const updateRes = await client.query(
      `UPDATE projects
       SET archived = TRUE, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId]
    );
    const row = updateRes.rows[0];
    const project = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      isArchived: true,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
projectsRoutes.post("/api/v1/projects/:projectId/reopen", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/projects/${projectId}/reopen`;
    await lockUserQuota(client, actor.id);
    await lockProjectOwner(client, projectId, actor.id, "reopen");
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      const role2 = await resolveProjectRole(projectId, actor.id, client);
      if (!role2) {
        throw HttpError.notFound("Project not found.", "NOT_FOUND");
      }
      if (role2 !== "owner") {
        throw HttpError.forbidden("Only workspace owner can reopen projects.", "FORBIDDEN");
      }
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const role = await resolveProjectRole(projectId, actor.id, client);
    if (!role) {
      throw HttpError.notFound("Project not found.", "NOT_FOUND");
    }
    if (role !== "owner") {
      throw HttpError.forbidden("Only workspace owner can reopen projects.", "FORBIDDEN");
    }
    const archivedNow = await client.query("SELECT archived FROM projects WHERE id = $1", [projectId]);
    if (archivedNow.rows[0]?.archived) {
      await assertOwnedProjectRoom(client, actor.id, limitsOf(c));
    }
    const updateRes = await client.query(
      `UPDATE projects
       SET archived = FALSE, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
      [projectId]
    );
    const row = updateRes.rows[0];
    const project = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      isArchived: false,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
    const responsePayload = { data: project };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/invitations.ts
import crypto10 from "node:crypto";
import { Hono as Hono5 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/invitation-email.ts
var ROLE_LABELS = {
  manager: "Manager",
  member: "Member",
  viewer: "Viewer"
};
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function plainLine(value, max) {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function acceptInvitationUrl(appOrigin, token) {
  return `${appOrigin}/invitation?token=${encodeURIComponent(token)}`;
}
var EMAIL_COLORS = {
  canvas: "#F8F5FA",
  card: "#FFFFFF",
  tint: "#F1EBF5",
  ink: "#2D2532",
  muted: "#5F5468",
  plum: "#302638",
  accent: "#684B7C",
  line: "#E3D9E9",
  col: "#DCEEFD",
  colInk: "#1D4A73",
  btn: "#684B7C",
  btnInk: "#FFFFFF"
};
var EMAIL_COLORS_DARK = {
  canvas: "#151018",
  card: "#241C2A",
  tint: "#2D2335",
  ink: "#F1EAF5",
  muted: "#B9ABC4",
  plum: "#2A2132",
  accent: "#B79AD0",
  line: "#3A2F42",
  col: "#1A2A3B",
  colInk: "#A9CDF2",
  btn: "#B79AD0",
  btnInk: "#1F1626"
};
var ROLE_CHIP = {
  manager: { bg: "#E9DDF2", ink: "#4B2F63" },
  member: { bg: "#D7F3E2", ink: "#1E5A36" },
  viewer: { bg: "#DCEEFD", ink: "#1D4A73" }
};
var ROLE_CHIP_DARK = {
  manager: { bg: "#34273F", ink: "#E2CCF2" },
  member: { bg: "#1E3A2A", ink: "#A8E3BE" },
  viewer: { bg: "#1B3550", ink: "#BCDDF8" }
};
var EXPIRY_CHIP = { bg: "#FBEFD9", ink: "#6B4A12" };
var EXPIRY_CHIP_DARK = { bg: "#3B2E14", ink: "#F2D9A0" };
var YOU_CHIP = { bg: "#E9DDF2", ink: "#4B2F63" };
var YOU_CHIP_DARK = { bg: "#34273F", ink: "#E2CCF2" };
var ROLE_ABILITIES = {
  manager: ["Manage boards", "Manage people", "Create and move cards"],
  member: ["Create and move cards", "Comment on cards", "Upload images"],
  viewer: ["View cards", "Read comments", "View images"]
};
var ROLE_DESCRIPTION = {
  member: "Join as a Member. Boards appear once an Owner shares them with you.",
  manager: "Join as a Manager. You can manage boards and people.",
  viewer: "Join as a Viewer. You can view the boards an Owner shares with you."
};
var FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
var MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
function emailImageUrls(appOrigin) {
  return {
    lockup: `${appOrigin}/email/flowboard-lockup-dark.png`
  };
}
function recipientInitials(email) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[^\p{L}]+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? "").slice(0, 2);
  return (letters || "F").toUpperCase();
}
function cardKey(invitationId) {
  const tail = String(invitationId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
  return `INV-${tail || "0000"}`;
}
function expiryDate(value) {
  const match = /\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : "";
}
function dueLabel(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `Due ${day} ${MONTHS[month - 1]}`;
}
function darkStyleBlock() {
  const d = EMAIL_COLORS_DARK;
  const rules = [
    `.fb-cv{background-color:${d.canvas} !important}`,
    `.fb-card{background-color:${d.card} !important}`,
    `.fb-plum{background-color:${d.plum} !important}`,
    `.fb-col{background-color:${d.col} !important}`,
    `.fb-tint{background-color:${d.tint} !important}`,
    `.fb-btn{background-color:${d.btn} !important}`,
    `.fb-accent-bg{background-color:${d.accent} !important}`,
    `.fb-line-bg{background-color:${d.line} !important}`,
    `.fb-ink{color:${d.ink} !important}`,
    `.fb-mut{color:${d.muted} !important}`,
    `.fb-colink{color:${d.colInk} !important}`,
    `.fb-btnink{color:${d.btnInk} !important}`,
    `.fb-accent{color:${d.accent} !important}`,
    `.fb-stripe{border-left-color:${d.accent} !important}`,
    `.fb-role-manager{background-color:${ROLE_CHIP_DARK.manager.bg} !important;color:${ROLE_CHIP_DARK.manager.ink} !important}`,
    `.fb-role-member{background-color:${ROLE_CHIP_DARK.member.bg} !important;color:${ROLE_CHIP_DARK.member.ink} !important}`,
    `.fb-role-viewer{background-color:${ROLE_CHIP_DARK.viewer.bg} !important;color:${ROLE_CHIP_DARK.viewer.ink} !important}`,
    `.fb-due{background-color:${EXPIRY_CHIP_DARK.bg} !important;color:${EXPIRY_CHIP_DARK.ink} !important}`,
    `.fb-you{background-color:${YOU_CHIP_DARK.bg} !important;color:${YOU_CHIP_DARK.ink} !important}`
  ];
  return `<style>@media (prefers-color-scheme: dark){${rules.join("")}}</style>`;
}
function buildInvitationEmail(input) {
  const project = plainLine(input.projectName, 100) || "a project";
  const inviter = plainLine(input.inviterName, 100) || "A Flowboard member";
  const recipient = plainLine(input.recipientEmail, 254);
  const roleKey = ROLE_CHIP[input.role] ? input.role : "member";
  const role = ROLE_LABELS[roleKey] ?? "Member";
  const expires = expiryDate(input.expiresAt);
  const due = dueLabel(expires);
  const key = cardKey(input.invitationId);
  const url = input.acceptUrl;
  const subject = plainLine(`${inviter} invited you to ${project} on Flowboard`, 160);
  const preheader = `${inviter} invited you to ${project} as ${role}.`;
  const description = ROLE_DESCRIPTION[roleKey];
  const footerLine = `Sent because ${inviter} invited you. Not expecting it? Ignore this email.`;
  const abilities = ROLE_ABILITIES[roleKey];
  const chip = ROLE_CHIP[roleKey];
  const expiresLine = expires ? `This invitation expires on ${expires} (UTC).` : "";
  const text2 = [
    `${inviter} invited you to a project.`,
    "",
    "In progress (1)",
    `  Join ${project}`,
    `  ${key} | ${role}${due ? ` | ${due}` : ""}`,
    `  ${description}`,
    "  Progress: 1 of 3",
    "  [x] Invitation sent",
    "  [>] Accept invitation (you are here)",
    "  [ ] Open project",
    `  Assigned to you: ${recipient}`,
    "",
    `Accept invitation: ${url}`,
    "",
    `You can: ${abilities.join("; ")}.`,
    ...expiresLine ? [expiresLine] : [],
    "",
    footerLine
  ].join("\n");
  const c = EMAIL_COLORS;
  const e = escapeHtml;
  const img = input.appOrigin ? emailImageUrls(input.appOrigin) : null;
  const dueChip = due ? `<td align="right" style="text-align:right;"><span class="fb-due" style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:${EXPIRY_CHIP.bg};color:${EXPIRY_CHIP.ink};font-family:${FONT_STACK};font-size:12px;font-weight:700;">${e(due)}</span></td>` : "";
  const roleClass = `fb-role-${roleKey}`;
  const abilityPills = abilities.map((label) => `<span class="fb-tint fb-ink" style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border-radius:999px;background-color:${c.tint};color:${c.ink};font-family:${FONT_STACK};font-size:13px;line-height:1.3;">${e(label)}</span>`).join("");
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${e(subject)}</title>`,
    darkStyleBlock(),
    "</head>",
    `<body class="fb-cv" style="margin:0;padding:0;background-color:${c.canvas};font-family:${FONT_STACK};" bgcolor="${c.canvas}">`,
    `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${e(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-cv" bgcolor="${c.canvas}" style="background-color:${c.canvas};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-card" style="width:100%;max-width:600px;border-radius:16px;overflow:hidden;" bgcolor="${c.card}">`,
    // Header band: dark plum with the lockup.
    `<tr><td align="left" class="fb-plum" bgcolor="${c.plum}" style="padding:22px 28px;background-color:${c.plum};">`,
    img ? `<img src="${e(img.lockup)}" width="200" height="48" alt="Flowboard" style="display:block;border:0;outline:none;text-decoration:none;width:200px;height:48px;">` : `<span style="font-family:${FONT_STACK};font-size:22px;font-weight:700;color:#e6d7f0;">Flowboard</span>`,
    "</td></tr>",
    // Intro line.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:24px 28px 8px 28px;background-color:${c.card};font-family:${FONT_STACK};font-size:16px;line-height:1.45;color:${c.ink};">`,
    `<span class="fb-ink"><strong>${e(inviter)}</strong> invited you to a project.</span>`,
    "</td></tr>",
    // The "In progress" column, with one card in it.
    `<tr><td style="padding:12px 24px 0 24px;background-color:${c.card};" class="fb-card" bgcolor="${c.card}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-col" bgcolor="${c.col}" style="border-radius:16px;background-color:${c.col};"><tr><td style="padding:12px;">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td class="fb-colink" style="font-family:${FONT_STACK};font-size:13px;font-weight:700;color:${c.colInk};padding:0 4px 10px 2px;">In progress</td>`,
    `<td align="right" style="padding:0 2px 10px 0;"><span class="fb-card fb-colink" style="display:inline-block;padding:1px 9px;border-radius:999px;background-color:${c.card};color:${c.colInk};font-family:${FONT_STACK};font-size:12px;font-weight:700;">1</span></td>`,
    "</tr></table>",
    // The card: plum left stripe, role chip, key, due date, title, description, progress and steps.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fb-card" bgcolor="${c.card}" style="background-color:${c.card};border-radius:12px;"><tr>`,
    `<td class="fb-stripe" width="5" style="width:5px;border-left:5px solid ${c.accent};border-radius:12px 0 0 12px;font-size:1px;line-height:1px;">&nbsp;</td>`,
    '<td style="padding:16px 18px 16px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td><span class="${roleClass}" style="display:inline-block;padding:3px 10px;border-radius:999px;background-color:${chip.bg};color:${chip.ink};font-family:${FONT_STACK};font-size:12px;font-weight:700;">${e(role)}</span>`,
    `&nbsp;<span class="fb-tint fb-mut" style="display:inline-block;padding:3px 8px;border-radius:6px;background-color:${c.tint};color:${c.muted};font-family:${MONO_STACK};font-size:11px;">${e(key)}</span></td>`,
    dueChip,
    "</tr></table>",
    `<p class="fb-ink" style="margin:12px 0 4px 0;font-family:${FONT_STACK};font-size:19px;line-height:1.3;font-weight:700;color:${c.ink};">Join ${e(project)}</p>`,
    `<p class="fb-ink" style="margin:0 0 14px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.45;color:${c.ink};">${e(description)}</p>`,
    // Progress: 1 of 3, filled to a third.
    `<p class="fb-mut" style="margin:0 0 6px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.4;color:${c.muted};text-align:right;">1 of 3</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td width="33%" class="fb-accent-bg" bgcolor="${c.accent}" style="width:33%;height:6px;line-height:6px;font-size:1px;border-radius:3px 0 0 3px;background-color:${c.accent};">&nbsp;</td>`,
    `<td class="fb-tint" bgcolor="${c.tint}" style="height:6px;line-height:6px;font-size:1px;border-radius:0 3px 3px 0;background-color:${c.tint};">&nbsp;</td>`,
    "</tr></table>",
    // Steps: sent (done), accept (current, "You are here"), open project (to do).
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">`,
    `<tr><td class="fb-mut" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;color:${c.muted};"><span aria-hidden="true" class="fb-accent" style="color:${c.accent};">&#10003;</span>&nbsp; Invitation sent</td></tr>`,
    `<tr><td class="fb-ink" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;font-weight:700;color:${c.ink};"><span aria-hidden="true" class="fb-accent" style="color:${c.accent};">&#9679;</span>&nbsp; Accept invitation&nbsp;<span class="fb-you" style="display:inline-block;padding:1px 8px;border-radius:999px;background-color:${YOU_CHIP.bg};color:${YOU_CHIP.ink};font-size:11px;font-weight:700;">You are here</span></td></tr>`,
    `<tr><td class="fb-mut" style="font-family:${FONT_STACK};font-size:13px;line-height:1.7;color:${c.muted};"><span aria-hidden="true">&#9675;</span>&nbsp; Open project</td></tr>`,
    "</table>",
    // Divider and the assignee row.
    `<div class="fb-line-bg" style="height:1px;line-height:1px;font-size:1px;background-color:${c.line};margin:14px 0 12px 0;">&nbsp;</div>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td valign="middle" width="28" align="center" class="fb-btn" bgcolor="${c.btn}" style="width:28px;height:28px;border-radius:14px;background-color:${c.btn};font-family:${FONT_STACK};font-size:11px;font-weight:700;color:${c.btnInk};">`,
    `<span class="fb-btnink" style="color:${c.btnInk};">${e(recipientInitials(recipient))}</span></td>`,
    `<td valign="middle" style="padding-left:10px;font-family:${FONT_STACK};font-size:12px;line-height:1.35;">`,
    `<span class="fb-mut" style="color:${c.muted};">Assigned to you</span><br>`,
    `<span class="fb-ink" style="font-weight:700;color:${c.ink};word-break:break-all;">${e(recipient)}</span>`,
    "</td></tr></table>",
    "</td></tr></table>",
    "</td></tr></table>",
    "</td></tr>",
    // Primary button: full width, a table cell with the fill, so Outlook draws it too.
    `<tr><td style="padding:20px 24px 4px 24px;background-color:${c.card};" class="fb-card" bgcolor="${c.card}">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td align="center" class="fb-btn" bgcolor="${c.btn}" style="padding:16px 20px;border-radius:14px;background-color:${c.btn};">`,
    `<a href="${e(url)}" target="_blank" class="fb-btnink" style="display:block;font-family:${FONT_STACK};font-size:17px;line-height:20px;font-weight:700;color:${c.btnInk};text-decoration:none;">Accept invitation &rarr;</a>`,
    "</td></tr></table>",
    "</td></tr>",
    // Fallback: the full link as text.
    `<tr><td align="center" class="fb-card" bgcolor="${c.card}" style="padding:8px 24px 8px 24px;background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};word-break:break-all;">`,
    `<span class="fb-mut">Or copy:</span> <span class="fb-colink" style="color:${c.colInk};">${e(url)}</span>`,
    "</td></tr>",
    // You can: the three abilities for the role.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:12px 28px 0 28px;background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.4;color:${c.muted};">`,
    `<span class="fb-mut" style="color:${c.muted};">You can</span>`,
    "</td></tr>",
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:6px 28px 12px 28px;background-color:${c.card};">${abilityPills}</td></tr>`,
    // Footer: why the person received it.
    `<tr><td class="fb-card" bgcolor="${c.card}" style="padding:14px 28px 26px 28px;border-top:1px solid ${c.line};background-color:${c.card};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${c.muted};">${e(footerLine)}</td></tr>`,
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>"
  ].join("\n");
  return { subject, text: text2, html };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/mailer.ts
var BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
var SEND_TIMEOUT_MS = 1e4;
var BrevoMailer = class {
  apiKey;
  settings;
  fetchImpl;
  constructor(apiKey, settings, fetchImpl = (...args) => fetch(...args)) {
    this.apiKey = apiKey;
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }
  get appOrigin() {
    return this.settings.appOrigin;
  }
  async send(message) {
    let response;
    try {
      response = await this.fetchImpl(BREVO_SEND_URL, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          sender: { email: this.settings.fromEmail, name: this.settings.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
      });
    } catch {
      return { status: "retry", reason: "network" };
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return { status: "retry", reason: `brevo_http_${response.status}` };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "permanent", reason: `brevo_http_${response.status}` };
    }
    const json = await response.json().catch(() => ({}));
    return {
      status: "sent",
      providerMessageId: typeof json.messageId === "string" ? json.messageId.slice(0, 200) : "unknown"
    };
  }
};
function validAppOrigin(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}
var EMAIL_ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
function mailerFromEnv(env, fetchImpl) {
  const apiKey = env?.BREVO_API_KEY?.trim();
  const fromEmail = env?.MAIL_FROM_EMAIL?.trim();
  const appOrigin = validAppOrigin(env?.APP_ORIGIN?.trim());
  if (!apiKey || !fromEmail || !EMAIL_ADDRESS.test(fromEmail) || !appOrigin) return null;
  const fromName = (env?.MAIL_FROM_NAME?.trim() || "Flowboard").replace(/[\p{Cc}]/gu, "").slice(0, 80);
  return new BrevoMailer(apiKey, { fromEmail, fromName, appOrigin }, fetchImpl);
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/invitation-delivery.ts
function parsePayload(payload) {
  if (typeof payload === "string") return JSON.parse(payload);
  return payload ?? {};
}
function text(value) {
  return typeof value === "string" ? value : "";
}
async function deliverInvitationRow(client, row, mailer) {
  const payload = parsePayload(row.payload);
  const token = text(payload["token"]);
  const to = text(payload["email"]);
  if (!token || !to) {
    await settle(client, row.id, "failed", void 0);
    return { kind: "failed" };
  }
  const content = buildInvitationEmail({
    appOrigin: mailer.appOrigin,
    projectName: text(payload["projectName"]),
    inviterName: text(payload["inviterName"]),
    role: text(payload["role"]),
    expiresAt: text(payload["expiresAt"]),
    acceptUrl: acceptInvitationUrl(mailer.appOrigin, token),
    invitationId: text(payload["invitationId"]),
    recipientEmail: to
  });
  const outcome = await mailer.send({ to, ...content });
  if (outcome.status === "sent") {
    await settle(client, row.id, "delivered", outcome.providerMessageId);
    return { kind: "delivered" };
  }
  if (outcome.status === "permanent") {
    await settle(client, row.id, "failed", void 0);
    return { kind: "failed" };
  }
  return { kind: "retry", reason: outcome.reason };
}
async function settle(client, id, status, providerMessageId) {
  await client.query(
    `UPDATE outbox
     SET status = $2,
         settled_at = NOW(),
         payload = jsonb_strip_nulls(jsonb_build_object('providerMessageId', $3::text))
     WHERE id = $1`,
    [id, status, providerMessageId ?? null]
  );
}
async function deliverInvitationNow(pool, outboxId, mailer) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT id, payload FROM outbox
       WHERE id = $1 AND event_type = 'invitation.created' AND status = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [outboxId]
    );
    const row = res.rows[0];
    const outcome = row ? await deliverInvitationRow(client, row, mailer) : null;
    await client.query("COMMIT");
    if (!outcome) return "not_pending";
    if (outcome.kind === "retry") return `retry:${outcome.reason}`;
    return outcome.kind;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    return `error:${errorCode(error)}`;
  } finally {
    client.release();
  }
}
function errorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,16}$/.test(code) ? code : "unknown";
}
function logImmediate(result) {
  const line = JSON.stringify({ event: "invitation_immediate_send", result });
  if (result === "delivered" || result === "not_pending") console.info(line);
  else console.warn(line);
}
function sendInvitationEmailSoon(c, outboxId) {
  const env = c.env;
  const mailer = mailerFromEnv(env);
  if (!mailer) return logImmediate("skipped:mail_not_configured");
  const connectionString = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
  if (!connectionString) return logImmediate("skipped:no_connection_string");
  let ctx;
  try {
    ctx = c.executionCtx;
  } catch {
    return logImmediate("skipped:no_execution_context");
  }
  const pool = createPool(connectionString, 1);
  ctx.waitUntil(
    deliverInvitationNow(pool, outboxId, mailer).catch((error) => `error:${errorCode(error)}`).then(logImmediate).finally(() => pool.end().catch(() => {
    }))
  );
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/invitations.ts
import crypto9 from "node:crypto";
async function invitationEmailPayload(client, input) {
  const res = await client.query(
    `SELECT p.name AS project_name, u.display_name AS inviter_name
     FROM projects p, users u
     WHERE p.id = $1 AND u.id = $2`,
    [input.projectId, input.inviterId]
  );
  return {
    invitationId: input.invitationId,
    email: input.email,
    role: input.role,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    projectName: res.rows[0]?.project_name ?? "",
    inviterName: res.rows[0]?.inviter_name ?? "",
    expiresAt: input.expiresAt,
    token: input.rawToken
  };
}
async function createInvitation(client, actor, projectId, email, role, idempotencyKey) {
  const normalizedEmail = email.trim().toLowerCase();
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict("Project is archived and read-only.", "READ_ONLY_CONTEXT");
  }
  const workspaceId = project.workspace_id;
  let actorRole = null;
  if (project.owner_id === actor.id) {
    actorRole = "owner";
  } else {
    const memberRes = await client.query(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id]
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === "active") {
      actorRole = memberRes.rows[0].role;
    }
  }
  if (!actorRole) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw HttpError.forbidden(
      "Only workspace owners and project managers can invite members.",
      "FORBIDDEN"
    );
  }
  if (actorRole === "manager" && role === "manager") {
    throw HttpError.forbidden("Only workspace owners can invite managers.", "FORBIDDEN");
  }
  const ownerUserRes = await client.query(
    `SELECT id FROM users WHERE id = $1 AND LOWER(email) = LOWER($2)`,
    [project.owner_id, normalizedEmail]
  );
  if (ownerUserRes.rows.length > 0) {
    throw HttpError.badRequest(
      "User is already an active member of this project.",
      "ALREADY_MEMBER"
    );
  }
  const activeMemberRes = await client.query(
    `SELECT pm.id
     FROM project_memberships pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1 AND LOWER(u.email) = LOWER($2) AND pm.status = 'active'`,
    [projectId, normalizedEmail]
  );
  if (activeMemberRes.rows.length > 0) {
    throw HttpError.badRequest(
      "User is already an active member of this project.",
      "ALREADY_MEMBER"
    );
  }
  const pendingInvRes = await client.query(
    `SELECT id
     FROM project_invitations
     WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending' AND expires_at > NOW()`,
    [projectId, normalizedEmail]
  );
  if (pendingInvRes.rows.length > 0) {
    throw HttpError.badRequest(
      "An active invitation already exists for this email. Resend the existing invitation instead of creating a duplicate.",
      "INVITATION_ALREADY_EXISTS"
    );
  }
  const rawToken = crypto9.randomBytes(32).toString("hex");
  const tokenHash = crypto9.createHash("sha256").update(rawToken).digest("hex");
  const invId = "inv_" + crypto9.randomUUID();
  const invRes = await client.query(
    `INSERT INTO project_invitations (
       id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'pending', NOW() + INTERVAL '7 days', NOW(), NOW()
     )
     RETURNING id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at`,
    [invId, projectId, workspaceId, normalizedEmail, role, tokenHash, actor.id]
  );
  const invRow = invRes.rows[0];
  if (!invRow) {
    throw new Error("Failed to create invitation record");
  }
  const outboxId = "out_" + crypto9.randomUUID();
  const outboxPayload = await invitationEmailPayload(client, {
    invitationId: invRow.id,
    email: invRow.email,
    role: invRow.role,
    projectId: invRow.project_id,
    workspaceId,
    inviterId: actor.id,
    expiresAt: new Date(invRow.expires_at).toISOString(),
    rawToken
  });
  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES (
       $1, $2, $3, 'invitation.created', $4, 'pending', 0, NOW(), NOW()
     )`,
    [outboxId, workspaceId, projectId, JSON.stringify(outboxPayload)]
  );
  const invitation = {
    id: invRow.id,
    projectId: invRow.project_id,
    email: invRow.email,
    role: invRow.role,
    status: invRow.status,
    invitedBy: invRow.invited_by,
    expiresAt: new Date(invRow.expires_at).toISOString(),
    createdAt: new Date(invRow.created_at).toISOString(),
    updatedAt: new Date(invRow.updated_at).toISOString(),
    token: rawToken
  };
  await recordActivity(client, {
    workspaceId,
    projectId,
    visibilityScope: "project",
    actorId: actor.id,
    action: "invitation_sent",
    safeChanges: { invitationId: invRow.id, role: invRow.role }
  });
  const methodPath = `/api/v1/projects/${projectId}/invitations`;
  const responsePayload = {
    data: {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken
    }
  };
  await saveReceipt(
    client,
    actor.id,
    "project",
    projectId,
    idempotencyKey,
    methodPath,
    { email: normalizedEmail, role },
    201,
    responsePayload
  );
  return { invitation, rawToken, outboxId };
}
async function acceptInvitation(client, actor, rawToken, limits = { ...DEFAULT_LIMITS }) {
  const tokenHash = crypto9.createHash("sha256").update(rawToken).digest("hex");
  const owning = await client.query("SELECT project_id FROM project_invitations WHERE token_hash = $1", [tokenHash]);
  if (owning.rows[0]) await lockProjectQuota(client, owning.rows[0].project_id);
  const invRes = await client.query(
    `SELECT id, project_id, workspace_id, email, role, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash]
  );
  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.badRequest("Invitation not found or no longer pending.", "INVALID_INVITATION");
  }
  const invitation = invRes.rows[0];
  if (invitation.status !== "pending") {
    throw HttpError.badRequest("Invitation not found or no longer pending.", "INVALID_INVITATION");
  }
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(invitation.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    await client.query(
      `UPDATE project_invitations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
      [invitation.id]
    );
    await client.query("COMMIT").catch(() => {
    });
    throw HttpError.badRequest("Invitation has expired.", "INVITATION_EXPIRED");
  }
  const archivedRes = await client.query("SELECT archived FROM projects WHERE id = $1", [invitation.project_id]);
  if (archivedRes.rows[0]?.archived) {
    throw HttpError.conflict("Project is archived and read-only.", "READ_ONLY_CONTEXT");
  }
  let actorEmail = actor.email;
  if (!actorEmail) {
    const userRes = await client.query("SELECT email FROM users WHERE id = $1", [
      actor.id
    ]);
    actorEmail = userRes.rows[0]?.email;
  }
  if (!actorEmail || invitation.email.toLowerCase() !== actorEmail.toLowerCase()) {
    throw HttpError.forbidden(
      "Authenticated email does not match invitation recipient.",
      "EMAIL_MISMATCH"
    );
  }
  const wsRes = await client.query(
    `SELECT owner_id FROM workspaces WHERE id = $1`,
    [invitation.workspace_id]
  );
  if (wsRes.rows[0]?.owner_id === actor.id) {
    throw HttpError.badRequest(
      "User is already an active member of this project.",
      "ALREADY_MEMBER"
    );
  }
  const existingMemberRes = await client.query(
    `SELECT id, status, updated_at
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR UPDATE`,
    [invitation.project_id, actor.id]
  );
  if (existingMemberRes.rows.length > 0) {
    const existingMember = existingMemberRes.rows[0];
    if (existingMember.status === "active") {
      throw HttpError.badRequest(
        "User is already an active member of this project.",
        "ALREADY_MEMBER"
      );
    }
    if (existingMember.status === "removed") {
      if (new Date(invitation.created_at).getTime() <= new Date(existingMember.updated_at).getTime()) {
        throw HttpError.badRequest(
          "This invitation was issued before project access was revoked. A fresh invitation from a project administrator is required.",
          "INVITATION_SUPERSEDED"
        );
      }
    }
  }
  if (await countActiveMembers(client, invitation.project_id) >= limits.membersPerProject) {
    throw quotaExceeded("members", limits.membersPerProject, "remove_member");
  }
  await client.query(
    `UPDATE project_invitations
     SET status = 'accepted', updated_at = NOW()
     WHERE id = $1`,
    [invitation.id]
  );
  const memberId = "pm_" + crypto9.randomUUID();
  const membershipRes = await client.query(
    `INSERT INTO project_memberships (
       id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'active', 1, NOW(), NOW()
     )
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET
       role = EXCLUDED.role,
       status = 'active',
       version = project_memberships.version + 1,
       updated_at = NOW()
     RETURNING id`,
    [memberId, invitation.project_id, invitation.workspace_id, actor.id, invitation.role]
  );
  await recordActivity(client, {
    workspaceId: invitation.workspace_id,
    projectId: invitation.project_id,
    visibilityScope: "project",
    actorId: actor.id,
    action: "invitation_accepted",
    safeChanges: { invitationId: invitation.id, role: invitation.role }
  });
  const finalMemberId = membershipRes.rows[0]?.id ?? memberId;
  return {
    success: true,
    projectId: invitation.project_id,
    workspaceId: invitation.workspace_id,
    role: invitation.role,
    membershipId: finalMemberId
  };
}
async function resendInvitation(client, actor, projectId, invitationId, idempotencyKey) {
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict("Project is archived and read-only.", "READ_ONLY_CONTEXT");
  }
  let actorRole = null;
  if (project.owner_id === actor.id) {
    actorRole = "owner";
  } else {
    const memberRes = await client.query(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id]
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === "active") {
      actorRole = memberRes.rows[0].role;
    }
  }
  if (!actorRole) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw HttpError.forbidden(
      "Only workspace owners and project managers can resend invitations.",
      "FORBIDDEN"
    );
  }
  const invRes = await client.query(
    `SELECT id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE id = $1 AND project_id = $2
     FOR UPDATE`,
    [invitationId, projectId]
  );
  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.notFound("Invitation not found.", "NOT_FOUND");
  }
  const invitationRow = invRes.rows[0];
  if (actorRole === "manager" && invitationRow.role === "manager") {
    throw HttpError.forbidden("Only workspace owners can resend invitations for managers.", "FORBIDDEN");
  }
  if (invitationRow.status === "expired" || new Date(invitationRow.expires_at).getTime() <= Date.now()) {
    throw HttpError.conflict("This invitation has expired. Send a new invitation.", "INVITATION_EXPIRED");
  }
  if (invitationRow.status === "accepted") {
    throw HttpError.badRequest("Cannot resend an invitation that has already been accepted.", "INVALID_INVITATION");
  }
  if (invitationRow.status === "revoked") {
    throw HttpError.badRequest("Cannot resend an invitation that has been revoked.", "INVALID_INVITATION");
  }
  const rawToken = crypto9.randomBytes(32).toString("hex");
  const tokenHash = crypto9.createHash("sha256").update(rawToken).digest("hex");
  const updateRes = await client.query(
    `UPDATE project_invitations
     SET token_hash = $1,
         expires_at = NOW() + INTERVAL '7 days',
         status = 'pending',
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at`,
    [tokenHash, invitationId]
  );
  const updatedRow = updateRes.rows[0];
  if (!updatedRow) {
    throw new Error("Failed to update invitation record");
  }
  await recordActivity(client, {
    workspaceId: updatedRow.workspace_id,
    projectId: updatedRow.project_id,
    visibilityScope: "project",
    actorId: actor.id,
    action: "invitation_resent",
    safeChanges: { invitationId: updatedRow.id, role: updatedRow.role }
  });
  await client.query(
    `UPDATE outbox
     SET status = 'failed', settled_at = NOW(), payload = '{"superseded":true}'::jsonb
     WHERE event_type = 'invitation.created' AND status IN ('pending', 'processing')
       AND payload->>'invitationId' = $1`,
    [updatedRow.id]
  );
  const outboxId = "out_" + crypto9.randomUUID();
  const outboxPayload = await invitationEmailPayload(client, {
    invitationId: updatedRow.id,
    email: updatedRow.email,
    role: updatedRow.role,
    projectId: updatedRow.project_id,
    workspaceId: updatedRow.workspace_id,
    inviterId: actor.id,
    expiresAt: new Date(updatedRow.expires_at).toISOString(),
    rawToken
  });
  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES (
       $1, $2, $3, 'invitation.created', $4, 'pending', 0, NOW(), NOW()
     )`,
    [outboxId, updatedRow.workspace_id, updatedRow.project_id, JSON.stringify(outboxPayload)]
  );
  const invitation = {
    id: updatedRow.id,
    projectId: updatedRow.project_id,
    email: updatedRow.email,
    role: updatedRow.role,
    status: updatedRow.status,
    invitedBy: updatedRow.invited_by,
    expiresAt: new Date(updatedRow.expires_at).toISOString(),
    createdAt: new Date(updatedRow.created_at).toISOString(),
    updatedAt: new Date(updatedRow.updated_at).toISOString(),
    token: rawToken
  };
  const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/resend`;
  const responsePayload = {
    data: {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken
    }
  };
  await saveReceipt(
    client,
    actor.id,
    "project",
    projectId,
    idempotencyKey,
    methodPath,
    { invitationId },
    200,
    responsePayload
  );
  return { invitation, rawToken, outboxId };
}
async function revokeInvitation(client, actor, projectId, invitationId, idempotencyKey) {
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict("Project is archived and read-only.", "READ_ONLY_CONTEXT");
  }
  let actorRole = null;
  if (project.owner_id === actor.id) {
    actorRole = "owner";
  } else {
    const memberRes = await client.query(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id]
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === "active") {
      actorRole = memberRes.rows[0].role;
    }
  }
  if (!actorRole) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw HttpError.forbidden(
      "Only workspace owners and project managers can revoke invitations.",
      "FORBIDDEN"
    );
  }
  const invRes = await client.query(
    `SELECT id, project_id, role, status
     FROM project_invitations
     WHERE id = $1 AND project_id = $2
     FOR UPDATE`,
    [invitationId, projectId]
  );
  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.notFound("Invitation not found.", "NOT_FOUND");
  }
  const invitationRow = invRes.rows[0];
  if (actorRole === "manager" && invitationRow.role === "manager") {
    throw HttpError.forbidden("Only workspace owners can revoke invitations for managers.", "FORBIDDEN");
  }
  if (invitationRow.status === "accepted") {
    throw HttpError.badRequest("Cannot revoke an invitation that has already been accepted.", "INVALID_INVITATION");
  }
  if (invitationRow.status === "revoked") {
    throw HttpError.badRequest("Cannot revoke an invitation that has already been revoked.", "INVALID_INVITATION");
  }
  if (invitationRow.status !== "pending") {
    throw HttpError.badRequest("Invitation is no longer pending.", "INVALID_INVITATION");
  }
  await client.query(
    `UPDATE project_invitations
     SET status = 'revoked', updated_at = NOW()
     WHERE id = $1`,
    [invitationId]
  );
  await recordActivity(client, {
    workspaceId: project.workspace_id,
    projectId,
    visibilityScope: "project",
    actorId: actor.id,
    action: "invitation_revoked",
    safeChanges: { invitationId, role: invitationRow.role }
  });
  const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/revoke`;
  const responsePayload = {
    data: {
      success: true,
      id: invitationId,
      status: "revoked"
    }
  };
  await saveReceipt(
    client,
    actor.id,
    "project",
    projectId,
    idempotencyKey,
    methodPath,
    { invitationId },
    200,
    responsePayload
  );
  return {
    success: true,
    id: invitationId,
    status: "revoked"
  };
}
async function listInvitations(client, actor, projectId) {
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  const project = prjRes.rows[0];
  let actorRole = null;
  if (project.owner_id === actor.id) {
    actorRole = "owner";
  } else {
    const memberRes = await client.query(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id]
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === "active") {
      actorRole = memberRes.rows[0].role;
    }
  }
  if (!actorRole) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw HttpError.forbidden(
      "Only workspace owners and project managers can view project invitations.",
      "FORBIDDEN"
    );
  }
  const invRes = await client.query(
    `SELECT id, project_id, email, role, invited_by, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE project_id = $1
     ORDER BY created_at DESC, id DESC`,
    [projectId]
  );
  const now = Date.now();
  return invRes.rows.map((row) => {
    const isPastDue = new Date(row.expires_at).getTime() <= now;
    const computedStatus = row.status === "pending" && isPastDue ? "expired" : row.status;
    return {
      id: row.id,
      projectId: row.project_id,
      email: row.email,
      role: row.role,
      status: computedStatus,
      invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  });
}
async function leaveProject(client, actor, projectId, idempotencyKey) {
  const prjRes = await client.query(
    `SELECT p.id, p.workspace_id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId]
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound("Project not found or unauthorized.", "NOT_FOUND");
  }
  const project = prjRes.rows[0];
  if (project.owner_id === actor.id) {
    throw HttpError.forbidden(
      "Workspace owners cannot leave their project. Transfer workspace ownership instead.",
      "FORBIDDEN"
    );
  }
  const memberRes = await client.query(
    `SELECT id, role, status, version
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR UPDATE`,
    [projectId, actor.id]
  );
  if (memberRes.rows.length === 0 || memberRes.rows[0]?.status !== "active") {
    throw HttpError.notFound("Project not found or not an active member.", "NOT_FOUND");
  }
  const membership = memberRes.rows[0];
  await client.query(
    `UPDATE project_memberships
     SET status = 'removed', version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [membership.id]
  );
  await recordActivity(client, {
    workspaceId: project.workspace_id,
    projectId,
    visibilityScope: "project",
    actorId: actor.id,
    action: "member_left",
    safeChanges: { userId: actor.id, role: membership.role }
  });
  const userRes = await client.query(
    "SELECT email FROM users WHERE id = $1",
    [actor.id]
  );
  const actorEmail = userRes.rows[0]?.email;
  if (actorEmail) {
    const revoked = await client.query(
      `UPDATE project_invitations
       SET status = 'revoked', updated_at = NOW()
       WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'
       RETURNING id, role`,
      [projectId, actorEmail]
    );
    for (const inv of revoked.rows) {
      await recordActivity(client, {
        workspaceId: project.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: "invitation_revoked",
        safeChanges: { invitationId: inv.id, role: inv.role, reason: "member_left" }
      });
    }
  }
  const methodPath = `/api/v1/projects/${projectId}/leave`;
  const responsePayload = {
    data: { success: true }
  };
  await saveReceipt(
    client,
    actor.id,
    "project",
    projectId,
    idempotencyKey,
    methodPath,
    {},
    200,
    responsePayload
  );
  return { success: true };
}
async function assertInvitationSeats(client, projectId, limits) {
  const pending = await countPendingInvitations(client, projectId);
  if (pending >= limits.pendingInvitesPerProject) {
    throw quotaExceeded("pending_invitations", limits.pendingInvitesPerProject, "revoke_invitation", pending);
  }
  const active = await countActiveMembers(client, projectId);
  if (active + pending >= limits.membersPerProject) {
    throw quotaExceeded("members", limits.membersPerProject, pending > 0 ? "revoke_invitation" : "remove_member", active);
  }
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/invitations.ts
var invitationsRoutes = new Hono5();
invitationsRoutes.post("/projects/:projectId/invitations", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(createInvitationInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockProjectQuota(client, projectId);
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    await acquireWritableProjectContextLock(client, projectId);
    if (!grant.isOwner && body.role === "manager") {
      throw HttpError.forbidden("Only workspace owners can invite managers.", "FORBIDDEN");
    }
    const methodPath = `/api/v1/projects/${projectId}/invitations`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    if ((await readNameState(actor.id, client)).needsName) {
      throw HttpError.conflict(NAME_REQUIRED_CODE, "Save your first and last name before you invite people.");
    }
    await consumeInvitationScopeLimits(client, actor.id, projectId);
    await assertInvitationSeats(client, projectId, limitsOf(c));
    const { invitation, rawToken, outboxId } = await createInvitation(
      client,
      actor,
      projectId,
      body.email,
      body.role,
      idempotencyKey
    );
    await client.query("COMMIT");
    sendInvitationEmailSoon(c, outboxId);
    const responseData = {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken
    };
    invitationSchema.parse(responseData);
    return c.json(
      {
        data: responseData,
        replayed: false
      },
      201
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
invitationsRoutes.post("/invitations/accept", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(acceptInvitationInputSchema, rawBody);
  if ((await readNameState(actor.id)).needsName) {
    throw HttpError.conflict(NAME_REQUIRED_CODE, "Save your first and last name before you accept an invitation.");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owningProject = await client.query("SELECT project_id FROM project_invitations WHERE token_hash = $1", [crypto10.createHash("sha256").update(body.token).digest("hex")]);
    if (owningProject.rows[0]) await lockProjectQuota(client, owningProject.rows[0].project_id);
    const methodPath = "/api/v1/invitations/accept";
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "actor",
      actor.id,
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      const respData = replay.responseBody?.data;
      if (respData?.projectId) {
        const checkRes = await client.query(
          `SELECT w.owner_id, pm.status AS member_status
           FROM projects p
           JOIN workspaces w ON p.workspace_id = w.id
           LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
           WHERE p.id = $1
           FOR SHARE OF w`,
          [respData.projectId, actor.id]
        );
        const check = checkRes.rows[0];
        if (!check || check.owner_id !== actor.id && check.member_status !== "active") {
          throw HttpError.notFound("Project not found or access revoked.", "NOT_FOUND");
        }
      }
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await acceptInvitation(client, actor, body.token, limitsOf(c));
    const responsePayload = {
      data: {
        success: true,
        projectId: result.projectId,
        workspaceId: result.workspaceId,
        role: result.role
      }
    };
    const saved = await saveReceipt(
      client,
      actor.id,
      "actor",
      actor.id,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(
      {
        ...responsePayload,
        replayed: false
      },
      200
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
invitationsRoutes.get("/projects/:projectId/invitations", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    const invitations = await listInvitations(client, actor, projectId);
    await client.query("COMMIT");
    return c.json(
      {
        data: invitations,
        nextCursor: null
      },
      200
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
invitationsRoutes.post(
  "/projects/:projectId/invitations/:invitationId/resend",
  authMiddleware,
  async (c) => {
    const actor = c.get("actor");
    if (!actor) {
      throw HttpError.unauthorized("Invalid or missing authentication session.");
    }
    const projectId = c.req.param("projectId");
    const invitationId = c.req.param("invitationId");
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw HttpError.badRequest(
        "Missing or invalid Idempotency-Key header.",
        "IDEMPOTENCY_KEY_REQUIRED"
      );
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockProjectQuota(client, projectId);
      const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
      await acquireWritableProjectContextLock(client, projectId);
      const targetInv = await client.query(
        `SELECT role, status FROM project_invitations WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [invitationId, projectId]
      );
      if (!targetInv.rows[0]) {
        throw HttpError.notFound("Invitation not found.", "NOT_FOUND");
      }
      if (!grant.isOwner && targetInv.rows[0].role === "manager") {
        throw HttpError.forbidden("Only workspace owners can resend invitations for managers.", "FORBIDDEN");
      }
      const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/resend`;
      const replay = await checkOrReplayReceipt(
        client,
        actor.id,
        "project",
        projectId,
        idempotencyKey,
        methodPath,
        { invitationId }
      );
      if (replay) {
        await client.query("ROLLBACK");
        return c.json(
          { ...replay.responseBody, replayed: true },
          replay.statusCode
        );
      }
      await consumeInvitationScopeLimits(client, actor.id, projectId);
      await assertInvitationSeats(client, projectId, limitsOf(c));
      const { invitation, rawToken, outboxId } = await resendInvitation(
        client,
        actor,
        projectId,
        invitationId,
        idempotencyKey
      );
      await client.query("COMMIT");
      sendInvitationEmailSoon(c, outboxId);
      const responseData = {
        id: invitation.id,
        projectId: invitation.projectId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        invitedBy: invitation.invitedBy,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        updatedAt: invitation.updatedAt,
        token: rawToken
      };
      invitationSchema.parse(responseData);
      return c.json(
        {
          data: responseData,
          replayed: false
        },
        200
      );
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      throw err;
    } finally {
      client.release();
    }
  }
);
invitationsRoutes.post(
  "/projects/:projectId/invitations/:invitationId/revoke",
  authMiddleware,
  async (c) => {
    const actor = c.get("actor");
    if (!actor) {
      throw HttpError.unauthorized("Invalid or missing authentication session.");
    }
    const projectId = c.req.param("projectId");
    const invitationId = c.req.param("invitationId");
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw HttpError.badRequest(
        "Missing or invalid Idempotency-Key header.",
        "IDEMPOTENCY_KEY_REQUIRED"
      );
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
      await acquireWritableProjectContextLock(client, projectId);
      const targetInv = await client.query(
        `SELECT role, status FROM project_invitations WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [invitationId, projectId]
      );
      if (!targetInv.rows[0]) {
        throw HttpError.notFound("Invitation not found.", "NOT_FOUND");
      }
      if (!grant.isOwner && targetInv.rows[0].role === "manager") {
        throw HttpError.forbidden("Only workspace owners can revoke invitations for managers.", "FORBIDDEN");
      }
      const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/revoke`;
      const replay = await checkOrReplayReceipt(
        client,
        actor.id,
        "project",
        projectId,
        idempotencyKey,
        methodPath,
        { invitationId }
      );
      if (replay) {
        await client.query("ROLLBACK");
        return c.json(
          { ...replay.responseBody, replayed: true },
          replay.statusCode
        );
      }
      const result = await revokeInvitation(
        client,
        actor,
        projectId,
        invitationId,
        idempotencyKey
      );
      await client.query("COMMIT");
      return c.json(
        {
          data: {
            success: result.success,
            id: result.id,
            status: result.status
          },
          replayed: false
        },
        200
      );
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      throw err;
    } finally {
      client.release();
    }
  }
);
invitationsRoutes.post("/projects/:projectId/leave", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/projects/${projectId}/leave`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      const prj = await client.query(
        `SELECT w.owner_id FROM projects p JOIN workspaces w ON p.workspace_id = w.id WHERE p.id = $1 FOR SHARE OF w`,
        [projectId]
      );
      if (!prj.rows[0]) {
        throw HttpError.notFound("Project not found.", "NOT_FOUND");
      }
      if (prj.rows[0].owner_id === actor.id) {
        throw HttpError.forbidden("Workspace owners cannot leave their project.", "FORBIDDEN");
      }
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await leaveProject(client, actor, projectId, idempotencyKey);
    await client.query("COMMIT");
    return c.json(
      {
        data: {
          success: result.success
        },
        replayed: false
      },
      200
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/members.ts
import { Hono as Hono6 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/members.ts
function isPool2(target) {
  return typeof target.connect === "function" && typeof target.totalCount === "number";
}
async function updateProjectMember(clientOrPool, actor, projectId, targetUserId, newRole, newStatus, expectedVersion) {
  const pool = clientOrPool ?? getPool();
  let poolClient;
  let client;
  if (isPool2(pool)) {
    poolClient = await pool.connect();
    client = poolClient;
  } else {
    client = pool;
  }
  try {
    if (poolClient) {
      await client.query("BEGIN");
    }
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    const isWorkspaceOwner = grant.isOwner;
    const targetRes = await client.query(
      `SELECT id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [projectId, targetUserId]
    );
    if (targetRes.rows.length === 0) {
      throw HttpError.notFound("Member not found.", "NOT_FOUND");
    }
    const targetMember = targetRes.rows[0];
    if (!isWorkspaceOwner) {
      if (targetUserId === actor.id) {
        throw HttpError.forbidden("Cannot modify own membership.", "FORBIDDEN");
      }
      if (targetUserId === grant.ownerId) {
        throw HttpError.forbidden("Project managers cannot modify workspace owner.", "FORBIDDEN");
      }
      if (targetMember.role === "manager") {
        throw HttpError.forbidden("Project managers cannot modify other managers.", "FORBIDDEN");
      }
      if (newRole === "manager") {
        throw HttpError.forbidden("Only workspace owners can appoint managers.", "FORBIDDEN");
      }
      if (newRole !== "member" && newRole !== "viewer") {
        throw HttpError.forbidden("Project managers can only assign member or viewer roles.", "FORBIDDEN");
      }
    }
    if (targetMember.version !== expectedVersion) {
      throw HttpError.conflict("Member was concurrently updated. Refresh and try again.", "STALE_VERSION");
    }
    const updateQuery = isWorkspaceOwner ? `UPDATE project_memberships
         SET role = $1, status = $2, version = version + 1, updated_at = NOW()
         WHERE project_id = $3 AND user_id = $4 AND version = $5
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at` : `UPDATE project_memberships
         SET role = $1, status = $2, version = version + 1, updated_at = NOW()
         WHERE project_id = $3 AND user_id = $4 AND version = $5 AND role IN ('member', 'viewer')
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`;
    const updateRes = await client.query(
      updateQuery,
      [newRole, newStatus, projectId, targetUserId, expectedVersion]
    );
    if (updateRes.rows.length === 0) {
      if (!isWorkspaceOwner && targetMember.role === "manager") {
        throw HttpError.forbidden("Project managers cannot modify other managers.", "FORBIDDEN");
      }
      throw HttpError.conflict("Member was concurrently updated. Refresh and try again.", "STALE_VERSION");
    }
    const updated = updateRes.rows[0];
    if (updated.role !== targetMember.role) {
      await recordActivity(client, {
        workspaceId: targetMember.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: "member_role_changed",
        safeChanges: { userId: targetUserId, fromRole: targetMember.role, toRole: updated.role }
      });
    }
    if (updated.status !== targetMember.status) {
      await recordActivity(client, {
        workspaceId: targetMember.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: updated.status === "removed" ? "member_removed" : "member_reinstated",
        safeChanges: { userId: targetUserId, role: updated.role }
      });
    }
    if (poolClient) {
      await client.query("COMMIT");
    }
    return {
      id: updated.id,
      projectId: updated.project_id,
      userId: updated.user_id,
      role: updated.role,
      status: updated.status,
      version: updated.version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString()
    };
  } catch (err) {
    if (poolClient) {
      await client.query("ROLLBACK").catch(() => {
      });
    }
    throw err;
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
}
async function removeProjectMember(clientOrPool, actor, projectId, targetUserId) {
  const pool = clientOrPool ?? getPool();
  let poolClient;
  let client;
  if (isPool2(pool)) {
    poolClient = await pool.connect();
    client = poolClient;
  } else {
    client = pool;
  }
  try {
    if (poolClient) {
      await client.query("BEGIN");
    }
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    const isWorkspaceOwner = grant.isOwner;
    const targetRes = await client.query(
      `SELECT id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [projectId, targetUserId]
    );
    if (targetRes.rows.length === 0) {
      throw HttpError.notFound("Member not found.", "NOT_FOUND");
    }
    const targetMember = targetRes.rows[0];
    if (!isWorkspaceOwner) {
      if (targetUserId === actor.id) {
        throw HttpError.forbidden("Cannot modify own membership.", "FORBIDDEN");
      }
      if (targetUserId === grant.ownerId) {
        throw HttpError.forbidden("Project managers cannot modify workspace owner.", "FORBIDDEN");
      }
      if (targetMember.role === "manager") {
        throw HttpError.forbidden("Project managers cannot modify other managers.", "FORBIDDEN");
      }
    }
    const updateQuery = isWorkspaceOwner ? `UPDATE project_memberships
         SET status = 'removed', version = version + 1, updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at` : `UPDATE project_memberships
         SET status = 'removed', version = version + 1, updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2 AND role IN ('member', 'viewer')
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`;
    const updateRes = await client.query(
      updateQuery,
      [projectId, targetUserId]
    );
    if (updateRes.rows.length === 0) {
      if (!isWorkspaceOwner) {
        throw HttpError.forbidden("Project managers cannot modify other managers.", "FORBIDDEN");
      }
      throw HttpError.notFound("Member not found.", "NOT_FOUND");
    }
    const userRes = await client.query(
      "SELECT email FROM users WHERE id = $1",
      [targetUserId]
    );
    const targetEmail = userRes.rows[0]?.email;
    const revokedInvitations = targetEmail ? await client.query(
      `UPDATE project_invitations
         SET status = 'revoked', updated_at = NOW()
         WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'
         RETURNING id, role`,
      [projectId, targetEmail]
    ) : { rows: [] };
    const updated = updateRes.rows[0];
    await recordActivity(client, {
      workspaceId: targetMember.workspace_id,
      projectId,
      visibilityScope: "project",
      actorId: actor.id,
      action: "member_removed",
      safeChanges: { userId: targetUserId, role: targetMember.role }
    });
    for (const inv of revokedInvitations.rows) {
      await recordActivity(client, {
        workspaceId: targetMember.workspace_id,
        projectId,
        visibilityScope: "project",
        actorId: actor.id,
        action: "invitation_revoked",
        safeChanges: { invitationId: inv.id, role: inv.role, reason: "member_removed" }
      });
    }
    if (poolClient) {
      await client.query("COMMIT");
    }
    return {
      success: true,
      membership: {
        id: updated.id,
        projectId: updated.project_id,
        userId: updated.user_id,
        role: updated.role,
        status: updated.status,
        version: updated.version,
        createdAt: new Date(updated.created_at).toISOString(),
        updatedAt: new Date(updated.updated_at).toISOString()
      }
    };
  } catch (err) {
    if (poolClient) {
      await client.query("ROLLBACK").catch(() => {
      });
    }
    throw err;
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/members.ts
var membersRoutes = new Hono6();
async function authorizeMemberReplay(client, projectId, actorId, targetUserId, newRole) {
  const grant = await acquireWriteGrantLock(client, projectId, actorId, "manager");
  await acquireWritableProjectContextLock(client, projectId);
  const target = await client.query(
    `SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
    [projectId, targetUserId]
  );
  if (!target.rows[0]) {
    throw HttpError.notFound("Member not found.", "NOT_FOUND");
  }
  if (!grant.isOwner) {
    if (targetUserId === actorId) {
      throw HttpError.forbidden("Cannot modify own membership.", "FORBIDDEN");
    }
    if (targetUserId === grant.ownerId) {
      throw HttpError.forbidden("Project managers cannot modify workspace owner.", "FORBIDDEN");
    }
    if (target.rows[0].role === "manager") {
      throw HttpError.forbidden("Project managers cannot modify other managers.", "FORBIDDEN");
    }
    if (newRole === "manager") {
      throw HttpError.forbidden("Only workspace owners can appoint managers.", "FORBIDDEN");
    }
  }
}
membersRoutes.patch("/projects/:projectId/members/:userId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateProjectMemberInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/projects/${projectId}/members/${userId}`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      await authorizeMemberReplay(client, projectId, actor.id, userId, body.role);
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const membership = await updateProjectMember(
      client,
      actor,
      projectId,
      userId,
      body.role,
      body.status,
      body.expectedVersion
    );
    const responsePayload = { data: membership };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
membersRoutes.delete("/projects/:projectId/members/:userId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/projects/${projectId}/members/${userId}`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      await authorizeMemberReplay(client, projectId, actor.id, userId);
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    await removeProjectMember(client, actor, projectId, userId);
    const responsePayload = { data: { success: true } };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/boards.ts
import { Hono as Hono7 } from "hono";
var boardsRoutes = new Hono7();
function getActorOrThrow(c) {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  return actor;
}
boardsRoutes.post("/api/v1/projects/:projectId/boards", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const projectId = c.req.param("projectId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(createBoardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockProjectQuota(client, projectId);
    const methodPath = `/api/v1/projects/${projectId}/boards`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    await consumeActorWindows(client, actor.id, ["board-create", "board-create-hour"]);
    const limits = limitsOf(c);
    const role = await resolveProjectRole(projectId, actor.id, client);
    const used = await countActiveBoards(client, projectId);
    if (used >= limits.boardsPerProject) {
      throw quotaExceeded("boards_per_project", limits.boardsPerProject, "archive_board", role === "owner" ? used : void 0);
    }
    const total = await countTotalBoards(client, projectId);
    if (total >= limits.boardsPerProjectTotal) {
      throw quotaExceeded("boards_per_project_total", limits.boardsPerProjectTotal, "none", role === "owner" ? total : void 0);
    }
    const board = await createBoard(client, projectId, body.name, actor.id, body.description ?? null);
    if (role === "manager") {
      await grantCreatorBoardAccess(client, board.id, projectId, actor.id);
    }
    const responsePayload = { data: board };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.get("/api/v1/projects/:projectId/boards", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const projectId = c.req.param("projectId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await listProjectBoards(client, projectId, actor.id, boardIds);
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
boardsRoutes.get("/api/v1/boards/:boardId", optionalAuthMiddleware, async (c) => {
  const boardId = c.req.param("boardId");
  const pool = getPool();
  const boardCheck = await pool.query("SELECT id FROM boards WHERE id = $1", [boardId]);
  if (boardCheck.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const actor = getActorOrThrow(c);
  const queryParams = c.req.query();
  const parsedQuery = parseOrThrow(boardSnapshotQuerySchema, queryParams);
  const snapshot = await getBoardSnapshot(pool, boardId, actor.id, parsedQuery);
  return c.json({ data: snapshot }, 200);
});
boardsRoutes.patch("/api/v1/boards/:boardId", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateBoardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prjRes = await client.query(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId]
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const projectId = prjRes.rows[0].project_id;
    const methodPath = `/api/v1/boards/${boardId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const updatedBoard = await updateBoard(
      client,
      boardId,
      { name: body.name, description: body.description },
      body.expectedVersion,
      actor.id
    );
    const responsePayload = { data: updatedBoard };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.post("/api/v1/boards/:boardId/columns", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(createColumnInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prjRes = await client.query(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId]
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const projectId = prjRes.rows[0].project_id;
    const methodPath = `/api/v1/boards/${boardId}/columns`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const column = await addColumn(client, boardId, body, actor.id);
    const responsePayload = { data: column };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.patch("/api/v1/boards/:boardId/columns/:columnId", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const columnId = c.req.param("columnId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(updateColumnInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prjRes = await client.query(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId]
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const projectId = prjRes.rows[0].project_id;
    const methodPath = `/api/v1/boards/${boardId}/columns/${columnId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const updatedColumn = await updateColumn(client, boardId, columnId, body, actor.id);
    const responsePayload = { data: updatedColumn };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.post("/api/v1/boards/:boardId/columns/reorder", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(reorderColumnsInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prjRes = await client.query(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId]
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const projectId = prjRes.rows[0].project_id;
    const methodPath = `/api/v1/boards/${boardId}/columns/reorder`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await reorderColumns(client, boardId, body.columnIds, body.expectedBoardVersion, actor.id);
    const responsePayload = { data: result };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.delete("/api/v1/boards/:boardId/columns/:columnId", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const columnId = c.req.param("columnId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  let expectedBoardVersion;
  const qv = c.req.query("expectedBoardVersion");
  if (qv !== void 0) {
    const num = parseInt(qv, 10);
    if (!Number.isNaN(num) && num >= 0) {
      expectedBoardVersion = num;
    }
  }
  if (expectedBoardVersion === void 0) {
    try {
      const rawBody = await c.req.json();
      if (typeof rawBody?.expectedBoardVersion === "number" && rawBody.expectedBoardVersion >= 0) {
        expectedBoardVersion = rawBody.expectedBoardVersion;
      }
    } catch {
    }
  }
  if (expectedBoardVersion === void 0) {
    throw HttpError.badRequest("Missing or invalid expectedBoardVersion parameter.", "VALIDATION_ERROR");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prjRes = await client.query(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId]
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const projectId = prjRes.rows[0].project_id;
    const methodPath = `/api/v1/boards/${boardId}/columns/${columnId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      { expectedBoardVersion },
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await deleteColumn(client, boardId, columnId, expectedBoardVersion, actor.id);
    const responsePayload = { data: result };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      { expectedBoardVersion },
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.get("/api/v1/boards/:boardId/columns/:columnId/placement", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const columnId = c.req.param("columnId");
  const queryParams = c.req.query();
  const parsed = parseOrThrow(placementInputSchema, queryParams);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockBoardAccess(client, boardId, actor.id);
    const result = await getPlacement(
      client,
      boardId,
      columnId,
      parsed.movingCardId,
      parsed.at,
      parsed.anchorCardId,
      actor.id
    );
    await client.query("COMMIT");
    return c.json({ data: result }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
boardsRoutes.get("/api/v1/boards/:boardId/cards", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const queryParams = c.req.query();
  const parsed = parseOrThrow(cardsQuerySchema, queryParams);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockBoardAccess(client, boardId, actor.id);
    const result = await listBoardCards(client, boardId, parsed, actor.id);
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
boardsRoutes.post("/api/v1/boards/:boardId/archive", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = await lockBoardAccess(client, boardId, actor.id);
    await acquireWriteGrantLock(client, access.projectId, actor.id, "manager", boardId);
    await acquireWritableProjectContextLock(client, access.projectId);
    const bCheck = await client.query(
      `SELECT id, project_id, archived, snapshot_version, structure_version FROM boards WHERE id = $1 FOR UPDATE`,
      [boardId]
    );
    if (!bCheck.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const bRow = bCheck.rows[0];
    const methodPath = `/api/v1/boards/${boardId}/archive`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const updateRes = await client.query(
      `UPDATE boards
       SET archived = TRUE, structure_version = structure_version + 1, snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, project_id, name, archived, structure_version, snapshot_version, created_at, updated_at`,
      [boardId]
    );
    const updated = updateRes.rows[0];
    await recordActivity(client, {
      workspaceId: updated.workspace_id,
      projectId: updated.project_id,
      boardId,
      visibilityScope: "board",
      actorId: actor.id,
      action: "board_archived",
      safeChanges: { name: updated.name }
    });
    const board = {
      id: updated.id,
      projectId: updated.project_id,
      name: updated.name,
      isArchived: true,
      structureVersion: updated.structure_version,
      snapshotVersion: updated.snapshot_version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString()
    };
    const responsePayload = { data: board };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
boardsRoutes.post("/api/v1/boards/:boardId/reopen", authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param("boardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owningProject = await client.query("SELECT project_id FROM boards WHERE id = $1", [boardId]);
    if (owningProject.rows[0]) await lockProjectQuota(client, owningProject.rows[0].project_id);
    const access = await lockBoardAccess(client, boardId, actor.id);
    await acquireWriteGrantLock(client, access.projectId, actor.id, "manager", boardId);
    const bCheck = await client.query(
      `SELECT id, project_id, archived, snapshot_version, structure_version FROM boards WHERE id = $1 FOR UPDATE`,
      [boardId]
    );
    if (!bCheck.rows[0]) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
    const bRow = bCheck.rows[0];
    const methodPath = `/api/v1/boards/${boardId}/reopen`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      "project",
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {}
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    await acquireWritableProjectContextLock(client, bRow.project_id);
    if (bRow.archived) {
      const reopenRole = await resolveProjectRole(bRow.project_id, actor.id, client);
      const reopenUsed = await countActiveBoards(client, bRow.project_id);
      const reopenLimits = limitsOf(c);
      if (reopenUsed >= reopenLimits.boardsPerProject) {
        throw quotaExceeded("boards_per_project", reopenLimits.boardsPerProject, "archive_board", reopenRole === "owner" ? reopenUsed : void 0);
      }
    }
    const updateRes = await client.query(
      `UPDATE boards
       SET archived = FALSE, structure_version = structure_version + 1, snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, project_id, name, archived, structure_version, snapshot_version, created_at, updated_at`,
      [boardId]
    );
    const updated = updateRes.rows[0];
    await recordActivity(client, {
      workspaceId: updated.workspace_id,
      projectId: updated.project_id,
      boardId,
      visibilityScope: "board",
      actorId: actor.id,
      action: "board_reopened",
      safeChanges: { name: updated.name }
    });
    const board = {
      id: updated.id,
      projectId: updated.project_id,
      name: updated.name,
      isArchived: false,
      structureVersion: updated.structure_version,
      snapshotVersion: updated.snapshot_version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString()
    };
    const responsePayload = { data: board };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/board-grants.ts
import { Hono as Hono8 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/board-access-cursor-draft.ts
var encoder = new TextEncoder();
var maxRevision = 9223372036854775807n;
var invalid = () => new Error("Invalid board access cursor.");
function validateSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
    throw new Error("Board access cursor signing requires a secret of at least 32 bytes.");
  }
}
function validateId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function canonicalPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const obj = value;
  if (Object.keys(obj).length !== 5 || obj["v"] !== 1 || !validateId(obj["boardId"]) || !validateId(obj["actorId"]) || !validateId(obj["lastUserId"]) || typeof obj["revision"] !== "string" || !/^[1-9][0-9]{0,18}$/.test(obj["revision"]) || BigInt(obj["revision"]) > maxRevision) throw invalid();
  return { v: 1, boardId: obj["boardId"], actorId: obj["actorId"], revision: obj["revision"], lastUserId: obj["lastUserId"] };
}
function encode(bytes) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(text2) {
  if (!text2 || !/^[A-Za-z0-9_-]+$/.test(text2)) throw invalid();
  try {
    const result = Uint8Array.from(atob(text2.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
    if (encode(result) !== text2) throw invalid();
    return result;
  } catch {
    throw invalid();
  }
}
async function importKey(secret) {
  validateSecret(secret);
  return crypto.subtle.importKey("raw", Uint8Array.from(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signBoardAccessCursor(payload, secret) {
  const key = await importKey(secret);
  const canonical = canonicalPayload(payload);
  const body = encode(encoder.encode(JSON.stringify(canonical)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}
async function verifyBoardAccessCursor(token, secret, scope) {
  const key = await importKey(secret);
  if (typeof token !== "string" || token.length > 4096) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 2) throw invalid();
  const [body, signature] = parts;
  if (!body || !signature) throw invalid();
  const bodyBytes = decode(body);
  const signatureBytes = decode(signature);
  if (signatureBytes.length !== 32 || !await crypto.subtle.verify("HMAC", key, Uint8Array.from(signatureBytes), encoder.encode(body))) throw invalid();
  try {
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
    const payload = canonicalPayload(decoded);
    if (encode(encoder.encode(JSON.stringify(payload))) !== body || payload.boardId !== scope.boardId || payload.actorId !== scope.actorId) throw invalid();
    return payload;
  } catch {
    throw invalid();
  }
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/board-grants.ts
var boardGrantsRoutes = new Hono8();
var unavailable2 = () => HttpError.notFound("Board not found.", "NOT_FOUND");
var maxRevision2 = 9223372036854775807n;
function parseRevision(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) {
    throw HttpError.badRequest("Provide a valid expected access revision.", "INVALID_ACCESS_REVISION");
  }
  const revision = BigInt(value);
  if (revision > maxRevision2) throw HttpError.badRequest("Provide a valid expected access revision.", "INVALID_ACCESS_REVISION");
  return revision;
}
function getCursorSecret(env) {
  const secret = env?.CURSOR_SECRET ?? (typeof process !== "undefined" ? process.env["CURSOR_SECRET"] : void 0);
  const bytes = secret ? new TextEncoder().encode(secret) : null;
  if (!bytes || bytes.byteLength < 32) {
    throw new HttpError(503, "CONFIG_ERROR", "Board access is temporarily unavailable.");
  }
  return bytes;
}
async function lockOwnedBoard(client, boardId, actorId) {
  const result = await client.query(
    `SELECT b.project_id, w.owner_id FROM boards b
       JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE b.id = $1 FOR SHARE OF w`,
    [boardId]
  );
  const row = result.rows[0];
  if (!row || row.owner_id !== actorId) throw unavailable2();
  return row;
}
boardGrantsRoutes.get("/boards/:boardId/access", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) throw HttpError.unauthorized();
  const cursorSecret = getCursorSecret(c.env);
  const boardId = c.req.param("boardId");
  const cursorToken = c.req.query("after");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await lockOwnedBoard(client, boardId, actor.id);
    let cursor = null;
    if (cursorToken) {
      try {
        cursor = await verifyBoardAccessCursor(cursorToken, cursorSecret, { boardId, actorId: actor.id });
      } catch {
        throw HttpError.badRequest("Invalid access cursor.", "INVALID_CURSOR");
      }
    }
    const revisionResult = await client.query("SELECT access_revision FROM boards WHERE id = $1", [boardId]);
    const revision = revisionResult.rows[0]?.access_revision;
    if (!revision) throw unavailable2();
    if (cursor && revision !== cursor.revision) throw HttpError.conflict("Board access changed. Refresh and try again.", "STALE_ACCESS_REVISION");
    const result = await client.query(
      `SELECT g.user_id FROM board_grants g
       JOIN project_memberships m ON m.project_id = g.project_id AND m.user_id = g.user_id AND m.status = 'active'
       WHERE g.board_id = $1 AND g.user_id > $2 ORDER BY g.user_id LIMIT 101`,
      [boardId, cursor?.lastUserId ?? ""]
    );
    await client.query("COMMIT");
    c.header("Cache-Control", "no-store");
    const grants = result.rows.slice(0, 100).map((row) => ({ userId: row.user_id }));
    const nextCursor = result.rows.length > 100 ? await signBoardAccessCursor({
      v: 1,
      boardId,
      actorId: actor.id,
      revision,
      lastUserId: grants.at(-1).userId
    }, cursorSecret) : null;
    return c.json({ data: { grants, accessRevision: revision, nextCursor } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
async function writeGrant(client, boardId, actorId, userId, allow, expectedAccessRevision) {
  const { project_id } = await lockOwnedBoard(client, boardId, actorId);
  const project = await client.query("SELECT archived FROM projects WHERE id = $1 FOR SHARE", [project_id]);
  if (!project.rows[0]) throw unavailable2();
  if (project.rows[0].archived) throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot write in an archived project.");
  const changed = await changeBoardGrant(client, boardId, actorId, userId, allow, expectedAccessRevision);
  await acquireWritableProjectContextLock(client, project_id, boardId);
  return changed;
}
boardGrantsRoutes.on(["PUT", "DELETE"], "/boards/:boardId/grants/:userId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) throw HttpError.unauthorized();
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw HttpError.badRequest("Use application/json for this request.", "INVALID_CONTENT_TYPE");
  const body = await c.req.json();
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "expectedAccessRevision")) {
    throw HttpError.badRequest("Provide a valid expected access revision.", "INVALID_ACCESS_REVISION");
  }
  const expectedAccessRevision = parseRevision(body.expectedAccessRevision);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await writeGrant(client, c.req.param("boardId"), actor.id, c.req.param("userId"), c.req.method === "PUT", expectedAccessRevision);
    await client.query("COMMIT");
    c.header("Cache-Control", "no-store");
    return c.json({ data: { changed } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/cards.ts
import { Hono as Hono9 } from "hono";
import { z as z13 } from "zod";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/cards.ts
import crypto11 from "node:crypto";
var CARD_KEY_SQL = `(SELECT p.key_prefix FROM projects p WHERE p.id = cards.project_id) || '-' || cards.card_number::text AS card_key`;
async function requireCardBoardAccess(db, boardId, projectId, actorId) {
  const access = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM boards b JOIN projects p ON p.id = b.project_id
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE b.id = $1 AND b.project_id = $2
         AND (w.owner_id = $3 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
           WHERE pm.project_id = p.id AND pm.user_id = $3 AND pm.status = 'active'
             AND bg.board_id = b.id))) AS allowed`,
    [boardId, projectId, actorId]
  );
  if (!access.rows[0]?.allowed) throw HttpError.notFound("Card not found.", "NOT_FOUND");
}
function toCard(row, assigneeIds, commentCount, imageCount) {
  return {
    id: row.id,
    ...row.card_key ? { key: row.card_key } : {},
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description ?? "",
    priority: row.priority,
    dueDate: row.due_date,
    assigneeIds,
    position: Number(row.position),
    version: row.version,
    state: row.state,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by ?? null,
    restoreUntil: row.restore_until ? new Date(row.restore_until).toISOString() : null,
    commentCount,
    imageCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
function toCardSummary(row, assigneeIds, commentCount, imageCount) {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    priority: row.priority,
    dueDate: row.due_date,
    assigneeIds,
    position: Number(row.position),
    version: row.version,
    commentCount,
    imageCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
async function validateAssigneeIds(clientOrPool, projectId, workspaceId, boardId, assigneeIds) {
  if (assigneeIds.length === 0) return;
  if (assigneeIds.length > 20) {
    throw validationError("At most 20 assignees can be assigned to a card.", {
      issues: [{ path: "assigneeIds", message: "At most 20 assignees can be assigned" }]
    });
  }
  const uniqueAssigneeIds = Array.from(new Set(assigneeIds));
  if (uniqueAssigneeIds.length !== assigneeIds.length) {
    throw validationError("Assignee IDs must be unique.", {
      issues: [{ path: "assigneeIds", message: "Assignee IDs must be unique" }]
    });
  }
  const validSet = await boardAssigneeIds(clientOrPool, projectId, boardId);
  const invalidUsers = assigneeIds.filter((id) => !validSet.has(id));
  if (invalidUsers.length > 0) {
    const reasons = await assigneeIneligibilityReasons(clientOrPool, projectId, boardId, invalidUsers);
    throw new HttpError(422, "ASSIGNEE_NOT_ELIGIBLE", "All assignees must be active owners, managers or members with access to this board.", {
      boardId,
      reasons,
      ineligibleUserIds: invalidUsers,
      invalidAssigneeIds: invalidUsers,
      // kept for clients that read the earlier key
      issues: [
        {
          path: "assigneeIds",
          message: `Users are not eligible assignees (active owner, manager or member with board access): ${invalidUsers.join(", ")}`
        }
      ]
    });
  }
}
async function fetchCardCounts(clientOrPool, cardIds) {
  const commentCounts = /* @__PURE__ */ new Map();
  const imageCounts = /* @__PURE__ */ new Map();
  const assigneesMap = /* @__PURE__ */ new Map();
  if (cardIds.length === 0) {
    return { commentCounts, imageCounts, assigneesMap };
  }
  const commentsRes = await clientOrPool.query(
    `SELECT card_id, COUNT(*)::TEXT AS count
     FROM comments
     WHERE card_id = ANY($1::TEXT[]) AND deleted_at IS NULL
     GROUP BY card_id`,
    [cardIds]
  );
  const imagesRes = await clientOrPool.query(
    `SELECT card_id, COUNT(*)::TEXT AS count
     FROM card_images
     WHERE card_id = ANY($1::TEXT[])
     GROUP BY card_id`,
    [cardIds]
  );
  const assigneesRes = await clientOrPool.query(
    `SELECT card_id, user_id
     FROM card_assignees
     WHERE card_id = ANY($1::TEXT[])
     ORDER BY created_at ASC`,
    [cardIds]
  );
  for (const row of commentsRes.rows) {
    commentCounts.set(row.card_id, parseInt(row.count, 10));
  }
  for (const row of imagesRes.rows) {
    imageCounts.set(row.card_id, parseInt(row.count, 10));
  }
  for (const row of assigneesRes.rows) {
    const list = assigneesMap.get(row.card_id) ?? [];
    list.push(row.user_id);
    assigneesMap.set(row.card_id, list);
  }
  return { commentCounts, imageCounts, assigneesMap };
}
async function createCard(client, boardId, input, actorId) {
  const accessBoard = await client.query(
    "SELECT project_id FROM boards WHERE id = $1",
    [boardId]
  );
  if (!accessBoard.rows[0]) throw HttpError.notFound("Board not found.", "NOT_FOUND");
  await acquireWriteGrantLock(client, accessBoard.rows[0].project_id, actorId, "member", boardId);
  await acquireWritableProjectContextLock(client, accessBoard.rows[0].project_id, boardId);
  const boardRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId]
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const board = boardRes.rows[0];
  if (board.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict("STALE_BOARD_VERSION", "Stale board structure version.", {
      currentBoardVersion: board.structure_version,
      expectedBoardVersion: input.expectedBoardVersion
    });
  }
  const columnRes = await client.query(
    `SELECT id, workspace_id, project_id
     FROM columns
     WHERE id = $1 AND board_id = $2`,
    [input.columnId, boardId]
  );
  if (columnRes.rows.length === 0) {
    throw validationError("Target column not found on this board.", {
      issues: [{ path: "columnId", message: "Target column not found on this board" }]
    });
  }
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
    throw validationError("Title must be between 1 and 200 characters.", {
      issues: [{ path: "title", message: "Title must be between 1 and 200 characters" }]
    });
  }
  if (input.dueDate !== null && input.dueDate !== void 0) {
    if (!isValidGregorianDate(input.dueDate)) {
      throw validationError("Due date must be a valid Gregorian calendar date in YYYY-MM-DD format.", {
        issues: [{ path: "dueDate", message: "Invalid calendar date" }]
      });
    }
  }
  const assigneeIds = input.assigneeIds ?? [];
  await validateAssigneeIds(client, board.project_id, board.workspace_id, boardId, assigneeIds);
  const posRes = await client.query(
    `SELECT COALESCE(MAX(position), 0)::TEXT AS max_pos
     FROM cards
     WHERE column_id = $1 AND state = 'active'`,
    [input.columnId]
  );
  const maxPos = parseInt(posRes.rows[0]?.max_pos ?? "0", 10);
  const position = maxPos + 1e3;
  const cardId = "crd_" + crypto11.randomUUID();
  const description = input.description ?? "";
  const priority = input.priority ?? "none";
  const dueDate = input.dueDate ?? null;
  const insertCardRes = await client.query(
    `INSERT INTO cards (
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, due_date, position,
       version, state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       1, 'active', NOW(), NOW()
     )
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at,
       ${CARD_KEY_SQL}`,
    [
      cardId,
      board.workspace_id,
      board.project_id,
      boardId,
      input.columnId,
      trimmedTitle,
      description,
      priority,
      dueDate,
      position
    ]
  );
  const cardRow = insertCardRes.rows[0];
  for (const uid of assigneeIds) {
    await client.query(
      `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [cardId, uid, board.workspace_id, board.project_id]
    );
  }
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId]
  );
  await recordActivity(client, {
    workspaceId: board.workspace_id,
    projectId: board.project_id,
    boardId,
    cardId,
    actorId,
    action: "card_created",
    safeChanges: {
      title: trimmedTitle,
      columnId: input.columnId,
      priority,
      dueDate,
      assigneeIds
    }
  });
  return toCard(cardRow, assigneeIds, 0, 0);
}
async function getCard(poolOrClient, cardId, actorId) {
  const cardRes = await poolOrClient.query(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at,
       ${CARD_KEY_SQL}
     FROM cards
     WHERE id = $1`,
    [cardId]
  );
  if (cardRes.rows.length === 0) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const cardRow = cardRes.rows[0];
  if (cardRow.state !== "active") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const role = await resolveProjectRole(cardRow.project_id, actorId, poolOrClient);
  if (!role) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  await requireCardBoardAccess(poolOrClient, cardRow.board_id, cardRow.project_id, actorId);
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, [cardId]);
  const assigneeIds = assigneesMap.get(cardId) ?? [];
  const commentCount = commentCounts.get(cardId) ?? 0;
  const imageCount = imageCounts.get(cardId) ?? 0;
  const people = [];
  for (const uid of assigneeIds) {
    const p = await getHistoricalPersonDisplay(poolOrClient, cardRow.project_id, uid);
    if (p) {
      people.push(p);
    }
  }
  await requireCardBoardAccess(poolOrClient, cardRow.board_id, cardRow.project_id, actorId);
  const card = toCard(cardRow, assigneeIds, commentCount, imageCount);
  const createdBy = await getCardCreator(poolOrClient, cardRow.id, cardRow.workspace_id, cardRow.project_id);
  return {
    card: createdBy === void 0 ? card : { ...card, createdBy },
    people
  };
}
async function getCardCreator(db, cardId, workspaceId, projectId) {
  const res = await db.query(
    `SELECT u.id, u.display_name, u.avatar_url,
       (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = $2 AND w.owner_id = u.id)
        OR EXISTS (SELECT 1 FROM project_memberships pm
                   WHERE pm.project_id = $3 AND pm.user_id = u.id AND pm.status = 'active')) AS active
     FROM activity_log al
     JOIN users u ON u.id = al.actor_id
     WHERE al.card_id = $1 AND al.action = 'card_created'
     ORDER BY al.created_at ASC, al.id ASC
     LIMIT 1`,
    [cardId, workspaceId, projectId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const creator = { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, activeInProject: Boolean(row.active) };
  return withNameSuffix(creator, await projectNameSuffixes(db, projectId));
}
async function updateCard(client, cardId, input, actorId) {
  const accessCard = await client.query(
    "SELECT project_id, board_id FROM cards WHERE id = $1",
    [cardId]
  );
  if (!accessCard.rows[0]) throw HttpError.notFound("Card not found.", "NOT_FOUND");
  await acquireWriteGrantLock(client, accessCard.rows[0].project_id, actorId, "member", accessCard.rows[0].board_id);
  await acquireWritableProjectContextLock(client, accessCard.rows[0].project_id, accessCard.rows[0].board_id);
  const cardRes = await client.query(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at
     FROM cards
     WHERE id = $1
     FOR UPDATE`,
    [cardId]
  );
  if (cardRes.rows.length === 0) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state !== "active") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  if (card.version !== input.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Stale card version.", {
      currentVersion: card.version,
      expectedVersion: input.expectedVersion
    });
  }
  let nextTitle = card.title;
  if (input.title !== void 0) {
    const trimmed = input.title.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      throw validationError("Title must be between 1 and 200 characters.", {
        issues: [{ path: "title", message: "Title must be between 1 and 200 characters" }]
      });
    }
    nextTitle = trimmed;
  }
  let nextDescription = card.description ?? "";
  if (input.description !== void 0) {
    nextDescription = input.description ?? "";
    if (nextDescription.length > 2e4) {
      throw validationError("Description cannot exceed 20,000 characters.", {
        issues: [{ path: "description", message: "Description cannot exceed 20,000 characters" }]
      });
    }
  }
  const nextPriority = input.priority !== void 0 ? input.priority : card.priority;
  let nextDueDate = card.due_date;
  if (input.dueDate !== void 0) {
    if (input.dueDate !== null && !isValidGregorianDate(input.dueDate)) {
      throw validationError("Due date must be a valid Gregorian calendar date in YYYY-MM-DD format.", {
        issues: [{ path: "dueDate", message: "Invalid calendar date" }]
      });
    }
    nextDueDate = input.dueDate;
  }
  const changes = {};
  let nextAssigneeIds;
  if (input.assigneeIds !== void 0) {
    await validateAssigneeIds(client, card.project_id, card.workspace_id, card.board_id, input.assigneeIds);
    nextAssigneeIds = input.assigneeIds;
    let oldAssigneeIds = [];
    const currentAssignees = await client.query(
      "SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY created_at ASC",
      [cardId]
    );
    oldAssigneeIds = currentAssignees.rows.map((r) => r.user_id);
    await client.query("DELETE FROM card_assignees WHERE card_id = $1", [cardId]);
    for (const uid of nextAssigneeIds) {
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [cardId, uid, card.workspace_id, card.project_id]
      );
    }
    const sortedOld = [...oldAssigneeIds].sort();
    const sortedNew = [...nextAssigneeIds].sort();
    if (sortedOld.length !== sortedNew.length || sortedOld.some((val, idx) => val !== sortedNew[idx])) {
      const added = nextAssigneeIds.filter((id) => !oldAssigneeIds.includes(id));
      const removed = oldAssigneeIds.filter((id) => !nextAssigneeIds.includes(id));
      changes.assignees = { added, removed };
    }
  } else {
    const currentAssignees = await client.query(
      "SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY created_at ASC",
      [cardId]
    );
    nextAssigneeIds = currentAssignees.rows.map((r) => r.user_id);
  }
  if (input.title !== void 0 && nextTitle !== card.title) {
    changes.title = { old: card.title, new: nextTitle };
  }
  if (input.description !== void 0 && nextDescription !== (card.description ?? "")) {
    changes.description = { old: card.description ?? "", new: nextDescription };
  }
  if (input.priority !== void 0 && nextPriority !== card.priority) {
    changes.priority = { old: card.priority, new: nextPriority };
  }
  if (input.dueDate !== void 0 && nextDueDate !== card.due_date) {
    changes.dueDate = { old: card.due_date, new: nextDueDate };
  }
  const updateRes = await client.query(
    `UPDATE cards
     SET title = $1,
         description = $2,
         priority = $3,
         due_date = $4,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $5
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at`,
    [nextTitle, nextDescription, nextPriority, nextDueDate, cardId]
  );
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [card.board_id]
  );
  if (Object.keys(changes).length > 0) {
    await recordActivity(client, {
      workspaceId: card.workspace_id,
      projectId: card.project_id,
      boardId: card.board_id,
      cardId,
      actorId,
      action: "card_updated",
      safeChanges: changes
    });
  }
  const { commentCounts, imageCounts } = await fetchCardCounts(client, [cardId]);
  return toCard(
    updateRes.rows[0],
    nextAssigneeIds,
    commentCounts.get(cardId) ?? 0,
    imageCounts.get(cardId) ?? 0
  );
}
async function recompactColumnPositions(client, columnId, excludedCardId) {
  const cardsRes = await client.query(
    `SELECT id
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND ($2::TEXT IS NULL OR id != $2)
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [columnId, excludedCardId ?? null]
  );
  for (let i = 0; i < cardsRes.rows.length; i++) {
    const cId = cardsRes.rows[i].id;
    const newPos = (i + 1) * 1e3;
    await client.query("UPDATE cards SET position = $1 WHERE id = $2", [newPos, cId]);
  }
}
async function moveCard(client, cardId, input, actorId) {
  const accessCard = await client.query(
    "SELECT project_id, board_id FROM cards WHERE id = $1",
    [cardId]
  );
  if (!accessCard.rows[0]) throw HttpError.notFound("Card not found.", "NOT_FOUND");
  await acquireWriteGrantLock(client, accessCard.rows[0].project_id, actorId, "member", accessCard.rows[0].board_id);
  await acquireWritableProjectContextLock(client, accessCard.rows[0].project_id, accessCard.rows[0].board_id);
  const cardRes = await client.query(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at
     FROM cards
     WHERE id = $1
     FOR UPDATE`,
    [cardId]
  );
  if (cardRes.rows.length === 0) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state !== "active") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const boardRes = await client.query(
    `SELECT id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [card.board_id]
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const board = boardRes.rows[0];
  if (card.version !== input.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Stale card version.", {
      currentVersion: card.version,
      expectedVersion: input.expectedVersion
    });
  }
  if (board.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict("STALE_BOARD_VERSION", "Stale board structure version.", {
      currentBoardVersion: board.structure_version,
      expectedBoardVersion: input.expectedBoardVersion
    });
  }
  const colRes = await client.query(
    `SELECT id, board_id FROM columns WHERE id = $1 AND board_id = $2`,
    [input.toColumnId, card.board_id]
  );
  if (colRes.rows.length === 0) {
    throw validationError("Destination column not found on this board.", {
      issues: [{ path: "toColumnId", message: "Destination column not found on this board" }]
    });
  }
  let calculatedPosition;
  const destCardsRes = await client.query(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [input.toColumnId, cardId]
  );
  const destCards = destCardsRes.rows.map((r) => ({
    id: r.id,
    position: Number(r.position)
  }));
  destCards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (destCards.length === 0) {
    if (input.previousCardId !== null || input.nextCardId !== null) {
      throw validationError("Destination column is empty; both previousCardId and nextCardId must be null.", {
        issues: [{ path: "previousCardId", message: "Destination column is empty; neighbors must be null" }]
      });
    }
    calculatedPosition = 1e3;
  } else if (input.previousCardId === null && input.nextCardId !== null) {
    if (destCards[0].id !== input.nextCardId) {
      throw validationError("nextCardId is not the first card in destination column.", {
        issues: [{ path: "nextCardId", message: "nextCardId must be the first card when previousCardId is null" }]
      });
    }
    let nextPos = destCards[0].position;
    if (nextPos <= 1) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const rechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId]
      );
      nextPos = parseInt(rechecked.rows[0].position, 10);
    }
    calculatedPosition = Math.max(1, Math.floor(nextPos / 2));
    if (calculatedPosition === nextPos) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const rechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId]
      );
      nextPos = parseInt(rechecked.rows[0].position, 10);
      calculatedPosition = Math.max(1, Math.floor(nextPos / 2));
    }
  } else if (input.previousCardId !== null && input.nextCardId === null) {
    if (destCards[destCards.length - 1].id !== input.previousCardId) {
      throw validationError("previousCardId is not the last card in destination column.", {
        issues: [{ path: "previousCardId", message: "previousCardId must be the last card when nextCardId is null" }]
      });
    }
    const prevPos = destCards[destCards.length - 1].position;
    calculatedPosition = prevPos + 1e3;
  } else if (input.previousCardId !== null && input.nextCardId !== null) {
    const prevIdx = destCards.findIndex((c) => c.id === input.previousCardId);
    const nextIdx = destCards.findIndex((c) => c.id === input.nextCardId);
    if (prevIdx === -1) {
      throw validationError("Previous card not found in destination column.", {
        issues: [{ path: "previousCardId", message: "Previous card not found in destination column" }]
      });
    }
    if (nextIdx === -1) {
      throw validationError("Next card not found in destination column.", {
        issues: [{ path: "nextCardId", message: "Next card not found in destination column" }]
      });
    }
    if (nextIdx !== prevIdx + 1) {
      throw validationError("Supplied neighbors are not adjacent in destination column.", {
        issues: [
          {
            path: "nextCardId",
            message: "previousCardId and nextCardId must be consecutive cards with no intervening cards"
          }
        ]
      });
    }
    let prevPos = destCards[prevIdx].position;
    let nextPos = destCards[nextIdx].position;
    let gap = nextPos - prevPos;
    if (gap <= 1) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const prevRechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.previousCardId]
      );
      const nextRechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId]
      );
      prevPos = parseInt(prevRechecked.rows[0].position, 10);
      nextPos = parseInt(nextRechecked.rows[0].position, 10);
      gap = nextPos - prevPos;
    }
    calculatedPosition = Math.floor((prevPos + nextPos) / 2);
    if (calculatedPosition === prevPos || calculatedPosition === nextPos) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const prevRechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.previousCardId]
      );
      const nextRechecked = await client.query(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId]
      );
      prevPos = parseInt(prevRechecked.rows[0].position, 10);
      nextPos = parseInt(nextRechecked.rows[0].position, 10);
      calculatedPosition = Math.floor((prevPos + nextPos) / 2);
    }
  } else {
    throw validationError("Cannot move with both null neighbors into non-empty column.", {
      issues: [{ path: "previousCardId", message: "Neighbors cannot both be null in non-empty column" }]
    });
  }
  const updateRes = await client.query(
    `UPDATE cards
     SET column_id = $1,
         position = $2,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $3
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at`,
    [input.toColumnId, calculatedPosition, cardId]
  );
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [card.board_id]
  );
  const columnTitleRes = await client.query(
    `SELECT id, name FROM columns WHERE id IN ($1, $2)`,
    [card.column_id, input.toColumnId]
  );
  const colMap = new Map(columnTitleRes.rows.map((r) => [r.id, r.name]));
  const moveChanges = {
    fromColumnId: card.column_id,
    toColumnId: input.toColumnId,
    fromColumnTitle: colMap.get(card.column_id) ?? null,
    toColumnTitle: colMap.get(input.toColumnId) ?? null,
    fromPosition: Number(card.position),
    toPosition: Number(calculatedPosition)
  };
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId,
    actorId,
    action: "card_moved",
    safeChanges: moveChanges
  });
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(client, [cardId]);
  return toCard(
    updateRes.rows[0],
    assigneesMap.get(cardId) ?? [],
    commentCounts.get(cardId) ?? 0,
    imageCounts.get(cardId) ?? 0
  );
}
async function searchProjectCards(poolOrClient, projectId, query, actorId, authorizedBoardIds) {
  const projRes = await poolOrClient.query(
    `SELECT p.id, p.archived, w.timezone
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1`,
    [projectId]
  );
  if (projRes.rows.length === 0 || projRes.rows[0].archived) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const role = await resolveProjectRole(projectId, actorId, poolOrClient);
  if (!role) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  const timezone = projRes.rows[0]?.timezone ?? "UTC";
  const asOfDate = getWorkspaceToday(timezone);
  const visibleBoards = await poolOrClient.query(
    `SELECT b.id, b.snapshot_version, b.access_revision::text FROM boards b
     JOIN projects p ON p.id = b.project_id JOIN workspaces w ON w.id = p.workspace_id
     WHERE b.project_id = $1 AND (w.owner_id = $2 OR EXISTS (
       SELECT 1 FROM project_memberships pm JOIN board_grants bg
         ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
       WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
         AND bg.board_id = b.id))
       ${authorizedBoardIds ? "AND b.id = ANY($3::text[])" : ""}
     ORDER BY b.id`,
    authorizedBoardIds ? [projectId, actorId, authorizedBoardIds] : [projectId, actorId]
  );
  const filterHash = crypto11.createHash("sha256").update(JSON.stringify([
    projectId,
    actorId,
    query.titleQuery ?? query.query ?? "",
    query.priority ?? "",
    query.assigneeId ?? "",
    query.columnId ?? "",
    query.due ?? "",
    asOfDate,
    visibleBoards.rows.map((board) => [board.id, board.snapshot_version, board.access_revision])
  ])).digest("hex");
  const visible = `(w.owner_id = $2 OR EXISTS (
    SELECT 1 FROM project_memberships pm JOIN board_grants bg
      ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
    WHERE pm.project_id = c.project_id AND pm.user_id = $2
      AND pm.status = 'active' AND bg.board_id = c.board_id))`;
  const conditions = [`c.project_id = $1`, `c.state = 'active'`, visible];
  const params = [projectId, actorId];
  if (authorizedBoardIds) {
    conditions.push("c.board_id = ANY($3::text[])");
    params.push(authorizedBoardIds);
  }
  let pIdx = params.length + 1;
  const searchQuery = query.titleQuery ?? query.query;
  if (searchQuery) {
    conditions.push(`(c.title ILIKE $${pIdx} OR c.description ILIKE $${pIdx})`);
    pIdx++;
    params.push(`%${searchQuery}%`);
  }
  if (query.priority) {
    conditions.push(`c.priority = $${pIdx++}`);
    params.push(query.priority);
  }
  if (query.columnId) {
    conditions.push(`c.column_id = $${pIdx++}`);
    params.push(query.columnId);
  }
  if (query.assigneeId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id AND ca.user_id = $${pIdx++})`
    );
    params.push(query.assigneeId);
  }
  if (query.due) {
    if (query.due === "overdue") {
      conditions.push(`c.due_date IS NOT NULL AND c.due_date < $${pIdx++}::date AND col.category != 'done'`);
      params.push(asOfDate);
    } else if (query.due === "today") {
      conditions.push(`c.due_date = $${pIdx++}::date`);
      params.push(asOfDate);
    } else if (query.due === "upcoming") {
      conditions.push(`c.due_date > $${pIdx++}::date`);
      params.push(asOfDate);
    } else if (query.due === "none") {
      conditions.push(`c.due_date IS NULL`);
    }
  }
  const countParams = [...params];
  const countSql = `
    SELECT 
      (SELECT COUNT(*)::INT FROM cards counted
       JOIN projects cp ON cp.id = counted.project_id
       JOIN workspaces cw ON cw.id = cp.workspace_id
       WHERE counted.project_id = $1 AND counted.state = 'active'
         AND (cw.owner_id = $2 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
           WHERE pm.project_id = counted.project_id AND pm.user_id = $2
             AND pm.status = 'active' AND bg.board_id = counted.board_id))
         ${authorizedBoardIds ? "AND counted.board_id = ANY($3::text[])" : ""}) AS active_count,
      COUNT(*)::INT AS matching_count
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN projects p ON p.id = c.project_id
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE ${conditions.join(" AND ")}
  `;
  const countRes = await poolOrClient.query(countSql, countParams);
  const activeCardCount = countRes.rows[0]?.active_count ?? 0;
  const matchingCardCount = countRes.rows[0]?.matching_count ?? 0;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  if (query.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    } catch {
    }
    const parsed = cursor;
    if (!parsed || parsed.hash !== filterHash || typeof parsed.position !== "string" || !/^-?\d+(?:\.\d+)?$/.test(parsed.position) || typeof parsed.id !== "string") {
      throw HttpError.conflict("Stale or malformed pagination cursor.", "STALE_CURSOR");
    }
    conditions.push(`(c.position > $${pIdx}::numeric OR (c.position = $${pIdx}::numeric AND c.id > $${pIdx + 1}))`);
    params.push(parsed.position, parsed.id);
    pIdx += 2;
  }
  params.push(limit + 1);
  const sql2 = `
    SELECT 
      c.id, c.board_id, c.column_id, c.title, c.priority,
      to_char(c.due_date, 'YYYY-MM-DD') AS due_date, c.position::TEXT,
      c.version, c.created_at, c.updated_at
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN projects p ON p.id = c.project_id
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.position ASC, c.id ASC
    LIMIT $${pIdx}
  `;
  const res = await poolOrClient.query(sql2, params);
  const page = res.rows.slice(0, limit);
  const cardIds = page.map((r) => r.id);
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, cardIds);
  const summaries = page.map(
    (r) => toCardSummary(
      r,
      assigneesMap.get(r.id) ?? [],
      commentCounts.get(r.id) ?? 0,
      imageCounts.get(r.id) ?? 0
    )
  );
  if (!await resolveProjectRole(projectId, actorId, poolOrClient)) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  for (const boardId of new Set(page.map((row) => row.board_id))) {
    await requireCardBoardAccess(poolOrClient, boardId, projectId, actorId);
  }
  const last = page.at(-1);
  const nextCursor = res.rows.length > limit && last ? Buffer.from(JSON.stringify({ hash: filterHash, position: last.position, id: last.id })).toString("base64url") : null;
  return { data: summaries, nextCursor, activeCardCount, matchingCardCount };
}
async function getMyTasks(poolOrClient, actorId, options) {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const conditions = [
    `c.state = 'active'`,
    `ca.user_id = $1`,
    `c.project_id = $2`,
    `(w.owner_id = $1 OR pm.id IS NOT NULL)`,
    `(w.owner_id = $1 OR EXISTS (
       SELECT 1 FROM board_grants bg WHERE bg.board_id = c.board_id
         AND bg.project_id = c.project_id AND bg.user_id = $1))`
  ];
  const params = [actorId, options.projectId];
  let pIdx = 3;
  if (options.authorizedBoardIds) {
    conditions.push(`c.board_id = ANY($${pIdx++}::text[])`);
    params.push(options.authorizedBoardIds);
  }
  if (options?.workspaceId) {
    conditions.push(`w.id = $${pIdx++}`);
    params.push(options.workspaceId);
  }
  params.push(limit);
  const res = await poolOrClient.query(
    `SELECT 
       c.id, c.board_id, c.column_id, c.title, c.priority,
       to_char(c.due_date, 'YYYY-MM-DD') AS due_date, c.position::TEXT,
       c.version, c.created_at, c.updated_at,
       p.name AS project_name, b.name AS board_name, col.name AS column_title,
       p.key_prefix || '-' || c.card_number::text AS card_key
     FROM cards c
     JOIN card_assignees ca ON ca.card_id = c.id
     JOIN projects p ON c.project_id = p.id
     JOIN boards b ON c.board_id = b.id
     JOIN columns col ON c.column_id = col.id
     JOIN workspaces w ON p.workspace_id = w.id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.due_date ASC NULLS LAST, c.updated_at DESC
     LIMIT $${pIdx}`,
    params
  );
  const cardIds = res.rows.map((r) => r.id);
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, cardIds);
  const summaries = res.rows.map((r) => ({
    ...toCardSummary(
      r,
      assigneesMap.get(r.id) ?? [],
      commentCounts.get(r.id) ?? 0,
      imageCounts.get(r.id) ?? 0
    ),
    key: r.card_key,
    projectName: r.project_name,
    boardName: r.board_name,
    columnTitle: r.column_title
  }));
  for (const boardId of new Set(res.rows.map((row) => row.board_id))) {
    const allowed = await poolOrClient.query(
      `SELECT EXISTS (
         SELECT 1 FROM boards b JOIN projects p ON p.id = b.project_id
         JOIN workspaces w ON w.id = p.workspace_id
         WHERE b.id = $1 AND (w.owner_id = $2 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = p.id AND bg.board_id = b.id AND bg.user_id = pm.user_id
           WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'))
       ) AS allowed`,
      [boardId, actorId]
    );
    if (!allowed.rows[0]?.allowed) {
      throw HttpError.notFound("Board not found.", "NOT_FOUND");
    }
  }
  return { data: summaries };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/cards.ts
var cardsRoutes = new Hono9();
function requireIdempotencyKey(keyHeader) {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return keyHeader;
}
cardsRoutes.post("/api/v1/boards/:boardId/cards", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const boardId = c.req.param("boardId");
  const idempotencyKey = requireIdempotencyKey(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(createCardInputSchema, rawBody);
  const pool = getPool();
  const boardRes = await pool.query(
    "SELECT id, project_id, archived FROM boards WHERE id = $1",
    [boardId]
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const projectId = boardRes.rows[0].project_id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const methodPath = `/api/v1/boards/${boardId}/cards`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const card = await createCard(client, boardId, input, actor.id);
    const responseBody = { data: card };
    await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      201,
      responseBody
    );
    await client.query("COMMIT");
    return c.json(responseBody, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
cardsRoutes.get("/api/v1/cards/:cardId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const pool = getPool();
  const result = await getCard(pool, cardId, actor.id);
  return c.json(
    {
      data: {
        ...result.card,
        people: result.people
      },
      people: result.people
    },
    200
  );
});
cardsRoutes.patch("/api/v1/cards/:cardId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = requireIdempotencyKey(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(updateCardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardLookup = await client.query(
      "SELECT id, project_id, board_id, state FROM cards WHERE id = $1",
      [cardId]
    );
    if (cardLookup.rows.length === 0 || cardLookup.rows[0].state !== "active") {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const { project_id: projectId, board_id: boardId } = cardLookup.rows[0];
    const methodPath = `/api/v1/cards/${cardId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const updated = await updateCard(client, cardId, input, actor.id);
    const responseBody = { data: updated };
    await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responseBody
    );
    await client.query("COMMIT");
    return c.json(responseBody, 200);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
cardsRoutes.post("/api/v1/cards/:cardId/move", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = requireIdempotencyKey(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(moveCardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardLookup = await client.query(
      "SELECT id, project_id, board_id, state FROM cards WHERE id = $1",
      [cardId]
    );
    if (cardLookup.rows.length === 0 || cardLookup.rows[0].state !== "active") {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const { project_id: projectId, board_id: boardId } = cardLookup.rows[0];
    const methodPath = `/api/v1/cards/${cardId}/move`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const moved = await moveCard(client, cardId, input, actor.id);
    const responseBody = { data: moved };
    await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responseBody
    );
    await client.query("COMMIT");
    return c.json(responseBody, 200);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
cardsRoutes.post("/api/v1/cards/:cardId/move-undo", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = requireIdempotencyKey(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(
    z13.object({
      expectedVersion: z13.number().int().nonnegative(),
      expectedBoardVersion: z13.number().int().nonnegative()
    }),
    rawBody
  );
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardLookup = await client.query(
      "SELECT id, project_id, board_id, state, version FROM cards WHERE id = $1",
      [cardId]
    );
    if (cardLookup.rows.length === 0 || cardLookup.rows[0].state !== "active") {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const card = cardLookup.rows[0];
    const methodPath = `/api/v1/cards/${cardId}/move-undo`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      card.project_id,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      card.board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    if (card.version !== input.expectedVersion) {
      await client.query("ROLLBACK");
      throw HttpError.conflict("STALE_VERSION", "Cannot undo move: card has been modified by intervening work.");
    }
    const actRes = await client.query(
      `SELECT safe_changes
       FROM activity_log
       WHERE card_id = $1 AND action = 'card_moved'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [cardId]
    );
    if (actRes.rows.length === 0 || !actRes.rows[0]?.safe_changes?.fromColumnId) {
      await client.query("ROLLBACK");
      throw HttpError.conflict("NO_PREVIOUS_MOVE", "Cannot undo: no prior move recorded for this card.");
    }
    const { fromColumnId } = actRes.rows[0].safe_changes;
    const colRes = await client.query(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [fromColumnId, card.board_id]
    );
    if (colRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.conflict("DESTINATION_COLUMN_MISSING", "Previous column no longer exists.");
    }
    const moved = await moveCard(
      client,
      cardId,
      {
        toColumnId: fromColumnId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: input.expectedVersion,
        expectedBoardVersion: input.expectedBoardVersion
      },
      actor.id
    );
    const responsePayload = { data: moved };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      card.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
cardsRoutes.get("/api/v1/projects/:projectId/cards/search", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const query = c.req.query();
  const parsed = parseOrThrow(cardsQuerySchema, query);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await searchProjectCards(client, projectId, parsed, actor.id, boardIds);
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
cardsRoutes.get("/api/v1/me/tasks", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const workspaceId = c.req.query("workspaceId");
  const projectId = c.req.query("projectId")?.trim();
  if (!projectId) throw HttpError.badRequest("projectId is required for My Tasks.");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { limit, workspaceId, projectId, authorizedBoardIds: boardIds });
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
cardsRoutes.get("/api/v1/workspaces/:workspaceId/my-tasks", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const workspaceId = c.req.param("workspaceId");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const projectId = c.req.query("projectId")?.trim();
  if (!projectId) throw HttpError.badRequest("projectId is required for My Tasks.");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { limit, workspaceId, projectId, authorizedBoardIds: boardIds });
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/comments.ts
import { Hono as Hono10 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/comments.ts
import crypto12 from "node:crypto";
function encodeCommentCursor(cursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeCommentCursor(value, cardId) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const parsed = JSON.parse(atob(base64));
    if (parsed.v !== 1 || parsed.cardId !== cardId || typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || parsed.id.length === 0) {
      throw new Error("invalid comment cursor");
    }
    return parsed;
  } catch {
    throw HttpError.conflict("STALE_CURSOR", "Comment cursor is invalid or belongs to another card.");
  }
}
async function listCardComments(clientOrPool, cardId, actorId, options) {
  const pool = clientOrPool ?? getPool();
  const cardRes = await pool.query(
    `SELECT id, project_id, workspace_id, board_id, state
     FROM cards
     WHERE id = $1`,
    [cardId]
  );
  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state === "trashed" || card.state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const role = await resolveProjectRole(card.project_id, actorId, pool);
  if (!role) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  if (role !== "owner") {
    const grantRes = await pool.query(
      `SELECT board_id FROM board_grants
       WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4`,
      [card.board_id, card.project_id, card.workspace_id, actorId]
    );
    if (!grantRes.rows[0]) {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
  }
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const cursor = options?.cursor ? decodeCommentCursor(options.cursor, cardId) : void 0;
  const commentsRes = await pool.query(
    `SELECT id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at
     FROM comments
     WHERE card_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::text))
     ORDER BY created_at ASC, id ASC
     LIMIT $4`,
    [cardId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );
  const rawRows = commentsRes.rows;
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCommentCursor({ v: 1, cardId, createdAt: new Date(lastRow.created_at).toISOString(), id: lastRow.id }) : null;
  if (pageRows.length === 0) {
    return { data: [], nextCursor: null };
  }
  const commentIds = pageRows.map((r) => r.id);
  const mentionsRes = await pool.query(
    `SELECT comment_id, user_id, start_offset, end_offset
     FROM comment_mentions
     WHERE comment_id = ANY($1)
     ORDER BY start_offset ASC`,
    [commentIds]
  );
  const mentionsByCommentId = /* @__PURE__ */ new Map();
  for (const m of mentionsRes.rows) {
    const list = mentionsByCommentId.get(m.comment_id) ?? [];
    list.push({
      userId: m.user_id,
      start: m.start_offset,
      end: m.end_offset
    });
    mentionsByCommentId.set(m.comment_id, list);
  }
  const authorIds = Array.from(new Set(pageRows.map((r) => r.author_id)));
  const authorsMap = /* @__PURE__ */ new Map();
  await Promise.all(
    authorIds.map(async (authorId) => {
      const display = await getHistoricalPersonDisplay(pool, card.project_id, authorId);
      if (display) {
        authorsMap.set(authorId, display);
      }
    })
  );
  const comments = pageRows.map((row) => {
    const isDeleted = row.deleted_at !== null;
    const author = authorsMap.get(row.author_id);
    return {
      id: row.id,
      projectId: row.project_id,
      cardId: row.card_id,
      authorId: row.author_id,
      body: isDeleted ? "[Comment deleted]" : row.body,
      mentions: isDeleted ? [] : mentionsByCommentId.get(row.id) ?? [],
      version: row.version,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      author: author ?? void 0
    };
  });
  return {
    data: comments,
    nextCursor
  };
}
async function validateMentions(client, projectId, boardId, body, mentions) {
  if (mentions.length === 0) return;
  const bodyLen = body.length;
  for (const m of mentions) {
    if (m.start < 0 || m.end > bodyLen || m.start >= m.end) {
      throw HttpError.badRequest(
        "VALIDATION_ERROR",
        `Mention span [${m.start}, ${m.end}] is out of bounds for body length ${bodyLen}.`
      );
    }
  }
  const eligible = await getEligibleMentionees(client, projectId, void 0, boardId);
  const eligibleIds = new Set(eligible.map((p) => p.id));
  for (const m of mentions) {
    if (!eligibleIds.has(m.userId)) {
      throw validationError("A mentioned user cannot be mentioned on this card.", {
        issues: [{ path: "mentions", message: "Mentioned user cannot access this board" }]
      });
    }
  }
}
async function postComment(client, cardId, input, actorId) {
  const validated = parseOrThrow(postCommentInputSchema, input);
  const cardRes = await client.query(
    `SELECT id, workspace_id, project_id, board_id, state
     FROM cards
     WHERE id = $1
     FOR SHARE`,
    [cardId]
  );
  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state === "trashed") {
    throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot comment on a trashed card.");
  }
  if (card.state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  await acquireWriteGrantLock(client, card.project_id, actorId, "member", card.board_id);
  await acquireWritableProjectContextLock(client, card.project_id, card.board_id);
  const mentions = validated.mentions ?? [];
  await validateMentions(client, card.project_id, card.board_id, validated.body, mentions);
  const actorRes = await client.query(
    `SELECT display_name, avatar_url FROM users WHERE id = $1`,
    [actorId]
  );
  const actorDisplayName = actorRes.rows[0]?.display_name ?? "A teammate";
  const commentId = "cmt_" + crypto12.randomUUID();
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const insertCommentRes = await client.query(
    `INSERT INTO comments (
       id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, NULL, $7, $7)
     RETURNING id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at`,
    [commentId, card.workspace_id, card.project_id, card.id, actorId, validated.body, nowIso]
  );
  const commentRow = insertCommentRes.rows[0];
  for (const m of mentions) {
    const mentionId = "men_" + crypto12.randomUUID();
    await client.query(
      `INSERT INTO comment_mentions (
         id, comment_id, user_id, start_offset, end_offset, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [mentionId, commentId, m.userId, m.start, m.end, nowIso]
    );
  }
  const uniqueMentionees = Array.from(new Set(mentions.map((m) => m.userId))).filter(
    (uid) => uid !== actorId
  );
  for (const targetUserId of uniqueMentionees) {
    const notifId = "not_" + crypto12.randomUUID();
    const notifTitle = `${actorDisplayName} mentioned you on a card`;
    const notifBody = validated.body.length > 200 ? validated.body.slice(0, 197) + "..." : validated.body;
    const notifLink = `/projects/${card.project_id}/boards/${card.board_id}?cardId=${card.id}`;
    await client.query(
      `INSERT INTO notifications (
         id, workspace_id, project_id, user_id, type, title, body, link, read, created_at, card_id
       ) VALUES ($1, $2, $3, $4, 'mention', $5, $6, $7, FALSE, $8, $9)`,
      [notifId, card.workspace_id, card.project_id, targetUserId, notifTitle, notifBody, notifLink, nowIso, card.id]
    );
  }
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: "comment_created",
    safeChanges: { commentId, mentionsCount: mentions.length },
    createdAt: nowIso
  });
  const outboxId = "out_" + crypto12.randomUUID();
  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES ($1, $2, $3, 'comment.created', $4, 'pending', 0, $5, $5)`,
    [
      outboxId,
      card.workspace_id,
      card.project_id,
      JSON.stringify({
        commentId,
        cardId: card.id,
        authorId: actorId,
        mentions: uniqueMentionees
      }),
      nowIso
    ]
  );
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id]
  );
  const authorDisplay = await getHistoricalPersonDisplay(client, card.project_id, actorId);
  return {
    id: commentRow.id,
    projectId: commentRow.project_id,
    cardId: commentRow.card_id,
    authorId: commentRow.author_id,
    body: commentRow.body,
    mentions,
    version: commentRow.version,
    deletedAt: null,
    createdAt: new Date(commentRow.created_at).toISOString(),
    updatedAt: new Date(commentRow.updated_at).toISOString(),
    author: authorDisplay ?? void 0
  };
}
async function editComment(client, commentId, input, actorId) {
  const validated = parseOrThrow(editCommentInputSchema, input);
  const commentRes = await client.query(
    `SELECT c.id, c.workspace_id, c.project_id, c.card_id, c.author_id, c.body, c.version,
            c.deleted_at, c.created_at, c.updated_at, cd.state AS card_state, cd.board_id
     FROM comments c
     JOIN cards cd ON c.card_id = cd.id
     WHERE c.id = $1
     FOR UPDATE`,
    [commentId]
  );
  if (commentRes.rows.length === 0 || !commentRes.rows[0]) {
    throw HttpError.notFound("Comment not found.", "NOT_FOUND");
  }
  const comment = commentRes.rows[0];
  if (comment.deleted_at !== null) {
    throw HttpError.badRequest("COMMENT_DELETED", "Cannot edit a deleted comment.");
  }
  if (comment.card_state === "trashed") {
    throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot edit comment on a trashed card.");
  }
  if (comment.card_state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  if (actorId !== comment.author_id) {
    throw HttpError.forbidden("Only the author can edit this comment.", "FORBIDDEN");
  }
  await acquireWriteGrantLock(client, comment.project_id, actorId, "member", comment.board_id);
  await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);
  if (comment.version !== validated.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Comment has been modified concurrently.");
  }
  const mentions = validated.mentions ?? [];
  await validateMentions(client, comment.project_id, comment.board_id, validated.body, mentions);
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const updateRes = await client.query(
    `UPDATE comments
     SET body = $1, version = version + 1, updated_at = $2
     WHERE id = $3
     RETURNING id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at`,
    [validated.body, nowIso, commentId]
  );
  const updatedRow = updateRes.rows[0];
  await client.query(`DELETE FROM comment_mentions WHERE comment_id = $1`, [commentId]);
  for (const m of mentions) {
    const mentionId = "men_" + crypto12.randomUUID();
    await client.query(
      `INSERT INTO comment_mentions (
         id, comment_id, user_id, start_offset, end_offset, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [mentionId, commentId, m.userId, m.start, m.end, nowIso]
    );
  }
  await recordActivity(client, {
    workspaceId: comment.workspace_id,
    projectId: comment.project_id,
    boardId: comment.board_id,
    cardId: comment.card_id,
    actorId,
    action: "comment_updated",
    safeChanges: { commentId, version: updatedRow.version },
    createdAt: nowIso
  });
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, comment.board_id]
  );
  const authorDisplay = await getHistoricalPersonDisplay(client, comment.project_id, actorId);
  return {
    id: updatedRow.id,
    projectId: updatedRow.project_id,
    cardId: updatedRow.card_id,
    authorId: updatedRow.author_id,
    body: updatedRow.body,
    mentions,
    version: updatedRow.version,
    deletedAt: null,
    createdAt: new Date(updatedRow.created_at).toISOString(),
    updatedAt: new Date(updatedRow.updated_at).toISOString(),
    author: authorDisplay ?? void 0
  };
}
async function deleteComment(client, commentId, expectedVersion, actorId) {
  const commentRes = await client.query(
    `SELECT c.id, c.workspace_id, c.project_id, c.card_id, c.author_id, c.version,
            c.deleted_at, cd.board_id, cd.state AS card_state
     FROM comments c
     JOIN cards cd ON c.card_id = cd.id
     WHERE c.id = $1
     FOR UPDATE`,
    [commentId]
  );
  if (commentRes.rows.length === 0 || !commentRes.rows[0]) {
    throw HttpError.notFound("Comment not found.", "NOT_FOUND");
  }
  const comment = commentRes.rows[0];
  if (comment.card_state === "trashed") {
    throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot delete a comment on a trashed card.");
  }
  if (comment.card_state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  if (comment.deleted_at !== null) {
    throw HttpError.notFound("Comment not found or already deleted.", "NOT_FOUND");
  }
  if (actorId === comment.author_id) {
    await acquireWriteGrantLock(client, comment.project_id, actorId, "member", comment.board_id);
    await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);
  } else {
    await acquireWriteGrantLock(client, comment.project_id, actorId, "manager", comment.board_id);
    await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);
  }
  if (comment.version !== expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Comment has been modified concurrently.");
  }
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const updateRes = await client.query(
    `UPDATE comments
     SET deleted_at = $1, body = '', version = version + 1, updated_at = $1
     WHERE id = $2
     RETURNING version`,
    [nowIso, commentId]
  );
  await client.query(`DELETE FROM comment_mentions WHERE comment_id = $1`, [commentId]);
  const newVersion = updateRes.rows[0].version;
  await recordActivity(client, {
    workspaceId: comment.workspace_id,
    projectId: comment.project_id,
    boardId: comment.board_id,
    cardId: comment.card_id,
    actorId,
    action: "comment_deleted",
    safeChanges: { commentId, deletedBy: actorId },
    createdAt: nowIso
  });
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, comment.board_id]
  );
  return {
    success: true,
    id: commentId,
    version: newVersion
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/comments.ts
var commentsRoutes = new Hono10();
function parseLimit2(limitParam) {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}
commentsRoutes.get("/cards/:cardId/comments", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const queryParams = c.req.query();
  const limit = parseLimit2(queryParams.limit);
  const cursor = queryParams.cursor;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardContext = await client.query(
      "SELECT board_id FROM cards WHERE id = $1",
      [cardId]
    );
    if (!cardContext.rows[0]) throw HttpError.notFound("Card not found.", "NOT_FOUND");
    await lockBoardAccess(client, cardContext.rows[0].board_id, actor.id);
    const result = await listCardComments(client, cardId, actor.id, {
      limit,
      cursor: cursor !== void 0 ? cursor : void 0
    });
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
commentsRoutes.post("/cards/:cardId/comments", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(postCommentInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardRes = await client.query(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId]
    );
    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const projectId = cardRes.rows[0].project_id;
    const boardId = cardRes.rows[0].board_id;
    const methodPath = `/api/v1/cards/${cardId}/comments`;
    await acquireWriteGrantLock(client, projectId, actor.id, "member", boardId);
    await acquireWritableProjectContextLock(client, projectId, boardId);
    const cardRow = await client.query(
      `SELECT state FROM cards WHERE id = $1 FOR SHARE`,
      [cardId]
    );
    if (cardRow.rows[0]?.state === "trashed") {
      throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot comment on a trashed card.");
    }
    if (cardRow.rows[0]?.state !== "active") {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      body,
      boardId
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const comment = await postComment(client, cardId, body, actor.id);
    const responsePayload = { data: comment };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
commentsRoutes.patch("/comments/:commentId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const commentId = c.req.param("commentId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(editCommentInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT c.project_id, cd.board_id
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1`,
      [commentId]
    );
    if (scope.rows.length === 0 || !scope.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Comment not found.", "NOT_FOUND");
    }
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, "member", scope.rows[0].board_id);
    await acquireWritableProjectContextLock(client, scope.rows[0].project_id, scope.rows[0].board_id);
    const cmtRes = await client.query(
      `SELECT c.project_id, cd.board_id, cd.state AS card_state
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1
       FOR SHARE OF cd`,
      [commentId]
    );
    if (cmtRes.rows.length === 0 || !cmtRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Comment not found.", "NOT_FOUND");
    }
    const projectId = cmtRes.rows[0].project_id;
    if (cmtRes.rows[0].card_state === "trashed") {
      throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot edit comments on a trashed card.");
    }
    if (cmtRes.rows[0].card_state === "purged") {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const methodPath = `/api/v1/comments/${commentId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      body,
      cmtRes.rows[0].board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const comment = await editComment(client, commentId, body, actor.id);
    const responsePayload = { data: comment };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
commentsRoutes.delete("/comments/:commentId", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const commentId = c.req.param("commentId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  let rawBody;
  try {
    rawBody = await c.req.json();
  } catch {
    const vParam = c.req.query("expectedVersion");
    if (vParam) {
      rawBody = { expectedVersion: parseInt(vParam, 10) };
    }
  }
  const body = parseOrThrow(deleteCommentInputSchema, rawBody ?? {});
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT c.project_id, cd.board_id
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1`,
      [commentId]
    );
    if (scope.rows.length === 0 || !scope.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Comment not found.", "NOT_FOUND");
    }
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, "member", scope.rows[0].board_id);
    await acquireWritableProjectContextLock(client, scope.rows[0].project_id, scope.rows[0].board_id);
    const cmtRes = await client.query(
      `SELECT c.project_id, c.author_id, cd.board_id, cd.state AS card_state
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1
       FOR SHARE OF cd`,
      [commentId]
    );
    if (cmtRes.rows.length === 0 || !cmtRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Comment not found.", "NOT_FOUND");
    }
    const projectId = cmtRes.rows[0].project_id;
    if (cmtRes.rows[0].card_state === "trashed") {
      throw HttpError.badRequest("CARD_IS_TRASHED", "Cannot delete comments on a trashed card.");
    }
    if (cmtRes.rows[0].card_state === "purged") {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const methodPath = `/api/v1/comments/${commentId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      actor.id === cmtRes.rows[0].author_id ? "member" : "manager",
      idempotencyKey,
      methodPath,
      body,
      cmtRes.rows[0].board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await deleteComment(client, commentId, body.expectedVersion, actor.id);
    const responsePayload = { data: result };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/trash.ts
import { Hono as Hono11 } from "hono";
import { z as z14 } from "zod";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/trash.ts
async function lockCardBoard(client, cardId, actorId) {
  const context = await client.query(
    "SELECT board_id FROM cards WHERE id = $1",
    [cardId]
  );
  if (!context.rows[0]) throw HttpError.notFound("Card not found.", "NOT_FOUND");
  await lockBoardAccess(client, context.rows[0].board_id, actorId);
}
function encodeTrashCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
function decodeTrashCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.pId === "string" && typeof parsed.dAt === "string" && typeof parsed.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
async function fetchCardWithCounts(clientOrPool, cardId) {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query(
    `SELECT 
       c.*,
       (SELECT COUNT(*)::text FROM comments cm WHERE cm.card_id = c.id AND cm.deleted_at IS NULL) AS comment_count,
       (SELECT COUNT(*)::text FROM card_images ci WHERE ci.card_id = c.id) AS image_count,
       (SELECT COALESCE(array_agg(ca.user_id), '{}') FROM card_assignees ca WHERE ca.card_id = c.id) AS assignee_ids
     FROM cards c
     WHERE c.id = $1`,
    [cardId]
  );
  if (res.rows.length === 0 || !res.rows[0]) {
    return null;
  }
  const row = res.rows[0];
  let dueDateStr = null;
  if (row.due_date) {
    if (typeof row.due_date === "string") {
      dueDateStr = row.due_date.slice(0, 10);
    } else if (row.due_date instanceof Date) {
      dueDateStr = row.due_date.toISOString().slice(0, 10);
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description ?? "",
    priority: row.priority,
    dueDate: dueDateStr,
    assigneeIds: row.assignee_ids ?? [],
    position: Number(row.position),
    version: row.version,
    state: row.state,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by ?? null,
    restoreUntil: row.restore_until ? new Date(row.restore_until).toISOString() : null,
    commentCount: parseInt(row.comment_count, 10) || 0,
    imageCount: parseInt(row.image_count, 10) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
async function deleteCard(client, cardId, input, actorId) {
  const validated = parseOrThrow(softDeleteCardInputSchema, input);
  await lockCardBoard(client, cardId, actorId);
  const cardRes = await client.query(
    `SELECT c.id, c.workspace_id, c.project_id, c.board_id, c.column_id, c.title, c.position, c.version, c.state,
            b.structure_version AS board_structure_version, b.snapshot_version AS board_snapshot_version
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     WHERE c.id = $1
     FOR UPDATE`,
    [cardId]
  );
  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state === "trashed") {
    throw HttpError.conflict("CARD_ALREADY_TRASHED", "Card is already trashed.");
  }
  if (card.state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  await acquireWriteGrantLock(client, card.project_id, actorId, "manager", card.board_id);
  await acquireWritableProjectContextLock(client, card.project_id, card.board_id);
  if (card.version !== validated.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Card version does not match expected version.");
  }
  if (card.board_structure_version !== validated.expectedBoardVersion) {
    throw HttpError.conflict("STALE_VERSION", "Board structure version does not match expected board version.");
  }
  const neighborRes = await client.query(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC`,
    [card.column_id, cardId]
  );
  const cardPos = Number(card.position);
  const prevNeighbors = neighborRes.rows.filter((r) => Number(r.position) < cardPos);
  const nextNeighbors = neighborRes.rows.filter((r) => Number(r.position) > cardPos);
  const previousCardId = prevNeighbors.length > 0 ? prevNeighbors[prevNeighbors.length - 1].id : null;
  const nextCardId = nextNeighbors.length > 0 ? nextNeighbors[0].id : null;
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  await client.query(
    `UPDATE cards
     SET state = 'trashed',
         deleted_at = $1,
         deleted_by = $2,
         restore_until = $1::timestamptz + INTERVAL '24 hours',
         version = version + 1,
         updated_at = $1
     WHERE id = $3`,
    [nowIso, actorId, cardId]
  );
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id]
  );
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: "card_trashed",
    safeChanges: {
      cardId: card.id,
      previousCardId,
      nextCardId,
      originalPosition: cardPos
    },
    createdAt: nowIso
  });
  const updatedCard = await fetchCardWithCounts(client, cardId);
  if (!updatedCard) {
    throw new Error("Failed to retrieve trashed card");
  }
  return updatedCard;
}
async function listProjectTrash(clientOrPool, projectId, actorId, options) {
  const pool = clientOrPool ?? getPool();
  const trashSuffixes = await projectNameSuffixes(pool, projectId);
  const role = await resolveProjectRole(projectId, actorId, pool);
  if (!role) {
    throw HttpError.notFound("Project not found.", "NOT_FOUND");
  }
  if (role !== "owner" && role !== "manager") {
    throw HttpError.forbidden("Only workspace owner or project manager can view trash.", "FORBIDDEN");
  }
  const serverNow = (/* @__PURE__ */ new Date()).toISOString();
  const serverNowTime = new Date(serverNow).getTime();
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  let cursorPayload = null;
  if (options?.cursor) {
    cursorPayload = decodeTrashCursor(options.cursor);
    if (!cursorPayload || cursorPayload.pId !== projectId) {
      throw HttpError.conflict("Stale or malformed pagination cursor.", "STALE_CURSOR");
    }
  }
  const params = [projectId];
  let cursorClause = "";
  if (cursorPayload) {
    params.push(cursorPayload.dAt, cursorPayload.id);
    cursorClause = ` AND (c.deleted_at < $2::timestamptz OR (c.deleted_at = $2::timestamptz AND c.id < $3))`;
  }
  let grantJoin = "";
  if (role !== "owner") {
    params.push(actorId);
    const actorIdx = params.length;
    grantJoin = ` JOIN board_grants bg ON bg.board_id = c.board_id AND bg.project_id = c.project_id AND bg.user_id = $${actorIdx}`;
  }
  let lockedBoardClause = "";
  if (role !== "owner" && options?.authorizedBoardIds) {
    params.push(options.authorizedBoardIds);
    lockedBoardClause = ` AND c.board_id = ANY($${params.length}::text[])`;
  }
  params.push(limit + 1);
  const limitIdx = params.length;
  const res = await pool.query(
    `SELECT 
       c.id,
       c.title,
       p.key_prefix || '-' || c.card_number::text AS card_key,
       c.project_id,
       c.board_id,
       c.column_id AS original_column_id,
       c.version,
       b.structure_version,
       c.deleted_at,
       c.deleted_by,
       c.restore_until,
       p.archived AS project_archived,
       b.archived AS board_archived,
       col.id AS existing_column_id,
       u.id AS actor_id,
       u.display_name AS actor_name,
       u.avatar_url AS actor_avatar
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     JOIN projects p ON c.project_id = p.id${grantJoin}
     LEFT JOIN columns col ON col.id = c.column_id AND col.board_id = c.board_id
     LEFT JOIN users u ON u.id = c.deleted_by
     WHERE c.project_id = $1 AND c.state = 'trashed'${cursorClause}${lockedBoardClause}
     ORDER BY c.deleted_at DESC, c.id DESC
     LIMIT $${limitIdx}`,
    params
  );
  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeTrashCursor({
    pId: projectId,
    dAt: new Date(lastRow.deleted_at).toISOString(),
    id: lastRow.id
  }) : null;
  const trashRows = pageRows.map((row) => {
    const restoreUntilIso = new Date(row.restore_until).toISOString();
    const restoreUntilTime = new Date(restoreUntilIso).getTime();
    let canRestore = true;
    let blockedReason = null;
    if (serverNowTime >= restoreUntilTime) {
      canRestore = false;
      blockedReason = "window_expired";
    } else if (row.project_archived) {
      canRestore = false;
      blockedReason = "project_archived";
    } else if (row.board_archived) {
      canRestore = false;
      blockedReason = "board_archived";
    } else if (!row.existing_column_id) {
      canRestore = false;
      blockedReason = "destination_missing";
    }
    const actorDisplay = row.actor_id ? withNameSuffix({
      id: row.actor_id,
      displayName: row.actor_name ?? "Teammate",
      avatarUrl: row.actor_avatar ?? null,
      activeInProject: true,
      scopedRole: "manager",
      assignable: true,
      mentionable: true
    }, trashSuffixes) : void 0;
    return {
      id: row.id,
      title: row.title,
      key: row.card_key,
      projectId: row.project_id,
      boardId: row.board_id,
      originalColumnId: row.original_column_id,
      version: row.version,
      structureVersion: row.structure_version,
      deletedAt: new Date(row.deleted_at).toISOString(),
      deletedBy: row.deleted_by,
      restoreUntil: restoreUntilIso,
      canRestore,
      blockedReason,
      actor: actorDisplay
    };
  });
  return {
    data: trashRows,
    nextCursor,
    serverNow
  };
}
async function restoreCard(client, cardId, input, actorId) {
  const validated = parseOrThrow(restoreCardInputSchema, input);
  await lockCardBoard(client, cardId, actorId);
  const cardRes = await client.query(
    `SELECT c.id, c.workspace_id, c.project_id, c.board_id, c.column_id, c.title, c.position, c.version, c.state,
            c.restore_until,
            b.structure_version AS board_structure_version,
            b.snapshot_version AS board_snapshot_version,
            b.archived AS board_archived,
            p.archived AS project_archived
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     JOIN projects p ON c.project_id = p.id
     WHERE c.id = $1
     FOR UPDATE`,
    [cardId]
  );
  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  if (card.state === "purged") {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  if (card.state !== "trashed") {
    throw HttpError.badRequest("CARD_NOT_TRASHED", "Card is not in trashed state.");
  }
  await acquireWriteGrantLock(client, card.project_id, actorId, "manager", card.board_id);
  if (card.project_archived) {
    throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot restore card in an archived project.", {
      reason: "project_archived",
      contextId: card.project_id
    });
  }
  if (card.board_archived) {
    throw HttpError.conflict("READ_ONLY_CONTEXT", "Cannot restore card on an archived board.", {
      reason: "board_archived",
      contextId: card.board_id
    });
  }
  const serverNow = /* @__PURE__ */ new Date();
  const restoreUntil = card.restore_until ? new Date(card.restore_until) : /* @__PURE__ */ new Date(0);
  if (serverNow.getTime() >= restoreUntil.getTime()) {
    throw new HttpError(410, "RESTORE_WINDOW_EXPIRED", "Card restore window has expired.", {
      serverNow: serverNow.toISOString(),
      restoreUntil: restoreUntil.toISOString()
    });
  }
  let targetColumnId;
  if (validated.toColumnId) {
    const colRes = await client.query(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [validated.toColumnId, card.board_id]
    );
    if (colRes.rows.length === 0) {
      throw HttpError.badRequest(
        "INVALID_DESTINATION",
        "Explicit destination column does not exist on this board."
      );
    }
    targetColumnId = validated.toColumnId;
  } else {
    const colRes = await client.query(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [card.column_id, card.board_id]
    );
    if (colRes.rows.length === 0) {
      const boardColumns = await client.query(
        "SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC, id ASC",
        [card.board_id]
      );
      throw HttpError.conflict(
        "RESTORE_DESTINATION_REQUIRED",
        "Original column was deleted; explicit destination column is required.",
        {
          reason: "destination_missing",
          boardId: card.board_id,
          columns: boardColumns.rows.map((col) => ({ id: col.id, name: col.name }))
        }
      );
    }
    targetColumnId = card.column_id;
  }
  if (card.version !== validated.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Card version does not match expected version.");
  }
  if (card.board_structure_version !== validated.expectedBoardVersion) {
    throw HttpError.conflict("STALE_VERSION", "Board structure version does not match expected board version.");
  }
  const destCardsRes = await client.query(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [targetColumnId, cardId]
  );
  const destCards = destCardsRes.rows.map((r) => ({
    id: r.id,
    position: Number(r.position)
  }));
  destCards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const actLogRes = await client.query(
    `SELECT safe_changes
     FROM activity_log
     WHERE card_id = $1 AND action = 'card_trashed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [cardId]
  );
  const safeChanges = actLogRes.rows[0]?.safe_changes;
  const prevAnchorId = safeChanges?.previousCardId ?? null;
  const nextAnchorId = safeChanges?.nextCardId ?? null;
  const originalPos = safeChanges?.originalPosition ?? Number(card.position);
  let newPosition;
  if (destCards.length === 0) {
    newPosition = 1e3;
  } else {
    const prevIdx = prevAnchorId ? destCards.findIndex((c) => c.id === prevAnchorId) : -1;
    const nextIdx = nextAnchorId ? destCards.findIndex((c) => c.id === nextAnchorId) : -1;
    if (prevIdx !== -1 && nextIdx !== -1 && nextIdx === prevIdx + 1) {
      newPosition = Math.floor((destCards[prevIdx].position + destCards[nextIdx].position) / 2);
    } else if (prevIdx !== -1) {
      const prevPos = destCards[prevIdx].position;
      const nextCard = destCards[prevIdx + 1];
      newPosition = nextCard ? Math.floor((prevPos + nextCard.position) / 2) : prevPos + 1e3;
    } else if (nextIdx !== -1) {
      const nextPos = destCards[nextIdx].position;
      const prevCard = destCards[nextIdx - 1];
      newPosition = prevCard ? Math.floor((prevCard.position + nextPos) / 2) : Math.max(1, Math.floor(nextPos / 2));
    } else {
      if (originalPos < destCards[0].position) {
        newPosition = Math.max(1, Math.floor(destCards[0].position / 2));
      } else if (originalPos > destCards[destCards.length - 1].position) {
        newPosition = destCards[destCards.length - 1].position + 1e3;
      } else {
        let foundIdx = -1;
        for (let i = 0; i < destCards.length - 1; i++) {
          if (destCards[i].position <= originalPos && originalPos <= destCards[i + 1].position) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx !== -1) {
          newPosition = Math.floor((destCards[foundIdx].position + destCards[foundIdx + 1].position) / 2);
        } else {
          newPosition = destCards[destCards.length - 1].position + 1e3;
        }
      }
    }
    if (destCards.some((c) => c.position === newPosition)) {
      for (let i = 0; i < destCards.length; i++) {
        await client.query("UPDATE cards SET position = $1 WHERE id = $2", [(i + 1) * 1e3, destCards[i].id]);
      }
      newPosition = (destCards.length + 1) * 1e3;
    }
  }
  const nowIso = serverNow.toISOString();
  await client.query(
    `UPDATE cards
     SET state = 'active',
         deleted_at = NULL,
         deleted_by = NULL,
         restore_until = NULL,
         column_id = $1,
         position = $2,
         version = version + 1,
         updated_at = $3
     WHERE id = $4`,
    [targetColumnId, newPosition, nowIso, cardId]
  );
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id]
  );
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: "card_restored",
    safeChanges: { cardId: card.id, columnId: targetColumnId },
    createdAt: nowIso
  });
  const restoredCard = await fetchCardWithCounts(client, cardId);
  if (!restoredCard) {
    throw new Error("Failed to retrieve restored card");
  }
  return restoredCard;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/trash.ts
var trashRoutes = new Hono11();
trashRoutes.post("/cards/:cardId/delete", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(softDeleteCardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardRes = await client.query(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId]
    );
    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const projectId = cardRes.rows[0].project_id;
    const methodPath = `/api/v1/cards/${cardId}/delete`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      cardRes.rows[0].board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const card = await deleteCard(client, cardId, body, actor.id);
    const responsePayload = { data: card };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
var trashQuerySchema = z14.object({
  limit: z14.coerce.number().int().min(1).max(100).optional(),
  cursor: z14.string().optional()
});
trashRoutes.get("/projects/:projectId/trash", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const queryParams = c.req.query();
  const parsed = trashQuerySchema.safeParse(queryParams);
  const options = parsed.success ? parsed.data : void 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = await acquireWriteGrantLock(client, projectId, actor.id, "manager");
    const grants = access.isOwner ? [] : (await client.query(
      `SELECT board_id FROM board_grants
       WHERE project_id = $1 AND user_id = $2
       ORDER BY board_id FOR SHARE`,
      [projectId, actor.id]
    )).rows.map((row) => row.board_id);
    const result = await listProjectTrash(client, projectId, actor.id, {
      ...options,
      ...!access.isOwner ? { authorizedBoardIds: grants } : {}
    });
    await client.query("COMMIT");
    return c.json(result, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
trashRoutes.post("/cards/:cardId/restore", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = c.req.header("idempotency-key");
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  const rawBody = await c.req.json();
  const body = parseOrThrow(restoreCardInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardRes = await client.query(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId]
    );
    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const projectId = cardRes.rows[0].project_id;
    const methodPath = `/api/v1/cards/${cardId}/restore`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "manager",
      idempotencyKey,
      methodPath,
      body,
      cardRes.rows[0].board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const card = await restoreCard(client, cardId, body, actor.id);
    const responsePayload = { data: card };
    const saved = await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    if (saved?.replayed) {
      return c.json(
        { ...saved.responseBody, replayed: true },
        saved.statusCode
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/images.ts
import { Hono as Hono12 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/images.ts
import crypto14 from "node:crypto";
import pg2 from "pg";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/storage.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var storageScope = new AsyncLocalStorage2();
var defaultStorageDriver = null;
function runWithStorageDriver(driver, fn) {
  return storageScope.run({ driver }, fn);
}
function getStorageDriver() {
  const scope = storageScope.getStore();
  const driver = scope ? scope.driver : defaultStorageDriver;
  if (!driver) {
    throw new HttpError(503, "CONFIG_ERROR", "Image storage is not configured for this deployment.");
  }
  return driver;
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/image-validator.ts
import crypto13 from "node:crypto";
var MAX_IMAGE_BYTE_LENGTH2 = 10 * 1024 * 1024;
var MAX_IMAGE_DIMENSION = 8192;
var MAX_IMAGE_MEGAPIXELS = 2e7;
var ImageValidationError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
};
function checkForPolyglotOrMarkup(buffer) {
  const textPrefix = buffer.subarray(0, Math.min(buffer.length, 2048)).toString("utf8").toLowerCase();
  const forbiddenSnippets = [
    "<svg",
    "<?xml",
    "<html",
    "<!doctype html",
    "<script",
    "<iframe",
    "<body",
    "javascript:",
    "onload=",
    "onerror="
  ];
  for (const snippet of forbiddenSnippets) {
    if (textPrefix.includes(snippet)) {
      throw new ImageValidationError(
        "REJECTED_FORMAT",
        `File contains markup or script content (${snippet}), which is not permitted.`
      );
    }
  }
}
function parsePngDimensions(buffer) {
  if (buffer.length < 24) {
    throw new ImageValidationError("MALFORMED_IMAGE", "PNG file truncated before header.");
  }
  const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < pngMagic.length; i++) {
    if (buffer[i] !== pngMagic[i]) {
      throw new ImageValidationError("MIME_SPOOF_DETECTED", "Invalid PNG signature.");
    }
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new ImageValidationError("MALFORMED_IMAGE", "Missing PNG IHDR chunk.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}
function parseJpegDimensions(buffer) {
  if (buffer.length < 4) {
    throw new ImageValidationError("MALFORMED_IMAGE", "JPEG file truncated before header.");
  }
  if (buffer[0] !== 255 || buffer[1] !== 216) {
    throw new ImageValidationError("MIME_SPOOF_DETECTED", "Invalid JPEG signature.");
  }
  let offset = 2;
  const len = buffer.length;
  while (offset < len) {
    if (buffer[offset] !== 255) {
      offset++;
      continue;
    }
    while (offset < len && buffer[offset] === 255) {
      offset++;
    }
    if (offset >= len) break;
    const marker = buffer[offset++];
    if (marker === void 0) break;
    if (marker >= 208 && marker <= 215 || marker === 1 || // TEM
    marker === 0) {
      continue;
    }
    if (marker === 217) {
      break;
    }
    if (marker === 218) {
      break;
    }
    if (offset + 2 > len) {
      throw new ImageValidationError("MALFORMED_IMAGE", "JPEG segment truncated.");
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) {
      throw new ImageValidationError("MALFORMED_IMAGE", "Invalid JPEG segment length.");
    }
    const isSof = marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207;
    if (isSof) {
      if (offset + 7 > len) {
        throw new ImageValidationError("MALFORMED_IMAGE", "JPEG SOF header truncated.");
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new ImageValidationError("MALFORMED_IMAGE", "Could not determine JPEG dimensions.");
}
function parseWebpDimensions(buffer) {
  if (buffer.length < 16) {
    throw new ImageValidationError("MALFORMED_IMAGE", "WebP file truncated before header.");
  }
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") {
    throw new ImageValidationError("MIME_SPOOF_DETECTED", "Invalid WebP signature.");
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType === "VP8 ") {
    if (buffer.length < 30) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8 chunk truncated.");
    }
    if (buffer[23] !== 157 || buffer[24] !== 1 || buffer[25] !== 42) {
      throw new ImageValidationError("MALFORMED_IMAGE", "Invalid WebP VP8 keyframe code.");
    }
    const b26 = buffer[26];
    const b27 = buffer[27];
    const b28 = buffer[28];
    const b29 = buffer[29];
    if (b26 === void 0 || b27 === void 0 || b28 === void 0 || b29 === void 0) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8 chunk truncated.");
    }
    const width = (b26 | b27 << 8) & 16383;
    const height = (b28 | b29 << 8) & 16383;
    return { width, height };
  }
  if (chunkType === "VP8L") {
    if (buffer.length < 25) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8L chunk truncated.");
    }
    if (buffer[20] !== 47) {
      throw new ImageValidationError("MALFORMED_IMAGE", "Invalid WebP VP8L signature byte.");
    }
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    if (b0 === void 0 || b1 === void 0 || b2 === void 0 || b3 === void 0) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8L chunk truncated.");
    }
    const width = 1 + ((b1 & 63) << 8 | b0);
    const height = 1 + ((b3 & 15) << 10 | b2 << 2 | (b1 & 192) >> 6);
    return { width, height };
  }
  if (chunkType === "VP8X") {
    if (buffer.length < 30) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8X chunk truncated.");
    }
    const b24 = buffer[24];
    const b25 = buffer[25];
    const b26 = buffer[26];
    const b27 = buffer[27];
    const b28 = buffer[28];
    const b29 = buffer[29];
    if (b24 === void 0 || b25 === void 0 || b26 === void 0 || b27 === void 0 || b28 === void 0 || b29 === void 0) {
      throw new ImageValidationError("MALFORMED_IMAGE", "WebP VP8X chunk truncated.");
    }
    const width = 1 + (b24 | b25 << 8 | b26 << 16);
    const height = 1 + (b27 | b28 << 8 | b29 << 16);
    return { width, height };
  }
  throw new ImageValidationError("MALFORMED_IMAGE", `Unsupported WebP format chunk: ${chunkType}`);
}
function validateImageBinary(data, expectedContentType, expectedSha256) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length === 0) {
    throw new ImageValidationError("EMPTY_FILE", "Image payload cannot be empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTE_LENGTH2) {
    throw new ImageValidationError(
      "FILE_TOO_LARGE",
      "The image is too large."
    );
  }
  checkForPolyglotOrMarkup(buffer);
  const computedHash = crypto13.createHash("sha256").update(buffer).digest("hex").toLowerCase();
  if (expectedSha256 && computedHash !== expectedSha256.toLowerCase()) {
    throw new ImageValidationError(
      "DIGEST_MISMATCH",
      `Calculated SHA-256 digest (${computedHash}) does not match expected digest (${expectedSha256}).`
    );
  }
  let dimensions;
  switch (expectedContentType) {
    case "image/png":
      dimensions = parsePngDimensions(buffer);
      break;
    case "image/jpeg":
      dimensions = parseJpegDimensions(buffer);
      break;
    case "image/webp":
      dimensions = parseWebpDimensions(buffer);
      break;
    default:
      throw new ImageValidationError(
        "UNSUPPORTED_MEDIA_TYPE",
        `Unsupported image content type: ${expectedContentType}`
      );
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new ImageValidationError(
      "INVALID_DIMENSIONS",
      `Image dimensions must be positive integers (got ${dimensions.width}x${dimensions.height}).`
    );
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new ImageValidationError(
      "DIMENSIONS_EXCEEDED",
      `Image dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed dimension of ${MAX_IMAGE_DIMENSION}px.`
    );
  }
  const megapixels = dimensions.width * dimensions.height;
  if (megapixels > MAX_IMAGE_MEGAPIXELS) {
    throw new ImageValidationError(
      "MEGAPIXELS_EXCEEDED",
      `Image resolution (${megapixels} pixels) exceeds maximum limit of 20 megapixels (20,000,000 pixels).`
    );
  }
  return {
    valid: true,
    contentType: expectedContentType,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: buffer.length,
    sha256: computedHash
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/images.ts
var MAX_CARD_IMAGES = 10;
function stagingKeyOf(upload) {
  return upload.staging_storage_key ?? `staging/${upload.id}/${upload.filename}`;
}
async function requireImageBoardAccess(db, cardId, actorId) {
  const result = await db.query(
    `SELECT c.board_id, c.project_id,
       CASE WHEN w.owner_id = $2 THEN 'owner' ELSE pm.role END AS role
     FROM cards c JOIN projects p ON p.id = c.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     LEFT JOIN board_grants bg ON bg.board_id = c.board_id AND bg.project_id = p.id AND bg.user_id = $2
     WHERE c.id = $1 AND (w.owner_id = $2 OR (pm.id IS NOT NULL AND bg.board_id IS NOT NULL))`,
    [cardId, actorId]
  );
  const row = result.rows[0];
  if (!row) throw HttpError.notFound("Image not found.", "NOT_FOUND");
  return { boardId: row.board_id, projectId: row.project_id, role: row.role };
}
function mapUploadRowToContract(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    version: row.version,
    state: row.state,
    expectedBytes: row.byte_length,
    receivedBytes: row.received_bytes,
    expiresAt: row.expires_at.toISOString(),
    serverNow: (/* @__PURE__ */ new Date()).toISOString(),
    finalizedImageId: row.finalized_image_id,
    error: row.error
  };
}
function mapFinalizedImageRowToContract(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    filename: row.filename,
    byteLength: row.byte_length,
    contentType: row.content_type,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    uploaderId: row.uploader_id,
    version: row.version,
    createdAt: row.created_at.toISOString()
  };
}
async function createImageUpload(clientOrPool, actorId, cardId, input) {
  const cardRes = await clientOrPool.query(
    "SELECT id, workspace_id, project_id, board_id, state FROM cards WHERE id = $1",
    [cardId]
  );
  if (cardRes.rows.length === 0) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  await verifyProjectAncestry(clientOrPool, card.workspace_id, card.project_id, {
    id: card.id,
    type: "card"
  });
  const role = await resolveProjectRole(card.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  await requireImageBoardAccess(clientOrPool, card.id, actorId);
  if (role === "viewer") {
    throw HttpError.forbidden("Viewers cannot stage or upload image attachments.");
  }
  if (card.state !== "active") {
    throw HttpError.conflict("Cannot attach images to a trashed or inactive card.", "CARD_TRASHED");
  }
  await clientOrPool.query("SELECT id FROM cards WHERE id = $1 FOR UPDATE", [card.id]);
  const countRes = await clientOrPool.query(
    `SELECT ((SELECT COUNT(*) FROM card_images WHERE card_id = $1)
           + (SELECT COUNT(*) FROM card_image_uploads
              WHERE card_id = $1 AND expires_at > NOW()
                AND state IN ('awaiting_content', 'content_received', 'validating')))::text AS count`,
    [card.id]
  );
  const currentCount = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (currentCount >= MAX_CARD_IMAGES) {
    throw HttpError.unprocessable(
      `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
      "IMAGE_LIMIT_EXCEEDED"
    );
  }
  const uploadId = "upl_" + crypto14.randomUUID();
  const insertRes = await clientOrPool.query(
    `INSERT INTO card_image_uploads (
       id, workspace_id, project_id, card_id, uploader_id,
       filename, byte_length, content_type, sha256, staging_storage_key,
       state, expires_at, version, received_bytes, error,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       'awaiting_content', NOW() + INTERVAL '1 hour', 1, NULL, NULL,
       NOW(), NOW()
     ) RETURNING *`,
    [
      uploadId,
      card.workspace_id,
      card.project_id,
      card.id,
      actorId,
      input.filename,
      input.byteLength,
      input.contentType,
      input.sha256,
      `staging/${uploadId}`
    ]
  );
  return mapUploadRowToContract(insertRes.rows[0]);
}
async function receiveImageContent(clientOrPool, actorId, uploadId, rawBytes) {
  const uploadRes = await clientOrPool.query(
    "SELECT * FROM card_image_uploads WHERE id = $1",
    [uploadId]
  );
  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  const upload = uploadRes.rows[0];
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: "upload"
  });
  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  if (actorId !== upload.uploader_id && role !== "owner" && role !== "manager") {
    throw HttpError.forbidden("Only the original uploader or a project manager can provide upload content.");
  }
  if (upload.state === "finalized") {
    return mapUploadRowToContract(upload);
  }
  if (upload.state === "cancelled") {
    throw HttpError.conflict("Upload staging has been cancelled.", "UPLOAD_CANCELLED");
  }
  if (upload.state === "expired" || upload.expires_at.getTime() < Date.now()) {
    await clientOrPool.query(
      `UPDATE card_image_uploads
       SET state = 'expired', updated_at = NOW(), version = version + 1
       WHERE id = $1`,
      [uploadId]
    );
    throw HttpError.badRequest("Upload staging has expired.", "UPLOAD_EXPIRED");
  }
  if (rawBytes.byteLength !== upload.byte_length) {
    throw HttpError.badRequest(
      "The upload does not match what was declared. Start the upload again.",
      "SIZE_MISMATCH"
    );
  }
  const actualHash = crypto14.createHash("sha256").update(rawBytes).digest("hex").toLowerCase();
  if (actualHash !== upload.sha256.toLowerCase()) {
    throw HttpError.badRequest(
      `Payload SHA-256 digest (${actualHash}) does not match staged hash (${upload.sha256}).`,
      "DIGEST_MISMATCH"
    );
  }
  try {
    validateImageBinary(rawBytes, upload.content_type, upload.sha256);
  } catch (err) {
    const code = err instanceof ImageValidationError ? err.code : "INVALID_IMAGE";
    const message = err instanceof Error ? err.message : "Invalid image binary";
    await clientOrPool.query(
      `UPDATE card_image_uploads
       SET state = 'failed',
           error = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [uploadId, JSON.stringify({ code, message, retryable: false })]
    );
    throw HttpError.unprocessable(message, code);
  }
  const storage = getStorageDriver();
  const stagingKey = stagingKeyOf(upload);
  await storage.put(stagingKey, rawBytes, upload.content_type);
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  const updateRes = await clientOrPool.query(
    `UPDATE card_image_uploads
     SET state = 'content_received',
         received_bytes = $2,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1 AND state IN ('awaiting_content', 'content_received')
     RETURNING *`,
    [uploadId, rawBytes.byteLength]
  );
  if (!updateRes.rows[0]) throw HttpError.conflict("Upload state changed.", "INVALID_UPLOAD_STATE");
  return mapUploadRowToContract(updateRes.rows[0]);
}
async function finalizeImageUpload(clientOrPool, actorId, uploadId) {
  const isPool4 = clientOrPool instanceof pg2.Pool;
  const client = isPool4 ? await clientOrPool.connect() : clientOrPool;
  try {
    if (isPool4) await client.query("BEGIN");
    const initial = await client.query("SELECT * FROM card_image_uploads WHERE id = $1", [uploadId]);
    if (!initial.rows[0]) throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    const access = await requireImageBoardAccess(client, initial.rows[0].card_id, actorId);
    await acquireWriteGrantLock(client, access.projectId, actorId, "member", access.boardId);
    const uploadRes = await client.query(
      "SELECT * FROM card_image_uploads WHERE id = $1 FOR UPDATE",
      [uploadId]
    );
    if (uploadRes.rows.length === 0) {
      throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    }
    const upload = uploadRes.rows[0];
    await verifyProjectAncestry(client, upload.workspace_id, upload.project_id, {
      id: upload.id,
      type: "upload"
    });
    const role = await resolveProjectRole(upload.project_id, actorId, client);
    if (!role) {
      throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    }
    if (actorId !== upload.uploader_id && role !== "owner" && role !== "manager") {
      throw HttpError.forbidden("Only the original uploader or a project manager can finalize an upload.");
    }
    if (upload.state === "finalized" && upload.finalized_image_id) {
      const imgRes = await client.query(
        "SELECT * FROM card_images WHERE id = $1",
        [upload.finalized_image_id]
      );
      if (imgRes.rows.length > 0) {
        if (isPool4) await client.query("COMMIT");
        return mapFinalizedImageRowToContract(imgRes.rows[0]);
      }
    }
    if (upload.state !== "content_received") {
      throw HttpError.conflict(
        `Upload cannot be finalized from state "${upload.state}". Must be "content_received".`,
        "INVALID_UPLOAD_STATE"
      );
    }
    if (upload.expires_at.getTime() < Date.now()) {
      await client.query(
        `UPDATE card_image_uploads
         SET state = 'expired', version = version + 1, updated_at = NOW()
         WHERE id = $1`,
        [uploadId]
      );
      throw HttpError.badRequest("Upload staging has expired.", "UPLOAD_EXPIRED");
    }
    const cardRes = await client.query("SELECT id, workspace_id, project_id, board_id, state, version FROM cards WHERE id = $1 FOR UPDATE", [
      upload.card_id
    ]);
    if (cardRes.rows.length === 0) {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const card = cardRes.rows[0];
    if (card.state !== "active") {
      throw HttpError.conflict("Cannot attach image to a trashed or inactive card.", "CARD_TRASHED");
    }
    const countRes = await client.query(
      "SELECT COUNT(*)::text AS count FROM card_images WHERE card_id = $1",
      [card.id]
    );
    const currentCount = parseInt(countRes.rows[0]?.count ?? "0", 10);
    if (currentCount >= MAX_CARD_IMAGES) {
      await client.query(
        `UPDATE card_image_uploads
         SET state = 'failed',
             error = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [
          uploadId,
          JSON.stringify({
            code: "IMAGE_LIMIT_EXCEEDED",
            message: `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
            retryable: false
          })
        ]
      );
      throw HttpError.unprocessable(
        `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
        "IMAGE_LIMIT_EXCEEDED"
      );
    }
    const storage = getStorageDriver();
    const stagingKey = stagingKeyOf(upload);
    const stored = await storage.get(stagingKey);
    if (!stored) {
      throw HttpError.badRequest("Staged image content missing from storage.", "CONTENT_MISSING");
    }
    const validation = validateImageBinary(stored.data, upload.content_type, upload.sha256);
    const imageId = "img_" + crypto14.randomUUID();
    const finalStorageKey = `images/${upload.project_id}/${upload.card_id}/${imageId}`;
    await storage.put(finalStorageKey, stored.data, upload.content_type);
    await storage.delete(stagingKey);
    const insertImageRes = await client.query(
      `INSERT INTO card_images (
         id, workspace_id, project_id, card_id, uploader_id,
         filename, byte_length, content_type, storage_key, sha256,
         width, height, version, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, 1, NOW(), NOW()
       ) RETURNING *`,
      [
        imageId,
        upload.workspace_id,
        upload.project_id,
        upload.card_id,
        upload.uploader_id,
        upload.filename,
        upload.byte_length,
        upload.content_type,
        finalStorageKey,
        upload.sha256,
        validation.width,
        validation.height
      ]
    );
    await client.query(
      `UPDATE card_image_uploads
       SET state = 'finalized',
           finalized_image_id = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [uploadId, imageId]
    );
    await client.query(
      `UPDATE boards
       SET snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1`,
      [card.board_id]
    );
    await recordActivity(client, {
      workspaceId: card.workspace_id,
      projectId: card.project_id,
      boardId: card.board_id,
      cardId: card.id,
      actorId,
      action: "image_attached",
      safeChanges: {
        imageId,
        filename: upload.filename,
        byteLength: upload.byte_length,
        contentType: upload.content_type,
        width: validation.width,
        height: validation.height
      }
    });
    if (isPool4) await client.query("COMMIT");
    return mapFinalizedImageRowToContract(insertImageRes.rows[0]);
  } catch (err) {
    if (isPool4) await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    if (isPool4 && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}
async function getImageUpload(clientOrPool, actorId, uploadId) {
  const uploadRes = await clientOrPool.query(
    "SELECT * FROM card_image_uploads WHERE id = $1",
    [uploadId]
  );
  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  const upload = uploadRes.rows[0];
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: "upload"
  });
  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  return mapUploadRowToContract(upload);
}
async function cancelImageUpload(clientOrPool, actorId, uploadId) {
  const uploadRes = await clientOrPool.query(
    "SELECT * FROM card_image_uploads WHERE id = $1",
    [uploadId]
  );
  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  const upload = uploadRes.rows[0];
  const access = await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: "upload"
  });
  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
  }
  if (actorId !== upload.uploader_id && role !== "owner" && role !== "manager") {
    throw HttpError.forbidden("Only the original uploader or a project manager can cancel an upload.");
  }
  if (upload.state === "finalized") {
    throw HttpError.conflict("Cannot cancel an upload that has already been finalized.", "ALREADY_FINALIZED");
  }
  if (upload.state === "cancelled") {
    return mapUploadRowToContract(upload);
  }
  if (!(clientOrPool instanceof pg2.Pool)) {
    await acquireWriteGrantLock(clientOrPool, access.projectId, actorId, "member", access.boardId);
  }
  const storage = getStorageDriver();
  const stagingKey = stagingKeyOf(upload);
  await storage.delete(stagingKey).catch(() => {
  });
  const updateRes = await clientOrPool.query(
    `UPDATE card_image_uploads
     SET state = 'cancelled', version = version + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [uploadId]
  );
  return mapUploadRowToContract(updateRes.rows[0]);
}
async function listCardImages(clientOrPool, actorId, cardId) {
  const cardRes = await clientOrPool.query("SELECT id, workspace_id, project_id, board_id, state FROM cards WHERE id = $1", [cardId]);
  if (cardRes.rows.length === 0) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  const card = cardRes.rows[0];
  await verifyProjectAncestry(clientOrPool, card.workspace_id, card.project_id, {
    id: card.id,
    type: "card"
  });
  const role = await resolveProjectRole(card.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Card not found.", "NOT_FOUND");
  }
  await requireImageBoardAccess(clientOrPool, card.id, actorId);
  if (card.state === "trashed") {
    if (role !== "owner" && role !== "manager") {
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
  }
  const imagesRes = await clientOrPool.query(
    `SELECT * FROM card_images
     WHERE card_id = $1
     ORDER BY created_at ASC, id ASC`,
    [card.id]
  );
  const items = imagesRes.rows.map(mapFinalizedImageRowToContract);
  await requireImageBoardAccess(clientOrPool, card.id, actorId);
  return { items, totalCount: items.length };
}
async function getImageContent(clientOrPool, actorId, imageId) {
  const imgRes = await clientOrPool.query(
    "SELECT * FROM card_images WHERE id = $1",
    [imageId]
  );
  if (imgRes.rows.length === 0) {
    throw HttpError.notFound("Image not found.", "NOT_FOUND");
  }
  const image = imgRes.rows[0];
  await requireImageBoardAccess(clientOrPool, image.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, image.workspace_id, image.project_id, {
    id: image.id,
    type: "image"
  });
  const role = await resolveProjectRole(image.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound("Image not found.", "NOT_FOUND");
  }
  const cardRes = await clientOrPool.query(
    "SELECT state FROM cards WHERE id = $1",
    [image.card_id]
  );
  const cardState = cardRes.rows[0]?.state;
  if (cardState === "trashed") {
    if (role !== "owner" && role !== "manager") {
      throw HttpError.notFound("Image not found.", "NOT_FOUND");
    }
  }
  if (cardState !== "active" && cardState !== "trashed") {
    throw HttpError.notFound("Image not found.", "NOT_FOUND");
  }
  const storage = getStorageDriver();
  const stored = await storage.get(image.storage_key);
  if (!stored) {
    throw HttpError.notFound("Image binary not found in storage.", "NOT_FOUND");
  }
  await requireImageBoardAccess(clientOrPool, image.card_id, actorId);
  return {
    data: stored.data,
    contentType: image.content_type,
    filename: image.filename,
    byteLength: image.byte_length,
    sha256: image.sha256
  };
}
async function deleteCardImage(clientOrPool, actorId, imageId, expectedVersion) {
  const isPool4 = clientOrPool instanceof pg2.Pool;
  const client = isPool4 ? await clientOrPool.connect() : clientOrPool;
  try {
    if (isPool4) await client.query("BEGIN");
    const initial = await client.query("SELECT * FROM card_images WHERE id = $1", [imageId]);
    if (!initial.rows[0]) throw HttpError.notFound("Image not found.", "NOT_FOUND");
    const access = await requireImageBoardAccess(client, initial.rows[0].card_id, actorId);
    await acquireWriteGrantLock(client, access.projectId, actorId, "member", access.boardId);
    const imgRes = await client.query(
      "SELECT * FROM card_images WHERE id = $1 FOR UPDATE",
      [imageId]
    );
    if (imgRes.rows.length === 0) {
      throw HttpError.notFound("Image not found.", "NOT_FOUND");
    }
    const image = imgRes.rows[0];
    await verifyProjectAncestry(client, image.workspace_id, image.project_id, {
      id: image.id,
      type: "image"
    });
    const role = await resolveProjectRole(image.project_id, actorId, client);
    if (!role) {
      throw HttpError.notFound("Image not found.", "NOT_FOUND");
    }
    if (actorId !== image.uploader_id && role !== "owner" && role !== "manager") {
      throw HttpError.forbidden("Only the original uploader or a project manager can remove this image.");
    }
    const cardRes = await client.query(
      "SELECT id, board_id, state FROM cards WHERE id = $1",
      [image.card_id]
    );
    const card = cardRes.rows[0];
    if (card && card.state === "trashed") {
      throw HttpError.conflict("Cannot remove images from a trashed card.", "CARD_TRASHED");
    }
    if (image.version !== expectedVersion) {
      throw HttpError.conflict(
        "This image changed since you loaded it. Reload to see the latest version.",
        "STALE_VERSION"
      );
    }
    await client.query("DELETE FROM card_images WHERE id = $1", [imageId]);
    await client.query(
      `INSERT INTO pending_storage_deletions (storage_key) VALUES ($1)
       ON CONFLICT (storage_key) DO NOTHING`,
      [image.storage_key]
    );
    const deletedStorageKey = image.storage_key;
    if (card) {
      await client.query(
        "UPDATE boards SET snapshot_version = snapshot_version + 1, updated_at = NOW() WHERE id = $1",
        [card.board_id]
      );
    }
    await recordActivity(client, {
      workspaceId: image.workspace_id,
      projectId: image.project_id,
      boardId: card?.board_id,
      cardId: image.card_id,
      actorId,
      action: "image_removed",
      safeChanges: { imageId: image.id, filename: image.filename }
    });
    if (isPool4) await client.query("COMMIT");
    return { result: { success: true, imageId }, storageKey: deletedStorageKey };
  } catch (err) {
    if (isPool4) await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    if (isPool4 && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}
async function deleteStorageAfterCommit(client, storageKey) {
  try {
    await getStorageDriver().delete(storageKey);
  } catch {
    return;
  }
  await client.query("DELETE FROM pending_storage_deletions WHERE storage_key = $1", [storageKey]).catch(() => {
  });
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/images.ts
var imagesRoutes = new Hono12();
var requireImageStorage = async (_c, next) => {
  getStorageDriver();
  await next();
};
async function getImageForDelivery(imageId, actorId) {
  const pool = getPool();
  const result = await getImageContent(pool, actorId, imageId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const image = await client.query(
      `SELECT c.board_id, c.id AS card_id FROM card_images i
       JOIN cards c ON c.id = i.card_id AND c.project_id = i.project_id AND c.workspace_id = i.workspace_id
       WHERE i.id = $1`,
      [imageId]
    );
    if (!image.rows[0]) throw HttpError.notFound("Image not found.", "NOT_FOUND");
    const access = await lockBoardAccess(client, image.rows[0].board_id, actorId);
    const card = await client.query(
      "SELECT state FROM cards WHERE id = $1 FOR SHARE",
      [image.rows[0].card_id]
    );
    if (card.rows[0]?.state !== "active" && !(card.rows[0]?.state === "trashed" && (access.role === "owner" || access.role === "manager"))) {
      throw HttpError.notFound("Image not found.", "NOT_FOUND");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
}
function requireIdempotencyKey2(keyHeader) {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return keyHeader;
}
imagesRoutes.post("/api/v1/cards/:cardId/image-uploads", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const idempotencyKey = requireIdempotencyKey2(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(createImageUploadInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cardRes = await client.query(
      "SELECT id, project_id, board_id, state FROM cards WHERE id = $1",
      [cardId]
    );
    if (cardRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Card not found.", "NOT_FOUND");
    }
    const card = cardRes.rows[0];
    const methodPath = `/api/v1/cards/${cardId}/image-uploads`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      card.project_id,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      card.board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    if (card.state !== "active") {
      throw HttpError.conflict("Cannot attach images to a trashed or inactive card.", "CARD_TRASHED");
    }
    const upload = await createImageUpload(client, actor.id, cardId, input);
    const responsePayload = { data: upload };
    await saveReceipt(
      client,
      actor.id,
      "project",
      card.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
      201,
      responsePayload
    );
    await client.query("COMMIT");
    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
imagesRoutes.put("/api/v1/image-uploads/:uploadId/content", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const uploadId = c.req.param("uploadId");
  const arrayBuffer = await c.req.arrayBuffer();
  const rawBytes = new Uint8Array(arrayBuffer);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT u.project_id, c.board_id FROM card_image_uploads u
       JOIN cards c ON c.id = u.card_id WHERE u.id = $1`,
      [uploadId]
    );
    if (!scope.rows[0]) throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, "member", scope.rows[0].board_id);
    const upload = await receiveImageContent(client, actor.id, uploadId, rawBytes);
    await client.query("COMMIT");
    return c.json({ data: upload }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
imagesRoutes.post("/api/v1/image-uploads/:uploadId/finalize", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const uploadId = c.req.param("uploadId");
  const idempotencyKey = requireIdempotencyKey2(c.req.header("idempotency-key"));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uploadRes = await client.query(`SELECT u.id, u.project_id, u.card_id, c.board_id, u.state, u.finalized_image_id
        FROM card_image_uploads u JOIN cards c ON c.id = u.card_id WHERE u.id = $1`, [
      uploadId
    ]);
    if (uploadRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    }
    const uploadRecord = uploadRes.rows[0];
    const methodPath = `/api/v1/image-uploads/${uploadId}/finalize`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      uploadRecord.project_id,
      "member",
      idempotencyKey,
      methodPath,
      {},
      uploadRecord.board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const finalized = await finalizeImageUpload(client, actor.id, uploadId);
    const responsePayload = { data: finalized };
    await saveReceipt(
      client,
      actor.id,
      "project",
      uploadRecord.project_id,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload
    );
    await client.query("COMMIT");
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});
imagesRoutes.get("/api/v1/image-uploads/:uploadId", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const uploadId = c.req.param("uploadId");
  const pool = getPool();
  const upload = await getImageUpload(pool, actor.id, uploadId);
  return c.json({ data: upload }, 200);
});
imagesRoutes.delete("/api/v1/image-uploads/:uploadId", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const uploadId = c.req.param("uploadId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT u.project_id, c.board_id FROM card_image_uploads u
       JOIN cards c ON c.id = u.card_id WHERE u.id = $1`,
      [uploadId]
    );
    if (!scope.rows[0]) throw HttpError.notFound("Upload staging record not found.", "NOT_FOUND");
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, "member", scope.rows[0].board_id);
    const upload = await cancelImageUpload(client, actor.id, uploadId);
    await client.query("COMMIT");
    return c.json({ data: upload }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
});
imagesRoutes.get("/api/v1/cards/:cardId/images", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const pool = getPool();
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const card = await client.query("SELECT board_id FROM cards WHERE id = $1", [cardId]);
    if (!card.rows[0]) throw HttpError.notFound("Card not found.", "NOT_FOUND");
    await lockBoardAccess(client, card.rows[0].board_id, actor.id);
    result = await listCardImages(client, actor.id, cardId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
  return c.json(
    {
      data: {
        items: result.items,
        nextCursor: null,
        totalCount: result.totalCount
      }
    },
    200
  );
});
imagesRoutes.get("/api/v1/images/:imageId/content", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const imageId = c.req.param("imageId");
  const result = await getImageForDelivery(imageId, actor.id);
  return new Response(Buffer.from(result.data), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.filename)}"`,
      "Content-Length": String(result.byteLength),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
imagesRoutes.get("/api/v1/images/:imageId/thumbnail", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const imageId = c.req.param("imageId");
  const result = await getImageForDelivery(imageId, actor.id);
  return new Response(Buffer.from(result.data), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.filename)}"`,
      "Content-Length": String(result.byteLength),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
imagesRoutes.delete("/api/v1/images/:imageId", authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const imageId = c.req.param("imageId");
  const idempotencyKey = requireIdempotencyKey2(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(deleteImageInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const imgRes = await client.query(
      "SELECT i.id, i.project_id, c.board_id FROM card_images i JOIN cards c ON c.id = i.card_id WHERE i.id = $1",
      [imageId]
    );
    if (imgRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Image not found.", "NOT_FOUND");
    }
    const projectId = imgRes.rows[0].project_id;
    const methodPath = `/api/v1/images/${imageId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      "member",
      idempotencyKey,
      methodPath,
      rawBody,
      imgRes.rows[0].board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const { result, storageKey } = await deleteCardImage(client, actor.id, imageId, input.expectedVersion);
    const responsePayload = { data: result };
    await saveReceipt(
      client,
      actor.id,
      "project",
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    await deleteStorageAfterCommit(client, storageKey);
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/imports.ts
import fs2 from "node:fs";
import { Hono as Hono13 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/imports.ts
import crypto15 from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/services/excel-parser.ts
import zlib from "node:zlib";
var MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
var MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
var MAX_IMPORT_ROWS = 200;
var STANDARD_HEADERS = [
  "External ID",
  "Title",
  "Description",
  "Priority",
  "Due Date",
  "Assignees",
  "Status"
];
function unzipXlsx(buffer) {
  if (buffer.length > MAX_COMPRESSED_BYTES) {
    throw new HttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The workbook is too large to import."
    );
  }
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === 101010256) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw HttpError.unprocessable(
      "INVALID_WORKBOOK",
      "Invalid workbook file: missing ZIP central directory signature."
    );
  }
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (totalEntries > 100) {
    throw HttpError.unprocessable(
      "INVALID_WORKBOOK",
      "Invalid workbook package: exceeds maximum allowed entry count."
    );
  }
  const files = /* @__PURE__ */ new Map();
  let totalExpandedBytes = 0;
  let offset = cdOffset;
  const expandedTooLarge = () => new HttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    "The workbook contains too much content to import."
  );
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 33639248) {
      throw HttpError.unprocessable(
        "INVALID_WORKBOOK",
        "Invalid workbook package: corrupted central directory entry."
      );
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLen);
    offset += 46 + fileNameLen + extraLen + commentLen;
    const lowerName = fileName.toLowerCase();
    if (lowerName.startsWith("xl/embeddings/") || lowerName.endsWith(".ole")) {
      throw HttpError.unprocessable(
        "OLE_EMBEDDINGS_REJECTED",
        "Embedded OLE objects are strictly disallowed."
      );
    }
    if (lowerName.startsWith("xl/externallinks/") || lowerName.includes("externalreferences")) {
      throw HttpError.unprocessable(
        "EXTERNAL_LINKS_REJECTED",
        "External package links and external references are strictly disallowed."
      );
    }
    if (lowerName.endsWith(".bin") || lowerName.endsWith(".exe") || lowerName.endsWith(".dll") || lowerName.endsWith(".vbs") || lowerName.endsWith(".bat") || lowerName.endsWith(".cmd") || lowerName.includes("vba")) {
      throw HttpError.unprocessable(
        "MACRO_OR_EXECUTABLE_REJECTED",
        "Macros, executable code, and binary package parts are strictly disallowed."
      );
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 67324752) {
      throw HttpError.unprocessable(
        "INVALID_WORKBOOK",
        "Invalid workbook package: corrupted local file header."
      );
    }
    const localFileLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw HttpError.unprocessable(
        "INVALID_WORKBOOK",
        "Invalid workbook package: compressed data segment overflow."
      );
    }
    const remainingBudget = MAX_EXPANDED_BYTES - totalExpandedBytes;
    if (uncompressedSize > remainingBudget) {
      throw expandedTooLarge();
    }
    const compressedData = buffer.subarray(dataStart, dataEnd);
    let uncompressedData;
    if (method === 0) {
      if (compressedData.length > remainingBudget) {
        throw expandedTooLarge();
      }
      uncompressedData = Buffer.from(compressedData);
    } else if (method === 8) {
      try {
        uncompressedData = zlib.inflateRawSync(compressedData, { maxOutputLength: remainingBudget });
      } catch (err) {
        if (err instanceof RangeError && err.code === "ERR_BUFFER_TOO_LARGE") {
          throw expandedTooLarge();
        }
        throw HttpError.unprocessable(
          "DECOMPRESSION_FAILED",
          "Failed to decompress workbook XML content."
        );
      }
    } else {
      throw HttpError.unprocessable(
        "INVALID_WORKBOOK",
        `Unsupported ZIP compression method: ${method}`
      );
    }
    totalExpandedBytes += uncompressedData.length;
    files.set(fileName, uncompressedData);
  }
  return files;
}
function assertNoXXE(xml, fileName) {
  const upper = xml.toUpperCase();
  if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) {
    throw HttpError.unprocessable(
      "XXE_DETECTED",
      `XML External Entity (XXE) declaration detected in ${fileName}. Entity declarations are strictly disallowed.`
    );
  }
}
function unescapeXml(text2) {
  return text2.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}
function colLettersToIndex(col) {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1;
}
function excelSerialToIsoDate(serial, is1904) {
  if (isNaN(serial) || !isFinite(serial)) {
    throw new Error("Invalid numeric date serial");
  }
  const intSerial = Math.floor(serial);
  if (is1904) {
    if (intSerial < 0 || intSerial > 2958465) {
      throw new Error("Date serial out of valid Gregorian range");
    }
    const epochMs = Date.UTC(1904, 0, 1);
    const date = new Date(epochMs + intSerial * 864e5);
    const iso = date.toISOString().split("T")[0];
    if (!isValidGregorianDate(iso)) {
      throw new Error("Invalid calendar date");
    }
    return iso;
  } else {
    if (intSerial === 60) {
      throw new Error("Fictitious 1900-02-29 date is not supported");
    }
    if (intSerial < 1 || intSerial > 2958465) {
      throw new Error("Date serial out of valid Gregorian range");
    }
    const epochMs = intSerial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const date = new Date(epochMs + intSerial * 864e5);
    const iso = date.toISOString().split("T")[0];
    if (!isValidGregorianDate(iso)) {
      throw new Error("Invalid calendar date");
    }
    return iso;
  }
}
function parseSharedStrings(xml) {
  assertNoXXE(xml, "xl/sharedStrings.xml");
  const strings = [];
  const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1];
    const tRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tMatch;
    let strVal = "";
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      strVal += tMatch[1];
    }
    strings.push(unescapeXml(strVal));
  }
  return strings;
}
function parseExcelWorkbook(fileBuffer) {
  const files = unzipXlsx(fileBuffer);
  const workbookXmlBuf = files.get("xl/workbook.xml");
  if (!workbookXmlBuf) {
    throw HttpError.unprocessable(
      "INVALID_WORKBOOK",
      "Invalid workbook package: missing xl/workbook.xml."
    );
  }
  const workbookXml = workbookXmlBuf.toString("utf8");
  assertNoXXE(workbookXml, "xl/workbook.xml");
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbookXml);
  const sheetTagRegex = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
  let sheetMatch;
  const sheetList = [];
  while ((sheetMatch = sheetTagRegex.exec(workbookXml)) !== null) {
    const attrs = sheetMatch[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const rIdMatch = attrs.match(/\b(?:r:id|id)="([^"]+)"/i);
    if (nameMatch && rIdMatch) {
      sheetList.push({ name: nameMatch[1], rId: rIdMatch[1] });
    }
  }
  if (sheetList.length === 0) {
    throw HttpError.unprocessable(
      "EMPTY_WORKBOOK",
      "Workbook contains no worksheets."
    );
  }
  for (const sheet of sheetList) {
    const lowerName = sheet.name.trim().toLowerCase();
    if (lowerName !== "cards" && lowerName !== "instructions") {
      throw HttpError.unprocessable(
        "UNSUPPORTED_WORKSHEET",
        `Workbook contains unsupported worksheet '${sheet.name}'. Only 'Cards' and optional 'Instructions' are allowed.`
      );
    }
  }
  let targetSheet = sheetList.find((s) => s.name.trim().toLowerCase() === "cards");
  if (!targetSheet) {
    targetSheet = sheetList.find((s) => s.name.trim().toLowerCase() !== "instructions");
  }
  if (!targetSheet) {
    throw HttpError.unprocessable(
      "CARDS_SHEET_NOT_FOUND",
      "Workbook is missing required 'Cards' worksheet."
    );
  }
  const relsXmlBuf = files.get("xl/_rels/workbook.xml.rels");
  let worksheetRelPath = "xl/worksheets/sheet1.xml";
  if (relsXmlBuf) {
    const relsXml = relsXmlBuf.toString("utf8");
    assertNoXXE(relsXml, "xl/_rels/workbook.xml.rels");
    const relRegex = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
    let relMatch;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      const attrs = relMatch[1];
      const idMatch = attrs.match(/\bId="([^"]+)"/i);
      const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
      if (idMatch && targetMatch && idMatch[1] === targetSheet.rId) {
        let t = targetMatch[1];
        if (t.startsWith("/")) t = t.slice(1);
        if (!t.startsWith("xl/")) t = "xl/" + t;
        worksheetRelPath = t;
        break;
      }
    }
  }
  const worksheetXmlBuf = files.get(worksheetRelPath);
  if (!worksheetXmlBuf) {
    throw HttpError.unprocessable(
      "WORKSHEET_NOT_FOUND",
      `Worksheet XML not found at ${worksheetRelPath}.`
    );
  }
  const worksheetXml = worksheetXmlBuf.toString("utf8");
  assertNoXXE(worksheetXml, worksheetRelPath);
  if (/<(?:\w+:)?f\b[^>]*>/i.test(worksheetXml)) {
    throw HttpError.unprocessable(
      "FORMULA_REJECTED",
      "Formulas and calculated cells are strictly disallowed in the import template."
    );
  }
  let sharedStrings = [];
  const sharedStringsXmlBuf = files.get("xl/sharedStrings.xml");
  if (sharedStringsXmlBuf) {
    sharedStrings = parseSharedStrings(sharedStringsXmlBuf.toString("utf8"));
  }
  const rowRegex = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch;
  let headerMap = null;
  const rows = [];
  while ((rowMatch = rowRegex.exec(worksheetXml)) !== null) {
    const rowAttrs = rowMatch[1];
    const rowContent = rowMatch[2];
    const rAttr = rowAttrs.match(/\br="(\d+)"/i);
    const rowNum = rAttr ? parseInt(rAttr[1], 10) : rows.length + (headerMap ? 2 : 1);
    const cellRegex = /<(?:\w+:)?c\b([^>]*)>(?:([\s\S]*?)<\/(?:\w+:)?c>)?/g;
    let cMatch;
    const cells = [];
    while ((cMatch = cellRegex.exec(rowContent)) !== null) {
      const cAttrs = cMatch[1];
      const cInner = cMatch[2] ?? "";
      const cellRefMatch = cAttrs.match(/\br="([A-Z]+)(\d+)"/i);
      if (!cellRefMatch) continue;
      const colLetter = cellRefMatch[1].toUpperCase();
      const colIndex = colLettersToIndex(colLetter);
      const typeMatch = cAttrs.match(/\bt="([^"]+)"/i);
      const cellType = typeMatch ? typeMatch[1].toLowerCase() : "";
      let cellVal = "";
      let isNumericRaw = false;
      if (cellType === "inlineStr") {
        const isMatch = cInner.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
        if (isMatch) cellVal = unescapeXml(isMatch[1]);
      } else {
        const vMatch = cInner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
        if (vMatch) {
          const rawV = vMatch[1].trim();
          if (cellType === "s") {
            const strIdx = parseInt(rawV, 10);
            cellVal = sharedStrings[strIdx] ?? "";
          } else if (cellType === "str") {
            cellVal = unescapeXml(rawV);
          } else if (cellType === "b") {
            cellVal = rawV === "1" ? "true" : "false";
          } else {
            cellVal = rawV;
            isNumericRaw = !isNaN(Number(rawV)) && rawV !== "";
          }
        }
      }
      cells.push({
        colIndex,
        colLetter,
        type: cellType,
        isNumericRaw,
        value: cellVal
      });
    }
    if (!headerMap) {
      if (rowNum === 1 || rows.length === 0) {
        headerMap = /* @__PURE__ */ new Map();
        const seenHeaders = /* @__PURE__ */ new Set();
        for (const cell of cells) {
          const headerText = cell.value.trim();
          if (!headerText) continue;
          const matchedHeader = STANDARD_HEADERS.find(
            (sh) => sh.toLowerCase() === headerText.toLowerCase()
          );
          if (!matchedHeader) {
            throw HttpError.unprocessable(
              "UNKNOWN_HEADER",
              `Unknown header in column ${cell.colLetter}: '${headerText}'. Allowed headers are: ${STANDARD_HEADERS.join(", ")}.`
            );
          }
          if (seenHeaders.has(matchedHeader)) {
            throw HttpError.unprocessable(
              "DUPLICATE_HEADER",
              `Duplicate header in import: '${matchedHeader}'.`
            );
          }
          seenHeaders.add(matchedHeader);
          headerMap.set(cell.colIndex, matchedHeader);
        }
        if (!seenHeaders.has("External ID")) {
          throw HttpError.unprocessable(
            "MISSING_REQUIRED_HEADER",
            "Missing required header: 'External ID'."
          );
        }
        if (!seenHeaders.has("Title")) {
          throw HttpError.unprocessable(
            "MISSING_REQUIRED_HEADER",
            "Missing required header: 'Title'."
          );
        }
        continue;
      }
    }
    if (!headerMap) continue;
    let rawExternalId = "";
    let externalIdIsNumeric = false;
    let rawTitle = "";
    let rawDescription = "";
    let rawPriority = "";
    let rawDueDate = "";
    let dueDateIsSerial = false;
    let rawAssignees = "";
    let rawStatus = "";
    for (const cell of cells) {
      const header = headerMap.get(cell.colIndex);
      if (!header) continue;
      const val = cell.value;
      switch (header) {
        case "External ID":
          rawExternalId = val;
          externalIdIsNumeric = cell.isNumericRaw && cell.type !== "s" && cell.type !== "str" && cell.type !== "inlineStr";
          break;
        case "Title":
          rawTitle = val;
          break;
        case "Description":
          rawDescription = val;
          break;
        case "Priority":
          rawPriority = val;
          break;
        case "Due Date":
          rawDueDate = val;
          dueDateIsSerial = cell.isNumericRaw;
          break;
        case "Assignees":
          rawAssignees = val;
          break;
        case "Status":
          rawStatus = val;
          break;
      }
    }
    const isBlank = !rawExternalId.trim() && !rawTitle.trim() && !rawDescription.trim() && !rawPriority.trim() && !rawDueDate.trim() && !rawAssignees.trim() && !rawStatus.trim();
    if (isBlank) {
      continue;
    }
    if (rows.length >= MAX_IMPORT_ROWS) {
      throw HttpError.unprocessable(
        "ROW_LIMIT_EXCEEDED",
        `Import exceeds maximum allowed limit of ${MAX_IMPORT_ROWS} nonempty rows.`
      );
    }
    const rawErrors = [];
    let externalId = rawExternalId.normalize("NFC").trim();
    if (externalIdIsNumeric) {
      rawErrors.push({
        field: "externalId",
        code: "NUMERIC_ID_REJECTED",
        message: "Numeric External ID rejected. Format the External ID cell as Text in Excel to preserve leading zeros."
      });
    } else if (!externalId) {
      rawErrors.push({
        field: "externalId",
        code: "REQUIRED",
        message: "External ID is required."
      });
    } else if (externalId.length > 64) {
      rawErrors.push({
        field: "externalId",
        code: "MAX_LENGTH_EXCEEDED",
        message: "External ID cannot exceed 64 characters."
      });
    }
    const title = rawTitle.trim();
    if (!title) {
      rawErrors.push({
        field: "title",
        code: "REQUIRED",
        message: "Title is required."
      });
    } else if (title.length > 200) {
      rawErrors.push({
        field: "title",
        code: "MAX_LENGTH_EXCEEDED",
        message: "Title cannot exceed 200 characters."
      });
    }
    const description = rawDescription.trim();
    if (description.length > 2e4) {
      rawErrors.push({
        field: "description",
        code: "MAX_LENGTH_EXCEEDED",
        message: "Description cannot exceed 20,000 characters."
      });
    }
    let priority = "none";
    const normPriority = rawPriority.trim().toLowerCase();
    if (normPriority) {
      if (["none", "low", "medium", "high", "urgent"].includes(normPriority)) {
        priority = normPriority;
      } else {
        rawErrors.push({
          field: "priority",
          code: "INVALID_PRIORITY",
          message: `Priority '${rawPriority.trim()}' is invalid. Allowed: none, low, medium, high, urgent.`
        });
      }
    }
    let dueDate = null;
    const trimmedDueDate = rawDueDate.trim();
    if (trimmedDueDate) {
      if (dueDateIsSerial) {
        try {
          const serialNum = parseFloat(trimmedDueDate);
          dueDate = excelSerialToIsoDate(serialNum, date1904);
        } catch (err) {
          rawErrors.push({
            field: "dueDate",
            code: "INVALID_DATE",
            message: err instanceof Error ? err.message : "Invalid Excel date serial."
          });
        }
      } else {
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDueDate) && isValidGregorianDate(trimmedDueDate)) {
          dueDate = trimmedDueDate;
        } else {
          rawErrors.push({
            field: "dueDate",
            code: "INVALID_DATE",
            message: "Due date must be a valid Gregorian date in YYYY-MM-DD format or genuine Excel date."
          });
        }
      }
    }
    const assigneeEmails = [];
    if (rawAssignees.trim()) {
      const parts = rawAssignees.split(";").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
      const seenEmails = /* @__PURE__ */ new Set();
      for (const email of parts) {
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          assigneeEmails.push(email);
        }
      }
      if (assigneeEmails.length > 20) {
        rawErrors.push({
          field: "assigneeEmails",
          code: "ASSIGNEE_LIMIT_EXCEEDED",
          message: "At most 20 distinct assignees are allowed per card."
        });
      }
      for (const email of assigneeEmails) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          rawErrors.push({
            field: "assigneeEmails",
            code: "INVALID_EMAIL_FORMAT",
            message: `Invalid email address format: '${email}'.`
          });
        }
      }
    }
    const status = rawStatus.trim() || null;
    rows.push({
      rowNumber: rowNum,
      externalId,
      externalIdIsNumeric,
      title,
      description,
      priority,
      dueDate,
      assigneeEmails,
      status,
      rawErrors
    });
  }
  return {
    sheetName: targetSheet.name,
    date1904,
    totalRows: rows.length,
    rows
  };
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/imports.ts
async function lockImportBoard(client, importId, actorId) {
  const context = await client.query(
    "SELECT board_id FROM card_imports WHERE id = $1",
    [importId]
  );
  if (!context.rows[0]) throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  await lockBoardAccess(client, context.rows[0].board_id, actorId);
}
function getImportTemplatePath() {
  const candidates = [
    path.resolve(process.cwd(), "outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx"),
    path.resolve(process.cwd(), "../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx"),
    path.resolve(process.cwd(), "../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx")
  ];
  try {
    const fromMeta = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx"
    );
    candidates.push(fromMeta);
  } catch {
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return candidates[0];
}
function normalizeDueDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split("T")[0];
  if (typeof d === "string") return d.split("T")[0];
  return String(d);
}
function computeRowHash(row) {
  const normalized = {
    externalId: row.externalId.normalize("NFC").trim(),
    title: row.title.trim(),
    description: row.description.trim(),
    priority: row.priority.toLowerCase().trim(),
    dueDate: normalizeDueDate(row.dueDate),
    assigneeEmails: [...row.assigneeEmails].map((e) => e.toLowerCase().trim()).sort(),
    status: row.status ? row.status.toLowerCase().trim() : null
  };
  return crypto15.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function computePreviewDigest(importId, boardId, defaultColumnId, version, rows) {
  const digestPayload = {
    importId,
    boardId,
    defaultColumnId,
    version,
    rowCount: rows.length,
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      rowHash: r.rowHash,
      outcome: r.outcome,
      status: r.status,
      assigneeIds: r.assigneeIds
    }))
  };
  return crypto15.createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex");
}
async function assertImportAccessBeforeParse(client, boardId, actorId) {
  const boardRes = await client.query(
    `SELECT b.project_id, b.workspace_id, w.owner_id
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1`,
    [boardId]
  );
  const board = boardRes.rows[0];
  if (!board) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  if (board.owner_id === actorId) {
    return;
  }
  const memberRes = await client.query(
    `SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
    [board.project_id, actorId]
  );
  const member = memberRes.rows[0];
  if (!member || member.status === "removed") {
    throw HttpError.notFound("Project not found or access revoked.", "NOT_FOUND");
  }
  const grantRes = await client.query(
    `SELECT board_id FROM board_grants
     WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4`,
    [boardId, board.project_id, board.workspace_id, actorId]
  );
  if (!grantRes.rows[0]) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  if (member.role === "viewer") {
    throw HttpError.forbidden("Viewers cannot perform write operations.", "FORBIDDEN");
  }
  if (member.role !== "manager") {
    throw HttpError.forbidden("Only a manager or the owner can do this.", "FORBIDDEN");
  }
}
async function createCardImport(client, params) {
  const { boardId, fileBuffer, defaultColumnId, actorId } = params;
  await assertImportAccessBeforeParse(client, boardId, actorId);
  const parseResult = parseExcelWorkbook(fileBuffer);
  const boardRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1`,
    [boardId]
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const board = boardRes.rows[0];
  await acquireWriteGrantLock(client, board.project_id, actorId, "manager", boardId);
  if (board.archived) {
    throw HttpError.conflict("BOARD_ARCHIVED", "Board is archived.");
  }
  await acquireWritableProjectContextLock(client, board.project_id, boardId);
  const colRes = await client.query(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2`,
    [defaultColumnId, boardId]
  );
  if (colRes.rows.length === 0) {
    throw validationError("Default column not found on this board.", {
      issues: [{ path: "defaultColumnId", message: "Default column not found on this board." }]
    });
  }
  const allColsRes = await client.query(
    `SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC`,
    [boardId]
  );
  const columnByName = /* @__PURE__ */ new Map();
  for (const c of allColsRes.rows) {
    columnByName.set(c.name.toLowerCase().trim(), c.id);
  }
  const membersRes = await client.query(
    `SELECT u.id, lower(u.email) AS email
     FROM users u
     WHERE (
       u.id = (SELECT owner_id FROM workspaces WHERE id = $1)
       OR EXISTS (
         SELECT 1 FROM project_memberships pm
         WHERE pm.project_id = $2
           AND pm.user_id = u.id
           AND pm.status = 'active'
           AND pm.role IN ('owner', 'manager', 'member')
       )
     )`,
    [board.workspace_id, board.project_id]
  );
  const emailToUserId = /* @__PURE__ */ new Map();
  for (const m of membersRes.rows) {
    emailToUserId.set(m.email.toLowerCase().trim(), m.id);
  }
  const dupesRes = await client.query(
    `SELECT external_id, row_hash, card_id
     FROM card_import_duplicates
     WHERE board_id = $1`,
    [boardId]
  );
  const existingDupes = /* @__PURE__ */ new Map();
  for (const d of dupesRes.rows) {
    existingDupes.set(d.external_id, { rowHash: d.row_hash, cardId: d.card_id });
  }
  const importId = "imp_" + crypto15.randomUUID();
  const seenBatchExternalIds = /* @__PURE__ */ new Set();
  const processedRows = [];
  let invalidCount = 0;
  let conflictCount = 0;
  let newCount = 0;
  let existingCount = 0;
  for (const parsed of parseResult.rows) {
    const rowId = "impr_" + crypto15.randomUUID();
    const errors = [...parsed.rawErrors];
    if (seenBatchExternalIds.has(parsed.externalId)) {
      errors.push({
        field: "externalId",
        code: "DUPLICATE_IN_BATCH",
        message: `External ID '${parsed.externalId}' is repeated in this workbook.`
      });
    } else {
      seenBatchExternalIds.add(parsed.externalId);
    }
    const resolvedAssigneeIds = [];
    for (const email of parsed.assigneeEmails) {
      const uid = emailToUserId.get(email.toLowerCase().trim());
      if (uid) {
        resolvedAssigneeIds.push(uid);
      } else {
        errors.push({
          field: "assigneeEmails",
          code: "UNKNOWN_OR_INELIGIBLE_ASSIGNEE",
          message: `Assignee email '${email}' is not an active member of this project.`
        });
      }
    }
    let targetColumnId = null;
    if (parsed.status) {
      const colId = columnByName.get(parsed.status.toLowerCase().trim());
      if (colId) {
        targetColumnId = colId;
      } else {
        errors.push({
          field: "status",
          code: "UNRECOGNIZED_STATUS",
          message: `Status '${parsed.status}' does not match any column on this board.`
        });
      }
    } else {
      targetColumnId = defaultColumnId;
    }
    const rowHash = computeRowHash({
      externalId: parsed.externalId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      assigneeEmails: parsed.assigneeEmails,
      status: parsed.status
    });
    let outcome = "new";
    let cardId = null;
    const existingDupe = existingDupes.get(parsed.externalId);
    if (existingDupe) {
      if (existingDupe.rowHash === rowHash) {
        outcome = "already_imported";
        cardId = existingDupe.cardId;
        existingCount++;
      } else {
        outcome = "conflict";
        conflictCount++;
        errors.push({
          field: "externalId",
          code: "IMPORT_CONFLICT",
          message: `External ID '${parsed.externalId}' was previously imported with different content. Changing an imported row is a conflict.`
        });
      }
    } else if (errors.length > 0) {
      outcome = "invalid";
      invalidCount++;
    } else {
      outcome = "new";
      newCount++;
    }
    processedRows.push({
      id: rowId,
      rowNumber: parsed.rowNumber,
      externalId: parsed.externalId,
      title: parsed.title,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      assigneeEmails: parsed.assigneeEmails,
      assigneeIds: resolvedAssigneeIds,
      outcome,
      errors,
      cardId,
      rowHash
    });
  }
  const importState = invalidCount > 0 || conflictCount > 0 ? "invalid" : "ready";
  const previewDigest = computePreviewDigest(
    importId,
    boardId,
    defaultColumnId,
    1,
    processedRows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      rowHash: r.rowHash,
      outcome: r.outcome,
      status: r.status,
      assigneeIds: r.assigneeIds
    }))
  );
  const expiresAt = new Date(Date.now() + 30 * 60 * 1e3);
  await client.query(
    `INSERT INTO card_imports (
       id, workspace_id, project_id, board_id, default_column_id,
       uploader_id, version, state, preview_digest, expires_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 1, $7, $8, $9,
       NOW(), NOW()
     )`,
    [
      importId,
      board.workspace_id,
      board.project_id,
      boardId,
      defaultColumnId,
      actorId,
      importState,
      previewDigest,
      expiresAt.toISOString()
    ]
  );
  for (const r of processedRows) {
    await client.query(
      `INSERT INTO card_import_rows (
         id, import_id, row_number, external_id, title, status,
         priority, due_date, assignee_emails, outcome, errors,
         card_id, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, NOW()
       )`,
      [
        r.id,
        importId,
        r.rowNumber,
        r.externalId,
        r.title,
        r.status,
        r.priority,
        r.dueDate,
        r.assigneeEmails.length > 0 ? r.assigneeEmails : null,
        r.outcome,
        r.errors.length > 0 ? JSON.stringify(r.errors) : null,
        r.cardId
      ]
    );
  }
  const counts = {
    total: processedRows.length,
    new: newCount,
    existing: existingCount,
    invalid: invalidCount,
    conflict: conflictCount,
    created: 0,
    skipped: 0
  };
  return {
    id: importId,
    projectId: board.project_id,
    boardId,
    defaultColumnId,
    version: 1,
    state: importState,
    previewDigest,
    expiresAt: expiresAt.toISOString(),
    serverNow: (/* @__PURE__ */ new Date()).toISOString(),
    counts,
    canCommit: importState === "ready" && invalidCount === 0 && conflictCount === 0,
    cancellationAllowed: true,
    rows: processedRows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate,
      assigneeIds: r.assigneeIds,
      outcome: r.outcome,
      errors: r.errors,
      cardId: r.cardId
    })),
    nextCursor: null,
    error: null
  };
}
async function getCardImportStatus(client, importId, actorId, pagination) {
  const importRes = await client.query(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            uploader_id, version, state, preview_digest, expires_at,
            created_at, updated_at
     FROM card_imports
     WHERE id = $1`,
    [importId]
  );
  if (importRes.rows.length === 0) {
    throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  }
  const imp = importRes.rows[0];
  await acquireWriteGrantLock(client, imp.project_id, actorId, "manager", imp.board_id);
  let currentState = imp.state;
  const now = /* @__PURE__ */ new Date();
  if (imp.expires_at && new Date(imp.expires_at) < now && ["uploaded", "validating", "ready", "invalid"].includes(currentState)) {
    currentState = "expired";
    await client.query(
      `UPDATE card_imports SET state = 'expired', updated_at = NOW() WHERE id = $1`,
      [importId]
    );
  }
  const countsRes = await client.query(
    `SELECT outcome, COUNT(*)::TEXT AS count
     FROM card_import_rows
     WHERE import_id = $1
     GROUP BY outcome`,
    [importId]
  );
  let newCount = 0;
  let existingCount = 0;
  let invalidCount = 0;
  let conflictCount = 0;
  let createdCount = 0;
  let skippedCount = 0;
  for (const c of countsRes.rows) {
    const n = parseInt(c.count, 10);
    switch (c.outcome) {
      case "new":
        newCount += n;
        break;
      case "already_imported":
        existingCount += n;
        break;
      case "invalid":
        invalidCount += n;
        break;
      case "conflict":
        conflictCount += n;
        break;
      case "created":
        createdCount += n;
        break;
      case "skipped":
        skippedCount += n;
        break;
    }
  }
  const total = newCount + existingCount + invalidCount + conflictCount + createdCount + skippedCount;
  const counts = {
    total,
    new: newCount,
    existing: existingCount,
    invalid: invalidCount,
    conflict: conflictCount,
    created: createdCount,
    skipped: skippedCount
  };
  const limit = Math.min(Math.max(pagination?.limit ?? 50, 1), 200);
  const cursorRow = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;
  const rowsRes = await client.query(
    `SELECT id, import_id, row_number, external_id, title, status,
            priority, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            assignee_emails, outcome, errors, card_id, created_at
     FROM card_import_rows
     WHERE import_id = $1 AND row_number > $2
     ORDER BY row_number ASC
     LIMIT $3`,
    [importId, cursorRow, limit + 1]
  );
  const hasMore = rowsRes.rows.length > limit;
  const displayRows = hasMore ? rowsRes.rows.slice(0, limit) : rowsRes.rows;
  const nextCursor = hasMore && displayRows.length > 0 ? String(displayRows[displayRows.length - 1].row_number) : null;
  const allEmails = /* @__PURE__ */ new Set();
  for (const r of displayRows) {
    if (r.assignee_emails) {
      for (const e of r.assignee_emails) allEmails.add(e.toLowerCase().trim());
    }
  }
  const emailToIdMap = /* @__PURE__ */ new Map();
  if (allEmails.size > 0) {
    const userRes = await client.query(
      `SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY($1::TEXT[])`,
      [Array.from(allEmails)]
    );
    for (const u of userRes.rows) {
      emailToIdMap.set(u.email, u.id);
    }
  }
  const rows = displayRows.map((r) => {
    const assigneeIds = (r.assignee_emails ?? []).map((e) => emailToIdMap.get(e.toLowerCase().trim())).filter((id) => Boolean(id));
    return {
      rowNumber: r.row_number,
      externalId: r.external_id,
      title: r.title,
      status: r.status,
      priority: r.priority ?? "none",
      dueDate: r.due_date ?? null,
      assigneeIds,
      outcome: r.outcome,
      errors: r.errors ?? [],
      cardId: r.card_id
    };
  });
  const canCommit = currentState === "ready" && invalidCount === 0 && conflictCount === 0;
  const cancellationAllowed = ["uploaded", "validating", "ready", "invalid"].includes(currentState);
  return {
    id: imp.id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    defaultColumnId: imp.default_column_id,
    version: imp.version,
    state: currentState,
    previewDigest: imp.preview_digest,
    expiresAt: imp.expires_at ? new Date(imp.expires_at).toISOString() : null,
    serverNow: (/* @__PURE__ */ new Date()).toISOString(),
    counts,
    canCommit,
    cancellationAllowed,
    rows,
    nextCursor,
    error: null
  };
}
async function updateImportMappings(client, importId, actorId, input) {
  await lockImportBoard(client, importId, actorId);
  const importRes = await client.query(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            version, state, preview_digest, expires_at
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId]
  );
  if (importRes.rows.length === 0) {
    throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  }
  const imp = importRes.rows[0];
  await acquireWriteGrantLock(client, imp.project_id, actorId, "manager", imp.board_id);
  if (["committed", "committing", "expired", "cancelled"].includes(imp.state)) {
    throw HttpError.conflict("INVALID_STATE", `Cannot update mappings in state '${imp.state}'.`);
  }
  if (imp.version !== input.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "Stale import version.");
  }
  const boardColsRes = await client.query(
    `SELECT id, name FROM columns WHERE board_id = $1`,
    [imp.board_id]
  );
  const validColIds = new Set(boardColsRes.rows.map((c) => c.id));
  const colById = new Map(boardColsRes.rows.map((c) => [c.id, c.name]));
  for (const [statusName, targetColId] of Object.entries(input.mappings)) {
    if (!validColIds.has(targetColId)) {
      throw validationError(`Target column ID '${targetColId}' does not belong to this board.`, {
        issues: [{ path: "mappings", message: `Target column '${targetColId}' does not belong to this board.` }]
      });
    }
  }
  const rowsRes = await client.query(
    `SELECT * FROM card_import_rows WHERE import_id = $1 ORDER BY row_number ASC FOR UPDATE`,
    [importId]
  );
  let invalidCount = 0;
  let conflictCount = 0;
  let newCount = 0;
  let existingCount = 0;
  for (const r of rowsRes.rows) {
    let outcome = r.outcome;
    let errors = r.errors ?? [];
    let updatedStatus = r.status;
    if (r.status && input.mappings[r.status]) {
      const targetColId = input.mappings[r.status];
      const colName = colById.get(targetColId);
      if (colName) {
        updatedStatus = colName;
      }
      errors = errors.filter((e) => e.code !== "UNRECOGNIZED_STATUS");
      if (outcome === "invalid" && errors.length === 0) {
        outcome = "new";
      }
    }
    if (outcome === "invalid") invalidCount++;
    else if (outcome === "conflict") conflictCount++;
    else if (outcome === "new") newCount++;
    else if (outcome === "already_imported") existingCount++;
    await client.query(
      `UPDATE card_import_rows SET status = $1, outcome = $2, errors = $3 WHERE id = $4`,
      [updatedStatus, outcome, errors.length > 0 ? JSON.stringify(errors) : null, r.id]
    );
  }
  const nextVersion = imp.version + 1;
  const nextState = invalidCount > 0 || conflictCount > 0 ? "invalid" : "ready";
  const updatedRowsRes = await client.query(
    `SELECT * FROM card_import_rows WHERE import_id = $1 ORDER BY row_number ASC`,
    [importId]
  );
  const previewDigest = computePreviewDigest(
    importId,
    imp.board_id,
    imp.default_column_id,
    nextVersion,
    updatedRowsRes.rows.map((r) => ({
      rowNumber: r.row_number,
      externalId: r.external_id,
      rowHash: r.id,
      // placeholder
      outcome: r.outcome,
      status: r.status,
      assigneeIds: []
    }))
  );
  await client.query(
    `UPDATE card_imports
     SET version = $1, state = $2, preview_digest = $3, updated_at = NOW()
     WHERE id = $4`,
    [nextVersion, nextState, previewDigest, importId]
  );
  return getCardImportStatus(client, importId, actorId);
}
async function commitCardImport(client, importId, actorId, input) {
  await lockImportBoard(client, importId, actorId);
  const importRes = await client.query(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            uploader_id, version, state, preview_digest, expires_at
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId]
  );
  if (importRes.rows.length === 0) {
    throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  }
  const imp = importRes.rows[0];
  await acquireWriteGrantLock(client, imp.project_id, actorId, "manager", imp.board_id);
  await acquireWritableProjectContextLock(client, imp.project_id, imp.board_id);
  if (imp.state === "committed") {
    return getCardImportStatus(client, importId, actorId);
  }
  if (imp.state === "committing") {
    throw HttpError.conflict("COMMIT_IN_PROGRESS", "Import commit is currently in progress.");
  }
  if (imp.expires_at && new Date(imp.expires_at) < /* @__PURE__ */ new Date()) {
    await client.query(
      `UPDATE card_imports SET state = 'expired', updated_at = NOW() WHERE id = $1`,
      [importId]
    );
    throw new HttpError(410, "PREVIEW_EXPIRED", "This preview has expired. Upload the file again to preview it.");
  }
  if (imp.state !== "ready") {
    throw HttpError.conflict("INVALID_STATE", `Cannot commit import in state '${imp.state}'.`);
  }
  if (imp.version !== input.expectedVersion) {
    throw HttpError.conflict("STALE_VERSION", "This import changed since you previewed it. Preview it again before confirming.", {
      expectedVersion: input.expectedVersion,
      currentVersion: imp.version
    });
  }
  if (imp.preview_digest !== input.previewDigest) {
    throw HttpError.conflict(
      "PREVIEW_STALE",
      "Preview digest mismatch. The import configuration has changed and requires revalidation.",
      {
        expectedDigest: input.previewDigest,
        currentDigest: imp.preview_digest
      }
    );
  }
  const boardRes = await client.query(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [imp.board_id]
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound("Board not found.", "NOT_FOUND");
  }
  const board = boardRes.rows[0];
  if (board.archived) {
    throw HttpError.conflict("BOARD_ARCHIVED", "Board is archived.");
  }
  const targetColId = input.defaultColumnId || imp.default_column_id;
  const colRes = await client.query(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2`,
    [targetColId, imp.board_id]
  );
  if (colRes.rows.length === 0) {
    throw validationError("Target default column not found on this board.", {
      issues: [{ path: "defaultColumnId", message: "Target default column not found." }]
    });
  }
  const allColsRes = await client.query(
    `SELECT id, name FROM columns WHERE board_id = $1`,
    [imp.board_id]
  );
  const colByName = /* @__PURE__ */ new Map();
  for (const c of allColsRes.rows) {
    colByName.set(c.name.toLowerCase().trim(), c.id);
  }
  const rowsRes = await client.query(
    `SELECT id, import_id, row_number, external_id, title, status,
            priority, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            assignee_emails, outcome, errors, card_id, created_at
     FROM card_import_rows
     WHERE import_id = $1
     ORDER BY row_number ASC
     FOR UPDATE`,
    [importId]
  );
  const hasInvalidOrConflict = rowsRes.rows.some((r) => r.outcome === "invalid" || r.outcome === "conflict");
  if (hasInvalidOrConflict) {
    throw HttpError.unprocessable(
      "IMPORT_HAS_ERRORS",
      "Cannot commit an import containing invalid or conflicting rows. Fix errors and re-upload."
    );
  }
  const allEmails = /* @__PURE__ */ new Set();
  for (const r of rowsRes.rows) {
    if (r.outcome === "new" && r.assignee_emails) {
      for (const e of r.assignee_emails) allEmails.add(e.toLowerCase().trim());
    }
  }
  const emailToUserMap = /* @__PURE__ */ new Map();
  if (allEmails.size > 0) {
    const verifiedUsersRes = await client.query(
      `SELECT u.id, lower(u.email) AS email
       FROM users u
       WHERE lower(u.email) = ANY($1::TEXT[])
         AND (
           u.id = (SELECT owner_id FROM workspaces WHERE id = $2)
           OR EXISTS (
             SELECT 1 FROM project_memberships pm
             WHERE pm.project_id = $3
               AND pm.user_id = u.id
               AND pm.status = 'active'
               AND pm.role IN ('owner', 'manager', 'member')
           )
         )`,
      [Array.from(allEmails), imp.workspace_id, imp.project_id]
    );
    for (const u of verifiedUsersRes.rows) {
      emailToUserMap.set(u.email, u.id);
    }
    for (const email of allEmails) {
      if (!emailToUserMap.has(email)) {
        throw HttpError.conflict(
          "PREVIEW_STALE",
          `Assignee membership for '${email}' changed or was revoked since preview generation. Revalidation required.`
        );
      }
    }
  }
  await client.query(
    `UPDATE card_imports SET state = 'committing', updated_at = NOW() WHERE id = $1`,
    [importId]
  );
  const posByColumn = /* @__PURE__ */ new Map();
  for (const col of allColsRes.rows) {
    const maxPosRes = await client.query(
      `SELECT COALESCE(MAX(position), 0)::TEXT AS max_pos
       FROM cards
       WHERE column_id = $1 AND state = 'active'`,
      [col.id]
    );
    posByColumn.set(col.id, parseInt(maxPosRes.rows[0]?.max_pos ?? "0", 10));
  }
  let createdCount = 0;
  let skippedCount = 0;
  for (const r of rowsRes.rows) {
    if (r.outcome === "already_imported") {
      await client.query(
        `UPDATE card_import_rows SET outcome = 'skipped' WHERE id = $1`,
        [r.id]
      );
      skippedCount++;
      continue;
    }
    if (r.outcome !== "new") {
      continue;
    }
    let destColId = targetColId;
    if (r.status) {
      const mapped = colByName.get(r.status.toLowerCase().trim());
      if (mapped) {
        destColId = mapped;
      } else if (allColsRes.rows.some((c) => c.id === r.status)) {
        destColId = r.status;
      }
    }
    const currentPos = posByColumn.get(destColId) ?? 0;
    const nextPos = currentPos + 1e3;
    posByColumn.set(destColId, nextPos);
    const cardId = "crd_" + crypto15.randomUUID();
    const priority = r.priority ?? "none";
    const dueDate = r.due_date ?? null;
    await client.query(
      `INSERT INTO cards (
         id, workspace_id, project_id, board_id, column_id,
         title, description, priority, due_date, position,
         version, state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, '', $7, $8, $9,
         1, 'active', NOW(), NOW()
       )`,
      [
        cardId,
        imp.workspace_id,
        imp.project_id,
        imp.board_id,
        destColId,
        r.title,
        priority,
        dueDate,
        nextPos
      ]
    );
    if (r.assignee_emails && r.assignee_emails.length > 0) {
      for (const email of r.assignee_emails) {
        const uid = emailToUserMap.get(email.toLowerCase().trim());
        if (uid) {
          await client.query(
            `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT DO NOTHING`,
            [cardId, uid, imp.workspace_id, imp.project_id]
          );
        }
      }
    }
    const rowHash = computeRowHash({
      externalId: r.external_id,
      title: r.title,
      description: "",
      priority: r.priority ?? "none",
      dueDate: r.due_date ?? null,
      assigneeEmails: r.assignee_emails ?? [],
      status: r.status
    });
    await client.query(
      `INSERT INTO card_import_duplicates (
         workspace_id, project_id, board_id, external_id,
         card_id, row_hash, created_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, NOW()
       )
       ON CONFLICT (board_id, external_id) DO NOTHING`,
      [imp.workspace_id, imp.project_id, imp.board_id, r.external_id, cardId, rowHash]
    );
    await client.query(
      `UPDATE card_import_rows SET outcome = 'created', card_id = $1 WHERE id = $2`,
      [cardId, r.id]
    );
    await recordActivity(client, {
      workspaceId: imp.workspace_id,
      projectId: imp.project_id,
      boardId: imp.board_id,
      cardId,
      actorId,
      action: "card_created",
      safeChanges: {
        source: "excel_import",
        importId,
        externalId: r.external_id,
        rowNumber: r.row_number,
        title: r.title
      }
    });
    createdCount++;
  }
  await recordActivity(client, {
    workspaceId: imp.workspace_id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    actorId,
    action: "card_import_committed",
    safeChanges: {
      importId,
      createdCount,
      skippedCount
    },
    visibilityScope: "board"
  });
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [imp.board_id]
  );
  await client.query(
    `UPDATE card_imports
     SET state = 'committed', version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [importId]
  );
  return getCardImportStatus(client, importId, actorId);
}
async function cancelCardImport(client, importId, actorId) {
  await lockImportBoard(client, importId, actorId);
  const importRes = await client.query(
    `SELECT id, project_id, board_id, state
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId]
  );
  if (importRes.rows.length === 0) {
    throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  }
  const imp = importRes.rows[0];
  await acquireWriteGrantLock(client, imp.project_id, actorId, "manager", imp.board_id);
  if (imp.state === "committing" || imp.state === "committed") {
    throw HttpError.conflict(
      "COMMIT_IN_PROGRESS",
      "Cannot cancel an import that has already committed or is currently committing."
    );
  }
  if (imp.state === "cancelled") {
    return { id: imp.id, state: "cancelled" };
  }
  await client.query(
    `UPDATE card_imports SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [importId]
  );
  return { id: imp.id, state: "cancelled" };
}
async function getImportReport(client, importId, actorId) {
  const importRes = await client.query(
    `SELECT id, project_id, board_id FROM card_imports WHERE id = $1`,
    [importId]
  );
  if (importRes.rows.length === 0) {
    throw HttpError.notFound("Import session not found.", "NOT_FOUND");
  }
  const imp = importRes.rows[0];
  await acquireWriteGrantLock(client, imp.project_id, actorId, "manager", imp.board_id);
  const rowsRes = await client.query(
    `SELECT row_number, external_id, title, status, priority,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            outcome, errors, card_id
     FROM card_import_rows
     WHERE import_id = $1
     ORDER BY row_number ASC`,
    [importId]
  );
  function escapeCsvCell(val) {
    if (val === null || val === void 0) return "";
    let str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
  const header = ["Row", "External ID", "Title", "Status", "Priority", "Due Date", "Outcome", "Errors", "Card ID"];
  const lines = [header.join(",")];
  for (const r of rowsRes.rows) {
    const errText = r.errors && r.errors.length > 0 ? r.errors.map((e) => e.message).join("; ") : "";
    const line = [
      escapeCsvCell(r.row_number),
      escapeCsvCell(r.external_id),
      escapeCsvCell(r.title),
      escapeCsvCell(r.status ?? ""),
      escapeCsvCell(r.priority ?? "none"),
      escapeCsvCell(r.due_date ?? ""),
      escapeCsvCell(r.outcome),
      escapeCsvCell(errText),
      escapeCsvCell(r.card_id ?? "")
    ];
    lines.push(line.join(","));
  }
  return lines.join("\n");
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/imports.ts
var importsRoutes = new Hono13();
function requireIdempotencyKey3(keyHeader) {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      "Missing or invalid Idempotency-Key header.",
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return keyHeader;
}
var handleDownloadTemplate = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const boardId = c.req.param("boardId");
  if (boardId) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await lockBoardAccess(client, boardId, actor.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
      });
      throw error;
    } finally {
      client.release();
    }
  }
  const templatePath = getImportTemplatePath();
  if (!fs2.existsSync(templatePath)) {
    throw HttpError.notFound("Import template file not found.", "NOT_FOUND");
  }
  const fileBuffer = fs2.readFileSync(templatePath);
  return new Response(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Flowboard_Card_Import_Template.xlsx"',
      "Content-Length": String(fileBuffer.length),
      "Cache-Control": "private, no-cache"
    }
  });
};
importsRoutes.get("/import/template", authMiddleware, handleDownloadTemplate);
importsRoutes.get("/boards/:boardId/card-import-template", authMiddleware, handleDownloadTemplate);
importsRoutes.get("/boards/:boardId/import-template", authMiddleware, handleDownloadTemplate);
var handleCreateImport = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const boardId = c.req.param("boardId");
  const contentType = c.req.header("content-type") ?? "";
  let fileBuffer;
  let defaultColumnId;
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.parseBody();
    const file = formData["file"];
    defaultColumnId = formData["defaultColumnId"];
    if (!file) {
      throw HttpError.badRequest("Missing file in form data.", "MISSING_FILE");
    }
    if (typeof file === "object" && "arrayBuffer" in file) {
      const arrayBuf = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuf);
    } else if (Buffer.isBuffer(file)) {
      fileBuffer = file;
    } else {
      throw HttpError.badRequest("Invalid uploaded file format.", "INVALID_FILE");
    }
  } else {
    const arrayBuf = await c.req.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuf);
    defaultColumnId = c.req.query("defaultColumnId") || c.req.header("x-default-column-id");
  }
  if (!defaultColumnId) {
    throw HttpError.badRequest("Default column ID is required.", "MISSING_DEFAULT_COLUMN");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importStatus = await createCardImport(client, {
      boardId,
      fileBuffer,
      defaultColumnId,
      actorId: actor.id
    });
    await client.query("COMMIT");
    return c.json({ data: importStatus }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
};
importsRoutes.post("/boards/:boardId/imports", authMiddleware, handleCreateImport);
importsRoutes.post("/boards/:boardId/card-imports", authMiddleware, handleCreateImport);
var handleGetImport = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const importId = c.req.param("importId");
  const rawLimit = c.req.query("limit");
  const limit = rawLimit ? parseInt(rawLimit, 10) : void 0;
  const cursor = c.req.query("cursor") || void 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = await getCardImportStatus(client, importId, actor.id, { limit, cursor });
    await client.query("COMMIT");
    return c.json({ data: status }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
};
importsRoutes.get("/imports/:importId", authMiddleware, handleGetImport);
importsRoutes.get("/card-imports/:importId", authMiddleware, handleGetImport);
var handleUpdateMappings = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const importId = c.req.param("importId");
  const rawBody = await c.req.json();
  const input = parseOrThrow(updateImportMappingsInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = await updateImportMappings(client, importId, actor.id, input);
    await client.query("COMMIT");
    return c.json({ data: status }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
};
importsRoutes.post("/imports/:importId/mappings", authMiddleware, handleUpdateMappings);
importsRoutes.post("/card-imports/:importId/mappings", authMiddleware, handleUpdateMappings);
var handleCommitImport = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const importId = c.req.param("importId");
  const idempotencyKey = requireIdempotencyKey3(c.req.header("idempotency-key"));
  const rawBody = await c.req.json();
  const input = parseOrThrow(commitImportInputSchema, rawBody);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      "SELECT project_id, board_id FROM card_imports WHERE id = $1",
      [importId]
    );
    if (scope.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Import session not found.", "NOT_FOUND");
    }
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, "manager", scope.rows[0].board_id);
    await acquireWritableProjectContextLock(client, scope.rows[0].project_id, scope.rows[0].board_id);
    const impRes = await client.query(
      "SELECT project_id, board_id FROM card_imports WHERE id = $1 FOR UPDATE",
      [importId]
    );
    if (impRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw HttpError.notFound("Import session not found.", "NOT_FOUND");
    }
    const impMeta = impRes.rows[0];
    const methodPath = `/api/v1/imports/${importId}/commit`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      impMeta.project_id,
      "manager",
      idempotencyKey,
      methodPath,
      rawBody,
      impMeta.board_id
    );
    if (replay) {
      await client.query("ROLLBACK");
      return c.json(
        { ...replay.responseBody, replayed: true },
        replay.statusCode
      );
    }
    const result = await commitCardImport(client, importId, actor.id, input);
    const responsePayload = { data: result };
    await saveReceipt(
      client,
      actor.id,
      "project",
      impMeta.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responsePayload
    );
    await client.query("COMMIT");
    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
};
importsRoutes.post("/imports/:importId/commit", authMiddleware, handleCommitImport);
importsRoutes.post("/card-imports/:importId/commit", authMiddleware, handleCommitImport);
var handleCancelImport = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const importId = c.req.param("importId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await cancelCardImport(client, importId, actor.id);
    await client.query("COMMIT");
    return c.json({ data: result }, 200);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
};
importsRoutes.delete("/imports/:importId", authMiddleware, handleCancelImport);
importsRoutes.delete("/card-imports/:importId", authMiddleware, handleCancelImport);
var handleGetReport = async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const importId = c.req.param("importId");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const csvContent = await getImportReport(client, importId, actor.id);
    await client.query("COMMIT");
    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-report-${importId}.csv"`,
        "Cache-Control": "private, no-cache"
      }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
};
importsRoutes.get("/imports/:importId/report", authMiddleware, handleGetReport);
importsRoutes.get("/card-imports/:importId/report", authMiddleware, handleGetReport);

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/activity.ts
import { Hono as Hono14 } from "hono";
var activityRoutes = new Hono14();
function parseLimit3(limitParam) {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}
activityRoutes.get("/activity/health", (c) => c.json({ data: { status: "ok" } }));
activityRoutes.get("/cards/:cardId/activity", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const cardId = c.req.param("cardId");
  const limit = parseLimit3(c.req.query("limit"));
  const cursor = c.req.query("cursor") || void 0;
  const pool = getPool();
  const result = await listCardActivity(pool, cardId, actor.id, { limit, cursor });
  return c.json({
    data: result.data,
    nextCursor: result.nextCursor
  });
});
activityRoutes.get("/projects/:projectId/activity", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const projectId = c.req.param("projectId");
  const limit = parseLimit3(c.req.query("limit"));
  const cursor = c.req.query("cursor") || void 0;
  const cardId = c.req.query("cardId") || void 0;
  const actorId = c.req.query("actorId") || void 0;
  const action = c.req.query("action") || void 0;
  const fromDate = c.req.query("fromDate") || void 0;
  const toDate = c.req.query("toDate") || void 0;
  const pool = getPool();
  const result = await listProjectActivity(pool, projectId, actor.id, {
    limit,
    cursor,
    cardId,
    actorId,
    action,
    fromDate,
    toDate
  });
  return c.json({
    data: result.data,
    nextCursor: result.nextCursor
  });
});
activityRoutes.get("/workspaces/:workspaceId/activity", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const workspaceId = c.req.param("workspaceId");
  const limit = parseLimit3(c.req.query("limit"));
  const cursor = c.req.query("cursor") || void 0;
  const projectId = c.req.query("projectId") || void 0;
  const cardId = c.req.query("cardId") || void 0;
  const actorId = c.req.query("actorId") || void 0;
  const action = c.req.query("action") || void 0;
  const fromDate = c.req.query("fromDate") || void 0;
  const toDate = c.req.query("toDate") || void 0;
  const pool = getPool();
  const result = await listWorkspaceActivity(pool, workspaceId, actor.id, {
    limit,
    cursor,
    projectId,
    cardId,
    actorId,
    action,
    fromDate,
    toDate
  });
  return c.json({
    data: result.data,
    nextCursor: result.nextCursor
  });
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/notifications.ts
import { Hono as Hono15 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/notifications.ts
import { createHash as createHash2 } from "node:crypto";
function encodeNotificationCursor(cursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeNotificationCursor(value, expectedUserId, scopeDigest, unreadOnly) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const parsed = JSON.parse(atob(base64));
    if (parsed.v !== 2 || parsed.userId !== expectedUserId || parsed.scopeDigest !== scopeDigest || parsed.unreadOnly !== unreadOnly || typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || parsed.id.length === 0) {
      throw new Error("invalid notification cursor");
    }
    return parsed;
  } catch {
    throw HttpError.conflict("STALE_CURSOR", "Notification cursor is invalid or belongs to another user.");
  }
}
async function inNotificationTransaction(db, run) {
  if (typeof db.totalCount !== "number") return run(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
}
var visibleNotification = `n.user_id=$1 AND EXISTS (
  SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
  WHERE p.id=n.project_id AND p.workspace_id=n.workspace_id AND
    (w.owner_id=$1 OR (
      EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=$1 AND pm.status='active')
      AND EXISTS (SELECT 1 FROM cards c JOIN boards b ON b.id=c.board_id
        AND b.project_id=c.project_id AND b.workspace_id=c.workspace_id
        JOIN board_grants g ON g.board_id=b.id AND g.project_id=b.project_id
        AND g.workspace_id=b.workspace_id AND g.user_id=$1
        WHERE c.id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id AND c.state='active')
    ))
)`;
async function notificationScopeDigest(db, actorId) {
  const scope = await db.query(
    `SELECT p.id AS project_id,b.id AS board_id,b.access_revision
     FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     LEFT JOIN boards b ON b.project_id=p.id AND b.workspace_id=p.workspace_id
     WHERE w.owner_id=$1 OR (EXISTS (
       SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=$1 AND pm.status='active')
       AND b.id IS NOT NULL AND EXISTS (
         SELECT 1 FROM board_grants g WHERE g.board_id=b.id AND g.project_id=p.id AND g.workspace_id=p.workspace_id AND g.user_id=$1))
     ORDER BY p.id,b.id`,
    [actorId]
  );
  return createHash2("sha256").update(JSON.stringify({ actorId, scope: scope.rows })).digest("hex");
}
async function listNotifications(poolOrClient, actorId, options) {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const unreadOnly = options?.unreadOnly === true;
    const scopeDigest = await notificationScopeDigest(client, actorId);
    const cursor = options?.cursor ? decodeNotificationCursor(options.cursor, actorId, scopeDigest, unreadOnly) : void 0;
    const result = await client.query(
      `SELECT n.id,n.user_id,n.type,n.title,n.body,n.link,n.read,n.created_at,
         to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
       FROM notifications n
       WHERE ${visibleNotification}
         AND ($2::boolean=FALSE OR n.read=FALSE)
         AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3::timestamptz,$4::text))
       ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,
      [actorId, unreadOnly, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      data: rows.map(toNotification),
      nextCursor: result.rows.length > limit && last ? encodeNotificationCursor({
        v: 2,
        userId: actorId,
        scopeDigest,
        unreadOnly,
        createdAt: last.cursor_time,
        id: last.id
      }) : null
    };
  });
}
function toNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.read),
    createdAt: new Date(row.created_at).toISOString()
  };
}
async function markNotificationRead(poolOrClient, notificationId, actorId) {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    const context = await client.query(
      `SELECT c.board_id,n.project_id,n.workspace_id,w.owner_id
       FROM notifications n JOIN projects p ON p.id=n.project_id AND p.workspace_id=n.workspace_id
       JOIN workspaces w ON w.id=p.workspace_id
       LEFT JOIN cards c ON c.id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
       WHERE n.id=$1 AND n.user_id=$2`,
      [notificationId, actorId]
    );
    const row = context.rows[0];
    if (!row) throw HttpError.notFound("Notification not found.", "NOT_FOUND");
    if (row.board_id) {
      try {
        const access = await lockBoardAccess(client, row.board_id, actorId);
        if (access.projectId !== row.project_id || access.workspaceId !== row.workspace_id)
          throw HttpError.notFound("Notification not found.", "NOT_FOUND");
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          throw HttpError.notFound("Notification not found.", "NOT_FOUND");
        throw error;
      }
    } else {
      const owner = await client.query(
        "SELECT owner_id FROM workspaces WHERE id=$1 FOR SHARE",
        [row.workspace_id]
      );
      if (owner.rows[0]?.owner_id !== actorId)
        throw HttpError.notFound("Notification not found.", "NOT_FOUND");
    }
    const update = await client.query(
      `UPDATE notifications n SET read=TRUE
       WHERE n.id=$2 AND ${visibleNotification}
       RETURNING n.id,n.user_id,n.type,n.title,n.body,n.link,n.read,n.created_at`,
      [actorId, notificationId]
    );
    const updated = update.rows[0];
    if (!updated) throw HttpError.notFound("Notification not found.", "NOT_FOUND");
    return toNotification(updated);
  });
}
async function markAllNotificationsRead(poolOrClient, actorId) {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    await client.query(
      `SELECT w.id FROM workspaces w WHERE w.owner_id=$1 AND EXISTS (
        SELECT 1 FROM notifications n JOIN projects p ON p.id=n.project_id
        WHERE n.workspace_id=w.id AND p.workspace_id=w.id AND n.user_id=$1 AND NOT n.read)
       ORDER BY w.id FOR SHARE`,
      [actorId]
    );
    const boards = await client.query(
      `SELECT DISTINCT c.board_id FROM notifications n JOIN cards c ON c.id=n.card_id
       AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
       WHERE n.user_id=$1 AND NOT n.read AND c.state='active' ORDER BY c.board_id`,
      [actorId]
    );
    for (const row of boards.rows) {
      try {
        await lockBoardAccess(client, row.board_id, actorId);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) continue;
        throw error;
      }
    }
    const update = await client.query(
      `UPDATE notifications n SET read=TRUE WHERE ${visibleNotification} AND n.read=FALSE`,
      [actorId]
    );
    return { count: update.rowCount ?? 0 };
  });
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/notifications.ts
var notificationsRoutes = new Hono15();
function parseLimit4(limitParam) {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}
notificationsRoutes.get("/notifications/health", (c) => c.json({ data: { status: "ok" } }));
notificationsRoutes.get("/notifications", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const limit = parseLimit4(c.req.query("limit"));
  const cursor = c.req.query("cursor") || void 0;
  const unreadOnly = c.req.query("unreadOnly") === "true";
  const pool = getPool();
  const result = await listNotifications(pool, actor.id, { limit, cursor, unreadOnly });
  return c.json({
    data: result.data,
    nextCursor: result.nextCursor
  });
});
notificationsRoutes.patch("/notifications/:id/read", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const notificationId = c.req.param("id");
  const pool = getPool();
  const notification = await markNotificationRead(pool, notificationId, actor.id);
  return c.json({
    data: notification
  });
});
notificationsRoutes.post("/notifications/mark-all-read", authMiddleware, async (c) => {
  const actor = c.get("actor");
  if (!actor) {
    throw HttpError.unauthorized("Invalid or missing authentication session.");
  }
  const pool = getPool();
  const result = await markAllNotificationsRead(pool, actor.id);
  return c.json({
    data: {
      success: true,
      count: result.count
    }
  });
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/system.ts
import { Hono as Hono16 } from "hono";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/migrations.ts
import fs3 from "node:fs/promises";
import fsSync from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/embedded-migrations.ts
var EMBEDDED_MIGRATIONS = [
  {
    version: "0001",
    name: "0001_initial.sql",
    sql: "-- Flowboard PostgreSQL Schema Migration 0001\n-- PostgreSQL 17 compatible DDL\n\n-- 1. workspaces\nCREATE TABLE workspaces (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  timezone TEXT NOT NULL,\n  owner_id TEXT NOT NULL,\n  version INTEGER NOT NULL DEFAULT 1,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 2. users\nCREATE TABLE users (\n  id TEXT PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE,\n  display_name TEXT NOT NULL,\n  avatar_url TEXT,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 3. projects\nCREATE TABLE projects (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  name TEXT NOT NULL,\n  description TEXT,\n  archived BOOLEAN NOT NULL DEFAULT FALSE,\n  version INTEGER NOT NULL DEFAULT 1,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 4. project_memberships\nCREATE TABLE project_memberships (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),\n  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),\n  version INTEGER NOT NULL DEFAULT 1,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL,\n  UNIQUE(project_id, user_id)\n);\n\n-- 5. project_invitations\nCREATE TABLE project_invitations (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  email TEXT NOT NULL,\n  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),\n  token_hash TEXT NOT NULL,\n  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),\n  expires_at TIMESTAMPTZ NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 6. boards\nCREATE TABLE boards (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  name TEXT NOT NULL,\n  structure_version INTEGER NOT NULL DEFAULT 1,\n  snapshot_version INTEGER NOT NULL DEFAULT 1,\n  archived BOOLEAN NOT NULL DEFAULT FALSE,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 7. columns\nCREATE TABLE columns (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,\n  name TEXT NOT NULL,\n  color TEXT NOT NULL,\n  category TEXT NOT NULL CHECK (category IN ('todo', 'active', 'done')),\n  position INTEGER NOT NULL,\n  version INTEGER NOT NULL DEFAULT 1,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL,\n  UNIQUE(board_id, name)\n);\n\n-- 8. cards\nCREATE TABLE cards (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,\n  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE RESTRICT,\n  title TEXT NOT NULL,\n  description TEXT,\n  priority TEXT NOT NULL CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),\n  due_date DATE,\n  position BIGINT NOT NULL,\n  version INTEGER NOT NULL DEFAULT 1,\n  state TEXT NOT NULL CHECK (state IN ('active', 'trashed', 'purged')),\n  deleted_at TIMESTAMPTZ,\n  deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,\n  restore_until TIMESTAMPTZ,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 9. card_assignees\nCREATE TABLE card_assignees (\n  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  created_at TIMESTAMPTZ NOT NULL,\n  PRIMARY KEY(card_id, user_id)\n);\n\n-- 10. comments\nCREATE TABLE comments (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,\n  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  body TEXT NOT NULL,\n  version INTEGER NOT NULL DEFAULT 1,\n  deleted_at TIMESTAMPTZ,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 11. comment_mentions\nCREATE TABLE comment_mentions (\n  id TEXT PRIMARY KEY,\n  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  start_offset INTEGER NOT NULL,\n  end_offset INTEGER NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL\n);\n\n-- 12. activity_log\nCREATE TABLE activity_log (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,\n  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  action TEXT NOT NULL,\n  safe_changes JSONB,\n  created_at TIMESTAMPTZ NOT NULL\n);\n\n-- 13. notifications\nCREATE TABLE notifications (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  type TEXT NOT NULL,\n  title TEXT NOT NULL,\n  body TEXT NOT NULL,\n  link TEXT NOT NULL,\n  read BOOLEAN NOT NULL DEFAULT FALSE,\n  created_at TIMESTAMPTZ NOT NULL\n);\n\n-- 14. card_images\nCREATE TABLE card_images (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,\n  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  filename TEXT NOT NULL,\n  byte_length INTEGER NOT NULL,\n  content_type TEXT NOT NULL,\n  storage_key TEXT NOT NULL,\n  sha256 TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 15. card_image_uploads\nCREATE TABLE card_image_uploads (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,\n  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  filename TEXT NOT NULL,\n  byte_length INTEGER NOT NULL,\n  content_type TEXT NOT NULL,\n  sha256 TEXT NOT NULL,\n  state TEXT NOT NULL CHECK (state IN ('awaiting_content', 'content_received', 'validating', 'finalized', 'failed', 'cancelled', 'expired')),\n  expires_at TIMESTAMPTZ NOT NULL,\n  finalized_image_id TEXT REFERENCES card_images(id) ON DELETE SET NULL,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 16. card_imports\nCREATE TABLE card_imports (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,\n  default_column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE RESTRICT,\n  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  version INTEGER NOT NULL DEFAULT 1,\n  state TEXT NOT NULL CHECK (state IN ('uploaded', 'validating', 'invalid', 'ready', 'committing', 'committed', 'failed', 'cancelled', 'expired')),\n  preview_digest TEXT,\n  expires_at TIMESTAMPTZ,\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL\n);\n\n-- 17. card_import_rows\nCREATE TABLE card_import_rows (\n  id TEXT PRIMARY KEY,\n  import_id TEXT NOT NULL REFERENCES card_imports(id) ON DELETE CASCADE,\n  row_number INTEGER NOT NULL,\n  external_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  status TEXT,\n  priority TEXT,\n  due_date DATE,\n  assignee_emails TEXT[],\n  outcome TEXT NOT NULL CHECK (outcome IN ('new', 'already_imported', 'invalid', 'conflict', 'created', 'skipped')),\n  errors JSONB,\n  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,\n  created_at TIMESTAMPTZ NOT NULL\n);\n\n-- 18. card_import_duplicates\nCREATE TABLE card_import_duplicates (\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,\n  external_id TEXT NOT NULL,\n  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,\n  row_hash TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL,\n  PRIMARY KEY(board_id, external_id)\n);\n\n-- 19. idempotency_receipts\nCREATE TABLE idempotency_receipts (\n  id TEXT PRIMARY KEY,\n  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'project', 'actor')),\n  scope_id TEXT NOT NULL,\n  idempotency_key TEXT NOT NULL,\n  method_path_hash TEXT NOT NULL,\n  body_hash TEXT NOT NULL,\n  status_code INTEGER NOT NULL,\n  response_body JSONB NOT NULL,\n  expires_at TIMESTAMPTZ NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL,\n  UNIQUE(actor_id, scope_id, idempotency_key)\n);\n\n-- 20. outbox\nCREATE TABLE outbox (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  event_type TEXT NOT NULL,\n  payload JSONB NOT NULL,\n  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),\n  retry_count INTEGER NOT NULL DEFAULT 0,\n  next_retry_at TIMESTAMPTZ NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL\n);\n\n-- 21. schema_migrations\nCREATE TABLE IF NOT EXISTS schema_migrations (\n  version TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  applied_at TIMESTAMPTZ NOT NULL\n);\n\n-- Performance and Foreign Key Indexes\nCREATE INDEX idx_projects_workspace ON projects(workspace_id);\nCREATE INDEX idx_project_memberships_user ON project_memberships(user_id);\nCREATE INDEX idx_project_memberships_project ON project_memberships(project_id);\nCREATE INDEX idx_project_invitations_project ON project_invitations(project_id);\nCREATE INDEX idx_project_invitations_token ON project_invitations(token_hash);\nCREATE INDEX idx_boards_project ON boards(project_id);\nCREATE INDEX idx_columns_board_position ON columns(board_id, position);\nCREATE INDEX idx_cards_column_position ON cards(column_id, position);\nCREATE INDEX idx_cards_board ON cards(board_id);\nCREATE INDEX idx_cards_project ON cards(project_id);\nCREATE INDEX idx_cards_state ON cards(state);\nCREATE INDEX idx_card_assignees_user ON card_assignees(user_id);\nCREATE INDEX idx_comments_card ON comments(card_id);\nCREATE INDEX idx_comment_mentions_comment ON comment_mentions(comment_id);\nCREATE INDEX idx_comment_mentions_user ON comment_mentions(user_id);\nCREATE INDEX idx_activity_log_card ON activity_log(card_id);\nCREATE INDEX idx_activity_log_project ON activity_log(project_id, created_at DESC);\nCREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = FALSE;\nCREATE INDEX idx_card_images_card ON card_images(card_id);\nCREATE INDEX idx_card_image_uploads_card ON card_image_uploads(card_id);\nCREATE INDEX idx_card_imports_board ON card_imports(board_id);\nCREATE INDEX idx_card_import_rows_import ON card_import_rows(import_id);\nCREATE INDEX idx_idempotency_receipts_lookup ON idempotency_receipts(actor_id, scope_id, idempotency_key);\nCREATE INDEX idx_idempotency_receipts_expires ON idempotency_receipts(expires_at);\nCREATE INDEX idx_outbox_pending ON outbox(status, next_retry_at) WHERE status IN ('pending', 'processing');\n"
  },
  {
    version: "0002",
    name: "0002_sessions.sql",
    sql: "-- Migration: 0002_sessions.sql\n-- Description: Database-backed sessions for authentication and cookie tracking\n\nCREATE TABLE IF NOT EXISTS sessions (\n    id TEXT PRIMARY KEY,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    expires_at TIMESTAMPTZ NOT NULL,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);\nCREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);\n"
  },
  {
    version: "0003",
    name: "0003_constraints.sql",
    sql: "-- Flowboard PostgreSQL Schema Migration 0003\n-- Strengthen ancestry, owner foreign keys, and relational hierarchy constraints.\n\n-- 1. Workspace owner foreign key constraint\n-- Ensures a workspace cannot reference a non-existent owner, and deleting an active owner is blocked.\nALTER TABLE workspaces\n  ADD CONSTRAINT fk_workspaces_owner\n  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;\n\n-- 2. Projects composite unique constraint\n-- Enables child entities with (project_id, workspace_id) to enforce strict matching parentage.\nALTER TABLE projects\n  ADD CONSTRAINT uq_projects_id_workspace\n  UNIQUE (id, workspace_id);\n\n-- 3. Project memberships ancestry constraint\nALTER TABLE project_memberships\n  ADD CONSTRAINT fk_project_memberships_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n\n-- 4. Project invitations ancestry constraint\nALTER TABLE project_invitations\n  ADD CONSTRAINT fk_project_invitations_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n\n-- 5. Boards ancestry constraint and composite unique constraint for child entities\nALTER TABLE boards\n  ADD CONSTRAINT fk_boards_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n\nALTER TABLE boards\n  ADD CONSTRAINT uq_boards_id_project_workspace\n  UNIQUE (id, project_id, workspace_id);\n\n-- 6. Columns ancestry constraint and composite unique constraint for child entities\nALTER TABLE columns\n  ADD CONSTRAINT fk_columns_board_project_workspace\n  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;\n\nALTER TABLE columns\n  ADD CONSTRAINT uq_columns_id_board\n  UNIQUE (id, board_id);\n\n-- 7. Cards ancestry constraints linking board/project/workspace and column/board\nALTER TABLE cards\n  ADD CONSTRAINT fk_cards_board_project_workspace\n  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;\n\nALTER TABLE cards\n  ADD CONSTRAINT fk_cards_column_board\n  FOREIGN KEY (column_id, board_id) REFERENCES columns(id, board_id) ON DELETE RESTRICT;\n\nALTER TABLE cards\n  ADD CONSTRAINT uq_cards_id_project_workspace\n  UNIQUE (id, project_id, workspace_id);\n\n-- 8. Card assignees ancestry constraint\nALTER TABLE card_assignees\n  ADD CONSTRAINT fk_card_assignees_card_project_workspace\n  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;\n\n-- 9. Comments ancestry constraint\nALTER TABLE comments\n  ADD CONSTRAINT fk_comments_card_project_workspace\n  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;\n\n-- 10. Card images ancestry constraint\nALTER TABLE card_images\n  ADD CONSTRAINT fk_card_images_card_project_workspace\n  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;\n\n-- 11. Card image uploads ancestry constraint\nALTER TABLE card_image_uploads\n  ADD CONSTRAINT fk_card_image_uploads_card_project_workspace\n  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;\n\n-- 12. Card imports ancestry constraints\nALTER TABLE card_imports\n  ADD CONSTRAINT fk_card_imports_board_project_workspace\n  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;\n\nALTER TABLE card_imports\n  ADD CONSTRAINT fk_card_imports_column_board\n  FOREIGN KEY (default_column_id, board_id) REFERENCES columns(id, board_id) ON DELETE RESTRICT;\n\n-- 13. Card import duplicates ancestry constraint\nALTER TABLE card_import_duplicates\n  ADD CONSTRAINT fk_card_import_duplicates_board_project_workspace\n  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;\n\n-- 14. Activity log ancestry constraint\nALTER TABLE activity_log\n  ADD CONSTRAINT fk_activity_log_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n\n-- 15. Notifications ancestry constraint\nALTER TABLE notifications\n  ADD CONSTRAINT fk_notifications_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n\n-- 16. Outbox ancestry constraint\nALTER TABLE outbox\n  ADD CONSTRAINT fk_outbox_project_workspace\n  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;\n"
  },
  {
    version: "0004",
    name: "0004_minimal_idempotency_receipts.sql",
    sql: "-- Receipts are retry metadata, not durable copies of private resource bodies.\n-- Retain only identifiers/version markers needed for a client refetch.\nUPDATE idempotency_receipts\nSET response_body = CASE\n  WHEN jsonb_typeof(response_body -> 'data') = 'object' THEN\n    jsonb_build_object(\n      'data',\n      COALESCE(\n        (\n          SELECT jsonb_object_agg(entry.key, entry.value)\n          FROM jsonb_each(response_body -> 'data') AS entry\n          WHERE entry.key IN ('id', 'version', 'structureVersion', 'snapshotVersion', 'operationId', 'success', 'role', 'projectId', 'workspaceId', 'state', 'status')\n        ),\n        '{}'::jsonb\n      )\n    )\n  WHEN jsonb_typeof(response_body -> 'data') = 'array' THEN\n    jsonb_build_object(\n      'data',\n      COALESCE(\n        (\n          SELECT jsonb_agg(\n            CASE WHEN jsonb_typeof(item.value) = 'object' THEN\n              COALESCE(\n                (\n                  SELECT jsonb_object_agg(entry.key, entry.value)\n                  FROM jsonb_each(item.value) AS entry\n                  WHERE entry.key IN ('id', 'version', 'structureVersion', 'snapshotVersion', 'operationId', 'success', 'role', 'projectId', 'workspaceId', 'state', 'status')\n                ),\n                '{}'::jsonb\n              )\n            ELSE '{}'::jsonb END\n          )\n          FROM jsonb_array_elements(response_body -> 'data') AS item(value)\n        ),\n        '[]'::jsonb\n      )\n    )\n  ELSE '{}'::jsonb\nEND;\n"
  },
  {
    version: "0005",
    name: "0005_card_images.sql",
    sql: "-- Migration 0005: Card images and upload staging extensions\n-- Adds dimensions and version tracking to card_images and card_image_uploads\n\nALTER TABLE card_images\n  ADD COLUMN IF NOT EXISTS width INTEGER,\n  ADD COLUMN IF NOT EXISTS height INTEGER,\n  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;\n\nALTER TABLE card_image_uploads\n  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,\n  ADD COLUMN IF NOT EXISTS received_bytes INTEGER,\n  ADD COLUMN IF NOT EXISTS error JSONB;\n\n-- Performance indexes for project scoping and upload cleanup\nCREATE INDEX IF NOT EXISTS idx_card_images_project ON card_images(project_id);\nCREATE INDEX IF NOT EXISTS idx_card_image_uploads_project ON card_image_uploads(project_id);\nCREATE INDEX IF NOT EXISTS idx_card_image_uploads_cleanup ON card_image_uploads(state, expires_at);\n"
  },
  {
    version: "0006",
    name: "0006_retryable_storage_cleanup.sql",
    sql: "-- Keep object keys available for retry after the owning image rows are purged.\nCREATE TABLE pending_storage_deletions (\n  storage_key TEXT PRIMARY KEY,\n  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),\n  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  lease_token TEXT,\n  lease_until TIMESTAMPTZ,\n  last_error TEXT,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE INDEX idx_pending_storage_deletions_retry\n  ON pending_storage_deletions(next_retry_at, storage_key);\n\n-- Structured card identity avoids unsafe substring matching on notification links.\nALTER TABLE notifications\n  ADD COLUMN card_id TEXT REFERENCES cards(id) ON DELETE SET NULL;\n\nUPDATE notifications\nSET card_id = substring(link FROM '[?&]cardId=([^&]+)')\nWHERE type = 'mention'\n  AND link ~ '[?&]cardId=[^&]+';\n\nCREATE INDEX idx_notifications_card ON notifications(card_id) WHERE card_id IS NOT NULL;\n"
  },
  {
    version: "0007",
    name: "0007_board_grants.sql",
    sql: "-- Local foundation only: this migration does not switch existing API authorization.\n-- Do not deploy until every board-derived route is converted and independently reviewed.\n-- Composite foreign keys enforce board/project/workspace ancestry and require a\n-- project membership row. They do NOT enforce an active status, Owner-only\n-- grant administration, implicit Owner access, audit, or policy on existing\n-- routes. Those invariants require a transaction-aware, mounted application.\n-- The membership-status trigger clears stale grants in the same transaction;\n-- it does not yet emit per-grant audit events. All writers must follow the\n-- documented membership -> grant -> board lock order. Existing routes do not.\nALTER TABLE boards ADD COLUMN access_revision BIGINT NOT NULL DEFAULT 1;\n\nCREATE TABLE board_grants (\n  board_id TEXT NOT NULL,\n  project_id TEXT NOT NULL,\n  workspace_id TEXT NOT NULL,\n  user_id TEXT NOT NULL,\n  granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  PRIMARY KEY (board_id, user_id),\n  FOREIGN KEY (board_id, project_id, workspace_id)\n    REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT,\n  FOREIGN KEY (project_id, user_id)\n    REFERENCES project_memberships(project_id, user_id) ON DELETE RESTRICT\n);\nCREATE INDEX idx_board_grants_project_user ON board_grants(project_id, user_id);\n\n-- A removed membership can later be reactivated, so clear old grants atomically.\n-- Membership update takes its row lock before this trigger takes board grant locks.\nCREATE FUNCTION clear_board_grants_on_project_removal() RETURNS TRIGGER AS $$\nDECLARE affected_board TEXT;\nBEGIN\n  IF OLD.status IS DISTINCT FROM NEW.status THEN\n    -- Order both grant and board locks by stable board ID. Every grant writer\n    -- must first lock this membership row, so a concurrent grant for the same\n    -- member cannot be inserted or revoked while this trigger is running.\n    FOR affected_board IN\n      SELECT board_id FROM board_grants\n      WHERE project_id = NEW.project_id AND user_id = NEW.user_id\n      ORDER BY board_id FOR UPDATE\n    LOOP\n      UPDATE boards SET access_revision = access_revision + 1 WHERE id = affected_board;\n      DELETE FROM board_grants WHERE board_id = affected_board AND user_id = NEW.user_id;\n    END LOOP;\n  END IF;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\nCREATE TRIGGER project_membership_clear_board_grants\n  AFTER UPDATE OF status ON project_memberships\n  FOR EACH ROW EXECUTE FUNCTION clear_board_grants_on_project_removal();\n"
  },
  {
    version: "0008",
    name: "0008_board_activity_scope.sql",
    sql: "-- EXPERIMENTAL: never auto-applied; all activity writers and reads must be\n-- cut over atomically. Unclassified legacy records stay Owner-only.\nALTER TABLE activity_log ADD COLUMN board_id TEXT;\nALTER TABLE activity_log ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'unknown'\n  CHECK (visibility_scope IN ('unknown', 'project', 'board'));\n\n-- Existing card-linked events have verified card ancestry. Cardless legacy\n-- events are deliberately left unknown rather than trusting arbitrary JSON.\nUPDATE activity_log a SET board_id = c.board_id, visibility_scope = 'board'\nFROM cards c\nWHERE a.card_id = c.id AND a.project_id = c.project_id AND a.workspace_id = c.workspace_id;\n\nALTER TABLE activity_log ADD CONSTRAINT activity_scope_board_fk\n  FOREIGN KEY (board_id, project_id, workspace_id)\n  REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;\nALTER TABLE activity_log ADD CONSTRAINT activity_scope_shape\n  CHECK ((visibility_scope = 'board' AND board_id IS NOT NULL)\n      OR (visibility_scope IN ('unknown', 'project') AND board_id IS NULL));\n\n-- Prevent marking a board/card event as a project event. The scope remains\n-- attached to historical events when the card reference is nulled on deletion.\nCREATE FUNCTION validate_activity_scope_draft() RETURNS TRIGGER AS $$\nBEGIN\n  IF TG_OP = 'UPDATE' AND (NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.visibility_scope IS DISTINCT FROM OLD.visibility_scope) THEN\n    RAISE EXCEPTION 'activity scope is immutable';\n  END IF;\n  IF NEW.card_id IS NOT NULL AND NEW.visibility_scope <> 'unknown' AND NOT EXISTS (\n    SELECT 1 FROM cards c WHERE c.id = NEW.card_id AND c.board_id = NEW.board_id\n      AND c.project_id = NEW.project_id AND c.workspace_id = NEW.workspace_id\n  ) THEN\n    RAISE EXCEPTION 'activity card scope does not match';\n  END IF;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\nCREATE TRIGGER validate_activity_scope_draft_trigger\n  BEFORE INSERT OR UPDATE ON activity_log FOR EACH ROW EXECUTE FUNCTION validate_activity_scope_draft();\n\nCREATE INDEX idx_activity_scope_draft_page ON activity_log(project_id, created_at DESC, id DESC);\n"
  },
  {
    version: "0009",
    name: "0009_card_keys_and_key_prefix.sql",
    sql: "-- Additive: human-readable card keys (e.g. WEB-101) and project key prefixes.\n-- Keys use one global sequence as the column default: nextval() takes no row lock, so card\n-- creation does not add a lock upgrade, and a number is never reused. Numbers are not\n-- contiguous per project. Existing cards are numbered by creation order (created_at, id).\n\nCREATE SEQUENCE card_key_seq;\n\nALTER TABLE projects ADD COLUMN key_prefix TEXT;\nUPDATE projects\nSET key_prefix = COALESCE(NULLIF(UPPER(LEFT(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g'), 3)), ''), 'PRJ');\nALTER TABLE projects ALTER COLUMN key_prefix SET NOT NULL;\nALTER TABLE projects ALTER COLUMN key_prefix SET DEFAULT 'PRJ';\n\nALTER TABLE cards ADD COLUMN card_number BIGINT;\nUPDATE cards c\nSET card_number = numbered.rn\nFROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM cards) numbered\nWHERE c.id = numbered.id;\nSELECT setval('card_key_seq', COALESCE((SELECT MAX(card_number) FROM cards), 0) + 1, false);\nALTER TABLE cards ALTER COLUMN card_number SET DEFAULT nextval('card_key_seq');\nALTER TABLE cards ALTER COLUMN card_number SET NOT NULL;\nCREATE UNIQUE INDEX cards_card_number_key ON cards (card_number);\n"
  },
  {
    version: "0010",
    name: "0010_column_tone.sql",
    sql: "-- Additive: optional named tone for a column (prototype pastel set). NULL means not set; the\n-- client keeps deriving a tone from name/category. Existing rows are unchanged.\nALTER TABLE columns ADD COLUMN tone TEXT\n  CHECK (tone IN ('lavender', 'ice', 'grey', 'green', 'coral', 'rose', 'mint', 'peach', 'butter', 'lilac'));\n"
  },
  {
    version: "0011",
    name: "0011_rate_limit_windows.sql",
    sql: "-- Additive: fixed-window request counters for the sensitive-route rate limiter (Google sign-in,\n-- invitation create, import preview and commit, image upload and finalize). One row per\n-- (bucket, client key, one-minute window). UNLOGGED: writes skip the WAL. A crash or restart\n-- empties the table, which resets the counters; acceptable for one-minute windows. Rows for ended\n-- windows are removed by the scheduled purge in apps/api (adapters/rate-limit-postgres.ts).\nCREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_windows (\n  bucket TEXT NOT NULL,\n  client_key TEXT NOT NULL,\n  window_start BIGINT NOT NULL,\n  request_count INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY (bucket, client_key, window_start)\n);\n\n-- Lets the purge find ended windows by time without scanning the whole table.\nCREATE INDEX IF NOT EXISTS rate_limit_windows_window_start_idx ON rate_limit_windows (window_start);\n"
  },
  {
    version: "0012",
    name: "0012_user_last_location.sql",
    sql: "-- Additive: remember where each user last was, so the app can return them there.\n-- Both columns are pointers only. Access is re-checked on every read (see\n-- apps/api/src/adapters/last-location.ts); a pointer to a project or board the user\n-- can no longer read is never returned. ON DELETE SET NULL clears a pointer when its\n-- target row is deleted. No backfill: existing users start with NULL.\nALTER TABLE users ADD COLUMN IF NOT EXISTS last_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;\nALTER TABLE users ADD COLUMN IF NOT EXISTS last_board_id TEXT REFERENCES boards(id) ON DELETE SET NULL;\n"
  },
  {
    version: "0013",
    name: "0013_board_description_default_board.sql",
    sql: `-- Additive: a plain-text description on each board, and a per-project default landing board.
-- No backfill: existing boards have a NULL description, existing projects a NULL default board.
-- Idempotent: columns use IF NOT EXISTS; constraints are added inside a DO block that ignores
-- "already exists", so a second run changes nothing.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS description TEXT;

-- The composite foreign key below needs a unique target on (id, project_id). boards.id is already
-- unique, so this constraint adds no new rows and only lets the foreign key name both columns.
DO $$
BEGIN
  ALTER TABLE boards ADD CONSTRAINT boards_id_project_id_key UNIQUE (id, project_id);
EXCEPTION
  -- duplicate_table: a UNIQUE constraint's backing index already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_board_id TEXT;

-- The pair (default_board_id, id) must match a real board whose project_id is this project's id.
-- So a project can only point at one of its own boards, enforced by PostgreSQL rather than by
-- application code alone. ON DELETE SET NULL (default_board_id) clears only the pointer if the
-- board row is deleted; it never touches the project's id.
DO $$
BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_default_board_fk
    FOREIGN KEY (default_board_id, id) REFERENCES boards (id, project_id)
    ON DELETE SET NULL (default_board_id);
EXCEPTION
  -- duplicate_object: the named foreign key already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;
`
  },
  {
    version: "0014",
    name: "0014_project_brief_links.sql",
    sql: "-- Additive: a plain-text brief on each project, and up to 10 https links per project.\n-- No backfill: existing projects have a NULL brief and no links.\n-- Idempotent: IF NOT EXISTS everywhere, so a second run changes nothing.\n-- The API enforces the length, count and https rules (packages/contracts). The CHECKs below are a\n-- second line of defence so a bad row cannot be written by another path.\n\nALTER TABLE projects ADD COLUMN IF NOT EXISTS brief TEXT;\n\nCREATE TABLE IF NOT EXISTS project_links (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,\n  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),\n  url TEXT NOT NULL CHECK (url ~* '^https://' AND char_length(url) <= 2000),\n  position INTEGER NOT NULL CHECK (position >= 0),\n  created_at TIMESTAMPTZ NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL,\n  UNIQUE (project_id, position)\n);\n"
  },
  {
    version: "0015",
    name: "0015_project_links_workspace_fk.sql",
    sql: `-- Additive: a project link must belong to the same workspace as its project (FB-AUD-07).
-- Before this, the foreign keys on project_links.workspace_id and project_links.project_id were
-- independent, so one row could name workspace A with a project from workspace B. The composite
-- key below reuses the unique (id, workspace_id) key that projects already has (migration 0003).
-- No backfill: a row that already pairs a link with another workspace's project would stop the
-- constraint from being added. Such a row cannot come from the API, and an operator must fix it first.
-- Idempotent: the constraint is added inside a DO block that ignores "already exists", so a second
-- run changes nothing.
DO $$
BEGIN
  ALTER TABLE project_links ADD CONSTRAINT project_links_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE RESTRICT;
EXCEPTION
  -- duplicate_object: the named foreign key already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;
`
  },
  {
    version: "0016",
    name: "0016_staged_upload_cleanup.sql",
    sql: "-- Additive: marks a staged upload whose staging object has been queued for deletion (B-11), so the\n-- orphan sweep settles each row once instead of revisiting it on every run. No backfill: existing\n-- rows start as not cleaned, and the first sweep settles them.\n-- Idempotent: IF NOT EXISTS everywhere, so a second run changes nothing.\nALTER TABLE card_image_uploads ADD COLUMN IF NOT EXISTS staging_cleaned BOOLEAN NOT NULL DEFAULT FALSE;\n\nCREATE INDEX IF NOT EXISTS card_image_uploads_orphan_idx\n  ON card_image_uploads (expires_at)\n  WHERE staging_cleaned = FALSE;\n"
  },
  {
    version: "0017",
    name: "0017_audit_round_b14.sql",
    sql: "-- Additive (B-14, audit rounds 2 and C). Every statement is idempotent, so a second run changes nothing.\n--\n-- 1. Child-side indexes for foreign keys that had none (C-06). Without them, deleting a workspace\n--    or a user scans these tables for rows that still reference them.\nCREATE INDEX IF NOT EXISTS project_links_workspace_idx ON project_links (workspace_id);\nCREATE INDEX IF NOT EXISTS board_grants_granted_by_idx ON board_grants (granted_by);\n\n-- 2. Window counters cannot be negative (C-10). Existing rows are checked when the constraint is\n--    added: a negative counter would stop it, and such a row cannot come from the API.\nDO $$\nBEGIN\n  ALTER TABLE rate_limit_windows\n    ADD CONSTRAINT rate_limit_windows_request_count_nonnegative CHECK (request_count >= 0);\nEXCEPTION\n  -- duplicate_object: the constraint already exists on a re-run.\n  WHEN duplicate_object THEN NULL;\nEND\n$$;\n\n-- 3. Settled outbox rows are purged 30 days after they settled (FB-AUD-11, FB-AUD-09). settled_at\n--    records when a row reached delivered or failed. Rows that settled before this migration are\n--    backfilled with created_at, which is never later than their real settle time.\nALTER TABLE outbox ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;\n\nUPDATE outbox\nSET settled_at = created_at\nWHERE settled_at IS NULL\n  AND status IN ('delivered', 'failed');\n\nCREATE INDEX IF NOT EXISTS outbox_settled_idx\n  ON outbox (settled_at)\n  WHERE status IN ('delivered', 'failed');\n\n-- 4. Staged upload objects get a random storage key that does not contain the user's filename\n--    (FB-AUD-09). The key is stored on the row, so cleanup never rebuilds it from the filename.\n--    Rows created before this migration get the key their bytes were stored under.\nALTER TABLE card_image_uploads ADD COLUMN IF NOT EXISTS staging_storage_key TEXT;\n\nUPDATE card_image_uploads\nSET staging_storage_key = 'staging/' || id || '/' || filename\nWHERE staging_storage_key IS NULL;\n"
  },
  {
    version: "0018",
    name: "0018_user_names.sql",
    sql: `-- B-16: first and last name. Additive and idempotent. No backfill: existing users keep their
-- display_name and have name_confirmed_at NULL, so they are asked for a name once.
--
-- first_name and last_name hold Google's suggestion (given and family name) until the user saves
-- their own names; name_confirmed_at is the only confirmation marker. display_name is the shown
-- name and becomes "First Last" when the names are saved.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_first_name_length' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_first_name_length
      CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_last_name_length' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_last_name_length
      CHECK (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 60);
  END IF;
END
$$;
`
  },
  {
    version: "0019",
    name: "0019_personal_workspace_backfill.sql",
    sql: "-- 0019 (B-21; edge-case review F-02, F-15, F-22, F-27). Additive and idempotent: a second run inserts nothing.\n--\n-- 1. Personal workspace backfill. Every user who owns no workspace gets one, named with the fixed\n--    internal name 'Personal workspace' (F-05; a person's name never becomes a workspace name). Its id is\n--    derived from the user id, so the row is the same on every run.\n--    The backfill takes the same per-user advisory lock as ensurePersonalWorkspace\n--    (hashtext('fb:quota:user:' || id)) and re-checks ownership under it. A sign-in or project create that\n--    runs during the migration therefore either finishes first (the backfill then skips the user) or waits.\n--    Without the lock, NOT EXISTS alone would not stop a concurrent live sign-in from making a second row.\n-- 2. Owner index for counting owned projects and finding a person's workspace (F-27).\n-- 3. boards.created_by: who made the board. Nullable, with no backfill: older boards keep NULL (F-22).\n\nCREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);\n\nALTER TABLE boards ADD COLUMN IF NOT EXISTS created_by TEXT;\n\nDO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint\n    WHERE conname = 'boards_created_by_fkey' AND conrelid = 'boards'::regclass\n  ) THEN\n    ALTER TABLE boards ADD CONSTRAINT boards_created_by_fkey\n      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;\n  END IF;\nEND\n$$;\n\nDO $$\nDECLARE\n  candidate RECORD;\nBEGIN\n  FOR candidate IN\n    SELECT u.id FROM users u\n    WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = u.id)\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('fb:quota:user:' || candidate.id));\n    IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = candidate.id) THEN\n      INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)\n      VALUES ('ws_' || md5(candidate.id), 'Personal workspace', 'UTC', candidate.id, 1, NOW(), NOW());\n    END IF;\n  END LOOP;\nEND\n$$;\n"
  }
];

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/adapters/migrations.ts
function resolveDefaultMigrationsDir() {
  try {
    const currentDir = path2.dirname(fileURLToPath2(import.meta.url));
    const candidate1 = path2.resolve(currentDir, "../../../../database/migrations");
    if (fsSync.existsSync(candidate1)) {
      return candidate1;
    }
    const candidate2 = path2.resolve(process.cwd(), "database/migrations");
    if (fsSync.existsSync(candidate2)) {
      return candidate2;
    }
  } catch {
  }
  return void 0;
}
function isPool3(target) {
  return typeof target.connect === "function" && typeof target.totalCount === "number";
}
async function executeMigrationsWithClient(client, migrationsDir) {
  const applied = [];
  await client.query("SELECT pg_advisory_lock(hashtext($1))", ["flowboard_migrations"]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
      );
    `);
    const existing = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version ASC"
    );
    const appliedVersions = new Set(existing.rows.map((row) => row.version));
    let migrationItems = [];
    let hasFsDir = false;
    if (migrationsDir) {
      try {
        hasFsDir = fsSync.existsSync(migrationsDir);
      } catch {
        hasFsDir = false;
      }
    }
    if (hasFsDir && migrationsDir) {
      const dirEntries = await fs3.readdir(migrationsDir, { withFileTypes: true });
      const migrationFiles = dirEntries.filter((entry) => entry.isFile() && /^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.test(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
      for (const file of migrationFiles) {
        const match = /^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.exec(file);
        if (!match) continue;
        const version = match[1];
        const filePath = path2.join(migrationsDir, file);
        const sqlContent = await fs3.readFile(filePath, "utf8");
        migrationItems.push({ version, name: file, sql: sqlContent });
      }
    } else {
      migrationItems = EMBEDDED_MIGRATIONS;
    }
    for (const item of migrationItems) {
      if (appliedVersions.has(item.version)) {
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(item.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())",
          [item.version, item.name]
        );
        await client.query("COMMIT");
        applied.push({ version: item.version, name: item.name });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["flowboard_migrations"]);
  }
}
async function runMigrations(poolOrClient, options) {
  const migrationsDir = options?.migrationsDir ?? resolveDefaultMigrationsDir();
  if (isPool3(poolOrClient)) {
    const client = await poolOrClient.connect();
    try {
      return await executeMigrationsWithClient(client, migrationsDir);
    } finally {
      client.release();
    }
  }
  return await executeMigrationsWithClient(poolOrClient, migrationsDir);
}

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/routes/system.ts
var systemRoutes = new Hono16();
systemRoutes.get("/status", async (c) => {
  const env = c.env;
  const deployed = Boolean(env?.HYPERDRIVE || env?.DATABASE_URL);
  if (!adminSecretMatches(c.req.header("x-dev-secret"), env?.DEV_LOGIN_SECRET, deployed)) {
    return c.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, 403);
  }
  const pool = getPool(c);
  const rows = await pool.query("SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC");
  return c.json({ data: { migrations: rows.rows, rateLimitBindings: rateLimitBindingStatus(c.env) } });
});
systemRoutes.post("/migrate", async (c) => {
  const env = c.env;
  const deployed = Boolean(env?.HYPERDRIVE || env?.DATABASE_URL);
  if (!adminSecretMatches(c.req.header("x-dev-secret"), env?.DEV_LOGIN_SECRET, deployed)) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Invalid or missing administrative secret.",
          requestId: c.get("requestId")
        }
      },
      403
    );
  }
  let pool;
  try {
    pool = getPool(c);
  } catch {
    pool = null;
  }
  if (!pool) {
    return c.json(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "No database connection pool available.",
          requestId: c.get("requestId")
        }
      },
      503
    );
  }
  try {
    const result = await runMigrations(pool);
    return c.json({
      data: {
        status: "ok",
        appliedCount: result.applied.length,
        applied: result.applied
      }
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: "MIGRATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          requestId: c.get("requestId")
        }
      },
      500
    );
  }
});

// ../../../../../../private/tmp/flowboard-perf-old-hemn5c9w/apps/api/src/http/app.ts
function createApp(probeDatabase = async () => {
}, options) {
  if (options?.pool) {
    setGlobalPool(options.pool);
  }
  const app = new Hono17();
  const limits = options?.limits ?? { ...DEFAULT_LIMITS };
  app.use("*", async (c, next) => {
    c.set("limits", limits);
    await next();
  });
  app.use("*", cors({
    origin: (origin, c) => !origin ? origin : isTrustedOrigin(origin, c) ? origin : null,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "Idempotency-Key",
      "If-Match",
      "X-Dev-Secret"
    ],
    exposeHeaders: ["X-Request-Id", "Server-Timing", "Content-Disposition", "ETag"],
    maxAge: 86400
  }));
  if (options?.pool) {
    const injectedPool = options.pool;
    app.use("*", async (c, next) => {
      c.set("pool", injectedPool);
      return poolStorage.run(injectedPool, () => next());
    });
  } else {
    app.use("*", async (c, next) => {
      const env = c.env;
      const connStr = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
      if (connStr) {
        const requestPool = createPool(connStr, 1);
        c.set("pool", requestPool);
        try {
          return await poolStorage.run(requestPool, () => next());
        } finally {
          await requestPool.end();
        }
      }
      await next();
    });
  }
  if (options?.storage !== void 0) {
    const scopedStorage = options.storage;
    app.use("*", (_c, next) => runWithStorageDriver(scopedStorage, () => next()));
  }
  app.use("*", correlationMiddleware);
  app.use("*", originCheckMiddleware);
  const rateLimitOptions = { bindingsRequired: options?.rateLimitBindingsRequired ?? false };
  app.use("*", rateLimitMiddleware(options?.rateLimiter ?? cloudflareRateLimiter, rateLimitOptions));
  app.use("*", windowRateLimitMiddleware(
    options?.windowCounter ?? ((c) => postgresWindowCounter(getPool(c))),
    rateLimitOptions
  ));
  app.use("*", timingMiddleware);
  app.use("*", routeBodyLimitMiddleware(options?.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));
  app.use("*", deadlineMiddleware(options?.deadlineMs ?? DEFAULT_DEADLINE_MS));
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "no-store");
    }
  });
  app.get("/health/live", (c) => c.json({ data: { status: "ok" } }));
  app.get("/health/ready", async (c) => {
    try {
      await probeDatabase();
      return c.json({ data: { status: "ready" } });
    } catch {
      return c.json(
        {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database is unavailable.",
            requestId: c.get("requestId")
          }
        },
        503
      );
    }
  });
  app.route("/api/v1/session", sessionRoutes);
  app.route("/api/v1/auth", googleAuthRoutes);
  app.route("", workspacesRoutes);
  app.route("", projectsRoutes);
  app.route("/api/v1", invitationsRoutes);
  app.route("/api/v1", membersRoutes);
  app.route("", boardsRoutes);
  app.route("/api/v1", boardGrantsRoutes);
  app.route("", cardsRoutes);
  app.route("/api/v1", commentsRoutes);
  app.route("/api/v1", trashRoutes);
  app.route("", imagesRoutes);
  app.route("/api/v1", importsRoutes);
  app.route("/api/v1", activityRoutes);
  app.route("/api/v1", notificationsRoutes);
  app.route("/api/v1/system", systemRoutes);
  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}
export {
  createApp
};
