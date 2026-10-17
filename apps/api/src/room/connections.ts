import { CLOSE_CODES, type CloseReason } from '@zubatto-quiz/protocol';

import { getAttachment, setAttachment, type Attachment } from './attachment';
import { acceptedAtTag, closeExpiredPending } from './pending-timeout';

/**
 * 回答者用の入口から受け付ける WebSocket の上限。未確認の接続と、置き換えの途中の古い接続を含む（ADR 0004）。
 * 回答者50名に対して約2倍の余裕を持たせる
 */
export const MAX_CONNECTIONS = 100;

/**
 * ホスト用の入口から受け付ける WebSocket の上限。回答者用の100本とは別に数える（ADR 0004）。
 * 部屋の URL を知る人が回答者用の100本を埋めても、ホストがつなげて進行を止めないようにするため。
 * PC とスマホの両方で開いたり、リロードが重なったりしても足りる本数にする
 */
export const MAX_HOST_CONNECTIONS = 5;

/**
 * 部屋の DO が受け付けている接続のうち、開いているものの本数を、ホスト用と回答者用の枠に分けて数える。
 * 回答者用（player）には、未確認の接続も含む。
 *
 * getWebSockets() は、DO が close() したあとも、相手が close を返すまでは CLOSING の接続を返す。
 * それも数えると、閉じた接続が枠を使い続けるので、readyState が OPEN のものだけを数える（ADR 0004）
 */
export function countOpenConnections(ctx: DurableObjectState): Record<RoomEntry['role'], number> {
  const websockets = ctx.getWebSockets();
  const openSockets = websockets.filter((websocket) => websocket.readyState === WebSocket.OPEN);
  const roleHost = openSockets
    .map((openSocket) => getAttachment(openSocket))
    .filter((attachment) => attachment?.role === 'host');
  return { host: roleHost.length, player: openSockets.length - roleHost.length };
}

/**
 * 接続を受け付けずに、理由の code で閉じる。101 の応答を返す。
 *
 * HTTP の 4xx や 503 で断ると、ブラウザには理由のない切断（1006）にしか見えない。いったん開いて code で理由を伝え、
 * 端末がつなぎ直すか（connection_limit）、やめるか（room_ended・room_not_found）を決められるようにする。
 * accept() で受けた接続は休止の対象にならず、getWebSockets() にも数えない。
 * WebSocketPair は DO の外でも使えるので、Worker の入口（routes/ws.ts）もこれで断る
 */
export function refuseConnection(
  reason: Extract<CloseReason, 'connection_limit' | 'room_ended' | 'room_not_found'>,
): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(CLOSE_CODES[reason], reason);
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * 接続を受け付けて、101 の応答と、受け付けた接続を返す。その接続の枠が上限に達していれば、受け付けずに 4503 で閉じ、
 * 接続は返さない（ADR 0004）。
 *
 * 本数の確認から acceptWebSocket までに await を挟まない。DO は1つのスレッドで動くので、
 * 同時に来た接続も1本ずつここを通り、間に別の接続が割り込んで上限を超えることがない。
 *
 * 数える前に、時間を過ぎた未確認の接続を閉じる。alarm は最大1分ほど遅れることがあるので、
 * 遅れても未確認の接続が枠を埋めていられる時間を10秒ほどに抑えるため（ADR 0004）
 */
export function acceptConnection(
  ctx: DurableObjectState,
  attachment: Attachment,
): { response: Response; accepted?: WebSocket } {
  // ホスト用の接続はホストの枠、回答者用の接続（attachment が null）は回答者用の枠と比べる
  const role = attachment?.role === 'host' ? 'host' : 'player';
  const limit = role === 'host' ? MAX_HOST_CONNECTIONS : MAX_CONNECTIONS;
  const now = Date.now();
  closeExpiredPending(ctx, now);

  if (countOpenConnections(ctx)[role] >= limit) {
    return { response: refuseConnection('connection_limit') };
  }

  const { 0: client, 1: server } = new WebSocketPair();
  // 回答者用の接続は attachment を書かず、null（未確認）のままにする。join か resume が通ったら player を書く。
  // 未確認のあいだの時間切れを確かめられるよう、受け付けた時刻をタグに入れる
  if (attachment) {
    ctx.acceptWebSocket(server);
    setAttachment(server, attachment);
  } else {
    ctx.acceptWebSocket(server, [acceptedAtTag(now)]);
  }
  return { response: new Response(null, { status: 101, webSocket: client }), accepted: server };
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
