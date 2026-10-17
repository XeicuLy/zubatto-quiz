import { Hono } from 'hono';

import { createDb } from '../src/db';
import app from '../src/index';
import { allowGithubUser, createTestAuth, insertGithubUser } from './auth/create-test-auth';
import { E2E_LOGIN_PATH } from './e2e-login-path';

/**
 * E2E 専用の API の Worker の入口（ADR 0003）。wrangler.jsonc の env.e2e の main だけがこのファイルを指す。
 *
 * 本番の入口（src/index.ts）の app をそのまま通し、ホストのセッションを作る経路を1つ足すだけにする。
 * 本番の入口はこのファイルを import しないので、本番のバンドルにこの経路は入らない（test/bundle/production-bundle.test.ts）。
 * 実行時の環境変数で止める作りにはしない。設定の誤りひとつで、本番に抜け道が開くため
 */

// wrangler は main の export から DO のクラスを探す
export { RoomDurableObject } from '../src/room/room-do';

const e2e = new Hono<{ Bindings: Env }>();

/**
 * 新しいホストを作り、そのログイン Cookie を返す。返す形は Playwright の context.addCookies にそのまま渡せる。
 * 呼ぶたびに別のホストにして、前の回の問題セットが見えないようにする。
 * セッションは本番と同じ Better Auth の設定で作るので、許可リストの確認（session.create.before）も通る
 */
e2e.post(E2E_LOGIN_PATH, async (c) => {
  const db = createDb(c.env.DB);
  const userId = crypto.randomUUID();
  const githubUserId = crypto.randomUUID();
  await insertGithubUser(db, { userId, githubUserId });
  await allowGithubUser(db, githubUserId);

  const { test } = await createTestAuth(c.env);
  const cookies = await test.getCookies({ userId, domain: new URL(c.env.BETTER_AUTH_URL).hostname });
  return c.json({ cookies });
});

e2e.route('/', app);

export default e2e;
