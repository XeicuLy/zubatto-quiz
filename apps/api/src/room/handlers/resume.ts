import { CLOSE_CODES, type CloseReason, type Resume } from '@zubatto-quiz/protocol';

import { getAttachment, setAttachment } from '../attachment';
import { closeReplacedConnections } from '../replace-connection';
import { resendCurrentPhase } from '../resend';
import { send } from '../send';
import { readParticipants, readRoomSnapshot } from '../snapshot';
import { hashToken } from '../token-hash';

/** resume を通す、入室からの時間（F19・ADR 0004） */
export const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

type FindResult =
  | { ok: true; participantId: string; name: string }
  | { ok: false; reason: Extract<CloseReason, 'room_ended' | 'resume_failed'> };

/** 2つのハッシュを、かかる時間から中身が漏れないように比べる。timingSafeEqual は長さが違うと例外になるので、先に長さを比べる */
function sameHash(a: ArrayBuffer, b: ArrayBuffer): boolean {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

/**
 * 秘密のハッシュから、戻ってよい回答者を探す。部屋が終わっていれば room_ended、
 * 秘密が合わないか入室から6時間を過ぎていれば resume_failed を返す
 */
function findParticipant(sql: SqlStorage, tokenHash: ArrayBuffer): FindResult {
  const { ended_at } = sql.exec<{ ended_at: number | null }>('SELECT ended_at FROM room').one();
  if (ended_at !== null) {
    return { ok: false, reason: 'room_ended' };
  }
  // resume は participantId を持たないので、秘密のハッシュから回答者を探す。
  // WHERE で引くと、比べる時間が中身で変わる。回答者は50名までなので、全員のハッシュを timingSafeEqual で比べる
  const row = sql
    .exec<{ participant_id: string; name: string; token_hash: ArrayBuffer; joined_at: number }>(
      'SELECT participant_id, name, token_hash, joined_at FROM participants',
    )
    .toArray()
    .find((participant) => sameHash(participant.token_hash, tokenHash));
  // 秘密が合わないときと6時間を過ぎたときは、同じ理由で閉じる。どちらでも端末のすることは同じなので、分けて伝えない
  if (!row || Date.now() - row.joined_at > RESUME_WINDOW_MS) {
    return { ok: false, reason: 'resume_failed' };
  }
  return { ok: true, participantId: row.participant_id, name: row.name };
}

/**
 * 未確認の接続から来た resume を受ける（F19・ADR 0004）。token は decodeClientMessage が32バイトと確かめたもの。
 * 通れば、その接続を同じ participantId の回答者として扱い、名前・得点・部屋の要約を返す。
 * 通らなければ理由付きで閉じ、端末は保存した秘密を消して名前の入力から入り直す。
 *
 * join と同じく、await は秘密のハッシュを求める1回だけで、そのあとは同期で行う
 */
export async function handleResume(ctx: DurableObjectState, ws: WebSocket, { token }: Resume): Promise<void> {
  const tokenHash = await hashToken(token);

  // await のあいだに、時間切れで閉じられたり、同じ接続から送られた join か resume が通ったりしているかもしれない（join と同じ）
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (getAttachment(ws) !== null) {
    send(ws, { type: 'error', code: 'invalid_state' });
    return;
  }

  const { sql } = ctx.storage;
  const result = findParticipant(sql, tokenHash);

  if (!result.ok) {
    ws.close(CLOSE_CODES[result.reason], result.reason);
    return;
  }

  setAttachment(ws, { role: 'player', participantId: result.participantId });
  // 古いタブに、このあとの配信が届かないよう、resumed を送る前に閉じる
  closeReplacedConnections(ctx, ws, result.participantId);
  // 得点は確定した問題の点の合計。まだ1問も確定していなければ0点
  const { score } = sql
    .exec<{ score: number }>(
      'SELECT coalesce(sum(points), 0) AS score FROM question_scores WHERE participant_id = ?',
      result.participantId,
    )
    .one();
  send(ws, {
    type: 'resumed',
    participantId: result.participantId,
    name: result.name,
    score,
    room: readRoomSnapshot(sql),
  });
  // 切れているあいだに入った人もいるので、参加者一覧も送る。ほかの人の一覧は変わらないので、本人にだけ送る
  send(ws, { type: 'participants', participants: readParticipants(sql) });
  resendCurrentPhase(ctx, ws, Date.now());
}
