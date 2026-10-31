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

  static badRequest(
    first = 'Malformed request.',
    second?: string | Record<string, unknown>,
    third?: Record<string, unknown>,
  ): HttpError {
    let code = 'MALFORMED_REQUEST';
    let message = 'Malformed request.';
    let details: Record<string, unknown> | undefined;

    if (typeof second === 'string') {
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
    return new HttpError(400, code, message, details);
  }

  static unauthorized(message = 'Invalid or missing authentication session.', code = 'UNAUTHORIZED'): HttpError {
    return new HttpError(401, code, message);
  }

  static forbidden(message = 'Insufficient permissions for this resource.', code = 'FORBIDDEN'): HttpError {
    return new HttpError(403, code, message);
  }

  static notFound(
    first = 'Route or resource not found.',
    second?: string,
  ): HttpError {
    let code = 'NOT_FOUND';
    let message = 'Route or resource not found.';

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
    return new HttpError(404, code, message);
  }

  static conflict(
    first = 'CONFLICT',
    second?: string | Record<string, unknown>,
    third?: Record<string, unknown>,
  ): HttpError {
    let code = 'CONFLICT';
    let message = 'Resource conflict or stale version.';
    let details: Record<string, unknown> | undefined;

    if (typeof second === 'string') {
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
    return new HttpError(409, code, message, details);
  }

  static payloadTooLarge(message = 'Payload too large.', code = 'PAYLOAD_TOO_LARGE'): HttpError {
    return new HttpError(413, code, message);
  }

  static internal(message = 'Internal server error.', code = 'INTERNAL_ERROR'): HttpError {
    return new HttpError(500, code, message);
  }

  static unprocessableEntity(
    first = 'Unprocessable entity.',
    second?: string,
    third?: Record<string, unknown>,
  ): HttpError {
    return HttpError.unprocessable(first, second, third);
  }

  static unprocessable(
    first = 'Unprocessable entity.',
    second?: string,
    third?: Record<string, unknown>,
  ): HttpError {
    let code = 'VALIDATION_ERROR';
    let message = 'Unprocessable entity.';
    let details: Record<string, unknown> | undefined;

    if (typeof second === 'string') {
      if (/^[A-Z0-9_]+$/.test(first) && !/^[A-Z0-9_]+$/.test(second)) {
        code = first;
        message = second;
      } else {
        message = first;
        code = second;
      }
      details = third;
    } else if (second && typeof second === 'object') {
      message = first;
      details = second;
    } else if (/^[A-Z0-9_]+$/.test(first)) {
      code = first;
    } else {
      message = first;
    }
    return new HttpError(422, code, message, details);
  }

  static serviceUnavailable(
    first = 'SERVICE_UNAVAILABLE',
    second?: string,
  ): HttpError {
    let code = 'SERVICE_UNAVAILABLE';
    let message = 'Service is temporarily unavailable.';
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
    return new HttpError(503, code, message);
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
  return new HttpError(429, 'RATE_LIMITED', message, details);
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
