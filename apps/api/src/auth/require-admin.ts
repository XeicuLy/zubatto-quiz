import type { HttpError } from '@zubatto-quiz/protocol';
import { createMiddleware } from 'hono/factory';

import { createDb } from '@/db';

import { isAdminUser } from './allowlist';
import type { HostEnv } from './require-host';

/**
 * 管理者だけの経路の入口（ADR 0013）。requireHost のあとに置き、requireHost が決めた ownerId（Better Auth の user.id）で確かめる。
 *
 * 要求のたびに D1 を読み、キャッシュしない。管理者の印をコマンドで外せば、同じセッションでも次の要求から断る。
 * 管理者でないホストには 403 を返す。S1 の 404 は他人のものの ID を隠すための約束で、経路は GET /api/me と画面から分かるので隠さない
 */
export const requireAdmin = createMiddleware<HostEnv>(async (c, next) => {
  if (!(await isAdminUser(createDb(c.env.DB), c.get('ownerId')))) {
    return c.json({ error: 'forbidden' } satisfies HttpError, 403);
  }
  await next();
});
