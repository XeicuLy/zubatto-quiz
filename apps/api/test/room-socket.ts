import { env } from 'cloudflare:workers';
import { expect } from 'vitest';

/** 持ち主が alice で、問題のない部屋の DO を作る。newUniqueId なので、ほかのテストの部屋と混ざらない */
export async function newRoom(ownerId = 'alice') {
  const stub = env.ROOM.get(env.ROOM.newUniqueId());
  await stub.initialize({ ownerId, title: 'テストの部屋', questions: [] });
  return stub;
}

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

/** サーバーが閉じたときの code と reason を待つ */
export const closeOf = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', ({ code, reason }) => resolve({ code, reason }));
  });
