import type { HttpError } from '@zubatto-quiz/protocol';

/**
 * API が 2xx 以外を返した。401 はログインが切れた、404 はない（または他人の）セット。
 * code は応答の本文の error（protocol の httpErrorSchema）で、読めたときだけ入る。
 * csrf() の 403 のように Hono が自分でテキストを返す応答では null になるので、まず status で見分ける
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: HttpError['error'] | null = null,
  ) {
    super(`API が ${status} を返した`);
    this.name = 'ApiError';
  }
}
