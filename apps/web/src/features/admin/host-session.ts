import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';

import { fetchHostSession, type HostSession } from '../../lib/auth-client';

/**
 * ログインしているホスト。上の帯の名前に使う。
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
 * 覚えた値は使わず、移るたびに確かめ直す（staleTime は既定の0なので、query は毎回読む）。
 * 別のタブでログアウトしたり、サーバーでセッションが切れたりしたあとに、覚えた値のまま管理画面の中を移れて、
 * 前に読んだ一覧が見えてしまわないようにする。
 * そのぶん移るたびに get-session を1回呼ぶが、管理画面の中を移る回数は少ない。
 *
 * これは、ホスト以外に管理画面を見せないためのもの。守りの本体は API の requireHost で、
 * ここを抜けても、問題セットも部屋も読めない
 */
export async function requireHost({ context }: { context: { queryClient: QueryClient } }): Promise<{
  host: HostSession;
}> {
  const host = await context.queryClient.query(hostSessionQueryOptions);
  if (!host) {
    throw redirect({ to: '/login' });
  }
  return { host };
}
