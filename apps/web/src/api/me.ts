import { queryOptions } from '@tanstack/react-query';
import { meResponseSchema, type MeResponse } from '@zubatto-quiz/protocol';

import { request, retryUnlessClientError } from './request';

/**
 * ログインしているホスト自身のこと（GET /api/me、ADR 0013）。応答の形は protocol の http/me.ts にある。
 * isAdmin は、管理者向けのリンクを出すか、/admin/hosts を開かせるかを決めるだけ。守りは API の requireAdmin にある
 */
export async function fetchMe(): Promise<MeResponse> {
  const response = await request('GET', '/api/me');
  return meResponseSchema.parse(await response.json());
}

/**
 * 管理画面の帯（useQuery）と /admin/hosts の beforeLoad（queryClient.query）が読む。
 * staleTime は既定の0のままにし、beforeLoad では移るたびに読み直す。管理者の印は、コマンドでいつでも外せるため。
 * ログアウトでは queryClient.clear() で捨てるので、次にログインしたホストに前の値は残らない
 */
export const meQueryOptions = queryOptions({
  queryKey: ['me'],
  queryFn: fetchMe,
  retry: retryUnlessClientError,
});
