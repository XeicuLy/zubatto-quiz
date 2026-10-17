import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { requireHost, type HostEnv } from '../auth/require-host';
import { refuseConnection, roomRequest } from '../room/connections';

type WsEnv = { Bindings: Env; Variables: HostEnv['Variables'] & { room: DurableObjectStub } };

/**
 * Origin が画面の Worker のオリジンと同じでなければ、Cookie を読む前に 403 で断る（S1・ADR 0003・0004・0006）。
 *
 * 転送された要求の URL は画面の Worker のものなので、許可リストを持たずに要求の URL のオリジンと比べればよい。
 * SameSite=Lax は同じサイトの別のオリジン（同じアカウントの別の Worker、localhost の別のポート）を止められないので、ここが主な守りになる。
 * ブラウザは WebSocket に必ず Origin を付けるので、Origin のない要求も断る。
 * ブラウザは WebSocket の失敗の応答を読めないので、本文は付けない
 */
const requireSameOrigin = createMiddleware<WsEnv>(async (c, next) => {
  if (c.req.header('origin') !== new URL(c.req.url).origin) {
    return c.body(null, 403);
  }
  await next();
});

/** WebSocket の Upgrade の要求でなければ 426 で断る */
const requireUpgrade = createMiddleware<WsEnv>(async (c, next) => {
  if (c.req.header('upgrade') !== 'websocket') {
    return c.body(null, 426);
  }
  await next();
});

/** 部屋の ID の形。POST /api/rooms が返す id.toString() と同じ、64桁の小文字の16進 */
const ROOM_ID = /^[0-9a-f]{64}$/;

/**
 * 経路の部屋 ID から部屋の DO を決める。形が違う ID と、この名前空間で作られていない ID は、ない部屋として 4404 で閉じる。
 * 作られていない部屋（initialize していない DO）と他人の部屋は、DO の中で同じ 4404 にする（ADR 0004）。
 *
 * 画面は ID の形を先に確かめるが、形が正しくても別の名前空間の ID は idFromString で落ちる。
 * HTTP の 404 にすると、ブラウザには 1006 にしか見えず、端末がつなぎ直し続けるので、受け付けてから code で閉じる
 */
const requireRoom = createMiddleware<WsEnv>(async (c, next) => {
  const roomId = c.req.param('roomId') ?? '';
  if (!ROOM_ID.test(roomId)) {
    return refuseConnection('room_not_found');
  }
  let id: DurableObjectId;
  try {
    id = c.env.ROOM.idFromString(roomId);
  } catch {
    return refuseConnection('room_not_found');
  }
  c.set('room', c.env.ROOM.get(id));
  await next();
});

/**
 * 部屋の WebSocket の入口（ADR 0003・0004）。index.ts で /api/rooms/:roomId/ws に置く。
 *
 * 関所は軽い順に並べ、Origin は Cookie を読む前に確かめる。DO へはブラウザの要求を渡さず、roomRequest で作り直した要求を渡す。
 * 本数の上限と、ホストが部屋の持ち主かどうかは、DO が確かめる
 */
export const wsRoutes = new Hono<WsEnv>()
  .use(requireSameOrigin, requireUpgrade, requireRoom)
  // ホスト用。Cookie のセッションから ownerId を決めて DO に渡す（ADR 0003）
  .get('/host', requireHost, (c) => c.var.room.fetch(roomRequest({ role: 'host', ownerId: c.var.ownerId })))
  // 回答者用。Cookie を読まず、DO にも渡さない。回答者は最初のメッセージの join か resume で名乗る（ADR 0004）
  .get('/play', (c) => c.var.room.fetch(roomRequest({ role: 'player' })));
