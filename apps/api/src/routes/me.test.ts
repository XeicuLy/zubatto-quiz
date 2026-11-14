import { meResponseSchema } from '@zubatto-quiz/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiRequest, apiRequestAs, resetHosts } from '../../test/host-request';

beforeEach(resetHosts);

describe('GET /api/me（ADR 0013）', () => {
  it('ログインしていなければ 401 を返す', async () => {
    const response = await apiRequest('/me');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('管理者でないホストには isAdmin: false を返す', async () => {
    const response = await apiRequestAs('alice', 'GET', '/me');

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json())).toEqual({ isAdmin: false });
  });

  it('管理者のホストには isAdmin: true を返す', async () => {
    const response = await apiRequestAs('admin', 'GET', '/me');

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json())).toEqual({ isAdmin: true });
  });
});
