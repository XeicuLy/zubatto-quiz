import { serverMessageSchema, type ClientMessage, type ServerMessage } from '@zubatto-quiz/protocol';

import { reconnectDelay, shouldReconnect } from './reconnect';

/**
 * 部屋の WebSocket の端末の側。画面の通信はここにまとめ、ほかの画面のコードは WebSocket を直接さわらない。
 * Go へ置き換えても、ここが protocol のメッセージ仕様だけに頼っていれば、画面は変わらない（ADR 0001）。
 */

export interface RoomSocketEventMap {
  open: Event;
  message: MessageEvent;
  close: CloseEvent;
}

/** connectRoom が使う WebSocket の一部。本物の WebSocket と、テストの偽のソケット（test/fake-room-server.ts）が当てはまる */
export interface RoomSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof RoomSocketEventMap>(type: K, listener: (event: RoomSocketEventMap[K]) => void): void;
}

/** connecting は最初の接続が開くまで。connectRoom は open・reconnecting・closed だけを知らせる */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomClientOptions {
  url: string;
  /** つながるたびに呼び、返したメッセージを最初に送る。回答者は playerHello を渡す。ホストは何も送らない */
  hello?: () => ClientMessage;
  /** 仕様どおりのメッセージだけを渡す。形の違うものは捨てる */
  onMessage: (message: ServerMessage) => void;
  /** 接続の状態が変わったとき。閉じたときはサーバーの close code も渡す */
  onStatus?: (status: ConnectionStatus, closeCode?: number) => void;
  /** テストで偽のソケットに替える */
  createSocket?: (url: string) => RoomSocket;
  /** テストで待ち時間のばらつきを決める */
  random?: () => number;
}

export interface RoomClient {
  /** 開いていなければ送らずに false を返す */
  send(message: ClientMessage): boolean;
  /** 画面を離れるときに呼ぶ。もうつなぎ直さない */
  close(): void;
}

/** 部屋に受け入れられた印。これが届いたら、つなぎ直しの待ち時間を最初に戻す */
const acceptedTypes: ReadonlySet<ServerMessage['type']> = new Set(['joined', 'resumed', 'hostReady']);

/**
 * 部屋の WebSocket を開き、切れたら間を空けてつなぎ直す（A1・F19）。
 * 部屋の DO は、つなぎ直した端末に今の状態を送り直すので、ここでは状態を持たない
 */
export function connectRoom(options: RoomClientOptions): RoomClient {
  const createSocket: (url: string) => RoomSocket = options.createSocket ?? ((url) => new WebSocket(url));
  let socket: RoomSocket;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function open() {
    const current = createSocket(options.url);
    socket = current;

    current.addEventListener('open', () => {
      const hello = options.hello?.();
      if (hello) {
        current.send(JSON.stringify(hello));
      }
      options.onStatus?.('open');
    });

    current.addEventListener('message', (event) => {
      const message = decodeServerMessage(event.data);
      if (!message) {
        return;
      }
      // 開いただけでは戻さない。上限で断るときも、部屋の DO はいったん受け付けてから閉じるため
      if (acceptedTypes.has(message.type)) {
        attempt = 0;
      }
      options.onMessage(message);
    });

    current.addEventListener('close', (event) => {
      if (stopped) {
        return;
      }
      if (!shouldReconnect(event.code)) {
        stopped = true;
        options.onStatus?.('closed', event.code);
        return;
      }
      options.onStatus?.('reconnecting', event.code);
      timer = setTimeout(open, reconnectDelay(attempt, options.random));
      attempt += 1;
    });
  }

  open();

  return {
    send(message) {
      if (stopped || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      socket.close(1000);
    },
  };
}

/**
 * 回答者が、つながるたびに最初に送るメッセージを作る（ADR 0004）。
 * 名前を渡すと初めの1回だけ join を送り、それからは秘密で resume を送る。
 * join の返事が届く前に切れても、部屋の DO が join を受け取っていれば resume で戻れる。
 * 受け取っていなければ resume_failed で閉じられるので、画面は名前の入力に戻す。
 * リロードしたときなど、秘密がすでに保存されていれば名前を渡さず、初めから resume を送る
 */
export function playerHello({ name, token }: { name?: string; token: string }): () => ClientMessage {
  let joinSent = false;
  return () => {
    if (name !== undefined && !joinSent) {
      joinSent = true;
      return { type: 'join', name, token };
    }
    return { type: 'resume', token };
  };
}

/**
 * 受け取った値を protocol のスキーマで確かめる。形が違えば undefined を返す。
 * z.object は知らない項目を取り除くので、仕様にない項目は画面に届かない
 */
export function decodeServerMessage(data: unknown): ServerMessage | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const result = serverMessageSchema.safeParse(json);
  return result.success ? result.data : undefined;
}
