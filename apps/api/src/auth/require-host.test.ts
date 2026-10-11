import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { allowGithubUser, createTestAuth, insertGithubUser } from '../../test/auth/create-test-auth';
import { createDb } from '../db';
import { hostAllowlist, user } from '../db/schema';
import { requireHost, type HostEnv } from './require-host';

const db = createDb(env.DB);

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

// ミドルウェアが決めた ownerId を、そのまま返す経路
const app = new Hono<HostEnv>().get('/owner', requireHost, (c) => c.json({ ownerId: c.get('ownerId') }));
const request = (headers?: HeadersInit) => app.request('/owner', { headers }, env);

describe('requireHost（ADR 0003）', () => {
  it('ログイン Cookie がなければ 401 を返し、次へ進まない', async () => {
    const response = await request();

    expect(response.status).toBe(401);
  });

  it('壊れたログイン Cookie なら 401 を返す', async () => {
    const response = await request({ cookie: 'better-auth.session_token=forged' });

    expect(response.status).toBe(401);
  });

  it('ownerId を Better Auth の user.id にする', async () => {
    await insertGithubUser(db, { userId: 'alice', githubUserId: '1001' });
    await allowGithubUser(db, '1001');
    const { test } = await createTestAuth(env);
    const headers = await test.getAuthHeaders({ userId: 'alice' });

    const response = await request(headers);

    expect(response.status).toBe(200);
    // GitHub のユーザー ID（1001）ではなく、Better Auth の user.id を使う（ADR 0003 の I1）
    expect(await response.json()).toEqual({ ownerId: 'alice' });
  });
});
