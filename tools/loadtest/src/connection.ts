import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '@zubatto-quiz/protocol';

/** 受け取ったメッセージと、受け取った時刻（performance.now()）。P1・P4 は送った時刻との差で測る */
export interface Received<T extends ServerMessage = ServerMessage> {
  message: T;
  at: number;
}

export type Match<T extends ServerMessage> = (message: ServerMessage) => message is T;

/** type が一致し、questionId を渡したときはそれも一致するメッセージ */
export function isType<K extends ServerMessage['type']>(type: K, questionId?: string) {
  return (message: ServerMessage): message is Extract<ServerMessage, { type: K }> =>
    message.type === type &&
    (questionId === undefined || ('questionId' in message && message.questionId === questionId));
}

export interface ConnectOptions {
  url: string;
  /** 画面の Worker のオリジン。API は Origin が違う WebSocket を 403 で断る（ADR 0003・0004） */
  origin: string;
  /** ホストのセッションの Cookie。回答者の入口へは付けない（ADR 0004） */
  cookie?: string;
}

/**
 * 部屋の WebSocket を1本開く。
 *
 * - Node の組み込みの WebSocket（undici）は、ブラウザと違って headers で Origin と Cookie を付けられる
 * - 受け取ったものは protocol の serverMessageSchema で読み、読めないものは数えるだけで捨てる
 * - 送るものは clientMessageSchema に通してから送る。仕様が変わったら、ボットもここで落ちて追いつく（ADR 0001）
 * - 受け取ったものはすべてためておくので、waitFor を呼ぶ前に届いていても取りこぼさない
 */
export class RoomSocket {
  readonly #socket: WebSocket;
  readonly #received: Received[] = [];
  readonly #listeners = new Set<(received: Received) => void>();
  /** 新しいメッセージが届いたか、接続が閉じたときに呼ぶ */
  readonly #wakers = new Set<() => void>();
  /** 仕様に合わず捨てたメッセージの数 */
  invalidCount = 0;
  /** 閉じたときの code。開いているあいだは null */
  closeCode: number | null = null;
  /** 開いたら解決し、開く前に閉じたら、閉じたときの code を持って失敗する */
  readonly opened: Promise<void>;

  constructor({ url, origin, cookie }: ConnectOptions) {
    const headers: Record<string, string> = { Origin: origin };
    if (cookie !== undefined) {
      headers.Cookie = cookie;
    }
    this.#socket = new WebSocket(url, { headers });
    this.opened = new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', () => resolve(), { once: true });
      this.#socket.addEventListener(
        'close',
        (event) => reject(new Error(`WebSocket を開けなかった（close code ${event.code}）`)),
        { once: true },
      );
    });
    // 開けなかったことは opened を待つ側が扱う。待たれる前に失敗しても、未処理の拒否にしない
    this.opened.catch(() => {});
    this.#socket.addEventListener('message', (event) => this.#receive(event.data));
    this.#socket.addEventListener('close', (event) => {
      this.closeCode = event.code;
      this.#wake();
    });
  }

  #receive(data: unknown) {
    const at = performance.now();
    if (typeof data !== 'string') {
      this.invalidCount += 1;
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.invalidCount += 1;
      return;
    }
    const parsed = serverMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.invalidCount += 1;
      return;
    }
    const received = { message: parsed.data, at };
    this.#received.push(received);
    for (const listener of this.#listeners) {
      listener(received);
    }
    this.#wake();
  }

  #wake() {
    for (const wake of this.#wakers) {
      wake();
    }
  }

  /** これから届くメッセージを受け取る。止めるときは返した関数を呼ぶ */
  subscribe(listener: (received: Received) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 送る直前の時刻を返す。開いていなくて送れなければ null */
  send(message: ClientMessage): number | null {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      return null;
    }
    const raw = JSON.stringify(clientMessageSchema.parse(message));
    const at = performance.now();
    this.#socket.send(raw);
    return at;
  }

  /**
   * match に合う最初のメッセージを待つ。すでに届いていればすぐに返す。
   * timeoutMs が過ぎるか、接続が閉じたら null を返す（届かなかったものとして数える）
   */
  waitFor<T extends ServerMessage>(match: Match<T>, timeoutMs: number): Promise<Received<T> | null> {
    const find = () => this.#received.find((received): received is Received<T> => match(received.message));
    return new Promise((resolve) => {
      const done = (value: Received<T> | null) => {
        clearTimeout(timer);
        this.#wakers.delete(check);
        resolve(value);
      };
      const check = () => {
        const found = find();
        if (found !== undefined) {
          done(found);
        } else if (this.closeCode !== null) {
          done(null);
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.#wakers.add(check);
      check();
    });
  }

  close() {
    this.#socket.close();
  }
}
