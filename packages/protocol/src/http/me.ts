import * as z from 'zod';

/**
 * ログインしているホスト自身のことを返す HTTP API（/api/me）の応答の形（ADR 0013）。ホストだけが使える（S1）。
 *
 * - GET /api/me  → 200 MeResponse
 *
 * 画面が、管理者向けのリンクを出すかを決めるのに使う。画面の出し分けは見た目だけで、守りは API の requireAdmin にある
 */
export const meResponseSchema = z.object({
  /** 管理者のホストか。管理者だけが、ホストの一覧・追加・外すをできる */
  isAdmin: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
