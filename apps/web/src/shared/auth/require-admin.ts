import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';

import { meQueryOptions } from '@/api/me';
import { describeApiError } from '@/shared/feedback/api-error';

/**
 * 管理者だけが開ける経路の beforeLoad（ADR 0013）。/admin の下に置くので、親の requireHost が先に通っている。
 * 管理者でなければ、問題セットの一覧（/admin）へ移す。
 *
 * requireHost と同じく、覚えた値は使わず、移るたびに /api/me を読み直す。管理者の印はコマンドでいつでも外せるため。
 * requireHost を通ったあとでセッションが切れていたら（401）、ログイン画面へ移す。それ以外の失敗は投げ、エラーの画面を出す。
 *
 * これは画面を隠すだけで、守りの本体は API の requireAdmin。ここを抜けても、一覧も追加も外すも 403 で断られる
 */
export async function requireAdmin({ context }: { context: { queryClient: QueryClient } }): Promise<void> {
  const me = await context.queryClient.query(meQueryOptions).catch((error: unknown) => {
    if (describeApiError(error) === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    throw error;
  });
  if (!me.isAdmin) {
    throw redirect({ to: '/admin' });
  }
}
