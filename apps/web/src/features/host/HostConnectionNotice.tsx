import { Link } from '@tanstack/react-router';
import type { CloseReason } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { ConnectionStatus } from '../../realtime/client';
import { useConnectionAnnouncement } from '../player/use-connection-announcement';
import type { RoomEnd } from '../results/room-end';

interface HostConnectionNoticeProps {
  connection: ConnectionStatus;
  closeReason: CloseReason | null;
  /** room_ended で閉じたときの段階（roomEndOf）。それ以外は null */
  roomEnd: RoomEnd | null;
  /** 接続しているときの画面 */
  children: ReactNode;
}

/**
 * 進行画面の接続の状態（A1）。回答者の ConnectionNotice と同じ形で、投影しても読める大きさにする。
 * つなぎ直しているあいだは中身を薄くして押せなくし、上に帯を重ねる。
 * ホストには X1 の置き換えも名前の入力もないので、つなぎ直さずに閉じるのは、ほぼ部屋が終わったときか、部屋が見つからないときだけ。
 * 最終ランキングのあとに部屋が終わったときは、映している最終ランキングを残す。操作の帯の代わりの HostEndedBar は HostPage が出す（#97）
 * 読み上げは、HostEndedBar の分もここから __root の Announcer に渡す。見える帯や画面には role="status" を付けない
 */
export function HostConnectionNotice({ connection, closeReason, roomEnd, children }: HostConnectionNoticeProps) {
  const closed = connection === 'closed' ? closedMessageOf(closeReason) : null;
  useConnectionAnnouncement({ connection, reconnecting: reconnectingMessage, closed });

  if (roomEnd === 'after_final') {
    return children;
  }
  if (closed !== null) {
    return <ClosedScreen message={closed} />;
  }
  if (connection !== 'reconnecting') {
    return children;
  }
  return (
    <div className="relative">
      <div className="opacity-40" inert>
        {children}
      </div>
      <div className="absolute inset-x-0 top-0 p-stage">
        <div className="flex items-center gap-3 rounded-panel bg-alert px-5 py-4 text-stage-label font-bold text-stage shadow-panel">
          <span
            className="size-[1.2em] shrink-0 rounded-full border-3 border-stage border-t-transparent motion-safe:animate-spin"
            aria-hidden="true"
          />
          <p>{reconnectingMessage}</p>
        </div>
      </div>
    </div>
  );
}

const reconnectingMessage = '接続が切れました。つなぎ直しています。進行の操作は、つながってからできます';

interface Message {
  title: string;
  body: string;
}

const roomEndedMessage: Message = {
  title: 'この部屋は終わりました',
  body: 'また遊ぶときは、問題セットの一覧から新しく部屋を作ってください。',
};

const closedMessages: Partial<Record<CloseReason, Message>> = {
  room_ended: roomEndedMessage,
  // 他人の部屋も同じ code で閉じられる（S1）。どちらかは分からないので、ログインしているアカウントも確かめてもらう
  room_not_found: {
    title: '部屋が見つかりません',
    body: 'URL が正しいか、部屋を作ったアカウントでログインしているかを確かめてください。',
  },
};

function closedMessageOf(reason: CloseReason | null): Message {
  return (
    (reason !== null && closedMessages[reason]) || {
      title: '接続が閉じました',
      body: 'ページを読み込み直してください。',
    }
  );
}

function ClosedScreen({ message }: { message: Message }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-4 p-stage">
      <h1 className="font-display text-stage-title">{message.title}</h1>
      <p className="text-stage-label leading-relaxed text-on-stage-muted">{message.body}</p>
      <BackToListLink />
    </main>
  );
}

/** 最終ランキングのあとに部屋が終わったとき、操作の帯の代わりに出す。接続は閉じたので、どの操作も送れない。読み上げは HostConnectionNotice が渡す */
export function HostEndedBar() {
  return (
    <footer className="sticky bottom-0 z-10 border-t border-stage-line bg-stage px-stage py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-stage-label font-bold">{roomEndedMessage.title}</p>
        <BackToListLink />
      </div>
    </footer>
  );
}

function BackToListLink() {
  return (
    <Link
      to="/admin"
      className="self-start text-stage-label font-bold underline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage"
    >
      問題セットの一覧に戻る
    </Link>
  );
}
