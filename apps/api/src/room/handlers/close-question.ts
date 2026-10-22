import type { RoomPhase } from '@zubatto-quiz/protocol';
import { quickBonusPoints, scoreAnswer } from '@zubatto-quiz/scoring';

import { getAttachment } from '../attachment';
import { fastestFor, finalRankingFor, myResultsFor, readQuestionOutcome, revealedFor, standingsFor } from '../results';
import { broadcast, send, sendToHosts } from '../send';

/**
 * 締め切った問題の得点と、そのうちの早押しボーナス（F12）を確定して question_scores に書き、questions.closed_at に今の時刻を入れる（F11・A3）。
 * 進行の段階を revealed にするのと同じ transactionSync の中で呼ぶ。分けると、障害のあとに「締め切ったのに得点がない」問題が残る。
 *
 * 正解（correct_index）を読むのは、部屋の DO の中でもここと results.ts だけ（S2）。
 * 点の式は書かず、scoring の scoreAnswer に任せる（M2）。回答しなかった人の行は書かない（0点として扱う）
 */
export function scoreQuestion(sql: SqlStorage, questionId: string, now: number): void {
  // 1. この問題の正解と制限時間を読む
  const question = sql
    .exec<{ correct_index: number; limit_ms: number; closed_at: number | null }>(
      'SELECT correct_index, limit_ms, closed_at FROM questions WHERE id = ?',
      questionId,
    )
    .one();
  // 2. もう確定していれば何もしない。alarm が2回動いても、得点を2重に書かない（A3）
  if (question.closed_at !== null) {
    return;
  }

  // 3. 回答を1行ずつ採点して書く。集計の読み出しは SQL 1本で、回答者の数によらない（P4）
  const answers = sql
    .exec<{ participant_id: string; choice_index: number; elapsed_ms: number }>(
      'SELECT participant_id, choice_index, elapsed_ms FROM answers WHERE question_id = ?',
      questionId,
    )
    .toArray();
  for (const answer of answers) {
    const toScore = {
      correct: answer.choice_index === question.correct_index,
      elapsedMs: answer.elapsed_ms,
      limitMs: question.limit_ms,
    };
    sql.exec(
      'INSERT INTO question_scores (question_id, participant_id, points, bonus_points) VALUES (?, ?, ?, ?)',
      questionId,
      answer.participant_id,
      scoreAnswer(toScore),
      quickBonusPoints(toScore),
    );
  }

  // 4. 確定した印を付ける。results.ts の「前のランキングに入るか」も、この時刻と入室の時刻を比べる
  sql.exec('UPDATE questions SET closed_at = ? WHERE id = ?', now, questionId);
}

/**
 * 進行の段階が変わったときに、締切のあとの結果を配る（F13・F14・F15）。
 * ① はホストと回答者で中身が違う。回答者には、それぞれの attachment の participantId の分だけを送る（ADR 0004）。
 * ② ③ と最終ランキングは全員に同じものを配る。それ以外の段階では何もしない
 */
export function sendResults(ctx: DurableObjectState, phase: RoomPhase, questionIndex: number): void {
  if (phase !== 'revealed' && phase !== 'fastest' && phase !== 'standings' && phase !== 'final') {
    return;
  }
  const outcome = readQuestionOutcome(ctx.storage.sql, questionIndex);

  switch (phase) {
    case 'revealed': {
      sendToHosts(ctx, revealedFor(outcome));
      const myResults = myResultsFor(outcome);
      for (const ws of ctx.getWebSockets()) {
        const attachment = getAttachment(ws);
        const myResult = attachment?.role === 'player' ? myResults.get(attachment.participantId) : undefined;
        if (myResult) {
          send(ws, myResult);
        }
      }
      return;
    }
    case 'fastest':
      broadcast(ctx, fastestFor(outcome));
      return;
    case 'standings':
      broadcast(ctx, standingsFor(outcome));
      return;
    case 'final':
      broadcast(ctx, finalRankingFor(outcome));
      return;
  }
}
