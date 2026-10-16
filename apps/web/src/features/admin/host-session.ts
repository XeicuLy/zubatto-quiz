import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';

import { fetchHostSession, type HostSession } from '../../lib/auth-client';

/**
 * ログインしているホスト。管理画面の中を移るたびに読み直さないよう、TanStack Query に覚えておく。
 * ログアウトでは queryClient.clear() で捨てる。GitHub から戻るときはページを読み直すので、覚えた値は残らない
 */
export const hostSessionQueryOptions = queryOptions({
  queryKey: ['host-session'],
  queryFn: fetchHostSession,
});

/**
 * ホストだけが開ける経路の beforeLoad（S1）。ログインしていなければログイン画面へ移す。
 * 返した host は、その経路と子の経路の context に入る。
 *
 * これは、ホスト以外に管理画面を見せないためのもの。守りの本体は API の requireHost で、
 * ここを抜けても、問題セットも部屋も読めない
 */
export async function requireHost({ context }: { context: { queryClient: QueryClient } }): Promise<{
  host: HostSession;
}> {
  const host = await context.queryClient.ensureQueryData(hostSessionQueryOptions);
  if (!host) {
    throw redirect({ to: '/login' });
  }
  return { host };
}
