import { Link } from '@tanstack/react-router';
import type { CloseReason } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { ConnectionStatus } from '../../realtime/client';

interface HostConnectionNoticeProps {
  connection: ConnectionStatus;
  closeReason: CloseReason | null;
  /** 接続しているときの画面 */
  children: ReactNode;
}

/**
 * 進行画面の接続の状態（A1）。回答者の ConnectionNotice と同じ形で、投影しても読める大きさにする。
 * つなぎ直しているあいだは中身を薄くして押せなくし、上に帯を重ねる。
 * ホストには X1 の置き換えも名前の入力もないので、つなぎ直さずに閉じるのは、ほぼ部屋が終わったときか、部屋が見つからないときだけ
 */
export function HostConnectionNotice({ connection, closeReason, children }: HostConnectionNoticeProps) {
  if (connection === 'closed') {
    return <ClosedScreen reason={closeReason} />;
  }
  if (connection !== 'reconnecting') {
    return children;
  }
  return (
    <div className="relative">
      <div className="opacity-40" inert>
        {children}
      </div>
      <div className="absolute inset-x-0 top-0 p-stage" role="status">
        <div className="flex items-center gap-3 rounded-panel bg-alert px-5 py-4 text-stage-label font-bold text-stage shadow-panel">
          <span
            className="size-[1.2em] shrink-0 rounded-full border-3 border-stage border-t-transparent motion-safe:animate-spin"
            aria-hidden="true"
          />
          <p>接続が切れました。つなぎ直しています。進行の操作は、つながってからできます</p>
        </div>
      </div>
    </div>
  );
}

const closedMessages: Partial<Record<CloseReason, { title: string; body: string }>> = {
  room_ended: {
    title: 'この部屋は終わりました',
    body: 'また遊ぶときは、問題セットの一覧から新しく部屋を作ってください。',
  },
  // 他人の部屋も同じ code で閉じられる（S1）。どちらかは分からないので、ログインしているアカウントも確かめてもらう
  room_not_found: {
    title: '部屋が見つかりません',
    body: 'URL が正しいか、部屋を作ったアカウントでログインしているかを確かめてください。',
  },
};

function ClosedScreen({ reason }: { reason: CloseReason | null }) {
  const message = (reason !== null && closedMessages[reason]) || {
    title: '接続が閉じました',
    body: 'ページを読み込み直してください。',
  };
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-4 p-stage">
      <h1 className="font-display text-stage-title">{message.title}</h1>
      <p className="text-stage-label leading-relaxed text-on-stage-muted">{message.body}</p>
      <Link
        to="/admin"
        className="self-start text-stage-label font-bold underline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage"
      >
        問題セットの一覧に戻る
      </Link>
    </main>
  );
}
