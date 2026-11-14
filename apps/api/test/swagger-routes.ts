import { swaggerUI } from '@hono/swagger-ui';
import openapi from '@zubatto-quiz/protocol/openapi.json' with { type: 'json' };
import type { Hono } from 'hono';

import { SWAGGER_UI_PATH } from './swagger-path';

/**
 * HTTP API の仕様（packages/protocol/schema/openapi.json）を Swagger UI で見て、試せるようにする（ADR 0011）。
 * テスト専用の入口（e2e-entry.ts）と開発の入口（dev-entry.ts）が呼ぶ。本番の入口（src/index.ts）からは呼ばない。
 *
 * 返す仕様は、Go 版と契約テストが読むのと同じコミットしたファイルで、ここでは作り直さない。
 * Swagger UI の本体は jsDelivr から読む。読むスクリプトが知らないうちに変わらないよう、版を固定する（Dependabot は上げないので手で上げる）。
 * /api/* の応答には _headers の CSP が付かないので、CDN とインラインのスクリプトも動く
 */
export function addSwaggerRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get(
    SWAGGER_UI_PATH,
    swaggerUI({ url: `${SWAGGER_UI_PATH}/openapi.json`, version: '5.34.1', title: 'ズバクイの HTTP API' }),
  );
  app.get(`${SWAGGER_UI_PATH}/openapi.json`, (c) => c.json(openapi));
}
