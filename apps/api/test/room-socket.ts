import type { ClientMessage, Joined, ServerMessage } from '@zubatto-quiz/protocol';
import { env } from 'cloudflare:workers';
import { expect } from 'vitest';

import { roomRequest, type RoomEntry } from '../src/room/connections';

/** newRoom が作る問題。n 問目（1始まり）の ID は q-n で、制限時間は10秒。正解はどれも0番目 */
export const testQuestion = (n: number) => ({
  id: `q-${n}`,
  text: n === 1 ? '社長の好物は？' : `第${n}問`,
  choices: ['寿司', '焼肉'],
  correctIndex: 0,
  limitMs: 10_000,
});

/**
 * 持ち主が alice で、問題が questionCount 問（既定は1問）ある部屋の DO を作る。newUniqueId なので、ほかのテストの部屋と混ざらない。
 * joined などに入れる部屋の要約は、問題が1問以上ないと仕様に合わない（questionCount は1以上）
 */
export async function newRoom(ownerId = 'alice', questionCount = 1) {
  const stub = env.ROOM.get(env.ROOM.newUniqueId());
  await stub.initialize({
    ownerId,
    title: 'テストの部屋',
    questions: Array.from({ length: questionCount }, (_, i) => testQuestion(i + 1)),
  });
  return stub;
}

export type RoomStub = Awaited<ReturnType<typeof newRoom>>;

/**
 * WebSocket の Upgrade の応答から、端末の側の WebSocket を取り出して使い始める。
 * 101 でなければ（Worker や DO が断ったら）テストを失敗させる
 */
export function openSocket(response: Response): WebSocket {
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (!ws) {
    throw new Error('応答に WebSocket がない');
  }
  ws.accept();
  return ws;
}

/** Worker を通さず、部屋の DO へ直接つなぐ */
export const connect = async (stub: RoomStub, entry: RoomEntry) => openSocket(await stub.fetch(roomRequest(entry)));

/** サーバーが閉じたときの code と reason を待つ */
export const closeOf = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', ({ code, reason }) => resolve({ code, reason }));
  });

/**
 * サーバーから届いたメッセージを、届いた順に1つずつ読む関数を返す。
 * 読む前に届いたメッセージも取りこぼさないよう、呼んだときから受け取り始めて溜めておく
 */
export function messageReader(ws: WebSocket): () => Promise<unknown> {
  const received: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  ws.addEventListener('message', ({ data }) => {
    const message: unknown = JSON.parse(String(data));
    const resolve = waiting.shift();
    if (resolve) {
      resolve(message);
    } else {
      received.push(message);
    }
  });
  return () =>
    received.length > 0 ? Promise.resolve(received.shift()) : new Promise((resolve) => waiting.push(resolve));
}

export type Socket = { ws: WebSocket; next: () => Promise<unknown> };

/** 指定した種類のメッセージが届くまで読み進める。参加者一覧や出題など、そのテストで見ないものは読み飛ばす */
export async function nextOf<T extends ServerMessage['type']>(socket: Socket, type: T) {
  for (;;) {
    const message = (await socket.next()) as ServerMessage;
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

/**
 * ホスト用の入口につなぎ、受け付けたときに届く hostReady と参加者一覧を読み終えた状態で返す。
 * 待機中の部屋なら、このあとに届くのは進行の配信だけになる
 */
export async function connectHost(stub: RoomStub, ownerId = 'alice') {
  const ws = await connect(stub, { role: 'host', ownerId });
  const socket = { ws, next: messageReader(ws) };
  const closed = closeOf(ws);
  await nextOf(socket, 'hostReady');
  await nextOf(socket, 'participants');
  return { ...socket, closed };
}

/** drain が送る、仕様に合わない文字列への返事 */
const syncReply = JSON.stringify({ type: 'error', code: 'invalid_message' });

/**
 * これまでの処理でこの接続へ届いたメッセージを、まとめて返す。
 * 送るものがない処理もあるので、仕様に合わない文字列を送り、その invalid_message が届くまでを1回分とみなす。
 * 同じ接続のメッセージは、部屋の DO が届いた順に1つずつ処理する
 */
export async function drain(socket: Socket): Promise<ServerMessage[]> {
  socket.ws.send('sync');
  const received: ServerMessage[] = [];
  for (;;) {
    const reply = await socket.next();
    if (JSON.stringify(reply) === syncReply) {
      return received;
    }
    received.push(reply as ServerMessage);
  }
}

/** メッセージを送り、それを処理するあいだにこの接続へ届いたメッセージを返す */
export async function exchange(socket: Socket, message: ClientMessage): Promise<ServerMessage[]> {
  socket.ws.send(JSON.stringify(message));
  return drain(socket);
}

/** 端末が作るのと同じ、32バイトの乱数を base64url（= なし）にした秘密 */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** 回答者用の入口につなぎ、join を通して participantId を返す */
export async function joinPlayer(stub: RoomStub, name: string, token = newToken()) {
  const ws = await connect(stub, { role: 'player' });
  const next = messageReader(ws);
  const closed = closeOf(ws);
  ws.send(JSON.stringify({ type: 'join', name, token }));
  const { participantId } = (await next()) as Joined;
  return { ws, next, closed, participantId };
}

/** 回答者用の入口に新しくつなぎ、resume を送る */
export async function resumePlayer(stub: RoomStub, token: string) {
  const ws = await connect(stub, { role: 'player' });
  const next = messageReader(ws);
  const closed = closeOf(ws);
  ws.send(JSON.stringify({ type: 'resume', token }));
  return { ws, next, closed };
}
