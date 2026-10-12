import { clientMessageSchema, encodeServerMessage, type ClientMessage } from '@zubatto-quiz/protocol';

import type { RoomSocket, RoomSocketEventMap } from '../src/realtime/client';

type ServerMessageInput = Parameters<typeof encodeServerMessage>[0];

/**
 * メモリの上で動く偽の WebSocket サーバー。画面のテストで、部屋の DO の代わりに使う。
 * 何を返すかはテストが台本として書く。join や resume の中身（名前のかぶりや秘密の照合）は真似しない。
 *
 * ```ts
 * const server = new FakeRoomServer();
 * connectRoom({ url, createSocket: server.createSocket, onMessage });
 * server.latest.open();
 * server.latest.emit({ type: 'participants', participants: [] });
 * ```
 */
export class FakeRoomServer {
  /** 端末が開いた接続。古い順 */
  readonly sockets: FakeSocket[] = [];

  /** connectRoom の createSocket に渡す */
  readonly createSocket = (url: string): FakeSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  /** いちばん新しい接続 */
  get latest(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) {
      throw new Error('まだ接続が開かれていない');
    }
    return socket;
  }
}

/**
 * 偽のサーバーの1本の接続。端末から見ると WebSocket と同じように振る舞う。
 * 端末が送ったメッセージは protocol の clientMessageSchema で確かめ、形が違えば例外にしてテストを落とす。
 */
export class FakeSocket extends EventTarget implements RoomSocket {
  readyState: number = WebSocket.CONNECTING;
  /** 端末から受け取ったメッセージ。古い順 */
  readonly received: ClientMessage[] = [];

  constructor(readonly url: string) {
    super();
  }

  // ---- 端末（connectRoom）から呼ばれる ----

  override addEventListener<K extends keyof RoomSocketEventMap>(
    type: K,
    listener: (event: RoomSocketEventMap[K]) => void,
  ): void {
    // dispatchEvent で渡すイベントの型は、type ごとに RoomSocketEventMap とそろえている
    super.addEventListener(type, listener as EventListener);
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('開いていない接続に送った');
    }
    this.received.push(clientMessageSchema.parse(JSON.parse(data)));
  }

  close(code = 1005, reason = ''): void {
    this.finish(code, reason);
  }

  // ---- テストの台本から呼ぶ ----

  /** サーバーが接続を受け付けた */
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** 仕様どおりのメッセージを送る。部屋の DO と同じく encodeServerMessage を通す */
  emit(message: ServerMessageInput): void {
    this.emitRaw(encodeServerMessage(message));
  }

  /** 形の違うメッセージを試すときに、生の文字列を送る */
  emitRaw(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  /** サーバーの側から閉じる。回線が切れたときは 1006 を渡す */
  closeFromServer(code: number, reason = ''): void {
    this.finish(code, reason);
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}
