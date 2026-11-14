import { httpErrorSchema } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { describeApiError } from './api-error';

describe('describeApiError', () => {
  it.each([
    [401, 'unauthorized'],
    [404, 'notFound'],
    [409, 'conflict'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [400, 'other'],
    [403, 'other'],
  ] as const)('API の %i は %s', (status, kind) => {
    expect(describeApiError(new ApiError(status))).toBe(kind);
  });

  it('fetch が届かなかった（TypeError）なら unavailable。やり直せば通るかもしれない', () => {
    expect(describeApiError(new TypeError('Failed to fetch'))).toBe('unavailable');
  });

  it('応答が protocol のスキーマに合わない（ZodError）なら other。やり直しても同じ応答が来る', () => {
    const result = httpErrorSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(describeApiError(result.error)).toBe('other');
  });

  it('ApiError でないほかの失敗（ログアウトの失敗など）は other', () => {
    expect(describeApiError(new Error('ログアウトできなかった（500）'))).toBe('other');
  });
});
