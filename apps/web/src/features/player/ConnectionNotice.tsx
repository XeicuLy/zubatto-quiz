import type { CloseReason } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { ConnectionStatus } from '@/realtime/client';
import { ReconnectingOverlay } from '@/shared/connection/ReconnectingOverlay';
import { useConnectionAnnouncement } from '@/shared/connection/use-connection-announcement';
import type { RoomEnd } from '@/shared/results/room-end';
import { MessageScreen } from '@/shared/status/MessageScreen';

import { TopLink } from './TopLink';

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
 * つなぎ直しているあいだは中身を薄くして押せなくし、上に「再接続中」を重ねる（ReconnectingOverlay。ホストと同じ形）。
 * つなぎ直さずに閉じたら、中身の代わりに理由を出す。名前の入力に戻す閉じ方（resume_failed など）は、ここに来る前に player-room が扱う。
 * 最終ランキングのあとに部屋が終わったときだけは、中身（最終ランキング）を残し、上に終わったことを出す（#97）
 * 見える知らせには role="status" を付けない。箱と中身が同時に現れると読まれないので、読み上げは __root の Announcer に文を渡す
 */
export function ConnectionNotice({ connection, closeReason, roomEnd, children }: ConnectionNoticeProps) {
  const closed = connection === 'closed' ? closedMessageOf(closeReason, roomEnd) : null;
  useConnectionAnnouncement({ connection, reconnecting: reconnectingMessage, closed });

  if (closed !== null && roomEnd !== 'after_final') {
    return (
      <MessageScreen variant="mobile" title={closed.title} body={closed.body}>
        {/* 部屋が終わったらもう戻れないので、入口へ出る道を置く。別のタブで開かれたときは、そのタブで続けられる */}
        {roomEnd !== null && <TopLink />}
      </MessageScreen>
    );
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
    <ReconnectingOverlay variant="mobile" message={reconnectingMessage}>
      {children}
    </ReconnectingOverlay>
  );
}

interface Message {
  title: string;
  body: string;
}

const reconnectingMessage = '接続が切れました。つなぎ直しています';

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
    <div className="mx-auto max-w-md px-5 pt-4">
      <div className="rounded-panel border-2 border-border bg-card px-4 py-3">
        <p className="font-bold">{message.title}</p>
        <p className="mt-1 text-note text-muted-foreground">{message.body}</p>
      </div>
    </div>
  );
}

// スクリーンのない会場もある（F17）ので、結果がどこに出ているかは言わない。
// 部屋の DO は、終わった部屋に結果を返さない（#338）。最終の結果は、終わったときに開いていた画面にしか残らない
const roomEndedMessages: Record<RoomEnd, Message> = {
  after_final: {
    title: 'この部屋は終わりました',
    body: '遊んでくれてありがとうございました。最終の結果は、読み込み直すと見られなくなります。残したいときは、画面を撮っておいてください。',
  },
  midway: {
    title: 'この部屋は終わりました',
    body: 'ホストが部屋を途中で終えました。遊んでくれてありがとうございました。',
  },
  // 終わったあとに、保存した秘密で読み込み直した人が来る。部屋の DO は、秘密が参加者の行と合ったときだけ resume を
  // room_ended で閉じる（行がなければ resume_failed）ので、ここに来るのは遊んだ人だけで、お礼を言ってよい。
  // あとから URL を開いて join で断られた人は、秘密を消して player-room の ended の画面にするので、ここには来ない。
  // どこで終わったかは分からない
  not_entered: {
    title: 'この部屋は終わりました',
    body: '遊んでくれてありがとうございました。部屋が終わったので、結果はもう見られません。',
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
