import type { CloseReason } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { ConnectionStatus } from '../../realtime/client';

interface ConnectionNoticeProps {
  connection: ConnectionStatus;
  closeReason: CloseReason | null;
  /** 接続しているときの画面 */
  children: ReactNode;
}

/**
 * 接続の状態を画面に出す（A1・ADR 0004）。
 * つなぎ直しているあいだは中身を薄くして押せなくし、上に「再接続中」を重ねる。
 * つなぎ直さずに閉じたら、中身の代わりに理由を出す。名前の入力に戻す閉じ方（resume_failed など）は、ここに来る前に player-room が扱う
 */
export function ConnectionNotice({ connection, closeReason, children }: ConnectionNoticeProps) {
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
      <div className="absolute inset-x-0 top-0 mx-auto max-w-md px-3 pt-3" role="status">
        <div className="flex items-center gap-3 rounded-panel bg-alert px-4 py-3 font-bold text-stage shadow-panel">
          <span
            className="size-5 shrink-0 rounded-full border-3 border-stage border-t-transparent motion-safe:animate-spin"
            aria-hidden="true"
          />
          <p>接続が切れました。つなぎ直しています</p>
        </div>
      </div>
    </div>
  );
}

const closedMessages: Partial<Record<CloseReason, { title: string; body: string }>> = {
  // X1: このタブは自動でつなぎ直さない。つなぎ直すと、2つのタブが閉じ合い続ける
  replaced: {
    title: '別のタブで開かれました',
    body: 'この部屋を別のタブで開いたため、このタブの接続を閉じました。続きは、あとから開いたタブで遊べます。名前と得点はそのまま引き継がれています。',
  },
  room_ended: {
    title: 'この部屋は終わりました',
    body: '遊んでくれてありがとうございました。最終の結果はスクリーンで発表されています。',
  },
};

function ClosedScreen({ reason }: { reason: CloseReason | null }) {
  const message = (reason !== null && closedMessages[reason]) || {
    title: '接続が閉じました',
    body: 'ページを読み込み直してください。',
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
      <h1 className="font-display text-3xl leading-snug">{message.title}</h1>
      <p className="mt-4 leading-relaxed text-on-stage-muted">{message.body}</p>
    </main>
  );
}
