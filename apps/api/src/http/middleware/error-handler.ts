import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ValidationError } from '@flowboard/contracts';
import { HttpError } from '../errors.ts';
import { REQUEST_ID_HEADER } from './correlation.ts';

const STATUS_TO_DEFAULT_CODE: Record<number, string> = {
  400: 'MALFORMED_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'RESTORE_WINDOW_EXPIRED',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED',
};

export const errorHandler: ErrorHandler<{ Variables: { requestId: string } }> = (err, c) => {
  const requestId = c.get('requestId') || crypto.randomUUID();
  c.header(REQUEST_ID_HEADER, requestId);
  c.header('Cache-Control', 'no-store');

  // 1. ValidationError from @flowboard/contracts
  if (err instanceof ValidationError || (err instanceof Error && err.name === 'ValidationError')) {
    const issues = 'issues' in err && Array.isArray((err as { issues: unknown }).issues)
      ? (err as { issues: unknown[] }).issues
      : [];
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message || 'Validation failed.',
          requestId,
          details: { issues },
        },
      },
      422,
    );
  }

  // 2. SyntaxError (e.g. malformed JSON in request body)
  if (err instanceof SyntaxError || (err instanceof Error && err.name === 'SyntaxError')) {
    return c.json(
      {
        error: {
          code: 'MALFORMED_REQUEST',
          message: 'Malformed JSON payload in request body.',
          requestId,
        },
      },
      400,
    );
  }

  // 3. Known HttpError
  if (err instanceof HttpError) {
    if (err.status === 429) {
      c.header('Retry-After', '60');
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      err.status as any,
    );
  }

  // 4. Hono HTTPException
  if (err instanceof HTTPException) {
    const status = err.status;
    const defaultCode = STATUS_TO_DEFAULT_CODE[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'MALFORMED_REQUEST');
    if (status === 429) {
      c.header('Retry-After', '60');
    }
    if (status >= 500) {
      return c.json(
        {
          error: {
            code: defaultCode,
            message: status === 503 ? 'Service is temporarily unavailable.' : 'Internal server error.',
            requestId,
          },
        },
        status,
      );
    }
    return c.json(
      {
        error: {
          code: defaultCode,
          message: err.message || 'Request failed.',
          requestId,
        },
      },
      status,
    );
  }

  // 5. Generic duck-typed HTTP status errors (e.g. from third-party libraries)
  if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    const status = (err as { status: number }).status;
    const code = 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : STATUS_TO_DEFAULT_CODE[status] || 'INTERNAL_ERROR';
    if (status === 429) {
      c.header('Retry-After', '60');
    }
    if (status >= 500 && status !== 503 && status !== 504) {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error.',
            requestId,
          },
        },
        500,
      );
    }
    const message = (err as { message?: string }).message || 'Request failed.';
    const details = 'details' in err && typeof (err as { details: unknown }).details === 'object'
      ? (err as { details: Record<string, unknown> }).details
      : undefined;
    return c.json(
      {
        error: {
          code,
          message,
          requestId,
          ...(details ? { details } : {}),
        },
      },
      status as any,
    );
  }

  // 5b. PostgreSQL deadlock/serialization failures are transient: ask the client to retry.
  const pgCode = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: unknown }).code : undefined;
  if (pgCode === '40P01' || pgCode === '40001') {
    c.header('Retry-After', '1');
    return c.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The request conflicted with another update. Retry shortly.',
          requestId,
        },
      },
      503,
    );
  }

  // 6. Safe 500 handler for unhandled exceptions
  // NEVER leak connection strings, passwords, or SQL query internals to client.
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
        requestId,
      },
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler<{ Variables: { requestId: string } }> = (c) => {
  const requestId = c.get('requestId') || crypto.randomUUID();
  c.header(REQUEST_ID_HEADER, requestId);
  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId,
      },
    },
    404,
  );
};
