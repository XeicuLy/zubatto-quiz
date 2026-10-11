import * as z from 'zod';

/**
 * HTTP API がエラーのときに返す本文。理由はコードだけで返し、項目ごとの説明は付けない。
 * 画面は送る前に同じ zod スキーマで確かめるので、サーバーの 400 は画面を通らない要求にだけ返る。
 *
 * 次の2つは Hono が自分でテキストを返し、この形にならない。正しい画面の要求では起きないので、画面は状態コードで見分ける
 * - csrf() が別のオリジンからのフォームの形の要求を断ったとき（403）
 * - 本文が JSON として読めないとき（400）
 */
export const httpErrorSchema = z.object({
  error: z.enum([
    /** ログインしていない、またはセッションが切れた（401） */
    'unauthorized',
    /** 入力が仕様に合わない（400） */
    'invalid_request',
    /** ない、または他人のもの。どちらかは区別しない（404, S1） */
    'not_found',
  ]),
});
export type HttpError = z.infer<typeof httpErrorSchema>;
