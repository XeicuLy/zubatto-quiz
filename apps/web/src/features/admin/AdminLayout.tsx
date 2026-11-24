import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { signOut, type HostSession } from '@/api/auth-client';
import { meQueryOptions } from '@/api/me';
import { ActionError } from '@/shared/feedback/ActionError';

import { useHeightVariable } from './use-height-variable';

interface AdminLayoutProps {
  host: HostSession;
}

/**
 * 管理画面（楽屋）の枠。上の帯にロゴ（入口へのリンク）・ホストの名前・ログアウトを置き、中に子の経路を出す。
 * 帯の下の段には、問題セットと使い方へのリンクを出す。管理者には、ホストの管理へのリンクも出す（ADR 0013）。読めなかったら出さない。
 * リンクを出すかは見た目だけで、/admin/hosts は requireAdmin（beforeLoad）と API の requireAdmin が守る
 */
export function AdminLayout({ host }: AdminLayoutProps) {
  const queryClient = useQueryClient();
  const me = useQuery(meQueryOptions);
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  // toast は画面の上に出るので、この帯の下へずらす。帯は fixed でなく文書の頭にあるので、スクロールしても toast には重ならない
  const header = useRef<HTMLElement>(null);
  useHeightVariable(header, '--header-height');

  async function logout() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSigningOut(false);
      setSignOutError(error);
      return;
    }
    // セッションと問題セットの一覧を、覚えた値ごと捨てる。残すと、戻る操作で前のホストの画面が見えてしまう
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  return (
    <div className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <header ref={header} className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-3">
          <Link to="/" className="shrink-0 font-logo text-heading">
            ズバクイ
          </Link>
          <div className="flex min-w-0 items-center gap-3 text-note">
            <p className="name-clip text-muted-foreground" title={host.name}>
              {host.name}
            </p>
            <button
              type="button"
              onClick={logout}
              disabled={signingOut}
              className="shrink-0 underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              ログアウト
            </button>
          </div>
        </div>
        {/* いまの画面のリンク（aria-current="page"、TanStack Router が付ける）は、下線を外して濃い色にする。
            使い方は管理画面の外へ出るリンクなので、最後に置く */}
        <nav aria-label="管理画面" className="mx-auto max-w-4xl px-5 pb-3">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-note">
            <li>
              {/* /admin/sets/… でも印を付けないよう、/admin と同じときだけにする */}
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className="text-muted-foreground underline underline-offset-4 aria-[current=page]:font-bold aria-[current=page]:text-foreground aria-[current=page]:no-underline"
              >
                問題セット
              </Link>
            </li>
            {me.data?.isAdmin === true && (
              <li>
                <Link
                  to="/admin/hosts"
                  className="text-muted-foreground underline underline-offset-4 aria-[current=page]:font-bold aria-[current=page]:text-foreground aria-[current=page]:no-underline"
                >
                  ホストの管理
                </Link>
              </li>
            )}
            <li>
              <Link to="/guide" className="text-muted-foreground underline underline-offset-4">
                使い方
              </Link>
            </li>
          </ul>
        </nav>
        {signOutError !== null && (
          <ActionError
            error={signOutError}
            failed="ログアウトできませんでした。もう一度押してください。"
            className="mx-auto max-w-4xl px-5 pb-3"
          />
        )}
      </header>
      <Outlet />
    </div>
  );
}
