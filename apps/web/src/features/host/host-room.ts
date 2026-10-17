import { connectRoom, type RoomClient, type RoomSocket } from '../../realtime/client';
import { createRoomStore, type RoomStore } from '../../realtime/room-store';

/**
 * ホストの進行画面の、部屋ごとの操作役。route の loader が部屋を開くときに1つ作り、
 * onEnter で connect を、onLeave で leave を呼ぶ。player-room と同じく、接続の開け閉めを描画（useEffect）に結びつけない。
 * 進行の操作（T32）は、ここに足す
 */
export interface HostRoom {
  /** 部屋の状態。hostReady と participants などが写る */
  readonly room: RoomStore;
  /**
   * ホスト用の入口（/ws/host）を開く。すでに開いていれば何もしない。
   * Cookie で持ち主かを確かめるので、回答者のように最初のメッセージは送らない（ADR 0003）
   */
  connect(): void;
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

  return {
    room,
    connect() {
      client ??= connectRoom({ url, createSocket, onMessage: receive, onStatus: connectionChanged });
    },
    leave() {
      client?.close();
      client = undefined;
    },
  };
}
