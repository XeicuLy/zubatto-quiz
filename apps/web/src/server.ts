/**
 * 画面の Worker の入口（ADR 0006）。
 *
 * wrangler.jsonc の run_worker_first で /api/* だけがここを通り、ほかの経路は静的アセット（SPA）が返す。
 * /api/ の下の要求は、Service binding で API の Worker へそのまま転送する。ブラウザからは同じオリジンに見えるので、
 * Cookie と Origin がそのまま届き、CORS は要らない。Go + Cloud Run へ移すときは、転送先だけを替える。
 */

/**
 * API の Worker へ転送する経路かを返す。
 *
 * API と WebSocket の経路は、すべて /api/ の下に置く（ADR 0006）。
 * /apis/health や /api-docs のように、/api で始まるだけの経路は転送しない。
 */
function isApiPath(pathname: string): boolean {
  // 末尾の / まで含めて比べる。'/api' で比べると '/apis/health' や '/api-docs' まで転送してしまう。
  // '/api' そのものも転送しない。run_worker_first（'/api/*'）も Worker に通さず、Hono の basePath('/api') にもその経路はない。
  //
  // pathname は new URL() が作った値なので、'/api/../admin' や '/api/%2e%2e/admin' の '..' は、ここに来る前に
  // '/admin' へ正規化されている。そのため、先頭を比べるだけで /api/ の外へ抜ける経路を転送することはない
  return pathname.startsWith('/api/');
}

export default {
  async fetch(request, env) {
    if (isApiPath(new URL(request.url).pathname)) {
      // 要求を作り直さずに渡す。Cookie・Origin・WebSocket の Upgrade のヘッダーと本文が、そのまま API の Worker に届く
      return env.API.fetch(request);
    }
    // run_worker_first の外の経路は、ふつうはここに来ない
    return new Response('見つかりません', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
