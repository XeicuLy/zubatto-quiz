import type { CloseReason } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { ConnectionStatus } from '../../realtime/client';
import type { RoomEnd } from '../results/room-end';

interface ConnectionNoticeProps {
  connection: ConnectionStatus;
  closeReason: CloseReason | null;
  /** room_ended で閉じたときの段階（roomEndOf）。それ以外は null */
  roomEnd: RoomEnd | null;
  /** 接続しているときの画面 */
  children: ReactNode;
}

/**
 * 接続の状態を画面に出す（A1・ADR 0004）。
 * つなぎ直しているあいだは中身を薄くして押せなくし、上に「再接続中」を重ねる。
 * つなぎ直さずに閉じたら、中身の代わりに理由を出す。名前の入力に戻す閉じ方（resume_failed など）は、ここに来る前に player-room が扱う。
 * 最終ランキングのあとに部屋が終わったときだけは、中身（最終ランキング）を残し、上に終わったことを出す（#97）
 */
export function ConnectionNotice({ connection, closeReason, roomEnd, children }: ConnectionNoticeProps) {
  if (connection === 'closed' && roomEnd !== 'after_final') {
    return <ClosedScreen message={closedMessageOf(closeReason, roomEnd)} />;
  }
  if (connection !== 'reconnecting') {
    // つながっているときと同じ並びで返し、終わっても中身を作り直さない。作り直すと、優勝の出てくるアニメーションがもう一度流れる
    return (
      <>
        {roomEnd === 'after_final' && <RoomEndedBanner />}
        {children}
      </>
    );
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

interface Message {
  title: string;
  body: string;
}

const closedMessages: Partial<Record<CloseReason, Message>> = {
  // X1: このタブは自動でつなぎ直さない。つなぎ直すと、2つのタブが閉じ合い続ける
  replaced: {
    title: '別のタブで開かれました',
    body: 'この部屋を別のタブで開いたため、このタブの接続を閉じました。続きは、あとから開いたタブで遊べます。名前と得点はそのまま引き継がれています。',
  },
};

function RoomEndedBanner() {
  const message = roomEndedMessages.after_final;
  return (
    <div className="mx-auto max-w-md px-5 pt-4" role="status">
      <div className="rounded-panel border-2 border-stage-line bg-stage-raised px-4 py-3">
        <p className="font-bold">{message.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-on-stage-muted">{message.body}</p>
      </div>
    </div>
  );
}

// スクリーンのない会場もある（F17）ので、結果がどこに出ているかは言わない
const roomEndedMessages: Record<RoomEnd, Message> = {
  after_final: {
    title: 'この部屋は終わりました',
    body: '遊んでくれてありがとうございました。最終の結果は、この画面で見られます。',
  },
  midway: {
    title: 'この部屋は終わりました',
    body: 'ホストが部屋を途中で終えました。遊んでくれてありがとうございました。',
  },
  // 終わったあとに読み込み直した人も、あとから URL を開いた人も来る。どこで終わったかは分からない
  not_entered: {
    title: 'この部屋は終わりました',
    body: '遊んでくれてありがとうございました。',
  },
};

function closedMessageOf(reason: CloseReason | null, roomEnd: RoomEnd | null): Message {
  if (roomEnd !== null) {
    return roomEndedMessages[roomEnd];
  }
  return (
    (reason !== null && closedMessages[reason]) || {
      title: '接続が閉じました',
      body: 'ページを読み込み直してください。',
    }
  );
}

function ClosedScreen({ message }: { message: Message }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
      <h1 className="font-display text-3xl leading-snug">{message.title}</h1>
      <p className="mt-4 leading-relaxed text-on-stage-muted">{message.body}</p>
    </main>
  );
}
