import {
  canShowStandings,
  type FastestRevealed,
  type FinalRanking,
  type MyResult,
  type Revealed,
  type Standings,
} from '@zubatto-quiz/protocol';
import {
  findBiggestClimber,
  findFastest,
  positionOf,
  rankByScore,
  rankUps,
  remainingMaxPoints,
  type Competitor,
  type QuestionAnswer,
} from '@zubatto-quiz/scoring';

/**
 * 締切のあとに配る結果（① ② ③ と最終ランキング）を、締め切った問題の得点と回答から作る（F11・F13・F14・F15）。
 *
 * 得点は締切のときに1回だけ question_scores に書く（handlers/close-question.ts）。ここではそれを読むだけで、点を計算し直さない。
 * 順位や最速正解者は保存せず、配るたびに作り直す。正本が question_scores の1か所なので、休止のあとも同じ結果になる（A3）。
 * 順位の決め方は packages/scoring に任せ、ここでは protocol の形に詰め替えるだけにする
 */

/** 回答者1人ぶんの、ある問題の結果 */
export type ParticipantOutcome = {
  participantId: string;
  name: string;
  /** 入室した順（participants.join_order） */
  joinOrder: number;
  /** 前の問題の締切のときに、もう入室していたか。前のランキングに入れる人。第1問では全員 false */
  inPreviousRanking: boolean;
  /** 前の問題までの合計点 */
  previousTotal: number;
  /** この問題の得点。回答しなかった人は0 */
  points: number;
  /** この問題の回答。時間切れ（未回答）なら null */
  answer: { choiceIndex: number; elapsedMs: number } | null;
};

/** 締め切った1問の結果。① ② ③ と最終ランキングは、どれもここから作る */
export type QuestionOutcome = {
  questionId: string;
  /** 何問目か（0始まり） */
  questionIndex: number;
  questionCount: number;
  /** 締切のあとにだけ読む（S2） */
  correctIndex: number;
  choiceCount: number;
  /** 入室した順 */
  participants: ParticipantOutcome[];
};

/** ③ に出す人数 */
const STANDINGS_COUNT = 10;

/**
 * 締め切った問題の結果を SQLite から読む。questionIndex の問題は、締切の集計を終えていること。
 * SQL は問題の1本・問題数の1本・回答者の1本で、回答者の数によらない（P4）
 */
export function readQuestionOutcome(sql: SqlStorage, questionIndex: number): QuestionOutcome {
  const question = sql
    .exec<{ id: string; correct_index: number; choice_count: number }>(
      'SELECT id, correct_index, json_array_length(choices) AS choice_count FROM questions WHERE position = ?',
      questionIndex,
    )
    .one();
  const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM questions').one();
  const rows = sql
    .exec<{
      participantId: string;
      name: string;
      joinOrder: number;
      inPreviousRanking: number;
      previousTotal: number;
      points: number;
      choiceIndex: number | null;
      elapsedMs: number | null;
    }>(
      // 前のランキングに入るのは、前の問題を締め切ったとき（closed_at）までに入室した人。
      // 第1問には前の問題がなく、副問い合わせが NULL になるので、全員が入らない
      `SELECT
         p.participant_id AS participantId,
         p.name,
         p.join_order AS joinOrder,
         coalesce(p.joined_at <= (SELECT closed_at FROM questions WHERE position = ?), 0) AS inPreviousRanking,
         (SELECT coalesce(sum(s.points), 0)
            FROM question_scores s JOIN questions q ON q.id = s.question_id
            WHERE s.participant_id = p.participant_id AND q.position < ?) AS previousTotal,
         coalesce(s.points, 0) AS points,
         a.choice_index AS choiceIndex,
         a.elapsed_ms AS elapsedMs
       FROM participants p
       LEFT JOIN answers a ON a.participant_id = p.participant_id AND a.question_id = ?
       LEFT JOIN question_scores s ON s.participant_id = p.participant_id AND s.question_id = ?
       ORDER BY p.join_order`,
      questionIndex - 1,
      questionIndex,
      question.id,
      question.id,
    )
    .toArray();

  return {
    questionId: question.id,
    questionIndex,
    questionCount: count,
    correctIndex: question.correct_index,
    choiceCount: question.choice_count,
    participants: rows.map(({ choiceIndex, elapsedMs, inPreviousRanking, ...row }) => ({
      ...row,
      inPreviousRanking: inPreviousRanking === 1,
      answer: choiceIndex === null || elapsedMs === null ? null : { choiceIndex, elapsedMs },
    })),
  };
}

/** 最後の2問か。③ を出せない問題では、② と自分の位置でも順位にかかわることを伏せる（F15）。問題が2問以下なら、どの問題も伏せる */
const ranksHidden = (outcome: QuestionOutcome): boolean =>
  !canShowStandings(outcome.questionIndex, outcome.questionCount);

const isCorrect = (outcome: QuestionOutcome, participant: ParticipantOutcome): boolean =>
  participant.answer?.choiceIndex === outcome.correctIndex;

/** 前の問題までのランキングと、この問題までのランキング */
function rankingsOf({ participants }: QuestionOutcome) {
  const competitor = (participant: ParticipantOutcome, score: number): Competitor => ({
    participantId: participant.participantId,
    joinOrder: participant.joinOrder,
    score,
  });
  return {
    previous: rankByScore(participants.filter((p) => p.inPreviousRanking).map((p) => competitor(p, p.previousTotal))),
    current: rankByScore(participants.map((p) => competitor(p, p.previousTotal + p.points))),
  };
}

/** participantId から回答者を引く。scoring の関数は ID しか返さないので、名前を足すときに使う */
function byId({ participants }: QuestionOutcome): (participantId: string) => ParticipantOutcome {
  const map = new Map(participants.map((participant) => [participant.participantId, participant]));
  return (participantId) => {
    const participant = map.get(participantId);
    if (participant === undefined) throw new Error(`結果にいない回答者: ${participantId}`);
    return participant;
  };
}

/** ① ホストへ: 正解と、選択肢ごとに選んだ人数（F13） */
export function revealedFor(outcome: QuestionOutcome): Revealed {
  const choiceCounts = Array.from({ length: outcome.choiceCount }, () => 0);
  for (const { answer } of outcome.participants) {
    if (answer !== null) choiceCounts[answer.choiceIndex] += 1;
  }
  return {
    type: 'revealed',
    questionId: outcome.questionId,
    correctIndex: outcome.correctIndex,
    choiceCounts,
    answeredCount: outcome.participants.filter(({ answer }) => answer !== null).length,
    participantCount: outcome.participants.length,
  };
}

/** ① 回答者1人ずつへ: 正解・自分の正誤と得点・自分の位置（F11・F15）。participantId ごとに返す */
export function myResultsFor(outcome: QuestionOutcome): Map<string, MyResult> {
  const { previous, current } = rankingsOf(outcome);
  const rankUpById = rankUps(previous, current);
  const hidden = ranksHidden(outcome);
  const remaining = remainingMaxPoints(outcome.questionCount - outcome.questionIndex - 1);

  return new Map(
    outcome.participants.map((participant): [string, MyResult] => {
      const { participantId } = participant;
      return [
        participantId,
        {
          type: 'myResult',
          questionId: outcome.questionId,
          correctIndex: outcome.correctIndex,
          answer: participant.answer,
          correct: isCorrect(outcome, participant),
          points: participant.points,
          totalScore: participant.previousTotal + participant.points,
          remainingMaxPoints: remaining,
          position: hidden
            ? { kind: 'hidden' }
            : { ...positionOf(current, participantId), rankUp: rankUpById.get(participantId) ?? 0 },
        },
      ];
    }),
  );
}

/** ② 全員へ: 最速の3人と秒数・正解した人数・この問題で一番順位を上げた人（F14） */
export function fastestFor(outcome: QuestionOutcome): FastestRevealed {
  const participantOf = byId(outcome);
  const answers: QuestionAnswer[] = outcome.participants.flatMap((participant) =>
    participant.answer === null
      ? []
      : [
          {
            participantId: participant.participantId,
            joinOrder: participant.joinOrder,
            correct: isCorrect(outcome, participant),
            elapsedMs: participant.answer.elapsedMs,
          },
        ],
  );
  const { fastest, correctCount } = findFastest(answers);
  const base = {
    type: 'fastest' as const,
    questionId: outcome.questionId,
    correctIndex: outcome.correctIndex,
    fastest: fastest.map((fast) => ({ ...fast, name: participantOf(fast.participantId).name })),
    correctCount,
    answeredCount: answers.length,
  };
  if (ranksHidden(outcome)) {
    return { ...base, ranksHidden: true };
  }

  const { previous, current } = rankingsOf(outcome);
  const climber = findBiggestClimber(previous, current);
  return {
    ...base,
    ranksHidden: false,
    biggestClimber: climber && { ...climber, name: participantOf(climber.participantId).name },
  };
}

/** ③ 全員へ: 上位10人の途中経過（F15）。最後の2問では、進行の操作（canShowStandings）が断るので呼ばれない */
export function standingsFor(outcome: QuestionOutcome): Standings {
  const participantOf = byId(outcome);
  return {
    type: 'standings',
    questionId: outcome.questionId,
    questionIndex: outcome.questionIndex,
    participantCount: outcome.participants.length,
    entries: rankingsOf(outcome)
      .current.slice(0, STANDINGS_COUNT)
      .map(({ participantId, rank, score }) => {
        const { name, points } = participantOf(participantId);
        return { participantId, name, rank, totalScore: score, points };
      }),
  };
}

/** 全員へ: 最終ランキング（F15）。最後の問題の結果から、全員の順位を出す */
export function finalRankingFor(outcome: QuestionOutcome): FinalRanking {
  const participantOf = byId(outcome);
  return {
    type: 'finalRanking',
    questionCount: outcome.questionCount,
    entries: rankingsOf(outcome).current.map(({ participantId, rank, score }) => ({
      participantId,
      name: participantOf(participantId).name,
      rank,
      totalScore: score,
    })),
  };
}
