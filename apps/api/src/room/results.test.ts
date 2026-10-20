import { describe, expect, it } from 'vitest';

import {
  fastestFor,
  finalRankingFor,
  myResultsFor,
  revealedFor,
  standingsFor,
  type ParticipantOutcome,
  type QuestionOutcome,
} from './results';

/** 回答者1人ぶん。並べた順を入室した順にし、指定しなければ前の問題から入室していて、前の合計0点・未回答・0点（ボーナスも0点） */
const participant = (id: string, fields: Partial<Omit<ParticipantOutcome, 'participantId'>> = {}) => ({
  participantId: id,
  name: `${id}さん`,
  inPreviousRanking: true,
  previousTotal: 0,
  points: 0,
  bonusPoints: 0,
  answer: null,
  ...fields,
});

/** 10問のうちの第 questionIndex + 1 問。正解は0番目で、選択肢は4つ */
const outcome = (
  participants: ReturnType<typeof participant>[],
  fields: Partial<Omit<QuestionOutcome, 'participants'>> = {},
): QuestionOutcome => ({
  questionId: 'q-1',
  questionIndex: 1,
  questionCount: 10,
  correctIndex: 0,
  choiceCount: 4,
  participants: participants.map((p, joinOrder) => ({ ...p, joinOrder })),
  ...fields,
});

const correctAnswer = (elapsedMs: number) => ({ choiceIndex: 0, elapsedMs });
const wrongAnswer = (elapsedMs: number) => ({ choiceIndex: 1, elapsedMs });

describe('revealedFor（① ホストへ）', () => {
  it('正解と、選択肢ごとに選んだ人数・回答した人数・回答者の数を出す', () => {
    const result = revealedFor(
      outcome([
        participant('a', { answer: correctAnswer(1000) }),
        participant('b', { answer: wrongAnswer(2000) }),
        participant('c', { answer: correctAnswer(3000) }),
        participant('d'),
      ]),
    );

    expect(result).toEqual({
      type: 'revealed',
      questionId: 'q-1',
      correctIndex: 0,
      choiceCounts: [2, 1, 0, 0],
      answeredCount: 3,
      participantCount: 4,
    });
  });
});

describe('myResultsFor（① 回答者1人ずつへ）', () => {
  it('自分の回答・正誤・この問題の点とそのうちのボーナス・合計点・残りの問題で取れる最大の点を出す', () => {
    const results = myResultsFor(
      outcome(
        [
          participant('a', { previousTotal: 900, points: 1150, bonusPoints: 200, answer: correctAnswer(1000) }),
          participant('b', { previousTotal: 800, answer: wrongAnswer(500) }),
          participant('c', { previousTotal: 700 }),
        ],
        { questionIndex: 3 },
      ),
    );

    // 10問のうち第4問なので、残りは6問 × ボーナスを含む1問の最大 1,200点（F15）
    expect(results.get('a')).toMatchObject({
      type: 'myResult',
      questionId: 'q-1',
      correctIndex: 0,
      answer: { choiceIndex: 0, elapsedMs: 1000 },
      correct: true,
      points: 1150,
      bonusPoints: 200,
      totalScore: 2050,
      remainingMaxPoints: 7200,
    });
    expect(results.get('b')).toMatchObject({
      answer: { choiceIndex: 1, elapsedMs: 500 },
      correct: false,
      points: 0,
      bonusPoints: 0,
    });
    // 時間切れ（未回答）は answer が null で、不正解と同じく0点
    expect(results.get('c')).toMatchObject({ answer: null, correct: false, points: 0, totalScore: 700 });
  });

  it('自分の位置は、1位が2位との差、2位・3位が順位、4位以下が順位の数字なしで出る（F15）', () => {
    const results = myResultsFor(
      outcome([
        participant('a', { previousTotal: 5000 }),
        participant('b', { previousTotal: 4800 }),
        participant('c', { previousTotal: 4500 }),
        participant('d', { previousTotal: 4000 }),
      ]),
    );

    expect(Object.fromEntries([...results].map(([id, result]) => [id, result.position]))).toEqual({
      a: { kind: 'leader', rankUp: 0, leadOverNext: 200 },
      b: { kind: 'podium', rank: 2, rankUp: 0, gapToAbove: 200 },
      c: { kind: 'podium', rank: 3, rankUp: 0, gapToAbove: 300 },
      d: { kind: 'chasing', rankUp: 0, gapToAbove: 500, gapToTop: 1000 },
    });
  });

  it('前の問題からの順位の上がり幅を rankUp に出す。途中で入った人は0', () => {
    // 前: a 1位・b 2位 → 今: b 1位・late 2位・a 3位
    const results = myResultsFor(
      outcome([
        participant('a', { previousTotal: 1000 }),
        participant('b', { previousTotal: 900, points: 950 }),
        participant('late', { inPreviousRanking: false, points: 1200 }),
      ]),
    );

    expect(results.get('b')?.position).toMatchObject({ kind: 'leader', rankUp: 1 });
    expect(results.get('late')?.position).toMatchObject({ kind: 'podium', rank: 2, rankUp: 0 });
    expect(results.get('a')?.position).toMatchObject({ kind: 'podium', rank: 3, rankUp: 0 });
  });
});

describe('fastestFor（② 全員へ）', () => {
  it('正解した人を速い順に3人まで、名前と0.01秒単位の秒数で出し、正解した人数と回答した人数を数える（F14）', () => {
    const result = fastestFor(
      outcome([
        participant('a', { answer: correctAnswer(3520) }),
        participant('b', { answer: wrongAnswer(300) }),
        participant('c', { answer: correctAnswer(1010) }),
        participant('d', { answer: correctAnswer(9990) }),
        participant('e', { answer: correctAnswer(500) }),
        participant('f'),
      ]),
    );

    expect(result).toMatchObject({
      type: 'fastest',
      questionId: 'q-1',
      correctIndex: 0,
      fastest: [
        { participantId: 'e', name: 'eさん', elapsedMs: 500 },
        { participantId: 'c', name: 'cさん', elapsedMs: 1010 },
        { participantId: 'a', name: 'aさん', elapsedMs: 3520 },
      ],
      correctCount: 4,
      answeredCount: 5,
      ranksHidden: false,
    });
  });

  it('全員が不正解なら、最速正解者は「なし」（空）で、正解した人数は0（F14）', () => {
    const result = fastestFor(
      outcome([participant('a', { answer: wrongAnswer(500) }), participant('b', { answer: wrongAnswer(800) })]),
    );

    expect(result).toMatchObject({ fastest: [], correctCount: 0, answeredCount: 2 });
  });

  it('この問題で一番順位を上げた人を、名前と上げた幅で出す', () => {
    // 前: x 1・y 2・z 3 → 今: z 1・x 2・y 3
    const result = fastestFor(
      outcome([
        participant('x', { previousTotal: 1000, points: 500 }),
        participant('y', { previousTotal: 900, points: 300 }),
        participant('z', { previousTotal: 800, points: 1000 }),
      ]),
    );

    expect(result).toMatchObject({
      ranksHidden: false,
      biggestClimber: { participantId: 'z', name: 'zさん', rankUp: 2 },
    });
  });

  it('第1問は前のランキングがないので、一番順位を上げた人は null', () => {
    const result = fastestFor(
      outcome(
        [
          participant('a', { inPreviousRanking: false, points: 900 }),
          participant('b', { inPreviousRanking: false, points: 950 }),
        ],
        { questionIndex: 0 },
      ),
    );

    expect(result).toMatchObject({ ranksHidden: false, biggestClimber: null });
  });
});

describe('最後の2問（F15）', () => {
  // 伏せるのは、③ を出せない問題（canShowStandings）と同じ。10問なら第9問（questionIndex 8）から
  it.each<[questionCount: number, questionIndex: number, hidden: boolean]>([
    [10, 0, false],
    [10, 7, false],
    [10, 8, true],
    [10, 9, true],
    [3, 0, false],
    [3, 1, true],
    // 問題が2問以下なら、どの問題も最後の2問に入る
    [2, 0, true],
    [2, 1, true],
    [1, 0, true],
  ])('%i問のうち questionIndex %i で、順位にかかわることを伏せるか: %s', (questionCount, questionIndex, hidden) => {
    const result = outcome([participant('a', { points: 900 }), participant('b')], { questionCount, questionIndex });

    expect(myResultsFor(result).get('a')?.position.kind === 'hidden').toBe(hidden);
    expect(fastestFor(result).ranksHidden).toBe(hidden);
  });
});

describe('standingsFor（③ 全員へ）', () => {
  it('上位10人を、順位・合計点・この問題の点と一緒に出す。同点は同じ順位で、入室した順に並べる', () => {
    // 12人。p0 が一番高く、p11 が一番低い。p3 と p4 は同点
    const scores = [1200, 1100, 1000, 900, 900, 700, 600, 500, 400, 300, 200, 100];
    const result = standingsFor(
      outcome(scores.map((score, i) => participant(`p${i}`, { previousTotal: score - 50, points: 50 }))),
    );

    expect(result.type).toBe('standings');
    expect(result.questionId).toBe('q-1');
    expect(result.questionIndex).toBe(1);
    expect(result.participantCount).toBe(12);
    expect(result.entries).toHaveLength(10);
    expect(result.entries.slice(2, 6)).toEqual([
      { participantId: 'p2', name: 'p2さん', rank: 3, totalScore: 1000, points: 50 },
      { participantId: 'p3', name: 'p3さん', rank: 4, totalScore: 900, points: 50 },
      { participantId: 'p4', name: 'p4さん', rank: 4, totalScore: 900, points: 50 },
      { participantId: 'p5', name: 'p5さん', rank: 6, totalScore: 700, points: 50 },
    ]);
  });
});

describe('finalRankingFor（最終ランキング）', () => {
  it('全員を、最後の問題までの合計点で順位を付けて出す', () => {
    const result = finalRankingFor(
      outcome(
        [
          participant('a', { previousTotal: 8000, points: 500 }),
          participant('b', { previousTotal: 8000, points: 900 }),
          participant('c', { previousTotal: 8500 }),
        ],
        { questionIndex: 9 },
      ),
    );

    expect(result).toEqual({
      type: 'finalRanking',
      questionCount: 10,
      entries: [
        { participantId: 'b', name: 'bさん', rank: 1, totalScore: 8900 },
        { participantId: 'a', name: 'aさん', rank: 2, totalScore: 8500 },
        { participantId: 'c', name: 'cさん', rank: 2, totalScore: 8500 },
      ],
    });
  });
});
