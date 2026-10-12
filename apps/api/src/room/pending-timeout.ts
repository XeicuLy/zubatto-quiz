import { CLOSE_CODES } from '@zubatto-quiz/protocol';

import { getAttachment } from './attachment';

/**
 * 未確認の接続を、受け付けてから閉じるまでの時間（ADR 0004）。
 * 端末は接続が開いたらすぐに join か resume を送るので、スマホの回線で往復に数秒かかっても間に合う
 */
export const JOIN_TIMEOUT_MS = 10_000;

const ACCEPTED_AT_PREFIX = 'acceptedAt:';

/**
 * 回答者用の接続を受け付けるときに、acceptWebSocket に渡すタグ。受け付けた時刻を入れる。
 * タグは休止のあとも残る。attachment は null のまま未確認を表すので、時刻はこちらに持つ（ADR 0004）
 */
export const acceptedAtTag = (now: number): string => `${ACCEPTED_AT_PREFIX}${now}`;

/** 開いている未確認の接続と、それを閉じる時刻 */
function pendingDeadlines(ctx: DurableObjectState): { ws: WebSocket; deadline: number }[] {
  return ctx
    .getWebSockets()
    .filter((ws) => ws.readyState === WebSocket.OPEN && getAttachment(ws) === null)
    .flatMap((ws) => {
      const tag = ctx.getTags(ws).find((t) => t.startsWith(ACCEPTED_AT_PREFIX));
      return tag ? [{ ws, deadline: Number(tag.slice(ACCEPTED_AT_PREFIX.length)) + JOIN_TIMEOUT_MS }] : [];
    });
}

/**
 * 時間を過ぎた未確認の接続を 4408 で閉じる。alarm と、新しい接続を受け付ける前の両方で呼ぶ。
 * 同期の処理だけなので、本数の確認から acceptWebSocket までのあいだに呼んでも、別の接続が割り込まない。
 * 閉じた接続は CLOSING になって pendingDeadlines から外れるので、2回呼んでも同じ接続を2度閉じない
 */
export function closeExpiredPending(ctx: DurableObjectState, now: number): void {
  for (const { ws, deadline } of pendingDeadlines(ctx)) {
    if (deadline <= now) {
      ws.close(CLOSE_CODES.join_timeout, 'join_timeout');
    }
  }
}

/** 一番早く閉じる未確認の接続の時刻。未確認の接続がなければ null */
export function nextPendingDeadline(ctx: DurableObjectState): number | null {
  const deadlines = pendingDeadlines(ctx).map(({ deadline }) => deadline);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}
