import { Hono } from 'hono';
import type { RouterRoute } from 'hono/types';
import { describe, expect, it } from 'vitest';

import app from '@/index';

// openapi.json は protocol の zod から書き出したもの（ADR 0011）。packages/protocol は exports に載せていないので、ファイルを直に読む
import openapi from '../../../packages/protocol/schema/openapi.json';

/**
 * openapi.json に書かない経路と、その理由。`<小文字のメソッド> <OpenAPI の書き方の経路>` で持つ。
 * 足すときは理由を書き、消したルートの行は消す（残っていると、下のテストが落ちる）
 */
const NOT_IN_SPEC: Record<string, string> = {
  'get /api/health': '死活確認だけの経路で、画面からは呼ばない',
  'get /api/auth/*': 'Better Auth の経路で、形は Better Auth が決める（ADR 0003）',
  'post /api/auth/*': 'Better Auth の経路で、形は Better Auth が決める（ADR 0003）',
  'get /api/rooms/{roomId}/ws/host': 'WebSocket の入口で、メッセージの形は ws.schema.json に書く',
  'get /api/rooms/{roomId}/ws/play': 'WebSocket の入口で、メッセージの形は ws.schema.json に書く',
};

/** OpenAPI 3.1 の Path Item で、操作を表すキー。parameters・summary などはこれ以外 */
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Hono のルートを `get /api/question-sets/{id}` の形にそろえる。
 * app.routes には .use() のミドルウェアが ALL として、ハンドラーの前のバリデーターが同じ操作のもう1行として入るので、
 * ALL を除き、Set で重なりをまとめる
 */
function routeOperations(routes: readonly RouterRoute[]): Set<string> {
  return new Set(
    routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method.toLowerCase()} ${route.path.replace(/:(\w+)/g, '{$1}')}`),
  );
}

/** openapi.json の paths を `get /api/question-sets/{id}` の形にする。parameters などのメソッドでないキーは除く */
function specOperations(paths: Record<string, object>): Set<string> {
  return new Set(
    Object.entries(paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => HTTP_METHODS.has(key))
        .map((method) => `${method} ${path}`),
    ),
  );
}

/** ルートと仕様の、片方にしかない操作を並べる。除外した操作はルートの側から外す */
function diffRoutes(routes: readonly RouterRoute[], paths: Record<string, object>, excluded: readonly string[]) {
  const inApp = [...routeOperations(routes)].filter((operation) => !excluded.includes(operation));
  const inSpec = [...specOperations(paths)];
  return {
    missingInSpec: inApp.filter((operation) => !inSpec.includes(operation)).sort(),
    missingInApp: inSpec.filter((operation) => !inApp.includes(operation)).sort(),
  };
}

describe('ルートと openapi.json の経路', () => {
  it('同じ操作を持つ（状態コードは見ない）', () => {
    expect(
      diffRoutes(app.routes, openapi.paths, Object.keys(NOT_IN_SPEC)),
      'ルートと openapi.json がずれている。ルートを足したか消したら packages/protocol/src/openapi.ts も直し、pnpm --filter @zubatto-quiz/protocol run schema で書き出す。仕様に書かない経路なら NOT_IN_SPEC に理由と足す',
    ).toEqual({ missingInSpec: [], missingInApp: [] });
  });

  it('除外した経路は、どれも実際のルートにある', () => {
    const operations = routeOperations(app.routes);
    expect(Object.keys(NOT_IN_SPEC).filter((operation) => !operations.has(operation))).toEqual([]);
  });
});

describe('diffRoutes', () => {
  const paths = { '/api/items/{id}': { parameters: [], get: {}, delete: {} } };

  it('ルートを足して仕様に書き忘れたら、missingInSpec に出る', () => {
    const routes = new Hono()
      .basePath('/api')
      .get('/items/:id', (c) => c.body(null))
      .delete('/items/:id', (c) => c.body(null))
      .post('/items', (c) => c.body(null)).routes;

    expect(diffRoutes(routes, paths, [])).toEqual({ missingInSpec: ['post /api/items'], missingInApp: [] });
  });

  it('仕様にあってルートにない操作は、missingInApp に出る', () => {
    const routes = new Hono().basePath('/api').get('/items/:id', (c) => c.body(null)).routes;

    expect(diffRoutes(routes, paths, [])).toEqual({ missingInSpec: [], missingInApp: ['delete /api/items/{id}'] });
  });

  it('ミドルウェアと、同じ操作の重なり（バリデーターの分）は数えず、除外した操作は外す', () => {
    const routes = new Hono()
      .basePath('/api')
      .use(async (_c, next) => next())
      .get('/health', (c) => c.body(null))
      .get(
        '/items/:id',
        async (_c, next) => next(),
        (c) => c.body(null),
      )
      .delete('/items/:id', (c) => c.body(null)).routes;

    expect(diffRoutes(routes, paths, ['get /api/health'])).toEqual({ missingInSpec: [], missingInApp: [] });
  });
});
