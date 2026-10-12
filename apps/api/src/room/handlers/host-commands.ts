import { CLOSE_CODES, type HostCommand, type RoomPhase } from '@zubatto-quiz/protocol';

import { scheduleAlarm } from '../alarm';
import { answeringStartedOf, questionShownOf, readQuestionRow } from '../resend';
import { broadcast, send } from '../send';
import { transition, type RoomState, type TransitionResult } from '../state-machine';
import { scoreQuestion, sendResults } from './close-question';

type RoomRow = {
  phase: RoomPhase;
  current_position: number | null;
  ended_at: number | null;
  deadline_at: number | null;
};

const readRoomRow = (sql: SqlStorage): RoomRow =>
  sql.exec<RoomRow>('SELECT phase, current_position, ended_at, deadline_at FROM room').one();

const toState = (row: RoomRow): RoomState => ({
  phase: row.phase,
  questionIndex: row.current_position,
  ended: row.ended_at !== null,
});

/**
 * 進行操作を当てて、SQLite に書き、全員に配る。受け付けない操作なら何もせずに { ok: false } を返す。
 * ホストの操作と、alarm の自動の締切の両方がここを通る。
 *
 * await を挟まず、SQLite の読み書きだけで済ませる。D1 にも外部にも問い合わせないので、P1 の1秒の大半を配信に使える（ADR 0003）
 */
function applyHostCommand(ctx: DurableObjectState, command: HostCommand, now: number): TransitionResult {
  const { sql } = ctx.storage;
  const room = readRoomRow(sql);
  const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM questions').one();
  const result = transition(toState(room), command, count);
  if (!result.ok) {
    return result;
  }
  const { next } = result;
  // 正解（correct_index）は締切まで DO の外へ出さないので、ここでは読まない。締切の集計（close-question.ts）でだけ読む（S2）
  const question = next.questionIndex === null ? undefined : readQuestionRow(sql, next.questionIndex);

  ctx.storage.transactionSync(() => {
    // やり直しでは、その問題の回答だけを消す。締切まで終えた問題の得点は残す（A3）
    if (command.type === 'retryQuestion' && question) {
      sql.exec('DELETE FROM answers WHERE question_id = ?', question.id);
    }
    // 締切では、段階を ① に移すのと同じトランザクションで得点を確定する。alarm の締切もここを通る（A3）
    if (command.type === 'closeAnswering' && question) {
      scoreQuestion(sql, question.id, now);
    }
    // 締切は受付中のあいだだけ持つ。部屋を終えたら、受付中だった問題の締切も捨てる
    const deadlineAt = next.phase === 'accepting' && !next.ended && question ? now + question.limit_ms : null;
    sql.exec(
      'UPDATE room SET phase = ?, current_position = ?, deadline_at = ?, ended_at = ?',
      next.phase,
      next.questionIndex,
      deadlineAt,
      // 終えた部屋への操作は transition が断るので、ここで終えるのは1回だけ
      next.ended ? now : null,
    );
  });

  if (next.ended) {
    // 未確認の接続も含めて、すべて閉じる。閉じたあとの端末は、自動で再接続しない
    for (const ws of ctx.getWebSockets()) {
      ws.close(CLOSE_CODES.room_ended, 'room_ended');
    }
    return result;
  }
  if (!question) {
    return result;
  }
  // 出題とやり直しは問題文だけ、受付開始で選択肢を配る。①②③と最終ランキングは、締切で確定した得点から作って配る
  if (next.phase === 'question') {
    broadcast(ctx, questionShownOf(question, count));
  } else if (next.phase === 'accepting') {
    // 締切を alarm に入れる。未確認の接続の時刻と比べて、早いほうに予定する
    scheduleAlarm(ctx);
    broadcast(ctx, answeringStartedOf(question, question.limit_ms));
  } else {
    sendResults(ctx, next.phase, question.position);
  }
  return result;
}

/**
 * ホスト用の接続から来た進行操作を受ける（F8）。role が host かどうかは、呼ぶ前に attachment で確かめておく（ADR 0003）。
 * 今の段階と合わない操作（番号の違い・2度押し・飛ばしなど）は、送った人にだけ invalid_state を返す
 */
export function handleHostCommand(ctx: DurableObjectState, ws: WebSocket, command: HostCommand): void {
  const now = Date.now();
  // alarm は最大1分ほど遅れるので、締切を過ぎても受付中のままのことがある。操作を当てる前に締め切り、
  // 締切までの回答をやり直しで消さないようにする（A3）。締切の時刻は SQLite にあるので、同期で確かめられる
  closeAnsweringIfDue(ctx, now);
  if (!applyHostCommand(ctx, command, now).ok) {
    send(ws, { type: 'error', code: 'invalid_state' });
  }
}

/**
 * 受付中で締切を過ぎていれば、ホストの締切と同じ操作で締め切る（F9）。alarm と、進行操作を当てる前の両方で呼ぶ。
 * alarm は2回動くこともあるが、締め切ったあとは受付中でなくなるので、2回目は何もしない（ADR 0004）
 */
export function closeAnsweringIfDue(ctx: DurableObjectState, now: number): void {
  const room = readRoomRow(ctx.storage.sql);
  // deadline_at は、受付中で部屋を終えていないときだけ値を持つ
  if (room.deadline_at === null || now < room.deadline_at) {
    return;
  }
  applyHostCommand(ctx, { type: 'closeAnswering', questionIndex: room.current_position ?? 0 }, now);
}
