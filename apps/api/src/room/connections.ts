import { CLOSE_CODES } from '@zubatto-quiz/protocol';

import { setAttachment, type Attachment } from './attachment';

/** 1部屋で受け付ける WebSocket の上限。未確認の接続・置き換えの途中の古い接続・ホストの接続を含む（ADR 0004） */
export const MAX_CONNECTIONS = 100;

/**
 * 部屋の DO が受け付けている接続のうち、開いているものの本数を数える。
 *
 * getWebSockets() は、DO が close() したあとも、相手が close を返すまでは CLOSING の接続を返す。
 * それも数えると、閉じた接続が枠を使い続けるので、readyState が OPEN のものだけを数える（ADR 0004）
 */
export function countOpenConnections(ctx: DurableObjectState): number {
  const websockets = ctx.getWebSockets();
  const openSockets = websockets.filter((websocket) => websocket.readyState === WebSocket.OPEN);
  return openSockets.length;
}

/**
 * 接続を受け付けて、101 の応答を返す。上限に達していれば、受け付けずに 4503 で閉じる（ADR 0004）。
 *
 * 本数の確認から acceptWebSocket までに await を挟まない。DO は1つのスレッドで動くので、
 * 同時に来た接続も1本ずつここを通り、間に別の接続が割り込んで100本を超えることがない
 */
export function acceptConnection(ctx: DurableObjectState, attachment: Attachment): Response {
  const { 0: client, 1: server } = new WebSocketPair();

  if (countOpenConnections(ctx) >= MAX_CONNECTIONS) {
    // HTTP の 503 で断ると、ブラウザには理由のない切断（1006）にしか見えない。いったん開いて code で理由を伝え、
    // 端末が間を空けて再接続できるようにする。accept() で受けた接続は休止の対象にならず、getWebSockets() にも数えない
    server.accept();
    server.close(CLOSE_CODES.connection_limit, 'connection_limit');
    return new Response(null, { status: 101, webSocket: client });
  }

  ctx.acceptWebSocket(server);
  // 回答者用の接続は何も書かず、null（未確認）のままにする。join か resume が通ったら player を書く（T19）
  if (attachment) {
    setAttachment(server, attachment);
  }
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * どの入口から来た接続か。Worker が確かめた結果だけを DO に渡す。
 * host の ownerId は Cookie のセッションから Worker が決めた値で、DO はこれを部屋の持ち主と比べる（ADR 0003）
 */
export type RoomEntry = { role: 'host'; ownerId: string } | { role: 'player' };

/** Worker から DO へ ownerId を渡す内部のヘッダー。roomRequest が作った要求にしか付かない */
const OWNER_ID_HEADER = 'x-zubakui-owner-id';

/**
 * Worker から部屋の DO へ渡す要求を、一から作る（ADR 0003・0004）。
 *
 * ブラウザの要求を写して直すのではなく、DO に要るものだけを入れる。Cookie も、外から付けられた偽の ownerId のヘッダーも、
 * 作りの上で DO に届かない。URL のホスト名は DO の中でしか使わないので、何でもよい
 */
export function roomRequest(entry: RoomEntry): Request {
  const headers = new Headers({ upgrade: 'websocket' });
  if (entry.role === 'host') {
    headers.set(OWNER_ID_HEADER, entry.ownerId);
  }
  return new Request(`https://room/${entry.role}`, { headers });
}

/** roomRequest が作った要求から、入口を読み戻す。知らない経路は undefined */
export function readRoomEntry(request: Request): RoomEntry | undefined {
  const { pathname } = new URL(request.url);
  if (pathname === '/player') {
    return { role: 'player' };
  }
  const ownerId = request.headers.get(OWNER_ID_HEADER);
  if (pathname === '/host' && ownerId !== null) {
    return { role: 'host', ownerId };
  }
  return undefined;
}
