import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractSocket, handshakeStatus, loginAsHost, request, roomSocketUrl, type HostSession } from './client.ts';

const origin = 'http://localhost:4173';
const session: HostSession = { origin, cookie: 'better-auth.session_token=abc' };
const questionSetId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const roomId = 'a'.repeat(64);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('roomSocketUrl', () => {
  it.each([
    ['http://localhost:4173', 'host', `ws://localhost:4173/api/rooms/${roomId}/ws/host`],
    ['https://zubakui.example', 'play', `wss://zubakui.example/api/rooms/${roomId}/ws/play`],
  ] as const)('%s の %s の入口は ws か wss の URL になる', (base, entry, expected) => {
    expect(roomSocketUrl(base, roomId, entry)).toBe(expected);
  });
});

describe('HTTP', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('loginAsHost はテスト用のログインが返した Cookie を、Cookie ヘッダーの形にする', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        cookies: [
          { name: 'better-auth.session_token', value: 'abc', domain: 'localhost' },
          { name: 'other', value: 'x', domain: 'localhost' },
        ],
      }),
    );

    await expect(loginAsHost(origin)).resolves.toEqual({
      origin,
      cookie: 'better-auth.session_token=abc; other=x',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${origin}/api/e2e/login`);
    expect(init?.method).toBe('POST');
  });

  it('loginAsHost は、ログインに失敗したら状態コードを書いて投げる', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));

    await expect(loginAsHost(origin)).rejects.toThrow(/\/api\/e2e\/login が 404/);
  });

  it('request は openapi.json のキーの {id} を埋め、ブラウザと同じ Origin と Cookie を付けて送る', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      request(session, 'PUT /api/question-sets/{id}', { params: { id: questionSetId }, body: { title: 't' } }),
    ).resolves.toEqual({ status: 204, body: undefined });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${origin}/api/question-sets/${questionSetId}`);
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"title":"t"}');
    expect(new Headers(init?.headers).get('origin')).toBe(origin);
    expect(new Headers(init?.headers).get('sec-fetch-site')).toBe('same-origin');
    expect(new Headers(init?.headers).get('cookie')).toBe(session.cookie);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('request は cookie のない呼び手なら、Cookie を付けずに送る（ログインしていない人）', async () => {
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized' }));

    await expect(request({ origin }, 'GET /api/question-sets')).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  });

  it('request は応答を openapi.json で調べ、状態コードと読んだ本文を返す', async () => {
    fetchMock.mockResolvedValue(json(201, { id: questionSetId }));

    await expect(request(session, 'POST /api/question-sets', { body: {} })).resolves.toEqual({
      status: 201,
      body: { id: questionSetId },
    });
  });

  it('request は openapi.json に合わない応答で投げる', async () => {
    fetchMock.mockResolvedValue(json(201, { id: 'not-a-uuid' }));

    await expect(request(session, 'POST /api/question-sets', { body: {} })).rejects.toThrow(/openapi\.json|POST/);
  });

  it('request は埋めていない {id} が残ったら、送る前に投げる', async () => {
    await expect(request(session, 'GET /api/question-sets/{id}')).rejects.toThrow(/\{id\}/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Node の WebSocket の代わり。開く・届く・閉じるをテストから起こす */
class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static last: FakeWebSocket | undefined;
  readyState = 0;
  readonly sent: string[] = [];

  constructor(
    readonly url: string,
    readonly options: { headers: Record<string, string> },
  ) {
    super();
    FakeWebSocket.last = this;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.serverClose(1000);
  }

  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  serverSend(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
  }

  serverClose(code: number) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}

describe('ContractSocket', () => {
  const hostReady = {
    type: 'hostReady',
    room: { title: 't', questionCount: 3, phase: 'lobby', questionIndex: null },
  };

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 開いた ContractSocket と、その下の偽の WebSocket */
  async function openSocket(cookie?: string) {
    const socket = new ContractSocket({ url: 'ws://localhost:4173/x', origin, cookie });
    const fake = FakeWebSocket.last!;
    fake.serverOpen();
    await socket.opened;
    return { socket, fake };
  }

  it('Origin と、渡したときだけ Cookie を付けて開く', async () => {
    const { fake: withCookie } = await openSocket(session.cookie);
    expect(withCookie.options.headers).toEqual({ Origin: origin, Cookie: session.cookie });
    const { fake: withoutCookie } = await openSocket();
    expect(withoutCookie.options.headers).toEqual({ Origin: origin });
  });

  it('送るメッセージを JSON にして送る', async () => {
    const { socket, fake } = await openSocket();
    socket.send({ type: 'showQuestion', questionIndex: 0 });
    expect(fake.sent).toEqual(['{"type":"showQuestion","questionIndex":0}']);
  });

  it('waitFor は、待つ前に届いていたものも含めて、type と条件に合うメッセージを返す', async () => {
    const { socket, fake } = await openSocket();
    fake.serverSend({ type: 'participants', participants: [] });
    fake.serverSend(hostReady);

    await expect(socket.waitFor('hostReady')).resolves.toEqual(hostReady);
    const later = socket.waitFor(
      'participants',
      (message) => Array.isArray(message.participants) && message.participants.length === 1,
    );
    const participant = { participantId: questionSetId, name: 'たろう' };
    fake.serverSend({ type: 'participants', participants: [participant] });
    await expect(later).resolves.toEqual({ type: 'participants', participants: [participant] });
    expect(socket.types).toEqual(new Set(['participants', 'hostReady']));
  });

  it('messages は、スキーマに合うメッセージを届いた順に返す', async () => {
    const { socket, fake } = await openSocket();
    fake.serverSend(hostReady);
    fake.serverSend({ type: 'participants', participants: [] });

    expect(socket.messages).toEqual([hostReady, { type: 'participants', participants: [] }]);
  });

  it('ws.schema.json に合わないメッセージが届いたら、待っている waitFor をすぐ失敗させる', async () => {
    const { socket, fake } = await openSocket();
    const waiting = socket.waitFor('hostReady');
    fake.serverSend({ ...hostReady, correctIndex: 0 });

    await expect(waiting).rejects.toThrow(/ws\.schema\.json の hostReady/);
    // 合わないものが一度でも届いたら、あとから待っても同じ理由で失敗する
    await expect(socket.waitFor('participants')).rejects.toThrow(/ws\.schema\.json の hostReady/);
  });

  it('JSON として読めないメッセージも失敗にする', async () => {
    const { socket, fake } = await openSocket();
    fake.serverSend('not json');

    await expect(socket.waitFor('hostReady')).rejects.toThrow(/JSON として読めない/);
  });

  it('届く前に閉じたら、閉じたときの code を書いて失敗し、closed は code で解決する', async () => {
    const { socket, fake } = await openSocket();
    const waiting = socket.waitFor('hostReady');
    fake.serverClose(4410);

    await expect(waiting).rejects.toThrow(/hostReady が届く前に閉じた（close code 4410）/);
    await expect(socket.closed).resolves.toBe(4410);
  });

  it('最後の waitFor のあとに合わないメッセージが届いて閉じたら、closed もその理由で失敗する', async () => {
    const { socket, fake } = await openSocket();
    fake.serverSend(hostReady);
    await socket.waitFor('hostReady');
    fake.serverSend({ ...hostReady, correctIndex: 0 });
    fake.serverClose(4410);

    await expect(socket.closed).rejects.toThrow(/ws\.schema\.json の hostReady/);
  });

  it('待つ上限を過ぎたら失敗する', async () => {
    const { socket } = await openSocket();

    await expect(socket.waitFor('hostReady', undefined, 10)).rejects.toThrow(
      /hostReady が 10 ms のあいだに届かなかった/,
    );
  });

  it('開く前に閉じたら、opened が code を書いて失敗する', async () => {
    const socket = new ContractSocket({ url: 'ws://localhost:4173/x', origin });
    FakeWebSocket.last!.serverClose(1006);

    await expect(socket.opened).rejects.toThrow(/close code 1006/);
  });
});

describe('handshakeStatus', () => {
  const server = createServer();
  /** 最後に届いた要求のヘッダー */
  let received: IncomingHttpHeaders | undefined;
  let url = '';

  beforeEach(async () => {
    received = undefined;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms/${roomId}/ws/play`;
  });

  afterEach(async () => {
    server.removeAllListeners('request');
    server.removeAllListeners('upgrade');
    await new Promise((resolve) => server.close(resolve));
  });

  it('WebSocket の Upgrade の要求を、渡したヘッダーだけを足して送り、断られたときの状態コードを返す', async () => {
    server.on('upgrade', (incoming, socket) => {
      received = incoming.headers;
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });

    await expect(handshakeStatus(url, { Cookie: session.cookie })).resolves.toBe(403);
    expect(received).toMatchObject({
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-version': '13',
      cookie: session.cookie,
    });
    expect(received?.['sec-websocket-key']).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    // Origin は渡したときだけ付く。Node はブラウザと違って自分では付けない
    expect(received).not.toHaveProperty('origin');
  });

  it('応答を返さずに切られたら null を返す（vite preview は 101 でない応答をこう扱う）', async () => {
    server.on('upgrade', (_incoming, socket) => socket.destroy());

    await expect(handshakeStatus(url)).resolves.toBeNull();
  });

  it('つなげなかったら、切られたのとは分けて失敗する', async () => {
    await new Promise((resolve) => server.close(resolve));

    await expect(handshakeStatus(url)).rejects.toThrow(/ECONNREFUSED/);
    // afterEach で閉じ直せるよう、もう一度立てておく
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  it('受け付けられたら 101 を返し、開いた接続はすぐ閉じる', async () => {
    const clientClosed = new Promise<void>((resolve) => {
      server.on('upgrade', (incoming, socket) => {
        received = incoming.headers;
        // 相手が閉じたことは end で分かる。upgrade の socket は読むまで止まっているので、流しておく。
        // こちらの側も閉じないと、server.close() がこの socket を待ち続ける
        socket.resume();
        socket.on('end', () => {
          socket.end();
          resolve();
        });
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      });
    });

    await expect(handshakeStatus(url, { Origin: origin })).resolves.toBe(101);
    expect(received).toMatchObject({ origin });
    await clientClosed;
  });
});
