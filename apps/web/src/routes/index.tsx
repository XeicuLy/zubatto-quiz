import { createFileRoute } from '@tanstack/react-router';

import { hostSessionQueryOptions } from '@/api/host-session';
import { LandingPage } from '@/features/landing/LandingPage';
import { pageTitle } from '@/lib/page-title';

/**
 * 入口（#294）。ログインせずに開ける。セッションは、ログインのボタンと「問題セットへ」を出し分けるためだけに読む。
 * 読めなくても入口は出したいので、エラーの画面にせず、ログインしていないとして扱う。ログイン済みでも /admin へは移さない
 */
export const Route = createFileRoute('/')({
  head: () => pageTitle('はじめに'),
  loader: async ({ context }) => {
    const host = await context.queryClient.query(hostSessionQueryOptions).catch(() => null);
    return { signedIn: host !== null };
  },
  component: TopRoute,
});

function TopRoute() {
  const { signedIn } = Route.useLoaderData();
  return (
    <div className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <LandingPage signedIn={signedIn} />
    </div>
  );
}
