import { encodeServerMessage } from '@zubatto-quiz/protocol';

import { getAttachment } from './attachment';

type ServerMessageInput = Parameters<typeof encodeServerMessage>[0];

/**
 * 1つの接続へ送る。仕様にない項目は encodeServerMessage が落とす。
 * 開いていない接続には送らない。join の await のあいだに端末が切ると、閉じた接続への送信が例外になり、
 * 続く参加者一覧の配信まで止まってしまうため
 */
export function send(ws: WebSocket, message: ServerMessageInput): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeServerMessage(message));
  }
}

/**
 * ホストと、join か resume が通った回答者の、開いている接続のすべてへ同じ内容を送る。
 * 未確認の接続には送らない。部屋の URL を知るだけの人に、参加者の名前などを見せないため
 */
export function broadcast(ctx: DurableObjectState, message: ServerMessageInput): void {
  sendWhere(ctx, message, (ws) => getAttachment(ws) !== null);
}

/** ホスト用の、開いている接続のすべてへ送る。回答数のように、進行画面にだけ出すもの */
export function sendToHosts(ctx: DurableObjectState, message: ServerMessageInput): void {
  sendWhere(ctx, message, (ws) => getAttachment(ws)?.role === 'host');
}

function sendWhere(ctx: DurableObjectState, message: ServerMessageInput, isTarget: (ws: WebSocket) => boolean): void {
  // 仕様の検査と JSON にするのは、送る相手の数によらず1回で済ませる
  const data = encodeServerMessage(message);
  for (const ws of ctx.getWebSockets()) {
    if (ws.readyState === WebSocket.OPEN && isTarget(ws)) {
      ws.send(data);
    }
  }
}
