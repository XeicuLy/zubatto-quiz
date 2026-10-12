import { CLOSE_CODES } from '@zubatto-quiz/protocol';

import { getAttachment } from './attachment';

/**
 * 同じ回答者の古い接続を、4301 replaced で閉じる（ADR 0004 の X1）。resume が通った直後に呼ぶ。
 * 新しい接続を優先するのは、スマホの回線が切れて古い接続がまだ生きているように見えても、すぐ戻れるようにするため。
 * 閉じられた側の端末は自動で再接続せず、「別のタブで開かれました」と出す。
 *
 * タグは使わない。タグは acceptWebSocket のときにしか付けられず、その時点では participantId が決まっていないため。
 * 1部屋の接続は105本までなので、すべてたどっても負担は小さい
 *
 * @param current resume が通った新しい接続。これは閉じない
 */
export function closeReplacedConnections(ctx: DurableObjectState, current: WebSocket, participantId: string): void {
  const websockets = ctx.getWebSockets();
  for (const websocket of websockets) {
    if (websocket === current) {
      continue;
    }
    const attachment = getAttachment(websocket);
    if (attachment?.role === 'player' && attachment.participantId === participantId) {
      websocket.close(CLOSE_CODES.replaced, 'replaced');
    }
  }
}
