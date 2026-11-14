import type { HttpError } from '@zubatto-quiz/protocol';
import { createMiddleware } from 'hono/factory';

import { createDb } from '@/db';

import { isAllowedSession } from './allowlist';
import { createAuth } from './create-auth';

/** requireHost を通った経路で使える値。ownerId は問題セットと部屋を絞るのに使う（ADR 0002・0003） */
export type HostEnv = { Bindings: Env; Variables: { ownerId: string } };

/**
 * ホスト用の API の入口で、ログイン Cookie のセッションから ownerId を決める（S1・ADR 0003）。
 *
 * ownerId は Better Auth の user.id にする（GitHub のユーザー ID ではない。ADR 0003 の I1）。
 *
 * セッションがあっても、許可リストにあることと、セッションがその行より後に作られたことを、要求のたびに確かめ直す（ADR 0013）。
 * 画面から外しても、コマンドで許可リストの行だけを外しても、次の要求から通らない。足し直しても、外す前のセッションは通らない。
 * 通らなければ、セッションがないときと同じ 401 にする。getSession も D1 を読むので、増えるクエリは1つ。
 * ホスト用の WebSocket は、つなぐときにだけここを通る（進行中の操作では確かめない。P1）
 */
export const requireHost = createMiddleware<HostEnv>(async (c, next) => {
  const result = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!result || !(await isAllowedSession(createDb(c.env.DB), result.user.id, result.session.createdAt))) {
    return c.json({ error: 'unauthorized' } satisfies HttpError, 401);
  }
  c.set('ownerId', result.user.id);
  await next();
});
