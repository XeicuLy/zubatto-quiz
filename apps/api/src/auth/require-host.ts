import { createMiddleware } from 'hono/factory';

import { createAuth } from './create-auth';

/** requireHost を通った経路で使える値。ownerId は問題セットと部屋を絞るのに使う（ADR 0002・0003） */
export type HostEnv = { Bindings: Env; Variables: { ownerId: string } };

/**
 * ホスト用の API の入口で、ログイン Cookie のセッションから ownerId を決める（S1・ADR 0003）。
 *
 * ownerId は Better Auth の user.id にする（GitHub のユーザー ID ではない。ADR 0003 の I1）。
 * 許可リストはセッションを作るときに確かめているので、ここでは確かめ直さない。
 * ホストを取り消すときは、許可リストから外したうえで、そのホストのセッションを D1 から消す（README の手順書）。
 */
export const requireHost = createMiddleware<HostEnv>(async (c, next) => {
  const result = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!result) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('ownerId', result.user.id);
  await next();
});
