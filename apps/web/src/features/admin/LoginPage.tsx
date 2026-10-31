import { useState } from 'react';

import { githubSignInUrl } from '../../lib/auth-client';

/** 許可リストの外で拒否されたときに、Better Auth が ?error= に入れる値（apps/api の HOST_NOT_ALLOWED） */
const HOST_NOT_ALLOWED = 'host_not_allowed';

interface LoginPageProps {
  /** GitHub のログインから戻ってきたときの ?error= の値 */
  error: string | undefined;
}

/**
 * ホストのログイン（ADR 0003）。GitHub でログインし、許可リストにいる人だけがホストになれる。
 * 拒否されると Better Auth が ?error= を付けてここへ戻すので、その理由を出す
 */
export function LoginPage({ error }: LoginPageProps) {
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const denied = error === HOST_NOT_ALLOWED;

  async function signIn() {
    setStarting(true);
    setStartFailed(false);
    try {
      // GitHub へ移る。ページを離れるので、成功したら starting は戻さない
      window.location.assign(await githubSignInUrl());
    } catch {
      setStarting(false);
      setStartFailed(true);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <p className="font-logo text-4xl">ズバクイ</p>
      <h1 className="mt-2 text-xl font-bold">ホストの管理画面</h1>

      {denied ? (
        <div className="mt-8 rounded-panel border-2 border-alert-strong bg-backstage-surface p-5" role="alert">
          <p className="font-bold text-phrase text-alert-strong">このアカウントはホストとして登録されていません</p>
          <p className="mt-2 leading-relaxed">
            ホストになるには、開発者に GitHub のアカウントを伝えて、許可リストに入れてもらってください。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-backstage-muted">
            別のアカウントでログインするときは、先に GitHub でそのアカウントに切り替えてください。
          </p>
        </div>
      ) : error !== undefined || startFailed ? (
        <div className="mt-8 rounded-panel border-2 border-alert-strong bg-backstage-surface p-5" role="alert">
          <p className="font-bold text-alert-strong">ログインできませんでした</p>
          <p className="mt-2 leading-relaxed">少し待ってから、もう一度ログインしてください。</p>
        </div>
      ) : (
        <p className="mt-6 leading-relaxed text-backstage-muted">
          問題セットを作り、部屋を作って進行します。ホストとして登録された GitHub アカウントでログインしてください。
        </p>
      )}

      <button
        type="button"
        onClick={signIn}
        disabled={starting}
        className={
          denied
            ? 'mt-8 rounded-panel border-2 border-backstage-line bg-backstage-surface py-3 font-bold focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-stage disabled:opacity-60'
            : 'mt-8 rounded-panel bg-stage py-4 text-lg font-bold text-on-stage shadow-panel focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-stage active:translate-y-1.5 active:shadow-none disabled:opacity-60'
        }
      >
        {denied ? '別のアカウントでログイン' : 'GitHub でログイン'}
      </button>
      <p className="mt-6 text-sm text-backstage-muted">
        クイズに答えるだけなら、ログインは要りません。ホストから届いた URL を開いてください。
      </p>
    </main>
  );
}
