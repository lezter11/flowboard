import { bodyLimit } from 'hono/body-limit';
import { timeout } from 'hono/timeout';
import { HttpError } from '../errors.ts';

export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024; // 1 MiB (1,048,576 bytes)
export const DEFAULT_DEADLINE_MS = 5000; // 5000 ms

export function bodyLimitMiddleware(maxBytes: number = DEFAULT_BODY_LIMIT_BYTES) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Request payload exceeds maximum allowed size of ${maxBytes} bytes.`,
      );
    },
  });
}

export function deadlineMiddleware(deadlineMs: number = DEFAULT_DEADLINE_MS) {
  return timeout(
    deadlineMs,
    () => new HttpError(504, 'DEADLINE_EXCEEDED', `Request deadline of ${deadlineMs}ms exceeded.`),
  );
}
