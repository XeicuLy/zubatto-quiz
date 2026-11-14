import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { hostAllowlist } from '@/db/schema';

import { loginAs, resetHosts } from '../../test/host-request';
import { requireAdmin } from './require-admin';
import { requireHost, type HostEnv } from './require-host';

beforeEach(resetHosts);

// 本番の管理者だけの経路と同じ順に、requireHost のあとに置く
const app = new Hono<HostEnv>().get('/admin', requireHost, requireAdmin, (c) => c.json({ ownerId: c.get('ownerId') }));
const request = (headers?: HeadersInit) => app.request('/admin', { headers }, env);
const requestAs = async (userId: string) => request(await loginAs(userId));

describe('requireAdmin（ADR 0013）', () => {
  it('ログインしていなければ、requireHost が 401 を返す', async () => {
    const response = await request();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('管理者でないホストには 403 forbidden を返し、次へ進まない', async () => {
    const response = await requestAs('alice');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('管理者のホストは通る', async () => {
    const response = await requestAs('admin');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId: 'admin' });
  });

  it('管理者の印をコマンドで外すと、同じセッションでも次の要求から 403 になる', async () => {
    const headers = await loginAs('admin');
    expect((await request(headers)).status).toBe(200);

    await createDb(env.DB).update(hostAllowlist).set({ isAdmin: false }).where(eq(hostAllowlist.githubUserId, '1000'));

    expect((await request(headers)).status).toBe(403);
  });
});
