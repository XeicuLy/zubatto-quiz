import type { HostCommand, ServerMessage } from '@zubatto-quiz/protocol';

import { connectRoom, type ConnectionStatus, type RoomClient, type RoomSocket } from '../../realtime/client';
import { createRoomStore, type RoomStore } from '../../realtime/room-store';

/**
 * ホストの進行画面の、部屋ごとの操作役。route の loader が部屋を開くときに1つ作り、
 * onEnter で connect を、onLeave で leave を呼ぶ。player-room と同じく、接続の開け閉めを描画（useEffect）に結びつけない
 */
export interface HostRoom {
  /** 部屋の状態。hostReady と participants などが写る */
  readonly room: RoomStore;
  /**
   * ホスト用の入口（/ws/host）を開く。すでに開いていれば何もしない。
   * Cookie で持ち主かを確かめるので、回答者のように最初のメッセージは送らない（ADR 0003）
   */
  connect(): void;
  /** 進行の操作を送る。接続が開いていなければ送らずに false を返す */
  send(command: HostCommand): boolean;
  /** 部屋を離れる。接続を閉じ、もうつなぎ直さない */
  leave(): void;
}

export interface HostRoomOptions {
  url: string;
  /** テストで偽のソケットに替える */
  createSocket?: (url: string) => RoomSocket;
}

export function createHostRoom({ url, createSocket }: HostRoomOptions): HostRoom {
  const room = createRoomStore();
  const { receive, connectionChanged } = room.getState();
  let client: RoomClient | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (command: HostCommand) => client?.send(command) ?? false;

  /**
   * 残りが0になったら、ホストからも締切を送る。部屋の DO の alarm は最大1分遅れることがあるため。
   * 数え始めは answeringStarted を受け取ったときなので、部屋の DO の締切より早く締め切ることはない。
   * 鳴ったときに、まだ同じ問題の受付中かを確かめる。先に締め切られた・やり直したなら送らない。
   * ホストの端末が2つあれば2回送られるが、2回目は部屋の DO が invalid_state で断る
   */
  function scheduleClose(questionId: string, remainingMs: number) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const { room: snapshot, question } = room.getState();
      if (snapshot?.phase === 'accepting' && question?.questionId === questionId) {
        send({ type: 'closeAnswering', questionIndex: question.questionIndex });
      }
    }, remainingMs);
  }

  /**
   * 切れたら、前の受付のタイマーを消す。切れているあいだにやり直しや受付開始があると、締切が変わっているかもしれない。
   * つなぎ直すと部屋の DO が answeringStarted を送り直すので、そのときに今の残りで置き直す。
   * 消さないと、hostReady で受付中に戻ってから送り直しを受け取るまでのあいだに古いタイマーが鳴り、早く締め切ってしまう
   */
  function onStatus(status: ConnectionStatus, closeCode?: number) {
    if (status === 'reconnecting' || status === 'closed') {
      clearTimeout(closeTimer);
    }
    connectionChanged(status, closeCode);
  }

  function onMessage(message: ServerMessage) {
    receive(message);
    // つなぎ直したときも、部屋の DO が残りを短くして送り直すので、ここで置き直す
    if (message.type === 'answeringStarted') {
      scheduleClose(message.questionId, message.remainingMs);
    }
  }

  return {
    room,
    connect() {
      client ??= connectRoom({ url, createSocket, onMessage, onStatus });
    },
    send,
    leave() {
      clearTimeout(closeTimer);
      client?.close();
      client = undefined;
    },
  };
}
