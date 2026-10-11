import { createFileRoute } from '@tanstack/react-router';

// ホストのログインと問題セットの一覧（T29）
export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

function AdminPage() {
  return (
    <main className="min-h-dvh bg-backstage px-6 py-16 text-backstage-ink">
      <h1 className="text-xl font-bold">ホストの管理画面</h1>
    </main>
  );
}
