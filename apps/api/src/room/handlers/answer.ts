import type { Answer, AnswerProgress, ErrorCode } from '@zubatto-quiz/protocol';
import { normalizeElapsedMs } from '@zubatto-quiz/scoring';

import { answerProgressOf } from '../resend';
import { send, sendToHosts } from '../send';
import { closeAnsweringIfDue } from './host-commands';

type AcceptResult =
  | { ok: true; elapsedMs: number; progress: AnswerProgress }
  | { ok: false; code: Extract<ErrorCode, 'not_accepting' | 'invalid_choice' | 'already_answered'> };

/** 受付中の問題。正解（correct_index）は読まない（S2） */
type AcceptingQuestion = { id: string; choice_count: number; limit_ms: number };

/** 受付中の問題を読む。受付中でないとき（出題中・締切のあと・部屋を終えたあと）は undefined */
const readAcceptingQuestion = (sql: SqlStorage): AcceptingQuestion | undefined =>
  sql
    .exec<AcceptingQuestion>(
      `SELECT q.id, json_array_length(q.choices) AS choice_count, q.limit_ms
       FROM room r JOIN questions q ON q.position = r.current_position
       WHERE r.phase = 'accepting' AND r.ended_at IS NULL`,
    )
    .toArray()[0];

/**
 * 回答を1行書く。同じ人が同じ問題にもう答えていれば、UNIQUE (question_id, participant_id) のかぶりとして何もせず false を返す（S4）。
 * OR IGNORE は CHECK の違反まで黙って捨て、「回答済み」と取り違えるので使わない。かぶりを見る列を ON CONFLICT で名指しする
 */
const insertAnswerOnce = (
  sql: SqlStorage,
  answerRow: { questionId: string; participantId: string; choiceIndex: number; elapsedMs: number; receivedAt: number },
): boolean => {
  sql.exec(
    `INSERT INTO answers (question_id, participant_id, choice_index, elapsed_ms, received_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (question_id, participant_id) DO NOTHING`,
    answerRow.questionId,
    answerRow.participantId,
    answerRow.choiceIndex,
    answerRow.elapsedMs,
    answerRow.receivedAt,
  );
  const { changes } = sql.exec<{ changes: number }>('SELECT changes() AS changes').one();
  return changes > 0;
};

/**
 * 回答者の接続から来た回答を受ける（F10・S4）。participantId は、呼ぶ前に attachment から取ったもの（ADR 0004）。
 *
 * 受付中かどうかの確認から挿入までを、await を挟まず1つの transactionSync で行う。
 * DO は1つのスレッドで動くので、締切の操作や同じ人のもう1件の回答が、確認と挿入のあいだに割り込まない
 */
export function handleAnswer(ctx: DurableObjectState, ws: WebSocket, participantId: string, answer: Answer): void {
  const now = Date.now();
  // alarm は最大1分ほど遅れるので、締切を過ぎても受付中のままのことがある。先に締め切り、締切のあとの回答を通さない（F10）
  closeAnsweringIfDue(ctx, now);

  const { sql } = ctx.storage;
  const result = ctx.storage.transactionSync((): AcceptResult => {
    const question = readAcceptingQuestion(sql);
    // 古い画面から前の問題へ送られた回答も、受付中でない問題への回答として断る
    if (!question || question.id !== answer.questionId) {
      return { ok: false, code: 'not_accepting' };
    }
    // protocol は4択までの 0〜3 を通すので、この問題の選択肢の数はここで確かめる
    if (answer.choiceIndex >= question.choice_count) {
      return { ok: false, code: 'invalid_choice' };
    }
    // 端末で計った値を信じる（P2）。制限時間を超えた値は制限時間に丸め、速さの点を0にするだけで、回答としては受け付ける。
    // 負の値は protocol の検査で invalid_message になり、ここへは来ない
    const elapsedMs = normalizeElapsedMs(answer.elapsedMs, question.limit_ms);
    const inserted = insertAnswerOnce(sql, {
      questionId: question.id,
      participantId,
      choiceIndex: answer.choiceIndex,
      elapsedMs,
      receivedAt: now,
    });
    if (!inserted) {
      return { ok: false, code: 'already_answered' };
    }

    return { ok: true, elapsedMs, progress: answerProgressOf(sql, question.id) };
  });

  if (!result.ok) {
    send(ws, { type: 'error', code: result.code });
    return;
  }
  send(ws, {
    type: 'answerAccepted',
    questionId: answer.questionId,
    choiceIndex: answer.choiceIndex,
    elapsedMs: result.elapsedMs,
  });
  // 回答数は進行画面にだけ出す。回答者へは送らず、締切の直前の一斉回答でも送る数を抑える
  sendToHosts(ctx, result.progress);
}
