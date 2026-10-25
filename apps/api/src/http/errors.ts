import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends HTTPException {
  readonly code: string;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(status, { message });
    this.name = 'HttpError';
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message = 'Malformed request.', details?: Record<string, unknown>): HttpError {
  return new HttpError(400, 'MALFORMED_REQUEST', message, details);
}

export function unauthorized(message = 'Invalid or missing authentication session.'): HttpError {
  return new HttpError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Insufficient permissions for this resource.'): HttpError {
  return new HttpError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Route or resource not found.'): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

export function conflict(
  code = 'CONFLICT',
  message = 'Resource conflict or stale version.',
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(409, code, message, details);
}

export function restoreWindowExpired(
  message = 'Card restore window has expired.',
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(410, 'RESTORE_WINDOW_EXPIRED', message, details);
}

export function payloadTooLarge(
  message = 'Request payload exceeds maximum allowed size.',
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(413, 'PAYLOAD_TOO_LARGE', message, details);
}

export function validationError(
  message = 'Validation failed.',
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', message, details);
}

export function tooManyRequests(
  message = 'Rate limit exceeded.',
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(429, 'TOO_MANY_REQUESTS', message, details);
}

export function serviceUnavailable(
  code = 'SERVICE_UNAVAILABLE',
  message = 'Service is temporarily unavailable.',
): HttpError {
  return new HttpError(503, code, message);
}

export function deadlineExceeded(message = 'Request deadline exceeded.'): HttpError {
  return new HttpError(504, 'DEADLINE_EXCEEDED', message);
}
