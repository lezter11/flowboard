import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createWorkspaceInputSchema,
  errorEnvelopeSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { createApp } from '../src/http/app.ts';
import {
  badRequest,
  conflict,
  deadlineExceeded,
  forbidden,
  notFound,
  payloadTooLarge,
  restoreWindowExpired,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from '../src/http/errors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMING_HEADER_REGEX = /^app;dur=\d+(\.\d+)?$/;

describe('FND-04: Observability, Correlation, Limits & Safe Error Baseline', () => {
  describe('1. Correlation Middleware & Request IDs', () => {
    it('generates a valid UUID request ID when x-request-id header is absent', async () => {
      const app = createApp(async () => {});
      const res = await app.request('/health/live');

      assert.equal(res.status, 200);
      const reqIdHeader = res.headers.get('x-request-id');
      assert.ok(reqIdHeader, 'x-request-id header must be present');
      assert.match(reqIdHeader, UUID_REGEX, 'Generated request ID must be a valid UUID');
    });

    it('propagates incoming valid ASCII x-request-id header faithfully', async () => {
      const app = createApp(async () => {});
      const customId = 'req_custom_obs_12345';
      const res = await app.request('/health/live', {
        headers: { 'x-request-id': customId },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-request-id'), customId);
    });

    it('replaces invalid x-request-id (<8 chars, spaces, non-allowed chars, >64 chars) with a safe UUID', async () => {
      const app = createApp(async () => {});
      const invalidIds = ['short', 'has space in id', 'req;semicolon?notallowed', 'a'.repeat(65), '???invalid!!!'];

      for (const invalidId of invalidIds) {
        const res = await app.request('/health/live', {
          headers: { 'x-request-id': invalidId },
        });

        assert.equal(res.status, 200);
        const reqIdHeader = res.headers.get('x-request-id');
        assert.ok(reqIdHeader);
        assert.notEqual(reqIdHeader, invalidId, `Invalid ID "${invalidId}" should be discarded`);
        assert.match(reqIdHeader, UUID_REGEX, 'Fallback must be a valid UUID');
      }
    });

    it('guarantees x-request-id header is attached on both success and error responses', async () => {
      const app = createApp(async () => {});
      const res404 = await app.request('/unknown-route');
      assert.equal(res404.status, 404);
      assert.match(res404.headers.get('x-request-id') ?? '', UUID_REGEX);

      const customId = 'req_test_error_99999';
      const resCustom404 = await app.request('/another-missing-route', {
        headers: { 'x-request-id': customId },
      });
      assert.equal(resCustom404.status, 404);
      assert.equal(resCustom404.headers.get('x-request-id'), customId);
      const body = (await resCustom404.json()) as { error: { requestId: string } };
      assert.equal(body.error.requestId, customId);
    });
  });

  describe('2. Server-Timing Header', () => {
    it('measures request duration and attaches Server-Timing: app;dur=<ms> header on 200 OK', async () => {
      const app = createApp(async () => {});
      const res = await app.request('/health/live');

      assert.equal(res.status, 200);
      const timingHeader = res.headers.get('Server-Timing');
      assert.ok(timingHeader, 'Server-Timing header must be present');
      assert.match(timingHeader, TIMING_HEADER_REGEX, 'Server-Timing must match app;dur=<ms>');
    });

    it('attaches Server-Timing header on 404 and error responses', async () => {
      const app = createApp(async () => {});
      const res = await app.request('/non-existent-path');

      assert.equal(res.status, 404);
      const timingHeader = res.headers.get('Server-Timing');
      assert.ok(timingHeader, 'Server-Timing header must be present on 404');
      assert.match(timingHeader, TIMING_HEADER_REGEX);
    });
  });

  describe('3. Not Found Handler (404)', () => {
    it('returns standard error envelope with NOT_FOUND code and no-store cache header', async () => {
      const app = createApp(async () => {});
      const res = await app.request('/api/v1/not-a-route');

      assert.equal(res.status, 404);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);

      assert.equal(parsed.error.code, 'NOT_FOUND');
      assert.equal(parsed.error.message, 'Route not found.');
      assert.equal(parsed.error.requestId, res.headers.get('x-request-id'));
    });
  });

  describe('4. Validation Error Formatting (400 and 422)', () => {
    it('returns 400 MALFORMED_REQUEST when request body contains invalid JSON syntax', async () => {
      const app = createApp(async () => {});
      app.post('/api/v1/test-json', async (c) => {
        const payload = await c.req.json();
        return c.json({ data: payload });
      });

      const res = await app.request('/api/v1/test-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json: not valid }',
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'MALFORMED_REQUEST');
      assert.match(parsed.error.message, /malformed json/i);
      assert.equal(parsed.error.requestId, res.headers.get('x-request-id'));
    });

    it('returns 422 VALIDATION_ERROR with structured issues when @flowboard/contracts validation fails', async () => {
      const app = createApp(async () => {});
      app.post('/api/v1/test-contract-validate', async (c) => {
        const json = await c.req.json();
        const validated = parseOrThrow(createWorkspaceInputSchema, json);
        return c.json({ data: validated });
      });

      // Name is required and must not be empty/whitespace
      const res = await app.request('/api/v1/test-contract-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      });

      assert.equal(res.status, 422);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'VALIDATION_ERROR');
      assert.ok(parsed.error.details, 'details must be present for validation errors');
      const issues = parsed.error.details['issues'] as Array<{ path: string; message: string; code: string }>;
      assert.ok(Array.isArray(issues), 'issues must be an array');
      assert.ok(issues.length > 0, 'issues array must contain validation issues');
      assert.equal(issues[0]?.path, 'name');
    });
  });

  describe('5. Safe 500 Handler & Sensitive Internal Error Masking', () => {
    it('masks unhandled errors and NEVER leaks database credentials, connection strings, or SQL internals', async () => {
      const app = createApp(async () => {});
      const sensitiveLeak =
        'FATAL: connection to postgres://super_admin:super_secret_password_999@internal-db.local:5432/flowboard_prod failed: ' +
        'syntax error at or near "SELECT * FROM user_secrets WHERE api_key = secret_token_xyz"';

      app.get('/api/v1/crash-with-secrets', () => {
        throw new Error(sensitiveLeak);
      });

      const customId = 'req_safe_masking_check';
      const res = await app.request('/api/v1/crash-with-secrets', {
        headers: { 'x-request-id': customId },
      });

      assert.equal(res.status, 500);
      assert.equal(res.headers.get('x-request-id'), customId);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');

      const rawBody = await res.text();
      // Ensure raw response body does NOT contain any secret strings, passwords, or query internals
      assert.doesNotMatch(rawBody, /super_secret_password/i);
      assert.doesNotMatch(rawBody, /super_admin/i);
      assert.doesNotMatch(rawBody, /internal-db\.local/i);
      assert.doesNotMatch(rawBody, /secret_token_xyz/i);
      assert.doesNotMatch(rawBody, /SELECT \* FROM/i);
      assert.doesNotMatch(rawBody, /user_secrets/i);
      assert.doesNotMatch(rawBody, /at \S+:\d+:\d+/i, 'Stack trace must not leak to response');

      const body = JSON.parse(rawBody);
      const parsed = errorEnvelopeSchema.parse(body);
      assert.deepEqual(parsed, {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error.',
          requestId: customId,
        },
      });
    });
  });

  describe('6. Body Size Limits (413 PAYLOAD_TOO_LARGE)', () => {
    it('rejects request bodies larger than configured limit with 413 PAYLOAD_TOO_LARGE', async () => {
      // Configure app with 512-byte limit to test without massive buffer allocations
      const limitBytes = 512;
      const app = createApp(async () => {}, { bodyLimitBytes: limitBytes });

      app.post('/api/v1/test-upload', async (c) => {
        const body = await c.req.text();
        return c.json({ receivedBytes: body.length });
      });

      // 1. Smaller payload succeeds
      const smallRes = await app.request('/api/v1/test-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'a'.repeat(256),
      });
      assert.equal(smallRes.status, 200);

      // 2. Oversized payload rejected
      const oversizedRes = await app.request('/api/v1/test-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': '600',
        },
        body: 'a'.repeat(600),
      });

      assert.equal(oversizedRes.status, 413);
      const body = await oversizedRes.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'PAYLOAD_TOO_LARGE');
      assert.match(parsed.error.message, /payload exceeds maximum/i);
      assert.equal(parsed.error.requestId, oversizedRes.headers.get('x-request-id'));
    });

    it('enforces default 1 MiB (1,048,576 bytes) limit on standard app', async () => {
      const app = createApp(async () => {});
      app.post('/api/v1/test-default-limit', async (c) => {
        const data = await c.req.text();
        return c.json({ size: data.length });
      });

      const oversizedLength = 1024 * 1024 + 10; // 1,048,586 bytes
      const res = await app.request('/api/v1/test-default-limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': String(oversizedLength),
        },
        body: 'b'.repeat(100), // Declared content-length triggers immediate 413
      });

      assert.equal(res.status, 413);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'PAYLOAD_TOO_LARGE');
    });
  });

  describe('7. Request Deadline / Timeout Middleware (504 DEADLINE_EXCEEDED)', () => {
    it('aborts long-running requests exceeding deadline with HTTP 504 DEADLINE_EXCEEDED', async () => {
      // 50ms deadline configured for fast automated testing
      const app = createApp(async () => {}, { deadlineMs: 50 });

      app.get('/api/v1/slow-handler', async (c) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return c.json({ status: 'completed' });
      });

      const res = await app.request('/api/v1/slow-handler');
      assert.equal(res.status, 504);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'DEADLINE_EXCEEDED');
      assert.match(parsed.error.message, /deadline/i);
      assert.equal(parsed.error.requestId, res.headers.get('x-request-id'));
    });

    it('allows fast requests within deadline to succeed normally', async () => {
      const app = createApp(async () => {}, { deadlineMs: 1000 });

      app.get('/api/v1/fast-handler', (c) => {
        return c.json({ status: 'completed' });
      });

      const res = await app.request('/api/v1/fast-handler');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'completed' });
    });
  });

  describe('8. Custom HTTP Errors and Status Mappings', () => {
    it('maps 401 UNAUTHORIZED correctly', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/unauth', () => { throw unauthorized('Session expired.'); });

      const res = await app.request('/api/v1/unauth');
      assert.equal(res.status, 401);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'UNAUTHORIZED');
      assert.equal(parsed.error.message, 'Session expired.');
    });

    it('maps 403 FORBIDDEN correctly', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/forbidden', () => { throw forbidden('Viewer cannot trash card.'); });

      const res = await app.request('/api/v1/forbidden');
      assert.equal(res.status, 403);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'FORBIDDEN');
      assert.equal(parsed.error.message, 'Viewer cannot trash card.');
    });

    it('maps 409 CONFLICT with domain-specific codes (STALE_VERSION, STALE_CURSOR)', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/stale-version', () => {
        throw conflict('STALE_VERSION', 'Board has changed. Refresh before moving.', {
          currentBoardVersion: 7,
        });
      });

      const res = await app.request('/api/v1/stale-version');
      assert.equal(res.status, 409);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'STALE_VERSION');
      assert.equal(parsed.error.details?.['currentBoardVersion'], 7);
    });

    it('maps 410 RESTORE_WINDOW_EXPIRED with details', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/expired', () => {
        throw restoreWindowExpired('Restore window 24h expired.', {
          serverNow: '2026-10-26T00:00:00Z',
          restoreUntil: '2026-10-25T23:59:59Z',
        });
      });

      const res = await app.request('/api/v1/expired');
      assert.equal(res.status, 410);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'RESTORE_WINDOW_EXPIRED');
      assert.equal(parsed.error.details?.['serverNow'], '2026-10-26T00:00:00Z');
    });

    it('maps 429 TOO_MANY_REQUESTS and attaches Retry-After: 60 header', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/rate-limit', () => { throw tooManyRequests(); });

      const res = await app.request('/api/v1/rate-limit');
      assert.equal(res.status, 429);
      assert.equal(res.headers.get('Retry-After'), '60', 'Retry-After header must be 60 seconds');
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'TOO_MANY_REQUESTS');
    });

    it('maps 503 SERVICE_UNAVAILABLE / DATABASE_UNAVAILABLE safely', async () => {
      const app = createApp(async () => {});
      app.get('/api/v1/db-down', () => {
        throw serviceUnavailable('DATABASE_UNAVAILABLE', 'Database is unavailable.');
      });

      const res = await app.request('/api/v1/db-down');
      assert.equal(res.status, 503);
      const body = await res.json();
      const parsed = errorEnvelopeSchema.parse(body);
      assert.equal(parsed.error.code, 'DATABASE_UNAVAILABLE');
      assert.equal(parsed.error.message, 'Database is unavailable.');
    });
  });
});
