import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  createErrorPayload,
  httpStatusForErrorCode,
  isClientError,
  decodeCursor,
  encodeCursor,
  cursorPageRequestSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  validate,
  formatIssuePath,
  z,
  INITIAL_REVISION,
  isRevisionStale,
  nextRevision,
} from '../src/index.js';

describe('error contract', () => {
  it('maps every client-facing code to a 4xx, never a 500', () => {
    const clientCodes = [
      ERROR_CODES.VALIDATION_FAILED,
      ERROR_CODES.MALFORMED_REQUEST,
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      ERROR_CODES.UNAUTHENTICATED,
      ERROR_CODES.FORBIDDEN,
      ERROR_CODES.NOT_FOUND,
      ERROR_CODES.CONFLICT,
      ERROR_CODES.STALE_REVISION,
      ERROR_CODES.RATE_LIMITED,
      ERROR_CODES.QUOTA_EXCEEDED,
    ];

    for (const code of clientCodes) {
      const status = httpStatusForErrorCode(code);
      expect(status, `${code} must be 4xx`).toBeGreaterThanOrEqual(400);
      expect(status, `${code} must be 4xx`).toBeLessThan(500);
      expect(isClientError(code)).toBe(true);
    }
  });

  it('maps a stale revision to 409, per the concurrency contract', () => {
    expect(httpStatusForErrorCode(ERROR_CODES.STALE_REVISION)).toBe(409);
  });

  it('builds an envelope carrying code, message, and correlation id', () => {
    const payload = createErrorPayload(ERROR_CODES.NOT_FOUND, 'Resource not found', 'req-1');
    expect(payload.error.code).toBe('not_found');
    expect(payload.error.requestId).toBe('req-1');
    expect(payload.error.details).toBeUndefined();
  });

  it('omits an empty details array rather than emitting a useless key', () => {
    const payload = createErrorPayload(ERROR_CODES.VALIDATION_FAILED, 'Invalid', 'req-2', []);
    expect(payload.error.details).toBeUndefined();
  });

  it('includes field details when present', () => {
    const payload = createErrorPayload(ERROR_CODES.VALIDATION_FAILED, 'Invalid', 'req-3', [
      { path: 'email', message: 'Required' },
    ]);
    expect(payload.error.details).toHaveLength(1);
  });
});

describe('validation', () => {
  const schema = z.object({
    email: z.string().email(),
    profile: z.object({ age: z.number().int().min(0) }),
    tags: z.array(z.string()),
  });

  it('returns typed data on success', () => {
    const result = validate(schema, {
      email: 'a@example.invalid',
      profile: { age: 3 },
      tags: ['x'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe('a@example.invalid');
  });

  it('turns a schema failure into field errors rather than throwing', () => {
    const result = validate(schema, { email: 'nope', profile: { age: -1 }, tags: 'no' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((error) => error.path);
      expect(paths).toContain('email');
      expect(paths).toContain('profile.age');
      expect(paths).toContain('tags');
    }
  });

  it('renders array indices in issue paths', () => {
    expect(formatIssuePath(['tags', 0, 'name'])).toBe('tags[0].name');
    expect(formatIssuePath([])).toBe('');
    expect(formatIssuePath(['email'])).toBe('email');
  });

  it('never throws on malformed input, so bad input cannot become a 500', () => {
    for (const input of [undefined, null, 42, 'string', [], Symbol('x')]) {
      expect(() => validate(schema, input)).not.toThrow();
      expect(validate(schema, input).ok).toBe(false);
    }
  });
});

describe('cursor pagination', () => {
  it('round-trips an opaque cursor', () => {
    const position = { occurredAt: '2026-08-28T00:00:00.000Z', id: 'abc123' };
    const decoded = decodeCursor(encodeCursor(position));
    expect(decoded).toEqual(position);
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('not json').toString('base64url'))).toBeNull();
  });

  it('applies the default page size and requires an explicit sort', () => {
    const parsed = cursorPageRequestSchema.safeParse({
      sort: [{ field: 'createdAt', direction: 'desc' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(DEFAULT_PAGE_SIZE);

    expect(cursorPageRequestSchema.safeParse({ sort: [] }).success).toBe(false);
  });

  it('rejects a page size above the maximum', () => {
    const parsed = cursorPageRequestSchema.safeParse({
      limit: MAX_PAGE_SIZE + 1,
      sort: [{ field: 'createdAt', direction: 'desc' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('optimistic concurrency', () => {
  it('detects a stale write', () => {
    expect(isRevisionStale(5, { expectedRevision: 4 })).toBe(true);
    expect(isRevisionStale(5, { expectedRevision: 5 })).toBe(false);
  });

  it('increments monotonically from the initial revision', () => {
    expect(INITIAL_REVISION).toBe(1);
    expect(nextRevision(INITIAL_REVISION)).toBe(2);
  });
});
