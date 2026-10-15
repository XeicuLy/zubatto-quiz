import type { Answer, CloseReason } from '@zubatto-quiz/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { connectRoom, playerHello, type RoomClient, type RoomSocket } from '../../realtime/client';
import { createRoomStore, type RoomStore } from '../../realtime/room-store';
import { clearToken, createToken, loadToken, saveToken } from './token-storage';

/**
 * 回答者の画面の、部屋ごとの操作役。route の loader が部屋に入るときに1つ作り、
 * onEnter で resumeSaved を、onLeave で leave を呼ぶ。名前の入力の「参加する」は join を呼ぶ。
 * 接続の開け閉めを描画（useEffect）ではなく、画面の移動と押した操作に結びつける
 */

/** 名前の入力に戻したときに出す理由 */
export type JoinNotice = 'name_taken' | 'resume_failed';

/** 秘密を消して入り直す理由。これ以外の閉じ方は、部屋の中の画面のまま ConnectionNotice が出す */
export type Rejection = JoinNotice | 'room_full';

export type PlayerEntry =
  /** 名前の入力。name は入れ直すときに残しておく前回の名前 */
  | { screen: 'form'; notice: JoinNotice | null; name: string }
  /**
   * 接続を開いたあと。入り直すたびに部屋の store を作り直す。
   * name は join で入れた名前で、resume で入ったときは null（resumed で届く名前を使う）。
   * persisted が false なら、秘密を保存できなかったので、読み込み直すと戻れない
   */
  | { screen: 'room'; room: RoomStore; name: string | null; persisted: boolean }
  /** 部屋が満員（SC1）。参加者は抜けないので、入れ直しても通らない */
  | { screen: 'full' };

export interface PlayerRoom {
  readonly store: StoreApi<{ entry: PlayerEntry }>;
  /** 名前を入れて入室する。秘密を作って保存してから接続を開く */
  join(name: string): void;
  /** 保存した秘密があれば、名前を聞かずに resume で入る */
  resumeSaved(): void;
  /**
   * 回答を送る（F10）。接続が開いていなければ送らずに false を返す。
   * 1問に1回だけ送るのは画面（QuestionView）の役目で、部屋の DO も2回目を already_answered で断る
   */
  answer(answer: Omit<Answer, 'type'>): boolean;
  /** 部屋を離れる。接続を閉じ、もうつなぎ直さない */
  leave(): void;
}

export interface PlayerRoomOptions {
  roomId: string;
  url: string;
  /** テストで偽のソケットに替える */
  createSocket?: (url: string) => RoomSocket;
}

export function createPlayerRoom({ roomId, url, createSocket }: PlayerRoomOptions): PlayerRoom {
  const store = createStore<{ entry: PlayerEntry }>()(() => ({ entry: { screen: 'form', notice: null, name: '' } }));
  let client: RoomClient | undefined;

  function connect(token: string, name: string | undefined, persisted: boolean) {
    client?.close();
    const room = createRoomStore();
    const { receive, connectionChanged } = room.getState();
    client = connectRoom({
      url,
      createSocket,
      hello: playerHello({ name, token }),
      onMessage: receive,
      onStatus: (status, closeCode) => {
        connectionChanged(status, closeCode);
        if (status === 'closed') {
          rejected(room.getState().closeReason, name ?? '');
        }
      },
    });
    store.setState({ entry: { screen: 'room', room, name: name ?? null, persisted } });
  }

  /** 断られた秘密は部屋の DO に行がない（か、もう使えない）ので消し、入り直してもらう（ADR 0004） */
  function rejected(reason: CloseReason | null, name: string) {
    const rejection = rejectionOf(reason);
    if (rejection === null) {
      return;
    }
    clearToken(roomId);
    client = undefined;
    store.setState({
      entry: rejection === 'room_full' ? { screen: 'full' } : { screen: 'form', notice: rejection, name },
    });
  }

  return {
    store,
    join(name) {
      const token = createToken();
      // 送る前に保存する。join の返事が届く前に切れても、この秘密の resume で戻れる
      const persisted = saveToken(roomId, token);
      connect(token, name, persisted);
    },
    resumeSaved() {
      const token = loadToken(roomId);
      if (token !== null) {
        connect(token, undefined, true);
      }
    },
    answer(answer) {
      return client?.send({ type: 'answer', ...answer }) ?? false;
    },
    leave() {
      client?.close();
      client = undefined;
    },
  };
}

/**
 * 閉じた理由のうち、秘密を消して入り直してもらうものを返す。ほかは null。
 * connectRoom がつなぎ直さずに閉じたときだけ呼ばれる（つなぎ直す join_timeout・connection_limit はここに来ない）
 */
export function rejectionOf(reason: CloseReason | null): Rejection | null {
  // どれも部屋の DO に使える行がない秘密。かぶりと満員では行が作られず、resume_failed では合う行がないか期限切れ
  if (reason === 'name_taken' || reason === 'resume_failed' || reason === 'room_full') {
    return reason;
  }
  // replaced は別のタブが同じ秘密で使っているので、消すとそのタブが読み込み直したときに戻れなくなる
  return null;
}
