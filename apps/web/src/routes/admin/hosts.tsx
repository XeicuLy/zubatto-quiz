import { createFileRoute } from '@tanstack/react-router';

import { hostsQueryOptions } from '@/api/hosts';
import { HostsPage } from '@/features/hosts/HostsPage';
import { pageTitle } from '@/lib/page-title';
import { requireAdmin } from '@/shared/auth/require-admin';

/**
 * ホストの管理（ADR 0013）。管理者だけが開ける。親の /admin の requireHost のあとに requireAdmin が動き、
 * 管理者でなければ問題セットの一覧へ移す。画面を隠すだけで、守りは API の requireAdmin にある。
 * タイトルにホストの名前は入れない（S3）
 */
export const Route = createFileRoute('/admin/hosts')({
  head: () => pageTitle('ホストの管理'),
  beforeLoad: requireAdmin,
  // 先に読んでおく。失敗は捨てる。ログインが切れた（401）などは、エラーの画面ではなく一覧の場所で知らせる
  loader: async ({ context }) => {
    await context.queryClient.query(hostsQueryOptions).catch(() => undefined);
  },
  component: HostsPage,
});
