import { createFileRoute } from '@tanstack/react-router';

import { AdminLayout } from '../../features/admin/AdminLayout';
import { requireHost } from '../../features/admin/host-session';

/**
 * ホストの管理画面（T29）。/admin の下の経路は、すべてここでログインを確かめる（S1）。
 * ログインしていなければ、子の経路の loader が動く前にログイン画面へ移る
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: requireHost,
  component: AdminRoute,
});

function AdminRoute() {
  return <AdminLayout host={Route.useRouteContext().host} />;
}
