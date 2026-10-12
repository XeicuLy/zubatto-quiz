import type { Joined, ServerMessage } from '@zubatto-quiz/protocol';
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
