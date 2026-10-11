import { describe, expect, it } from 'vitest';

import { defaultScoring, type ScoringConfig } from './config.ts';
import {
  findBiggestClimber,
  findFastest,
  positionOf,
  rankByScore,
  rankUps,
  type Competitor,
  type QuestionAnswer,
} from './ranking.ts';
import { scoreAnswer } from './score.ts';

const withQuickBonus: ScoringConfig = { ...defaultScoring, quickBonus: { withinMs: 1000, points: 200 } };

/** 入室した順に joinOrder を振る */
const competitors = (scores: Record<string, number>): Competitor[] =>
  Object.entries(scores).map(([participantId, score], joinOrder) => ({ participantId, joinOrder, score }));

const ranksOf = (ranked: { participantId: string; rank: number }[]) =>
  ranked.map(({ participantId, rank }) => [participantId, rank]);

describe('rankByScore', () => {
  it('点の高い順に並べ、1位から順位を付ける', () => {
    const ranked = rankByScore(competitors({ a: 300, b: 900, c: 500 }));
    expect(ranksOf(ranked)).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('同点は同じ順位にし、次の人はその人数だけ順位を飛ばす（1位・2位・2位・4位）', () => {
    const ranked = rankByScore(competitors({ a: 900, b: 500, c: 500, d: 100 }));
    expect(ranksOf(ranked)).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });

  it('同じ順位の人は、渡した並びによらず入室した順に並べる', () => {
    const input: Competitor[] = [
      { participantId: 'late', joinOrder: 2, score: 500 },
      { participantId: 'first', joinOrder: 0, score: 500 },
      { participantId: 'top', joinOrder: 3, score: 800 },
      { participantId: 'middle', joinOrder: 1, score: 500 },
    ];
    expect(ranksOf(rankByScore(input))).toEqual([
      ['top', 1],
      ['first', 2],
      ['middle', 2],
      ['late', 2],
    ]);
  });

  it('全員が0点なら、全員が1位', () => {
    expect(rankByScore(competitors({ a: 0, b: 0 })).map(({ rank }) => rank)).toEqual([1, 1]);
  });

  it('回答者がいなければ空', () => {
    expect(rankByScore([])).toEqual([]);
  });
});

describe('要件定義書の「20名・10問の例」', () => {
  const QUESTION_COUNT = 10;
  const LIMIT_MS = 10_000;

  /** P1〜P18 は 1.50 + 0.30 × n 秒で、第 ((n − 1) mod 10) + 1 問だけ間違える。物知りは3.00秒で全問正解。勝負師は0.80秒で第3問と第7問を間違える */
  const players = [
    ...Array.from({ length: 18 }, (_, i) => {
      const n = i + 1;
      return { id: `P${n}`, elapsedMs: 1500 + 300 * n, wrong: [((n - 1) % QUESTION_COUNT) + 1] };
    }),
    { id: '物知り', elapsedMs: 3000, wrong: [] as number[] },
    { id: '勝負師', elapsedMs: 800, wrong: [3, 7] },
  ];

  const totals = (config: ScoringConfig): Competitor[] =>
    players.map(({ id, elapsedMs, wrong }, joinOrder) => {
      let score = 0;
      for (let q = 1; q <= QUESTION_COUNT; q++) {
        score += scoreAnswer({ correct: !wrong.includes(q), elapsedMs, limitMs: LIMIT_MS }, config);
      }
      return { participantId: id, joinOrder, score };
    });

  const rows = (config: ScoringConfig) =>
    rankByScore(totals(config)).map(({ participantId, rank, score }) => [rank, participantId, score]);

  it('速さの点を入れると、20人全員の点が違い、同点はない', () => {
    const ranks = rankByScore(totals(defaultScoring)).map(({ rank }) => rank);
    expect(ranks).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('ボーナスなしでは、物知りが1位で、勝負師は6位', () => {
    const result = rows(defaultScoring);
    expect(result.slice(0, 7)).toEqual([
      [1, '物知り', 8500],
      [2, 'P1', 8190],
      [3, 'P2', 8055],
      [4, 'P3', 7920],
      [5, 'P4', 7785],
      [6, '勝負師', 7680],
      [7, 'P5', 7650],
    ]);
    expect(result.at(-1)).toEqual([20, 'P18', 5895]);
  });

  it('ボーナスを足すと、勝負師が9,280点で物知りを抜いて1位になる', () => {
    const result = rows(withQuickBonus);
    expect(result.slice(0, 7)).toEqual([
      [1, '勝負師', 9280],
      [2, '物知り', 8500],
      [3, 'P1', 8190],
      [4, 'P2', 8055],
      [5, 'P3', 7920],
      [6, 'P4', 7785],
      [7, 'P5', 7650],
    ]);
    expect(result.at(-1)).toEqual([20, 'P18', 5895]);
  });
});

describe('findFastest', () => {
  const answer = (participantId: string, joinOrder: number, correct: boolean, elapsedMs: number): QuestionAnswer => ({
    participantId,
    joinOrder,
    correct,
    elapsedMs,
  });

  it('正解した人を速い順に3人まで出し、正解した人数を数える（不正解の人は速くても入らない）', () => {
    const result = findFastest([
      answer('a', 0, true, 3520),
      answer('b', 1, false, 300),
      answer('c', 2, true, 1010),
      answer('d', 3, true, 9990),
      answer('e', 4, true, 500),
    ]);
    expect(result).toEqual({
      fastest: [
        { participantId: 'e', elapsedMs: 500 },
        { participantId: 'c', elapsedMs: 1010 },
        { participantId: 'a', elapsedMs: 3520 },
      ],
      correctCount: 4,
    });
  });

  it('正解した人が3人より少なければ、その人数だけ出す', () => {
    const result = findFastest([answer('a', 0, false, 500), answer('b', 1, true, 2000)]);
    expect(result).toEqual({ fastest: [{ participantId: 'b', elapsedMs: 2000 }], correctCount: 1 });
  });

  it('全員が不正解なら、最速正解者はいない', () => {
    expect(findFastest([answer('a', 0, false, 500), answer('b', 1, false, 800)])).toEqual({
      fastest: [],
      correctCount: 0,
    });
  });

  it('経過時間（0.01秒単位）が同じ人は、入室した順に並べる', () => {
    const result = findFastest([
      answer('late', 5, true, 1000),
      answer('early', 1, true, 1000),
      answer('x', 3, true, 1200),
    ]);
    expect(result.fastest.map(({ participantId }) => participantId)).toEqual(['early', 'late', 'x']);
  });
});

describe('rankUps と findBiggestClimber', () => {
  /** 前の問題までの合計点と、この問題までの合計点から、2つのランキングを作る。並びは入室した順 */
  const rankings = (rows: [id: string, previous: number, current: number][]) => {
    const toCompetitors = (pick: 1 | 2): Competitor[] =>
      rows.map((row, joinOrder) => ({ participantId: row[0], joinOrder, score: row[pick] }));
    return { previous: rankByScore(toCompetitors(1)), current: rankByScore(toCompetitors(2)) };
  };

  it('順位が上がった人は上げた幅、変わらないか下がった人は0', () => {
    // 前: x 1位・y 2位・z 3位 → 今: z 1位・x 2位・y 3位
    const { previous, current } = rankings([
      ['x', 1000, 1500],
      ['y', 900, 1200],
      ['z', 800, 1800],
    ]);
    expect(Object.fromEntries(rankUps(previous, current))).toEqual({ x: 0, y: 0, z: 2 });
  });

  it('前のランキングにいない人（途中で入った人）は0', () => {
    const previous = rankByScore([{ participantId: 'x', joinOrder: 0, score: 500 }]);
    const current = rankByScore([
      { participantId: 'x', joinOrder: 0, score: 500 },
      { participantId: 'new', joinOrder: 1, score: 900 },
    ]);
    expect(rankUps(previous, current).get('new')).toBe(0);
    expect(findBiggestClimber(previous, current)).toBeNull();
  });

  it('第1問は前のランキングがないので、一番順位を上げた人はいない', () => {
    const current = rankByScore([{ participantId: 'x', joinOrder: 0, score: 975 }]);
    expect(findBiggestClimber([], current)).toBeNull();
  });

  it('誰も順位を上げなかったら、いない', () => {
    const { previous, current } = rankings([
      ['x', 1000, 1900],
      ['y', 900, 1000],
    ]);
    expect(findBiggestClimber(previous, current)).toBeNull();
  });

  it('上げた幅が一番大きい人を出す', () => {
    // 前: x 1・y 2・z 3・w 4 → 今: w 1（3上げた）・z 2（1上げた）・x 3・y 4
    const { previous, current } = rankings([
      ['x', 1000, 1100],
      ['y', 900, 1000],
      ['z', 800, 1700],
      ['w', 700, 1800],
    ]);
    expect(findBiggestClimber(previous, current)).toEqual({ participantId: 'w', rankUp: 3 });
  });

  it('上げた幅が同じなら、入室した順より、今の順位が上の人を優先する', () => {
    // 入室は a が先。前: x 1・y 2・z 3・b 4・a 5 → 今: b 1・a 2・x 3・y 4・z 5。a も b も3上げた
    const { previous, current } = rankings([
      ['a', 600, 1100],
      ['x', 1000, 1000],
      ['y', 900, 900],
      ['z', 800, 800],
      ['b', 700, 1200],
    ]);
    expect(findBiggestClimber(previous, current)).toEqual({ participantId: 'b', rankUp: 3 });
  });

  it('上げた幅も今の順位も同じなら、入室した順で先の人を出す', () => {
    // 前: x 1・y 2・b 3・a 3 → 今: b 1・a 1・x 3・y 4。a も b も2上げて、同じ1位
    const { previous, current } = rankings([
      ['x', 1000, 1000],
      ['y', 900, 900],
      ['b', 700, 1200],
      ['a', 700, 1200],
    ]);
    expect(findBiggestClimber(previous, current)).toEqual({ participantId: 'b', rankUp: 2 });
  });
});

describe('positionOf', () => {
  const positions = (scores: Record<string, number>) => {
    const ranking = rankByScore(competitors(scores));
    return Object.fromEntries(Object.keys(scores).map((id) => [id, positionOf(ranking, id)]));
  };

  it('1位は2位との差、2位・3位は順位と1つ上の人との差、4位以下は1つ上の人との差とトップとの差', () => {
    expect(positions({ a: 5000, b: 4800, c: 4500, d: 4000, e: 3000 })).toEqual({
      a: { kind: 'leader', leadOverNext: 200 },
      b: { kind: 'podium', rank: 2, gapToAbove: 200 },
      c: { kind: 'podium', rank: 3, gapToAbove: 300 },
      d: { kind: 'chasing', gapToAbove: 500, gapToTop: 1000 },
      e: { kind: 'chasing', gapToAbove: 1000, gapToTop: 2000 },
    });
  });

  it('回答者が1人だけなら、1位で、2位との差はない', () => {
    expect(positions({ a: 975 })).toEqual({ a: { kind: 'leader', leadOverNext: null } });
  });

  it('1位が同点なら、どちらも1位で、2位との差は0', () => {
    expect(positions({ a: 3000, b: 3000, c: 1000 })).toEqual({
      a: { kind: 'leader', leadOverNext: 0 },
      b: { kind: 'leader', leadOverNext: 0 },
      c: { kind: 'podium', rank: 3, gapToAbove: 2000 },
    });
  });

  it('全員が同点なら、全員が1位で、差は0', () => {
    expect(positions({ a: 0, b: 0 })).toEqual({
      a: { kind: 'leader', leadOverNext: 0 },
      b: { kind: 'leader', leadOverNext: 0 },
    });
  });

  it('同点の人がいても、1つ上の人は自分より点の高い人のうち一番点の低い人（同点の人とは比べない）', () => {
    // 1位・2位・2位・4位・4位
    expect(positions({ a: 5000, b: 4000, c: 4000, d: 3500, e: 3500 })).toEqual({
      a: { kind: 'leader', leadOverNext: 1000 },
      b: { kind: 'podium', rank: 2, gapToAbove: 1000 },
      c: { kind: 'podium', rank: 2, gapToAbove: 1000 },
      d: { kind: 'chasing', gapToAbove: 500, gapToTop: 1500 },
      e: { kind: 'chasing', gapToAbove: 500, gapToTop: 1500 },
    });
  });

  it('3位が同点で4人以上いても、3位の人はみな順位を出す', () => {
    const result = positions({ a: 900, b: 800, c: 700, d: 700, e: 100 });
    expect(result['d']).toEqual({ kind: 'podium', rank: 3, gapToAbove: 100 });
    expect(result['e']).toEqual({ kind: 'chasing', gapToAbove: 600, gapToTop: 800 });
  });

  it('ランキングにいない回答者を渡すと、エラーにする', () => {
    expect(() => positionOf(rankByScore(competitors({ a: 100 })), 'nobody')).toThrow(
      'ランキングにいない回答者: nobody',
    );
  });
});
