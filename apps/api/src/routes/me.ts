import type { MeResponse } from '@zubatto-quiz/protocol';
import { Hono } from 'hono';

import { isAdminUser } from '@/auth/allowlist';
import { requireHost, type HostEnv } from '@/auth/require-host';
import { createDb } from '@/db';

/**
 * ログインしているホスト自身のことを返す HTTP API（ADR 0013）。応答の形は protocol の http/me.ts にある。
 *
 * 画面が管理者向けのリンクを出すかを決めるためのもので、守りの本体は管理者だけの経路の requireAdmin にある。
 * 状態を変えないので csrf() は置かず、requireHost だけを通す
 */
export const meRoutes = new Hono<HostEnv>().use(requireHost).get('/', async (c) => {
  const isAdmin = await isAdminUser(createDb(c.env.DB), c.get('ownerId'));
  return c.json({ isAdmin } satisfies MeResponse);
});
