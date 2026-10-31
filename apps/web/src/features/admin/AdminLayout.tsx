import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { signOut, type HostSession } from '../../lib/auth-client';

interface AdminLayoutProps {
  host: HostSession;
}

/** 管理画面（楽屋）の枠。上の帯にホストの名前とログアウトを置き、中に子の経路を出す */
export function AdminLayout({ host }: AdminLayoutProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function logout() {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
      setSignOutFailed(true);
      return;
    }
    // セッションと問題セットの一覧を、覚えた値ごと捨てる。残すと、戻る操作で前のホストの画面が見えてしまう
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  return (
    <div className="min-h-dvh bg-backstage font-sans text-backstage-ink antialiased">
      <header className="border-b border-backstage-line bg-backstage-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-3">
          <p className="shrink-0 font-logo text-xl">ズバクイ</p>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <p className="name-clip text-backstage-muted" title={host.name}>
              {host.name}
            </p>
            <button
              type="button"
              onClick={logout}
              disabled={signingOut}
              className="shrink-0 underline focus-visible:outline-2 focus-visible:outline-stage disabled:opacity-60"
            >
              ログアウト
            </button>
          </div>
        </div>
        {signOutFailed && (
          <p role="alert" className="mx-auto max-w-4xl px-5 pb-3 text-sm font-bold text-alert-strong">
            ログアウトできませんでした。もう一度押してください。
          </p>
        )}
      </header>
      <Outlet />
    </div>
  );
}
