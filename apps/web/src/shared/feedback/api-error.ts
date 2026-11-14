import { ApiError } from '@/api/errors';

/**
 * 失敗の種類。画面は、この種類で文と導線を選ぶ（ActionError・LoadErrorCard）。
 * - unauthorized: ログインが切れた（401）。ログインし直す導線を出す
 * - notFound: ない、または他人のもの（404, S1）
 * - conflict: ほかの操作とぶつかった（409）
 * - unavailable: 届かなかった、またはサーバーの失敗（5xx）。やり直せば通るかもしれない
 * - other: それ以外（400・403、応答の形の誤りなど）。やり直しても同じ答えが来る
 */
export type ApiErrorKind = 'unauthorized' | 'notFound' | 'conflict' | 'unavailable' | 'other';

/**
 * 失敗を種類に分ける純粋な関数。状態コードで分け、本文の code（ApiError.code）は見ない。
 * 同じ状態コードの中を分けるのは、呼ぶ側が code を見て決める
 */
export function describeApiError(error: unknown): ApiErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'unauthorized';
    if (error.status === 404) return 'notFound';
    if (error.status === 409) return 'conflict';
    if (error.status >= 500) return 'unavailable';
    return 'other';
  }
  // fetch は、届かなかったとき（オフライン、DNS、接続の切断）に TypeError で失敗する
  if (error instanceof TypeError) return 'unavailable';
  return 'other';
}
