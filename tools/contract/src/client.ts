import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { validateResponse, validateServerMessage } from './validate.ts';

/**
 * サーバーにつなぐ部品。受け取った HTTP の応答と WebSocket のメッセージは、すべて validate.ts で調べる。
 * protocol の TypeScript は import しないので、メッセージは type と中身のキーだけを持つ形として扱う
 */

/** テスト用のログインの経路。TS のサーバーではテスト専用の入口（apps/api/test/e2e-entry.ts）にだけあり、openapi.json にはない */
const LOGIN_PATH = '/api/e2e/login';

/** ホストのセッション。cookie はログにもエラーにも出さない */
export interface HostSession {
  /** 画面と API のオリジン（例: http://localhost:4173） */
  origin: string;
  /** Cookie ヘッダーにそのまま入れる値 */
  cookie: string;
}

/**
 * 新しいホストとしてログインする。テスト用のログインは `{ cookies: [{ name, value, … }] }` を返す
 * （Playwright の addCookies に渡せる形）ので、その name と value を Cookie ヘッダーの形にする
 */
export async function loginAsHost(origin: string): Promise<HostSession> {
  const response = await fetch(new URL(LOGIN_PATH, origin), { method: 'POST', headers: { Origin: origin } });
  if (!response.ok)
    throw new Error(`${LOGIN_PATH} が ${response.status} を返した。テスト用の入口で動いているか確かめる`);
  const { cookies } = (await response.json()) as { cookies: { name: string; value: string }[] };
  return { origin, cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') };
}

export interface ApiResult {
  status: number;
  /** openapi.json で調べたあとの本文。本文がない応答（204）は undefined */
  body: unknown;
}

/** HTTP API の呼び手。cookie がなければ、ログインしていない人として呼ぶ */
export type Caller = Pick<HostSession, 'origin'> & Partial<Pick<HostSession, 'cookie'>>;

/**
 * ホストのセッション（またはログインしていない人）で HTTP API を呼び、応答を openapi.json で調べる。
 * operation は openapi.json のキー（`'PUT /api/question-sets/{id}'`）で、`{…}` は params で埋める。
 * Cookie で認証する状態を変える経路は csrf() を通るので、ブラウザと同じ Origin と Sec-Fetch-Site を付ける
 */
export async function request(
  session: Caller,
  operation: string,
  { params = {}, body }: { params?: Record<string, string>; body?: unknown } = {},
): Promise<ApiResult> {
  const [method = '', template = ''] = operation.split(' ');
  const path = template.replaceAll(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${operation} の ${placeholder} を埋める値がない`);
    return encodeURIComponent(value);
  });
  const response = await fetch(new URL(path, session.origin), {
    method,
    headers: {
      Origin: session.origin,
      'Sec-Fetch-Site': 'same-origin',
      ...(session.cookie === undefined ? {} : { Cookie: session.cookie }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await validateResponse(operation, response) };
}

/** 部屋の WebSocket の URL。http は ws、https は wss にする */
export function roomSocketUrl(origin: string, roomId: string, entry: 'host' | 'play'): string {
  const url = new URL(`/api/rooms/${roomId}/ws/${entry}`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** ws.schema.json で調べたあとのメッセージ。中身の形はスキーマが確かめたので、ここでは type だけを型にする */
export type ServerMessage = { type: string } & Record<string, unknown>;

/** 1つのメッセージを待つ上限 */
const WAIT_MS = 10_000;

/**
 * 部屋の WebSocket を1本開く。
 *
 * - Node の組み込みの WebSocket（undici）は、ブラウザと違って headers で Origin と Cookie を付けられる
 * - 受け取ったものはすべて ws.schema.json で調べてためる。waitFor を呼ぶ前に届いていても取りこぼさない
 * - 合わないものが1つでも届いたら、待っている waitFor もこれからの waitFor も、その理由で失敗させる。
 *   loadtest のボットのように数えて捨てると、最初のずれがほかの待ちの時間切れに埋もれる
 */
export class ContractSocket {
  readonly #socket: WebSocket;
  readonly #received: ServerMessage[] = [];
  /** 新しいメッセージが届いたか、合わないものが届いたか、閉じたときに呼ぶ */
  readonly #wakers = new Set<() => void>();
  /** 最初に届いた、スキーマに合わないメッセージの理由 */
  #failure: Error | null = null;
  #closeCode: number | null = null;
  /** 開いたら解決し、開く前に閉じたら、閉じたときの code を持って失敗する */
  readonly opened: Promise<void>;
  /** 閉じたときの code で解決する。それまでにスキーマに合わないメッセージが届いていたら、その理由で失敗する */
  readonly closed: Promise<number>;

  constructor({ url, origin, cookie }: { url: string; origin: string; cookie?: string }) {
    this.#socket = new WebSocket(url, {
      headers: { Origin: origin, ...(cookie === undefined ? {} : { Cookie: cookie }) },
    });
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
    this.closed = new Promise((resolve, reject) => {
      this.#socket.addEventListener('close', (event) => {
        this.#closeCode = event.code;
        // 最後の waitFor のあとに届いたものは、ほかに確かめる場所がない。合わないものがあれば、閉じたことより先にそれを知らせる
        if (this.#failure === null) resolve(event.code);
        else reject(this.#failure);
        this.#wake();
      });
    });
    // 失敗は closed を待つ側が扱う。待たれる前に失敗しても、未処理の拒否にしない
    this.closed.catch(() => {});
    this.#socket.addEventListener('message', (event) => this.#receive(event.data));
  }

  #receive(data: unknown) {
    try {
      if (typeof data !== 'string') throw new Error('文字列でないメッセージが届いた');
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        throw new Error(`JSON として読めないメッセージが届いた: ${data.slice(0, 100)}`);
      }
      validateServerMessage(message);
      this.#received.push(message as ServerMessage);
    } catch (error) {
      this.#failure ??= error instanceof Error ? error : new Error(String(error));
    }
    this.#wake();
  }

  #wake() {
    for (const wake of this.#wakers) wake();
  }

  /** これまでに届いた、スキーマに合うメッセージ。届いた順に並ぶ */
  get messages(): readonly ServerMessage[] {
    return [...this.#received];
  }

  /** これまでに届いた、スキーマに合うメッセージの type */
  get types(): Set<string> {
    return new Set(this.#received.map((message) => message.type));
  }

  /** そのまま JSON にして送る。クライアントのメッセージの形はサーバーが確かめるので、ここでは調べない */
  send(message: { type: string } & Record<string, unknown>): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${message.type} を送れない（close code ${this.#closeCode ?? 'なし'}）`);
    }
    this.#socket.send(JSON.stringify(message));
  }

  /**
   * type が同じで where に合う最初のメッセージを待つ。すでに届いていればすぐに返す。
   * 合わないものが届くか、閉じるか、timeoutMs が過ぎたら失敗する
   */
  waitFor(
    type: string,
    where: (message: ServerMessage) => boolean = () => true,
    timeoutMs = WAIT_MS,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        this.#wakers.delete(check);
        settle();
      };
      const check = () => {
        const found = this.#received.find((message) => message.type === type && where(message));
        if (found !== undefined) finish(() => resolve(found));
        else if (this.#failure !== null) finish(() => reject(this.#failure));
        else if (this.#closeCode !== null) {
          finish(() => reject(new Error(`${type} が届く前に閉じた（close code ${this.#closeCode}）`)));
        }
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error(`${type} が ${timeoutMs} ms のあいだに届かなかった`))),
        timeoutMs,
      );
      this.#wakers.add(check);
      check();
    });
  }

  close(): void {
    this.#socket.close();
  }
}

/**
 * 部屋の入口へ WebSocket の Upgrade の要求を1つ送り、返ってきた状態コードを返す。受け付けられたら（101）すぐ閉じる。
 * 応答を返さずに切られたら null を返す。つなげなかったとき（ECONNREFUSED など）は失敗する。
 *
 * - Node の WebSocket は、断られたときの状態コードを見せない（閉じたときの code が 1006 になるだけ）ので、node:http で握手する
 * - 付けるのは握手に要るヘッダーと headers だけ。ブラウザと違って Origin は自分では付けないので、Origin のない要求を作れる
 * - vite preview（@cloudflare/vite-plugin 1.63.1）は、Worker が 101 でない応答を返すと、それを返さずに接続を切る。
 *   本番や Go のサーバーなら状態コードが返るが、どちらの形でも「受け付けなかった」ことは確かめられる
 */
export function handshakeStatus(url: string, headers: Record<string, string> = {}): Promise<number | null> {
  const target = new URL(url);
  const send = target.protocol === 'wss:' ? httpsRequest : httpRequest;
  target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
  return new Promise((resolve, reject) => {
    const handshake = send(target, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...headers,
      },
      timeout: WAIT_MS,
    });
    handshake.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 101);
    });
    handshake.on('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    handshake.on('timeout', () =>
      handshake.destroy(new Error(`${target.pathname} が ${WAIT_MS} ms のあいだに応えなかった`)),
    );
    handshake.on('error', (error: NodeJS.ErrnoException) => {
      // 応答の前に相手が切った。つなげなかったのとは分ける
      if (error.code === 'ECONNRESET') resolve(null);
      else reject(error);
    });
    handshake.end();
  });
}
