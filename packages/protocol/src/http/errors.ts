import * as z from 'zod';

/**
 * HTTP API がエラーのときに返す本文。理由はコードだけで返し、項目ごとの説明は付けない。
 * 画面は送る前に同じ zod スキーマで確かめるので、サーバーの 400 は画面を通らない要求にだけ返る。
 *
 * 次の2つは Hono が自分でテキストを返し、この形にならない。正しい画面の要求では起きないので、画面は状態コードで見分ける
 * - csrf() が別のオリジンからのフォームの形の要求を断ったとき（403）
 * - 本文が JSON として読めないとき（400）
 *
 * 管理者だけの経路では、管理者でないときの 403 forbidden（この形）と csrf() の 403（テキスト）が並ぶ。本文の形で見分ける（ADR 0014）
 */
export const httpErrorSchema = z.object({
  error: z.enum([
    /** ログインしていない、またはセッションが切れた（401） */
    'unauthorized',
    /** 管理者だけの経路に、管理者でないホストが来た（403, ADR 0013） */
    'forbidden',
    /** 入力が仕様に合わない（400） */
    'invalid_request',
    /** ない、または他人のもの。どちらかは区別しない（404, S1）。ホストの追加では、GitHub にその名前の User がない */
    'not_found',
    /** 足そうとしたホストが、すでに許可リストにいる（409, ADR 0013） */
    'already_exists',
    /** 管理者のホストは、画面から外せない。印はコマンドで外す（409, ADR 0013） */
    'admin_host',
    /** GitHub が答えなかった（403・429・5xx・時間切れ・形の違う応答）。時間をおいて入れ直す（502, ADR 0013） */
    'github_unavailable',
  ]),
});
export type HttpError = z.infer<typeof httpErrorSchema>;
