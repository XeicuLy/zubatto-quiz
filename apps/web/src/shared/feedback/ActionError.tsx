import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { cn } from '@/lib/tailwind';

import { describeApiError } from './api-error';

interface ActionErrorProps {
  /** 投げられた値。ルートの errorComponent の error は unknown なので、そのまま渡せる */
  error: unknown;
  /** 届かなかった・5xx・そのほかのときの文。「保存できませんでした。もう一度押してください。」のように、やり直し方まで書く */
  failed: ReactNode;
  /** 401 の文と導線。省くと「ログインが切れました。ログインし直す」で、同じタブの /login へ移る */
  unauthorized?: ReactNode;
  /** 404 の文。省くと failed を出す。404 で何も出さない（一覧から行が消える）なら、呼ぶ側がこの部品を描かない */
  notFound?: ReactNode;
  /** 置く場所の class（ボタンの下へ回す order-last w-full など） */
  className?: string;
}

/**
 * 操作（保存・作る・消す・ログアウト）の失敗を、押したボタンのそばに出す。toast にせず、次の操作まで消えない role="alert" で残す。
 * 文と導線は呼ぶ側が渡し、どれを出すかは describeApiError の種類で選ぶ
 */
export function ActionError({ className, ...messages }: ActionErrorProps) {
  return (
    <p role="alert" className={cn('text-body font-bold text-destructive', className)}>
      {messageOf(messages)}
    </p>
  );
}

function messageOf({ error, failed, unauthorized, notFound }: Omit<ActionErrorProps, 'className'>): ReactNode {
  switch (describeApiError(error)) {
    case 'unauthorized':
      return (
        unauthorized ?? (
          <>
            ログインが切れました。<LoginLink>ログインし直す</LoginLink>
          </>
        )
      );
    case 'notFound':
      return notFound ?? failed;
    case 'conflict':
    case 'unavailable':
    case 'other':
      return failed;
  }
}

/**
 * ログイン画面へのリンク。newTab は、下書きを持つ画面（問題セットの編集）で使う。
 * この画面で GitHub へ移ると下書きが消えるが、別のタブでログインすれば Cookie が共有され、戻ってそのまま保存できる
 */
export function LoginLink({ newTab = false, children }: { newTab?: boolean; children: ReactNode }) {
  if (newTab) {
    return (
      <a href="/login" target="_blank" rel="noopener" className="underline">
        {children}
      </a>
    );
  }
  return (
    <Link to="/login" className="underline">
      {children}
    </Link>
  );
}
