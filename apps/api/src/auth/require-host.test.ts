import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { account, hostAllowlist, session, user } from '@/db/schema';

import { allowGithubUser, createTestAuth, insertGithubUser } from '../../test/auth/create-test-auth';
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

  describe('許可リストの確かめ直し（ADR 0013）', () => {
    /** alice を許可リストに入れてログインし、その Cookie を返す */
    async function loginAlice() {
      await insertGithubUser(db, { userId: 'alice', githubUserId: '1001' });
      await allowGithubUser(db, '1001');
      const { test } = await createTestAuth(env);
      return test.getAuthHeaders({ userId: 'alice' });
    }
    const removeAlice = () => db.delete(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'));

    it('コマンドで許可リストの行だけを外すと、残ったセッションでも次の要求から 401 になる', async () => {
      const headers = await loginAlice();
      expect((await request(headers)).status).toBe(200);

      await removeAlice();

      const response = await request(headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    });

    it('行を外して足し直しても、外す前のセッションは 401 のまま。足し直したあとのログインは通る', async () => {
      const before = await loginAlice();
      await removeAlice();
      await allowGithubUser(db, '1001');
      // 同じミリ秒に足し直したときにも揺れないよう、外す前のセッションを、足し直した行より1ミリ秒前に作られたことにする
      const row = await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001')).get();
      await db
        .update(session)
        .set({ createdAt: new Date((row?.createdAt.getTime() ?? 0) - 1) })
        .where(eq(session.userId, 'alice'));

      expect((await request(before)).status).toBe(401);

      const { test } = await createTestAuth(env);
      const after = await test.getAuthHeaders({ userId: 'alice' });
      expect((await request(after)).status).toBe(200);
    });

    it('行と同じミリ秒に作られたセッションは通す（足した直後のログイン）', async () => {
      const headers = await loginAlice();
      const row = await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001')).get();
      await db.update(session).set({ createdAt: row?.createdAt }).where(eq(session.userId, 'alice'));

      expect((await request(headers)).status).toBe(200);
    });

    it('ほかのログイン方法の account は、ID が許可リストと同じでも通さない', async () => {
      const headers = await loginAlice();
      await db.update(account).set({ providerId: 'other' }).where(eq(account.userId, 'alice'));

      expect((await request(headers)).status).toBe(401);
    });
  });
});
