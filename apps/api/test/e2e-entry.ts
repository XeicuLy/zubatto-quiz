import { swaggerUI } from '@hono/swagger-ui';
import openapi from '@zubatto-quiz/protocol/openapi.json' with { type: 'json' };
import { Hono } from 'hono';

import { createDb } from '@/db';
import app from '@/index';

import { allowGithubUser, createTestAuth, insertGithubUser } from './auth/create-test-auth';
import { E2E_LOGIN_PATH } from './e2e-login-path';
import { SWAGGER_UI_PATH } from './swagger-path';

/**
 * E2E 専用の API の Worker の入口（ADR 0003）。wrangler.jsonc の env.e2e の main だけがこのファイルを指す。
 *
 * 本番の入口（src/index.ts）の app をそのまま通し、ホストのセッションを作る経路と、Swagger UI（ADR 0011）の経路を足すだけにする。
 * 本番の入口はこのファイルを import しないので、本番のバンドルにこれらの経路は入らない（test/bundle/production-bundle.test.ts）。
 * 実行時の環境変数で止める作りにはしない。設定の誤りひとつで、本番に抜け道が開くため
 */

// wrangler は main の export から DO のクラスを探す
export { RoomDurableObject } from '@/room/room-do';

const e2e = new Hono<{ Bindings: Env }>();

/**
 * 新しいホストを作り、そのログイン Cookie を返す。返す形は Playwright の context.addCookies にそのまま渡せる。
 * 呼ぶたびに別のホストにして、前の回の問題セットが見えないようにする。
 * セッションは本番と同じ Better Auth の設定で作るので、許可リストの確認（session.create.before）も通る。
 * 本文に { name } を渡すと、その名前にする（管理画面の右上に出る。使い方の画像に ID を写さない）。渡さなければ ID を名前にする
 */
e2e.post(E2E_LOGIN_PATH, async (c) => {
  const db = createDb(c.env.DB);
  const userId = crypto.randomUUID();
  const githubUserId = crypto.randomUUID();
  const body: unknown = await c.req.json().catch(() => ({}));
  const name =
    typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string'
      ? body.name
      : undefined;
  await insertGithubUser(db, { userId, githubUserId, name });
  await allowGithubUser(db, githubUserId);

  const { test } = await createTestAuth(c.env);
  const cookies = await test.getCookies({ userId, domain: new URL(c.env.BETTER_AUTH_URL).hostname });
  return c.json({ cookies });
});

/**
 * HTTP API の仕様（packages/protocol/schema/openapi.json）を Swagger UI で見て、試せるようにする（ADR 0011）。
 * 返す仕様は、Go 版と契約テストが読むのと同じコミットしたファイルで、ここでは作り直さない。
 * Swagger UI の本体は jsDelivr から読む。読むスクリプトが知らないうちに変わらないよう、版を固定する（Dependabot は上げないので手で上げる）。
 * /api/* の応答には _headers の CSP が付かないので、CDN とインラインのスクリプトも動く
 */
e2e.get(
  SWAGGER_UI_PATH,
  swaggerUI({ url: `${SWAGGER_UI_PATH}/openapi.json`, version: '5.34.1', title: 'ズバクイの HTTP API' }),
);
e2e.get(`${SWAGGER_UI_PATH}/openapi.json`, (c) => c.json(openapi));

e2e.route('/', app);

export default e2e;
