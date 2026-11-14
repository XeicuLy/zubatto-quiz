import { httpErrorSchema, type HttpError } from '@zubatto-quiz/protocol';

import { ApiError } from './errors';

/**
 * 同じオリジンの HTTP API（/api/*）を呼び、2xx 以外なら ApiError を投げる。本文のエラーのコードも読めたら持たせる。
 * 応答は呼ぶ側が protocol のスキーマで読む。Hono の RPC ではなく protocol のスキーマで読むので、
 * 画面は API の実装（Hono）に依存しない（ADR 0001）。
 *
 * Cookie は同じオリジンなので fetch が自動で付ける。csrf() は Origin と Sec-Fetch-Site で通す（ADR 0003・0006）
 */
export async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await errorCodeOf(response));
  }
  return response;
}

/** 本文が protocol のエラーの形なら、そのコードを返す。JSON でない本文（csrf() の 403 など）や違う形なら null */
async function errorCodeOf(response: Response): Promise<HttpError['error'] | null> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = httpErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : null;
}
