import { CLOSE_CODES, type CloseReason, type Join } from '@zubatto-quiz/protocol';

import { getAttachment, setAttachment } from '../attachment';
import { normalizeName } from '../normalize-name';
import { broadcast, send } from '../send';
import { readParticipants, readRoomSnapshot } from '../snapshot';
import { hashToken } from '../token-hash';

/** 1部屋の回答者の上限（SC1） */
export const MAX_PARTICIPANTS = 50;

type InsertResult =
  | { ok: true; participantId: string }
  | { ok: false; reason: Extract<CloseReason, 'room_ended' | 'room_full' | 'name_taken'> };

/**
 * 未確認の接続から来た join を受ける（F2・ADR 0004）。name と token は decodeClientMessage が確かめたもの。
 * token が32バイトでなければ、decode の時点で invalid_message になり、ここへは来ない。
 *
 * await は秘密のハッシュを求める1回だけで、そのあとの確認から挿入までは同期で行う。
 * DO は1つのスレッドで動くので、同時に来た2件の join が、両方とも49名を見て50名を超えることがない
 */
export async function handleJoin(ctx: DurableObjectState, ws: WebSocket, { name, token }: Join): Promise<void> {
  // 見えない文字だけの名前は、protocol の検査を通っても、画面では空に見える。仕様に合わない名前として断る
  const normalizedName = normalizeName(name);
  if (normalizedName === '') {
    send(ws, { type: 'error', code: 'invalid_message' });
    return;
  }

  const tokenHash = await hashToken(token);

  // await のあいだに、同じ接続から送られた別の join が通っているかもしれない。1本の接続で2人を登録しない
  if (getAttachment(ws) !== null) {
    send(ws, { type: 'error', code: 'invalid_state' });
    return;
  }

  const { sql } = ctx.storage;
  const result = ctx.storage.transactionSync((): InsertResult => {
    const { ended_at } = sql.exec<{ ended_at: number | null }>('SELECT ended_at FROM room').one();
    if (ended_at !== null) {
      return { ok: false, reason: 'room_ended' };
    }
    // 満員のときは名前を変えても入れないので、かぶりより先に確かめる
    const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM participants').one();
    if (count >= MAX_PARTICIPANTS) {
      return { ok: false, reason: 'room_full' };
    }
    const taken = sql.exec('SELECT 1 FROM participants WHERE normalized_name = ?', normalizedName).toArray();
    if (taken.length > 0) {
      return { ok: false, reason: 'name_taken' };
    }

    const participantId = crypto.randomUUID();
    sql.exec(
      'INSERT INTO participants (participant_id, name, normalized_name, token_hash, joined_at) VALUES (?, ?, ?, ?, ?)',
      participantId,
      name,
      normalizedName,
      tokenHash,
      Date.now(),
    );
    return { ok: true, participantId };
  });

  if (!result.ok) {
    ws.close(CLOSE_CODES[result.reason], result.reason);
    return;
  }

  // ここで初めて確認済みになる。休止のあとも attachment は残る
  setAttachment(ws, { role: 'player', participantId: result.participantId });
  // 秘密は端末が持っているので返さない
  send(ws, { type: 'joined', participantId: result.participantId, room: readRoomSnapshot(sql) });
  broadcast(ctx, { type: 'participants', participants: readParticipants(sql) });
}
