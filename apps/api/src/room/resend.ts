import type { AnswerProgress, AnsweringStarted, QuestionShown, RoomPhase } from '@zubatto-quiz/protocol';

import { getAttachment } from './attachment';
import { fastestFor, finalRankingFor, myResultsFor, readQuestionOutcome, revealedFor, standingsFor } from './results';
import { send } from './send';

/**
 * つなぎ直した端末に、今の段階のメッセージを送り直す（A1・F19）。
 * 送るものは、ふだんの配信と同じ形にする。端末は、ふだんの進行と同じ処理で今の画面に戻れる。
 * 出題・受付開始・回答数のメッセージを作る関数は、配信（handlers/host-commands.ts・handlers/answer.ts）もここから使う
 */

/** 問題の1行のうち、締切の前に配ってよい列。正解（correct_index）は読まない（S2） */
export type QuestionRow = { id: string; position: number; text: string; choices: string; limit_ms: number };

export const readQuestionRow = (sql: SqlStorage, position: number): QuestionRow =>
  sql
    .exec<QuestionRow>('SELECT id, position, text, choices, limit_ms FROM questions WHERE position = ?', position)
    .one();

/** 出題。問題文だけで、選択肢はまだ送らない（P2） */
export const questionShownOf = (question: QuestionRow, questionCount: number): QuestionShown => ({
  type: 'questionShown',
  questionId: question.id,
  questionIndex: question.position,
  questionCount,
  text: question.text,
  limitMs: question.limit_ms,
});

/** 受付開始。ここで初めて選択肢を送る。remainingMs は、ふだんは limitMs と同じで、送り直しのときだけ短い */
export const answeringStartedOf = (question: QuestionRow, remainingMs: number): AnsweringStarted => ({
  type: 'answeringStarted',
  questionId: question.id,
  choices: JSON.parse(question.choices) as string[],
  limitMs: question.limit_ms,
  remainingMs,
});

/** 回答した人数（ホストへだけ送る） */
export function answerProgressOf(sql: SqlStorage, questionId: string): AnswerProgress {
  const { answeredCount } = sql
    .exec<{ answeredCount: number }>('SELECT count(*) AS answeredCount FROM answers WHERE question_id = ?', questionId)
    .one();
  const { participantCount } = sql
    .exec<{ participantCount: number }>('SELECT count(*) AS participantCount FROM participants')
    .one();
  return { type: 'answerProgress', questionId, answeredCount, participantCount };
}

/**
 * 受付中に、もう答えた回答者へ、自分の回答（answerAccepted）を送り直す。まだ答えていなければ何も送らない。
 * 送らないと、端末に選択肢がまた出て、押すと already_answered になる
 */
function resendOwnAnswer(sql: SqlStorage, ws: WebSocket, participantId: string, questionId: string): void {
  // TODO(あなた): 次の2つを書く
  // 1. answers の表から、この人（participantId）のこの問題（questionId）の choice_index と elapsed_ms を読む。
  //    行がないこともあるので、.one() ではなく .toArray()[0] で受ける（room-do.ts の fetch と同じ形）
  // 2. 行があれば、answerAccepted を send で送る。形は handlers/answer.ts の send(ws, { type: 'answerAccepted', ... }) と同じ
  const answer = sql
    .exec<{ choice_index: number; elapsed_ms: number }>(
      'SELECT choice_index, elapsed_ms FROM answers WHERE participant_id = ? AND question_id = ?',
      participantId,
      questionId,
    )
    .toArray()[0];
  if (answer) {
    send(ws, {
      type: 'answerAccepted',
      questionId,
      choiceIndex: answer.choice_index,
      elapsedMs: answer.elapsed_ms,
    });
  }
}

/** 1問の流れの段階を、進む順に並べたもの。送り直しは、今の段階までをこの順に送る */
const QUESTION_FLOW: readonly RoomPhase[] = ['question', 'accepting', 'revealed', 'fastest', 'standings'];

/**
 * join・resume が通った回答者と、つないだホストに、今の段階までのメッセージを送り直す（A1・F19）。
 * その接続にだけ send で送り、ほかの人には配らない。呼ぶ前に、attachment を host か player にしておく。
 *
 * 締切のあとも、その問題の流れを出題から順に送る。端末は questionShown で今の問題を作り直してから、続きを受け取れる。
 * ① はふだんの配信と同じく、ホストには revealed、回答者には本人の myResult だけを送る（ADR 0004）。
 * 締切の前の段階では、正解を読む results.ts を呼ばないので、正解は届かない（S2）
 */
export function resendCurrentPhase(ctx: DurableObjectState, ws: WebSocket, now: number): void {
  const { sql } = ctx.storage;
  const room = sql
    .exec<{ phase: RoomPhase; current_position: number | null; deadline_at: number | null }>(
      'SELECT phase, current_position, deadline_at FROM room',
    )
    .one();
  const position = room.current_position;
  // 待機中は、まだ問題がない。参加者一覧は呼ぶ側が送る
  if (position === null) {
    return;
  }
  if (room.phase === 'final') {
    send(ws, finalRankingFor(readQuestionOutcome(sql, position)));
    return;
  }

  const attachment = getAttachment(ws);
  const reached = (phase: RoomPhase) => QUESTION_FLOW.indexOf(room.phase) >= QUESTION_FLOW.indexOf(phase);
  const question = readQuestionRow(sql, position);
  const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM questions').one();

  send(ws, questionShownOf(question, count));
  if (!reached('accepting')) {
    return;
  }
  // 締切のあとは deadline_at が null なので、残りは0。alarm が遅れて締切を過ぎたまま受付中のときも、0 未満にしない
  send(ws, answeringStartedOf(question, Math.max(0, (room.deadline_at ?? now) - now)));
  if (room.phase === 'accepting') {
    if (attachment?.role === 'host') {
      send(ws, answerProgressOf(sql, question.id));
    } else if (attachment?.role === 'player') {
      resendOwnAnswer(sql, ws, attachment.participantId, question.id);
    }
    return;
  }

  // ここから締切のあと。結果は締切で確定した得点から作り直す（results.ts）
  const outcome = readQuestionOutcome(sql, position);
  if (attachment?.role === 'host') {
    send(ws, revealedFor(outcome));
  } else if (attachment?.role === 'player') {
    const myResult = myResultsFor(outcome).get(attachment.participantId);
    if (myResult) {
      send(ws, myResult);
    }
  }
  if (reached('fastest')) {
    send(ws, fastestFor(outcome));
  }
  if (reached('standings')) {
    send(ws, standingsFor(outcome));
  }
}
