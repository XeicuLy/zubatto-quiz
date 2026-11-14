import { Hono } from 'hono';

import app from '@/index';

import { addSwaggerRoutes } from './swagger-routes';

/**
 * vite dev 専用の API の Worker の入口。apps/web の api-worker.ts が、vite dev のときだけ main をこのファイルに替える。
 *
 * 本番の入口（src/index.ts）の app をそのまま通し、Swagger UI（ADR 0011）の経路だけを足す。
 * ログインは本物の GitHub のものを使うので、E2E 用のログインの経路（e2e-entry.ts）は足さない。
 * wrangler.jsonc の main と Worker の名前は変えないので、wrangler deploy でこのファイルがバンドルされることはなく、
 * 開発のデータ（.wrangler/state の D1 と部屋の DO）の置き場所も変わらない（test/bundle/production-bundle.test.ts）
 */

// wrangler は main の export から DO のクラスを探す
export { RoomDurableObject } from '@/room/room-do';

const dev = new Hono<{ Bindings: Env }>();

addSwaggerRoutes(dev);

dev.route('/', app);

export default dev;
