import { createFileRoute, redirect } from '@tanstack/react-router';

import { hostSessionQueryOptions } from '@/api/host-session';
import { LoginPage } from '@/features/admin/LoginPage';
import { pageTitle } from '@/lib/page-title';

interface LoginSearch {
  /** GitHub のログインに失敗して戻ってきたときに、Better Auth が付ける理由 */
  error?: string;
}

/** ホストのログイン（T29・ADR 0003）。管理画面をログインせずに開くと、ここへ移る */
export const Route = createFileRoute('/login')({
  head: () => pageTitle('ログイン'),
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.error === 'string' ? { error: search.error } : {},
  beforeLoad: async ({ context }) => {
    // 覚えた値は使わず、毎回確かめる。ログインが切れて移ってきたときに、前のセッションで管理画面へ戻さない
    const host = await context.queryClient.query(hostSessionQueryOptions);
    if (host) {
      throw redirect({ to: '/admin' });
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { error } = Route.useSearch();
  return (
    <div className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <LoginPage error={error} />
    </div>
  );
}
